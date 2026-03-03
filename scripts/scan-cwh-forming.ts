#!/usr/bin/env npx tsx
// ============================================================
// CWH形成中スキャナー
// カップが完成し、ハンドル部分を形成中（ブレイクアウト前）の銘柄を抽出
//
// 使い方:
//   npx tsx scripts/scan-cwh-forming.ts                  # お気に入り銘柄
//   npx tsx scripts/scan-cwh-forming.ts --all             # 全銘柄スキャン
//   npx tsx scripts/scan-cwh-forming.ts --csv             # CSV出力あり
//   npx tsx scripts/scan-cwh-forming.ts --market prime    # 市場区分フィルタ
//   npx tsx scripts/scan-cwh-forming.ts --ready-only      # handle_readyのみ
//   npx tsx scripts/scan-cwh-forming.ts --max-distance 10 # BO距離10%以内 (デフォルト無制限)
//   npx tsx scripts/scan-cwh-forming.ts --supabase        # Supabaseに保存
//   npx tsx scripts/scan-cwh-forming.ts --scan-id 42      # 既存レコード更新 (GHA用)
// ============================================================

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import YahooFinance from "yahoo-finance2";
import { RequestQueue } from "@/lib/utils/requestQueue";
import { createServiceClient } from "@/lib/supabase/service";
import { detectCupWithHandleForming, type CwhFormingPattern } from "@/lib/utils/signals";
import { calcMultiPeriodSharpe } from "@/lib/utils/indicators";
import { getFinancialMetrics } from "@/lib/api/yahooFinance";
import { sleep, getArgs, hasFlag, parseFlag, parseIntFlag } from "@/lib/utils/cli";
import type { PriceData } from "@/types";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
const yfQueue = new RequestQueue(10);

// ── Types ──

interface StockInfo {
  symbol: string;
  name: string;
  marketSegment?: string;
  sectors?: string[];
  favorite?: boolean;
}

interface ScanResult {
  stock: StockInfo;
  pattern: CwhFormingPattern;
  prices: PriceData[];
}

export interface CwhFormingRow {
  symbol: string;
  name: string;
  marketSegment: string;
  stage: string;
  currentPrice: number;
  breakoutPrice: number;
  distancePct: number;
  pullbackPct: number;
  handleDays: number;
  cupDays: number;
  cupDepthPct: number;
  leftRimDate: string;
  bottomDate: string;
  rightRimDate: string;
  // 財務指標 (enrichment phase)
  marketCap: number | null;
  sharpe3m: number | null;
  sharpe6m: number | null;
  sharpe1y: number | null;
  roe: number | null;
  equityRatio: number | null;
  profitGrowthRate: number | null;
  prevProfitGrowthRate: number | null;
  // 出来高
  volume: number | null;
  avgVolume5d: number | null;
}

// ── CLI ──

const args = getArgs();
const ALL_STOCKS = hasFlag(args, "--all");
const CSV_OUTPUT = hasFlag(args, "--csv");
const READY_ONLY = hasFlag(args, "--ready-only");
const MARKET_FILTER = parseFlag(args, "--market")?.toLowerCase();
const MAX_DISTANCE = parseFloat(parseFlag(args, "--max-distance") ?? "100");
const DO_SUPABASE = hasFlag(args, "--supabase");
const SCAN_ID = parseIntFlag(args, "--scan-id", -1) === -1 ? undefined : parseIntFlag(args, "--scan-id", -1);

// ── Supabase ──

async function updateProgress(scanId: number | undefined, progress: { stage: string; current: number; total: number; message: string }): Promise<void> {
  if (!scanId) return;
  try {
    const supabase = createServiceClient();
    await supabase.from("cwh_forming_scans").update({ progress }).eq("id", scanId);
  } catch { /* best effort */ }
}

async function uploadScanResults(rows: CwhFormingRow[], scanId?: number): Promise<void> {
  const supabase = createServiceClient();
  const payload = {
    status: "completed" as const,
    stocks: JSON.stringify(rows),
    stock_count: rows.length,
    ready_count: rows.filter((r) => r.stage === "handle_ready").length,
    completed_at: new Date().toISOString(),
  };

  if (scanId) {
    const { error } = await supabase.from("cwh_forming_scans").update(payload).eq("id", scanId);
    if (error) console.error("Supabase update error:", error.message);
    else console.log(`Supabase scan #${scanId} updated`);
  } else {
    const { error } = await supabase.from("cwh_forming_scans").insert(payload);
    if (error) console.error("Supabase insert error:", error.message);
    else console.log("Supabase scan inserted");
  }
}

async function markScanFailed(scanId: number, errorMsg: string): Promise<void> {
  try {
    const supabase = createServiceClient();
    await supabase.from("cwh_forming_scans")
      .update({ status: "failed", error_message: errorMsg, completed_at: new Date().toISOString() })
      .eq("id", scanId);
  } catch { /* best effort */ }
}

// ── ウォッチリスト読込み ──

function loadStocks(): StockInfo[] {
  const watchlistPath = join(process.cwd(), "data", "watchlist.json");
  const watchlist = JSON.parse(readFileSync(watchlistPath, "utf-8"));
  let stocks: StockInfo[] = watchlist.stocks.map((s: Record<string, unknown>) => ({
    symbol: s.symbol as string,
    name: s.name as string,
    marketSegment: s.marketSegment as string | undefined,
    sectors: s.sectors as string[] | undefined,
    favorite: s.favorite as boolean | undefined,
  }));

  if (!ALL_STOCKS) {
    stocks = stocks.filter((s) => s.favorite);
  }

  if (MARKET_FILTER) {
    stocks = stocks.filter((s) => s.marketSegment?.toLowerCase().includes(MARKET_FILTER));
  }

  return stocks;
}

// ── Yahoo Finance データ取得 ──

async function fetchPrices(symbol: string): Promise<PriceData[]> {
  const period1 = new Date();
  period1.setFullYear(period1.getFullYear() - 1);

  const result = await yf.historical(symbol, {
    period1,
    period2: new Date(),
    interval: "1d",
  });

  return result.map((row) => ({
    date:
      row.date instanceof Date
        ? row.date.toISOString().split("T")[0]
        : String(row.date),
    open: row.open ?? 0,
    high: row.high ?? 0,
    low: row.low ?? 0,
    close: row.close ?? 0,
    volume: row.volume ?? 0,
  }));
}

// ── メイン ──

async function main() {
  const stocks = loadStocks();
  console.log(`\n📊 CWH形成中スキャナー`);
  console.log(`   対象: ${stocks.length}銘柄${ALL_STOCKS ? " (全銘柄)" : " (お気に入り)"}`);
  if (MAX_DISTANCE < 100) console.log(`   BO距離: ${MAX_DISTANCE}%以内`);
  if (MARKET_FILTER) console.log(`   市場: ${MARKET_FILTER}`);
  if (READY_ONLY) console.log(`   handle_readyのみ`);
  if (DO_SUPABASE) console.log(`   Supabase: ON${SCAN_ID ? ` (scan #${SCAN_ID})` : ""}`);
  console.log();

  if (DO_SUPABASE && SCAN_ID) {
    await updateProgress(SCAN_ID, { stage: "scanning", current: 0, total: stocks.length, message: "スキャン開始..." });
  }

  const results: ScanResult[] = [];
  let processed = 0;
  let errors = 0;

  // バッチ処理
  const BATCH = 10;
  for (let i = 0; i < stocks.length; i += BATCH) {
    const batch = stocks.slice(i, i + BATCH);
    const promises = batch.map(async (stock) => {
      try {
        const prices = await yfQueue.add(() => fetchPrices(stock.symbol));
        if (prices.length < 50) return;

        const patterns = detectCupWithHandleForming(prices);
        for (const pattern of patterns) {
          if (READY_ONLY && pattern.stage !== "handle_ready") continue;
          if (pattern.distanceToBreakoutPct > MAX_DISTANCE) continue;
          results.push({ stock, pattern, prices });
        }
      } catch {
        errors++;
      } finally {
        processed++;
        if (processed % 50 === 0 || processed === stocks.length) {
          process.stdout.write(`\r   処理中: ${processed}/${stocks.length} (検出: ${results.length})`);
        }
      }
    });
    await Promise.all(promises);
    if (i + BATCH < stocks.length) await sleep(200);

    // Supabase 進捗更新 (500件ごと)
    if (DO_SUPABASE && SCAN_ID && processed % 500 < BATCH) {
      await updateProgress(SCAN_ID, {
        stage: "scanning",
        current: processed,
        total: stocks.length,
        message: `${processed}/${stocks.length} 処理済み (${results.length}件検出)`,
      });
    }
  }

  console.log(`\n\n✅ 完了: ${processed}銘柄処理, ${errors}エラー\n`);

  // ソート: handle_ready優先, 次にブレイクアウトまでの距離が近い順
  results.sort((a, b) => {
    if (a.pattern.stage !== b.pattern.stage) {
      return a.pattern.stage === "handle_ready" ? -1 : 1;
    }
    return a.pattern.distanceToBreakoutPct - b.pattern.distanceToBreakoutPct;
  });

  // コンソール出力
  if (results.length > 0) {
    console.log(`🔍 CWH形成中: ${results.length}銘柄\n`);
    console.log(
      "ステージ".padEnd(14) +
      "銘柄".padEnd(18) +
      "現在値".padStart(10) +
      "BO価格".padStart(10) +
      "距離%".padStart(8) +
      "押し目%".padStart(8) +
      "ハンドル日".padStart(10) +
      "カップ日".padStart(8) +
      "深さ%".padStart(8) +
      "  右リム日"
    );
    console.log("─".repeat(110));

    for (const r of results) {
      const p = r.pattern;
      const stageLabel = p.stage === "handle_ready" ? "🟢 READY" : "🟡 FORMING";
      const name = (r.stock.symbol + " " + r.stock.name).slice(0, 16);
      console.log(
        stageLabel.padEnd(14) +
        name.padEnd(18) +
        p.currentPrice.toFixed(0).padStart(10) +
        p.breakoutPrice.toFixed(0).padStart(10) +
        p.distanceToBreakoutPct.toFixed(1).padStart(8) +
        p.pullbackPct.toFixed(1).padStart(8) +
        String(p.handleDays).padStart(10) +
        String(p.cupDays).padStart(8) +
        p.cupDepthPct.toFixed(1).padStart(8) +
        "  " + p.rightRimDate
      );
    }
  } else {
    console.log("CWH形成中の銘柄は見つかりませんでした。");
  }

  // ── 財務指標エンリッチメント ──
  console.log(`\n📈 財務指標を取得中 (${results.length}銘柄)...`);

  if (DO_SUPABASE && SCAN_ID) {
    await updateProgress(SCAN_ID, { stage: "enriching", current: 0, total: results.length, message: "財務指標を取得中..." });
  }

  // 1. バッチquoteで時価総額を取得
  const marketCapMap = new Map<string, number | null>();
  const QUOTE_BATCH = 50;
  const symbols = results.map((r) => r.stock.symbol);
  for (let qi = 0; qi < symbols.length; qi += QUOTE_BATCH) {
    const batch = symbols.slice(qi, qi + QUOTE_BATCH);
    try {
      const quotes = await yfQueue.add(() => yf.quote(batch));
      for (const q of quotes) {
        if (q.symbol) {
          marketCapMap.set(q.symbol, (q as Record<string, unknown>).marketCap as number ?? null);
        }
      }
    } catch { /* skip */ }
    if (qi + QUOTE_BATCH < symbols.length) await sleep(200);
  }

  // 2. シャープレシオを価格データからマルチ期間で計算
  const sharpeMap = new Map<string, { sharpe3m: number | null; sharpe6m: number | null; sharpe1y: number | null }>();
  for (const r of results) {
    sharpeMap.set(r.stock.symbol, calcMultiPeriodSharpe(r.prices));
  }

  // 3. getFinancialMetrics で ROE/自己資本比率/増益率/前期増益率
  const metricsMap = new Map<string, { roe: number | null; equityRatio: number | null; profitGrowthRate: number | null; prevProfitGrowthRate: number | null }>();
  let enriched = 0;
  const ENRICH_BATCH = 10;
  for (let ei = 0; ei < results.length; ei += ENRICH_BATCH) {
    const batch = results.slice(ei, ei + ENRICH_BATCH);
    await Promise.all(batch.map(async (r) => {
      try {
        const mc = marketCapMap.get(r.stock.symbol) ?? 0;
        const metrics = await getFinancialMetrics(r.stock.symbol, mc);
        metricsMap.set(r.stock.symbol, {
          roe: metrics.roe,
          equityRatio: metrics.equityRatio,
          profitGrowthRate: metrics.profitGrowthRate,
          prevProfitGrowthRate: metrics.prevProfitGrowthRate,
        });
      } catch { /* skip */ }
      enriched++;
      if (enriched % 50 === 0) {
        process.stdout.write(`\r   エンリッチ: ${enriched}/${results.length}`);
      }
    }));
    if (ei + ENRICH_BATCH < results.length) await sleep(200);
  }
  console.log(`\r   エンリッチ完了: ${enriched}/${results.length}`);

  // データ行を生成
  const rows: CwhFormingRow[] = results.map((r) => {
    const sym = r.stock.symbol;
    const mc = marketCapMap.get(sym) ?? null;
    const metrics = metricsMap.get(sym);
    // ROEは小数 (e.g., 0.15) → %表示 (15.0)
    const roeVal = metrics?.roe != null ? Math.round(metrics.roe * 1000) / 10 : null;
    return {
      symbol: sym,
      name: r.stock.name,
      marketSegment: r.stock.marketSegment ?? "",
      stage: r.pattern.stage,
      currentPrice: Math.round(r.pattern.currentPrice),
      breakoutPrice: Math.round(r.pattern.breakoutPrice),
      distancePct: Math.round(r.pattern.distanceToBreakoutPct * 10) / 10,
      pullbackPct: Math.round(r.pattern.pullbackPct * 10) / 10,
      handleDays: r.pattern.handleDays,
      cupDays: r.pattern.cupDays,
      cupDepthPct: Math.round(r.pattern.cupDepthPct * 10) / 10,
      leftRimDate: r.pattern.leftRimDate,
      bottomDate: r.pattern.bottomDate,
      rightRimDate: r.pattern.rightRimDate,
      marketCap: mc,
      sharpe3m: sharpeMap.get(sym)?.sharpe3m ?? null,
      sharpe6m: sharpeMap.get(sym)?.sharpe6m ?? null,
      sharpe1y: sharpeMap.get(sym)?.sharpe1y ?? null,
      roe: roeVal,
      equityRatio: metrics?.equityRatio ?? null,
      profitGrowthRate: metrics?.profitGrowthRate ?? null,
      prevProfitGrowthRate: metrics?.prevProfitGrowthRate ?? null,
      // 出来高 (prices は日付昇順)
      volume: r.prices.length >= 1 ? r.prices[r.prices.length - 1].volume : null,
      avgVolume5d: r.prices.length >= 5
        ? Math.round(r.prices.slice(-5).reduce((sum, p) => sum + p.volume, 0) / 5)
        : null,
    };
  });

  // JSON出力 (ローカル用)
  const jsonPath = join(process.cwd(), "data", "cwh-forming.json");
  writeFileSync(jsonPath, JSON.stringify({
    scannedAt: new Date().toISOString(),
    stockCount: rows.length,
    readyCount: rows.filter((r) => r.stage === "handle_ready").length,
    stocks: rows,
  }, null, 2), "utf-8");
  console.log(`\n📄 JSON出力: ${jsonPath}`);

  // Supabase アップロード
  if (DO_SUPABASE) {
    if (SCAN_ID) {
      await updateProgress(SCAN_ID, { stage: "uploading", current: 0, total: 1, message: "アップロード中..." });
    }
    await uploadScanResults(rows, SCAN_ID);
  }

  // CSV出力
  if (CSV_OUTPUT) {
    const csvLines = [
      "stage,symbol,name,marketSegment,currentPrice,breakoutPrice,distancePct,pullbackPct,handleDays,cupDays,cupDepthPct,leftRimDate,bottomDate,rightRimDate",
    ];
    for (const row of rows) {
      csvLines.push([
        row.stage, row.symbol, `"${row.name}"`, `"${row.marketSegment}"`,
        row.currentPrice, row.breakoutPrice, row.distancePct, row.pullbackPct,
        row.handleDays, row.cupDays, row.cupDepthPct,
        row.leftRimDate, row.bottomDate, row.rightRimDate,
      ].join(","));
    }
    const csvPath = join(process.cwd(), "data", "cwh-forming.csv");
    writeFileSync(csvPath, csvLines.join("\n"), "utf-8");
    console.log(`📄 CSV出力: ${csvPath}`);
  }

  console.log();
}

main().catch(async (err) => {
  console.error(err);
  if (DO_SUPABASE && SCAN_ID) {
    await markScanFailed(SCAN_ID, String(err));
  }
  process.exit(1);
});

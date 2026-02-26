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
// ============================================================

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import YahooFinance from "yahoo-finance2";
import { RequestQueue } from "@/lib/utils/requestQueue";
import { detectCupWithHandleForming, type CwhFormingPattern } from "@/lib/utils/signals";
import { sleep, getArgs, hasFlag, parseFlag } from "@/lib/utils/cli";
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
}

/** JSON出力用の型 */
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
}

// ── CLI ──

const args = getArgs();
const ALL_STOCKS = hasFlag(args, "--all");
const CSV_OUTPUT = hasFlag(args, "--csv");
const READY_ONLY = hasFlag(args, "--ready-only");
const MARKET_FILTER = parseFlag(args, "--market")?.toLowerCase();
const MAX_DISTANCE = parseFloat(parseFlag(args, "--max-distance") ?? "100");

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
  console.log();

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
          results.push({ stock, pattern });
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
  }

  console.log(`\n\n✅ 完了: ${processed}銘柄処理, ${errors}エラー\n`);

  if (results.length === 0) {
    console.log("CWH形成中の銘柄は見つかりませんでした。\n");
    return;
  }

  // ソート: handle_ready優先, 次にブレイクアウトまでの距離が近い順
  results.sort((a, b) => {
    if (a.pattern.stage !== b.pattern.stage) {
      return a.pattern.stage === "handle_ready" ? -1 : 1;
    }
    return a.pattern.distanceToBreakoutPct - b.pattern.distanceToBreakoutPct;
  });

  // コンソール出力
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

  // JSON出力 (常に書き出し → APIから読み取り)
  const rows: CwhFormingRow[] = results.map((r) => ({
    symbol: r.stock.symbol,
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
  }));

  const jsonPath = join(process.cwd(), "data", "cwh-forming.json");
  writeFileSync(jsonPath, JSON.stringify({
    scannedAt: new Date().toISOString(),
    stockCount: rows.length,
    readyCount: rows.filter((r) => r.stage === "handle_ready").length,
    stocks: rows,
  }, null, 2), "utf-8");
  console.log(`\n📄 JSON出力: ${jsonPath}`);

  // CSV出力
  if (CSV_OUTPUT) {
    const csvLines = [
      "stage,symbol,name,marketSegment,currentPrice,breakoutPrice,distancePct,pullbackPct,handleDays,cupDays,cupDepthPct,leftRimDate,bottomDate,rightRimDate",
    ];
    for (const row of rows) {
      csvLines.push([
        row.stage,
        row.symbol,
        `"${row.name}"`,
        `"${row.marketSegment}"`,
        row.currentPrice,
        row.breakoutPrice,
        row.distancePct,
        row.pullbackPct,
        row.handleDays,
        row.cupDays,
        row.cupDepthPct,
        row.leftRimDate,
        row.bottomDate,
        row.rightRimDate,
      ].join(","));
    }
    const csvPath = join(process.cwd(), "data", "cwh-forming.csv");
    writeFileSync(csvPath, csvLines.join("\n"), "utf-8");
    console.log(`📄 CSV出力: ${csvPath}`);
  }

  console.log();
}

main().catch(console.error);

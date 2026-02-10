#!/usr/bin/env npx tsx
// ============================================================
// 日次シグナルスキャン
// 全上場銘柄の価格データ取得 + シグナル検知 → Supabase 保存
//
// 使い方:
//   npx tsx scripts/daily-signal-scan.ts                      # ローカル実行
//   npx tsx scripts/daily-signal-scan.ts --supabase           # Supabase保存 (GHA用)
//   npx tsx scripts/daily-signal-scan.ts --supabase --scan-id 42
//   npx tsx scripts/daily-signal-scan.ts --favorites-only     # お気に入りのみ
//   npx tsx scripts/daily-signal-scan.ts --dry-run            # DB書込みなし
// ============================================================

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import YahooFinance from "yahoo-finance2";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { strategies, getStrategyParams } from "@/lib/backtest/strategies";
import { getExitLevels } from "@/lib/utils/exitLevels";
import type { PriceData } from "@/types";
import type { Signal } from "@/lib/backtest/types";
import type { PeriodType } from "@/lib/backtest/presets";

// ── 設定 ──

const yf = new YahooFinance();
const BATCH_SIZE = 10; // Yahoo Finance 同時リクエスト数
const EXCLUDE_SYMBOLS = new Set(["7817.T"]);
const LOOKBACK_DAYS = 365; // シグナル検出対象の直近日数（computeSignals.tsと統一）

// 全戦略 (DCA除外)
const SCAN_STRATEGIES = strategies.filter((s) => s.id !== "dca");

// タイムフレーム → Yahoo Finance interval + 取得期間
const TF_CONFIG: Record<PeriodType, { interval: "1d" | "1wk"; yearsBack: number }> = {
  daily: { interval: "1d", yearsBack: 1 },
  weekly: { interval: "1wk", yearsBack: 3 },
};

// ── CLI引数 ──

interface CLIArgs {
  supabase: boolean;
  scanId?: number;
  favoritesOnly: boolean;
  dryRun: boolean;
}

function parseArgs(): CLIArgs {
  const args = process.argv.slice(2);
  return {
    supabase: args.includes("--supabase"),
    scanId: args.includes("--scan-id")
      ? parseInt(args[args.indexOf("--scan-id") + 1], 10)
      : undefined,
    favoritesOnly: args.includes("--favorites-only"),
    dryRun: args.includes("--dry-run"),
  };
}

// ── ユーティリティ ──

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createServiceClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// ── Supabase から全銘柄取得 ──

interface StockInfo {
  symbol: string;
  name: string;
  market: string;
  marketSegment: string | null;
  sectors: string[] | null;
  favorite: boolean;
}

async function getAllStocks(supabase: SupabaseClient, favoritesOnly: boolean): Promise<StockInfo[]> {
  const PAGE_SIZE = 1000;
  const allStocks: StockInfo[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase
      .from("stocks")
      .select("symbol, name, market, market_segment, sectors, favorite")
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (favoritesOnly) {
      query = query.eq("favorite", true);
    }

    const { data, error } = await query;
    if (error) throw error;
    const rows = (data ?? []) as Array<{
      symbol: string;
      name: string;
      market: string;
      market_segment: string | null;
      sectors: string[] | null;
      favorite: boolean | null;
    }>;

    for (const r of rows) {
      allStocks.push({
        symbol: r.symbol,
        name: r.name,
        market: r.market,
        marketSegment: r.market_segment,
        sectors: r.sectors,
        favorite: r.favorite ?? false,
      });
    }

    if (rows.length < PAGE_SIZE) break;
  }

  return allStocks;
}

// ── Yahoo Finance データ取得 ──

async function fetchPrices(symbol: string, tf: PeriodType): Promise<PriceData[]> {
  const config = TF_CONFIG[tf];
  const period1 = new Date();
  period1.setFullYear(period1.getFullYear() - config.yearsBack);

  const result = await yf.historical(symbol, {
    period1,
    period2: new Date(),
    interval: config.interval,
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

// ── 価格データ Supabase 保存 ──

async function savePriceHistory(
  supabase: SupabaseClient,
  symbol: string,
  tf: PeriodType,
  prices: PriceData[],
): Promise<void> {
  const lastDate = prices.length > 0 ? prices[prices.length - 1].date : null;
  await supabase
    .from("price_history")
    .upsert({
      symbol,
      timeframe: tf,
      prices: JSON.stringify(prices),
      last_date: lastDate,
      updated_at: new Date().toISOString(),
    });
}

// ── シグナル検出 ──

interface DetectedSignal {
  symbol: string;
  stockName: string;
  sectors: string[] | null;
  marketSegment: string | null;
  strategyId: string;
  strategyName: string;
  timeframe: PeriodType;
  signalDate: string;
  buyPrice: number;
  currentPrice: number;
  exitLevels: Record<string, unknown>;
}

function findRecentBuySignals(
  data: PriceData[],
  signals: Signal[],
  lookbackDays: number,
): { index: number; date: string; price: number }[] {
  const results: { index: number; date: string; price: number }[] = [];
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

  for (let i = signals.length - 1; i >= 0; i--) {
    if (new Date(data[i].date) < cutoffDate) break;
    if (signals[i] === "buy") {
      results.push({
        index: i,
        date: data[i].date,
        price: data[i].close,
      });
    }
  }

  return results;
}

function detectSignals(
  stock: StockInfo,
  tf: PeriodType,
  data: PriceData[],
): DetectedSignal[] {
  if (data.length < 30) return [];

  const currentPrice = data[data.length - 1].close;
  const detected: DetectedSignal[] = [];

  for (const strat of SCAN_STRATEGIES) {
    const params = getStrategyParams(strat.id, "optimized", tf);
    const signals = strat.compute(data, params);
    const recentBuys = findRecentBuySignals(data, signals, LOOKBACK_DAYS);

    for (const buy of recentBuys) {
      const exits = getExitLevels(strat.id, data, buy.index, buy.price, params);
      detected.push({
        symbol: stock.symbol,
        stockName: stock.name,
        sectors: stock.sectors,
        marketSegment: stock.marketSegment,
        strategyId: strat.id,
        strategyName: strat.name,
        timeframe: tf,
        signalDate: buy.date,
        buyPrice: buy.price,
        currentPrice,
        exitLevels: exits as unknown as Record<string, unknown>,
      });
    }
  }

  return detected;
}

// ── 進捗更新 ──

interface ScanProgress {
  stage: "fetching" | "computing" | "uploading";
  current: number;
  total: number;
  message: string;
}

async function updateProgress(
  supabase: SupabaseClient,
  scanId: number | undefined,
  progress: ScanProgress,
  extra?: { processed_stocks?: number; new_signals_count?: number },
): Promise<void> {
  if (!scanId) return;
  try {
    await supabase
      .from("signal_scans")
      .update({ progress, ...extra })
      .eq("id", scanId);
  } catch { /* best effort */ }
}

// ── メイン処理 ──

async function main() {
  const args = parseArgs();
  const startTime = Date.now();

  console.log("=".repeat(60));
  console.log(`日次シグナルスキャン開始 (${new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })})`);
  if (args.dryRun) console.log("** DRY RUN モード - DB書込みなし **");
  if (args.favoritesOnly) console.log("** お気に入りのみモード **");
  console.log("=".repeat(60));

  const supabase = createServiceClient();

  // スキャンレコード作成 or 既存レコード使用
  let scanId = args.scanId;
  if (args.supabase && !args.dryRun && !scanId) {
    const { data, error } = await supabase
      .from("signal_scans")
      .insert({
        status: "running",
        scan_date: new Date().toISOString().split("T")[0],
      })
      .select("id")
      .single();
    if (error) throw error;
    scanId = data.id;
    console.log(`スキャンID: ${scanId}`);
  }

  // 全銘柄取得
  const allStocks = await getAllStocks(supabase, args.favoritesOnly);
  const jpStocks = allStocks
    .filter((s) => s.market === "JP" && !EXCLUDE_SYMBOLS.has(s.symbol));

  console.log(`対象銘柄: ${jpStocks.length}\n`);

  if (scanId && args.supabase && !args.dryRun) {
    await supabase
      .from("signal_scans")
      .update({ total_stocks: jpStocks.length })
      .eq("id", scanId);
  }

  let totalProcessed = 0;
  let totalErrors = 0;
  const allDetected: DetectedSignal[] = [];
  const timeframes: PeriodType[] = ["daily", "weekly"];

  // バッチ処理
  for (let batchStart = 0; batchStart < jpStocks.length; batchStart += BATCH_SIZE) {
    const batch = jpStocks.slice(batchStart, batchStart + BATCH_SIZE);

    const batchResults = await Promise.allSettled(
      batch.map(async (stock) => {
        const stockSignals: DetectedSignal[] = [];

        for (const tf of timeframes) {
          try {
            // 1. 価格データ取得
            const data = await fetchPrices(stock.symbol, tf);

            // 2. Supabase に保存
            if (args.supabase && !args.dryRun) {
              await savePriceHistory(supabase, stock.symbol, tf, data);
            }

            // 3. シグナル検出
            const signals = detectSignals(stock, tf, data);
            stockSignals.push(...signals);
          } catch (err) {
            console.error(`  ${stock.symbol} ${tf}: ${err instanceof Error ? err.message : err}`);
            totalErrors++;
          }
        }

        return { stock, signals: stockSignals };
      }),
    );

    // バッチ結果集計
    for (const result of batchResults) {
      if (result.status === "fulfilled") {
        totalProcessed++;
        const { stock, signals } = result.value;
        if (signals.length > 0) {
          allDetected.push(...signals);
          for (const sig of signals) {
            console.log(
              `  ${stock.name} (${stock.symbol}) - ${sig.strategyName} [${sig.timeframe === "daily" ? "日足" : "週足"}] ${sig.signalDate} ¥${sig.buyPrice.toLocaleString()}`,
            );
          }
        }
      } else {
        totalProcessed++;
        totalErrors++;
        console.error(`  バッチエラー: ${result.reason}`);
      }
    }

    // 進捗表示 & Supabase更新
    const progress = `[${Math.min(batchStart + BATCH_SIZE, jpStocks.length)}/${jpStocks.length}]`;
    console.log(`${progress} 処理済み (新規シグナル: ${allDetected.length})`);

    if (scanId && args.supabase && !args.dryRun && batchStart % (BATCH_SIZE * 5) === 0) {
      await updateProgress(supabase, scanId, {
        stage: "fetching",
        current: Math.min(batchStart + BATCH_SIZE, jpStocks.length),
        total: jpStocks.length,
        message: `価格取得+シグナル検出: ${Math.min(batchStart + BATCH_SIZE, jpStocks.length)}/${jpStocks.length}銘柄`,
      }, {
        processed_stocks: totalProcessed,
        new_signals_count: allDetected.length,
      });
    }

    // Yahoo Finance API負荷対策
    if (batchStart + BATCH_SIZE < jpStocks.length) {
      await sleep(500);
    }
  }

  // 検出シグナルを Supabase に保存
  if (args.supabase && !args.dryRun && allDetected.length > 0) {
    console.log(`\nシグナル ${allDetected.length} 件をSupabaseに保存中...`);

    if (scanId) {
      await updateProgress(supabase, scanId, {
        stage: "uploading",
        current: 0,
        total: allDetected.length,
        message: "シグナルをアップロード中...",
      });
    }

    // バッチでupsert (ON CONFLICT skip)
    const UPSERT_BATCH = 100;
    for (let i = 0; i < allDetected.length; i += UPSERT_BATCH) {
      const chunk = allDetected.slice(i, i + UPSERT_BATCH).map((sig) => ({
        scan_id: scanId,
        symbol: sig.symbol,
        stock_name: sig.stockName,
        sectors: sig.sectors,
        market_segment: sig.marketSegment,
        strategy_id: sig.strategyId,
        strategy_name: sig.strategyName,
        timeframe: sig.timeframe,
        signal_date: sig.signalDate,
        buy_price: sig.buyPrice,
        current_price: sig.currentPrice,
        exit_levels: sig.exitLevels,
      }));

      const { error } = await supabase
        .from("detected_signals")
        .upsert(chunk, { onConflict: "symbol,strategy_id,timeframe,signal_date" });

      if (error) {
        console.error(`  upsert エラー: ${error.message}`);
      }
    }
  }

  // スキャン完了
  if (scanId && args.supabase && !args.dryRun) {
    await supabase
      .from("signal_scans")
      .update({
        status: "completed",
        processed_stocks: totalProcessed,
        new_signals_count: allDetected.length,
        completed_at: new Date().toISOString(),
        progress: null,
      })
      .eq("id", scanId);
  }

  // サマリー
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("");
  console.log("=".repeat(60));
  console.log(`完了 (${elapsed}秒)`);
  console.log(`  対象銘柄: ${jpStocks.length}`);
  console.log(`  処理済み: ${totalProcessed}`);
  console.log(`  新規シグナル: ${allDetected.length}`);
  console.log(`  エラー: ${totalErrors}`);
  if (scanId) console.log(`  スキャンID: ${scanId}`);
  console.log("=".repeat(60));

  // シグナル一覧を表示
  if (allDetected.length > 0) {
    console.log("\n■ 検出シグナル一覧:");
    for (const sig of allDetected) {
      const pnl = ((sig.currentPrice - sig.buyPrice) / sig.buyPrice * 100).toFixed(1);
      console.log(
        `  ${sig.stockName} (${sig.symbol}) | ${sig.strategyName} | ${sig.timeframe === "daily" ? "日足" : "週足"} | ${sig.signalDate} | 買値¥${sig.buyPrice.toLocaleString()} → 現在¥${sig.currentPrice.toLocaleString()} (${Number(pnl) > 0 ? "+" : ""}${pnl}%)`,
      );
    }
  }
}

main().catch(async (err) => {
  console.error("Fatal error:", err);

  // scanId があれば failed に更新
  const scanId = parseArgs().scanId;
  if (scanId) {
    try {
      const supabase = createServiceClient();
      await supabase
        .from("signal_scans")
        .update({
          status: "failed",
          error_message: err instanceof Error ? err.message : String(err),
          completed_at: new Date().toISOString(),
        })
        .eq("id", scanId);
    } catch { /* best effort */ }
  }

  process.exit(1);
});

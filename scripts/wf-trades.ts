#!/usr/bin/env npx tsx
// ============================================================
// ウォークフォワード 個別トレードCSV出力
//
// 指定戦略 × WF推奨パラメータ × 全ウィンドウ検証期間 の
// 個別トレード（買い→売りラウンドトリップ）を CSV に出力する。
//
// 使い方:
//   npx tsx scripts/wf-trades.ts
//   npx tsx scripts/wf-trades.ts --all
//   npx tsx scripts/wf-trades.ts --strategies tabata_cwh
//   npx tsx scripts/wf-trades.ts --train-years 3 --test-years 1
// ============================================================

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getArgs, parseFlag, hasFlag, parseIntFlag } from "@/lib/utils/cli";
import { strategies } from "@/lib/backtest/strategies";
import { runBacktest } from "@/lib/backtest/engine";
import type { PriceData } from "@/types";
import type { Trade } from "@/lib/backtest/types";
import { loadCached10yr } from "./fetch-10yr-data";

const INITIAL_CAPITAL = 1_000_000;
const EXCLUDE_SYMBOLS = new Set(["7817.T"]);

// ============================================================
// 推奨パラメータ (ウォークフォワード安定性ベース)
// ============================================================

const WF_RECOMMENDED: Record<string, Record<string, number>> = {
  tabata_cwh: { takeProfitPct: 5, stopLossPct: 20 },
  cwh_trail: { trailPct: 8, stopLossPct: 6 },
  ma_cross: { shortPeriod: 2, longPeriod: 5 },
  rsi_reversal: { period: 5, oversold: 37, overbought: 70, atrPeriod: 14, atrMultiple: 2, stopLossPct: 5 },
  macd_signal: { shortPeriod: 5, longPeriod: 10, signalPeriod: 12 },
  dip_buy: { dipPct: 3, recoveryPct: 39, stopLossPct: 5 },
  macd_trail: { shortPeriod: 5, longPeriod: 23, signalPeriod: 3, trailPct: 12, stopLossPct: 15 },
  dip_kairi: { entryKairi: -30, exitKairi: -15, stopLossPct: 3, timeStopDays: 2 },
  dip_rsi_volume: { rsiThreshold: 30, volumeMultiple: 2, rsiExit: 55, takeProfitPct: 6 },
  dip_bb3sigma: { stopLossPct: 3 },
};

// ============================================================
// CLI引数
// ============================================================

function parseCliArgs() {
  const args = getArgs();

  const allStocks = hasFlag(args, "--all");
  const favoritesOnly = !allStocks;
  const trainYears = parseIntFlag(args, "--train-years", 3);
  const testYears = parseIntFlag(args, "--test-years", 1);
  const strategyFilter = parseFlag(args, "--strategies")?.split(",") ?? ["tabata_cwh", "cwh_trail"];

  const activeStrategies = strategies.filter((s) => strategyFilter.includes(s.id));

  return { allStocks, favoritesOnly, trainYears, testYears, activeStrategies, strategyFilter };
}

// ============================================================
// 銘柄・データ
// ============================================================

interface WatchlistStock { symbol: string; name: string; market: string; marketSegment?: string; favorite?: boolean; }
interface StockData { symbol: string; name: string; data: PriceData[]; }

function loadStocks(opts: ReturnType<typeof parseCliArgs>): WatchlistStock[] {
  const raw = readFileSync(join(process.cwd(), "data", "watchlist.json"), "utf-8");
  const watchlist = JSON.parse(raw) as { stocks: WatchlistStock[] };
  return watchlist.stocks.filter((s) => {
    if (EXCLUDE_SYMBOLS.has(s.symbol)) return false;
    if (s.market !== "JP") return false;
    if (opts.favoritesOnly) return s.favorite === true;
    return true;
  });
}

function loadAllStockData(stocks: WatchlistStock[]): StockData[] {
  const result: StockData[] = [];
  for (const stock of stocks) {
    const data = loadCached10yr(stock.symbol);
    if (data && data.length >= 30) {
      result.push({ symbol: stock.symbol, name: stock.name, data });
    }
  }
  return result;
}

function sliceData(data: PriceData[], startDate: string, endDate: string): PriceData[] {
  return data.filter((d) => d.date >= startDate && d.date <= endDate);
}

// ============================================================
// WFウィンドウ生成
// ============================================================

interface WFWindow {
  id: number;
  trainStart: string;
  trainEnd: string;
  testStart: string;
  testEnd: string;
  label: string;
}

function generateWindows(trainYears: number, testYears: number): WFWindow[] {
  const windows: WFWindow[] = [];
  const dataStartYear = 2016;
  const dataEndYear = 2025;

  for (let testEndYear = dataStartYear + trainYears + testYears - 1; testEndYear <= dataEndYear; testEndYear++) {
    const testStartYear = testEndYear - testYears + 1;
    const trainStartYear = testStartYear - trainYears;
    const trainEndYear = testStartYear - 1;

    windows.push({
      id: windows.length + 1,
      trainStart: `${trainStartYear}-01-01`,
      trainEnd: `${trainEndYear}-12-31`,
      testStart: `${testStartYear}-01-01`,
      testEnd: `${testEndYear}-12-31`,
      label: `${trainStartYear}-${trainEndYear}→${testStartYear}`,
    });
  }
  return windows;
}

// ============================================================
// ラウンドトリップ抽出
// ============================================================

interface RoundTrip {
  window: string;
  strategyId: string;
  strategyName: string;
  symbol: string;
  entryDate: string;
  exitDate: string;
  entryPrice: number;
  exitPrice: number;
  returnPct: number;
  win: 0 | 1;
}

function extractRoundTrips(
  trades: Trade[],
  windowLabel: string,
  strategyId: string,
  strategyName: string,
  symbol: string,
): RoundTrip[] {
  const roundTrips: RoundTrip[] = [];
  let lastBuy: Trade | null = null;

  for (const t of trades) {
    if (t.type === "buy") {
      lastBuy = t;
    } else if (t.type === "sell" && lastBuy) {
      const returnPct = ((t.price - lastBuy.price) / lastBuy.price) * 100;
      roundTrips.push({
        window: windowLabel,
        strategyId,
        strategyName,
        symbol,
        entryDate: lastBuy.date,
        exitDate: t.date,
        entryPrice: Math.round(lastBuy.price * 100) / 100,
        exitPrice: Math.round(t.price * 100) / 100,
        returnPct: Math.round(returnPct * 100) / 100,
        win: returnPct > 0 ? 1 : 0,
      });
      lastBuy = null;
    }
  }
  return roundTrips;
}

// ============================================================
// メイン
// ============================================================

async function main() {
  const opts = parseCliArgs();
  const stocks = loadStocks(opts);
  const allData = loadAllStockData(stocks);
  const windows = generateWindows(opts.trainYears, opts.testYears);

  console.log("============================================================");
  console.log("ウォークフォワード 個別トレードCSV出力");
  console.log(`  対象: ${opts.favoritesOnly ? "お気に入り" : "全銘柄"} (${allData.length}銘柄)`);
  console.log(`  ウィンドウ: 訓練${opts.trainYears}年→検証${opts.testYears}年 × ${windows.length}窓`);
  console.log(`  戦略: ${opts.activeStrategies.map((s) => s.name).join(", ")}`);
  console.log("============================================================\n");

  const allRoundTrips: RoundTrip[] = [];

  for (const strat of opts.activeStrategies) {
    const params = WF_RECOMMENDED[strat.id];
    if (!params) {
      console.log(`  ⚠ ${strat.name}: 推奨パラメータなし、スキップ`);
      continue;
    }

    console.log(`[${strat.name}] パラメータ: ${JSON.stringify(params)}`);
    let totalTrades = 0;

    for (const w of windows) {
      let windowTrades = 0;
      for (const sd of allData) {
        const testData = sliceData(sd.data, w.testStart, w.testEnd);
        if (testData.length < 30) continue;

        const result = runBacktest(testData, strat, params, INITIAL_CAPITAL);
        const rts = extractRoundTrips(result.trades, w.label, strat.id, strat.name, sd.symbol);
        allRoundTrips.push(...rts);
        windowTrades += rts.length;
      }
      totalTrades += windowTrades;
      console.log(`  ${w.label}: ${windowTrades}トレード`);
    }
    console.log(`  合計: ${totalTrades}トレード\n`);
  }

  // CSV出力
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const csvPath = join(process.cwd(), "data", `wf-trades-${timestamp}.csv`);

  const header = "window,strategyId,strategyName,symbol,entryDate,exitDate,entryPrice,exitPrice,returnPct,win";
  const rows = allRoundTrips.map((r) =>
    [r.window, r.strategyId, r.strategyName, r.symbol, r.entryDate, r.exitDate, r.entryPrice, r.exitPrice, r.returnPct, r.win].join(",")
  );

  writeFileSync(csvPath, [header, ...rows].join("\n"), "utf-8");
  console.log(`CSV出力: ${csvPath} (${allRoundTrips.length}行)`);

  // サマリ表示
  for (const strat of opts.activeStrategies) {
    const stratTrades = allRoundTrips.filter((r) => r.strategyId === strat.id);
    if (stratTrades.length === 0) continue;

    const wins = stratTrades.filter((r) => r.win === 1).length;
    const avgReturn = stratTrades.reduce((sum, r) => sum + r.returnPct, 0) / stratTrades.length;
    const medReturn = median(stratTrades.map((r) => r.returnPct));

    console.log(`\n[${strat.name}] サマリ:`);
    console.log(`  トレード数: ${stratTrades.length}`);
    console.log(`  勝率: ${(wins / stratTrades.length * 100).toFixed(1)}%`);
    console.log(`  平均リターン: ${avgReturn.toFixed(2)}%`);
    console.log(`  中央値リターン: ${medReturn.toFixed(2)}%`);

    // ウィンドウ別サマリ
    for (const w of windows) {
      const wTrades = stratTrades.filter((r) => r.window === w.label);
      if (wTrades.length === 0) { console.log(`  ${w.label}: 0トレード`); continue; }
      const wWins = wTrades.filter((r) => r.win === 1).length;
      const wAvg = wTrades.reduce((sum, r) => sum + r.returnPct, 0) / wTrades.length;
      console.log(`  ${w.label}: ${wTrades.length}トレード, 勝率${(wWins / wTrades.length * 100).toFixed(0)}%, 平均${wAvg.toFixed(1)}%`);
    }
  }
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

main().catch(console.error);

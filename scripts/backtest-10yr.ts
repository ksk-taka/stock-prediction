#!/usr/bin/env npx tsx
// ============================================================
// 10年バックテスト: マルチウィンドウ + ウォークフォワード分析
//
// 使い方:
//   npx tsx scripts/backtest-10yr.ts                              # お気に入り、全モード
//   npx tsx scripts/backtest-10yr.ts --all                         # 全銘柄
//   npx tsx scripts/backtest-10yr.ts --mode windows                # ウィンドウ分析のみ
//   npx tsx scripts/backtest-10yr.ts --mode walkforward            # ウォークフォワードのみ
//   npx tsx scripts/backtest-10yr.ts --strategies macd_trail,tabata_cwh
//   npx tsx scripts/backtest-10yr.ts --train-years 3 --test-years 1
//
// 前提: npx tsx scripts/fetch-10yr-data.ts で10年データをキャッシュ済み
// ============================================================

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getArgs, parseFlag, hasFlag, parseIntFlag } from "@/lib/utils/cli";
import { strategies } from "@/lib/backtest/strategies";
import { getStrategyParams } from "@/lib/backtest/strategies";
import { runBacktest } from "@/lib/backtest/engine";
import type { PriceData } from "@/types";
import type { StrategyDef } from "@/lib/backtest/types";
import { loadCached10yr } from "./fetch-10yr-data";

const INITIAL_CAPITAL = 1_000_000;
const EXCLUDE_SYMBOLS = new Set(["7817.T"]);

// ── CLI引数 ──

function parseCliArgs() {
  const args = getArgs();

  const allStocks = hasFlag(args, "--all");
  const favoritesOnly = !allStocks && !hasFlag(args, "--segment");
  const segment = parseFlag(args, "--segment") ?? "プライム";
  const limitStr = parseFlag(args, "--limit");
  const limit = limitStr ? parseInt(limitStr, 10) : undefined;
  const mode = (parseFlag(args, "--mode") ?? "both") as "windows" | "walkforward" | "both";
  const trainYears = parseIntFlag(args, "--train-years", 3);
  const testYears = parseIntFlag(args, "--test-years", 1);
  const strategyFilter = parseFlag(args, "--strategies")?.split(",") ?? null;

  // DCA除外、フィルタ適用
  const activeStrategies = strategies.filter((s) => {
    if (s.id === "dca") return false;
    if (strategyFilter) return strategyFilter.includes(s.id);
    return true;
  });

  return { allStocks, favoritesOnly, segment, limit, mode, trainYears, testYears, activeStrategies, strategyFilter };
}

// ── 銘柄読み込み ──

interface WatchlistStock { symbol: string; name: string; market: string; marketSegment?: string; favorite?: boolean; }

function loadStocks(opts: ReturnType<typeof parseCliArgs>): WatchlistStock[] {
  const raw = readFileSync(join(process.cwd(), "data", "watchlist.json"), "utf-8");
  const watchlist = JSON.parse(raw) as { stocks: WatchlistStock[] };
  return watchlist.stocks.filter((s) => {
    if (EXCLUDE_SYMBOLS.has(s.symbol)) return false;
    if (s.market !== "JP") return false;
    if (opts.favoritesOnly) return s.favorite === true;
    if (opts.allStocks) return true;
    return s.marketSegment === opts.segment;
  });
}

// ── 10年データ読み込み ──

interface StockData {
  symbol: string;
  name: string;
  data: PriceData[];
}

function loadAllStockData(stocks: WatchlistStock[]): StockData[] {
  const result: StockData[] = [];
  let missing = 0;
  for (const stock of stocks) {
    const data = loadCached10yr(stock.symbol);
    if (data && data.length >= 30) {
      result.push({ symbol: stock.symbol, name: stock.name, data });
    } else {
      missing++;
    }
  }
  if (missing > 0) {
    console.log(`  ⚠ ${missing}銘柄のキャッシュが見つかりません (先に fetch-10yr-data.ts を実行してください)`);
  }
  return result;
}

// ── ユーティリティ ──

function sliceData(data: PriceData[], startDate: string, endDate: string): PriceData[] {
  return data.filter((d) => d.date >= startDate && d.date <= endDate);
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function sum(arr: number[]): number { return arr.reduce((a, b) => a + b, 0); }
function fmtPct(v: number): string { return (v >= 0 ? "+" : "") + v.toFixed(1); }

function displayWidth(str: string): number {
  let w = 0;
  for (const ch of str) { w += ch.charCodeAt(0) > 0x7f ? 2 : 1; }
  return w;
}
function padEndW(str: string, width: number): string {
  return str + " ".repeat(Math.max(0, width - displayWidth(str)));
}

// ============================================================
// Part A: マルチウィンドウバックテスト
// ============================================================

interface TimeWindow {
  label: string;
  startDate: string;
  endDate: string;
}

function generateWindows(): TimeWindow[] {
  const windows: TimeWindow[] = [];
  // 全期間
  windows.push({ label: "10yr", startDate: "2016-01-01", endDate: "2025-12-31" });
  // 1年単位
  for (let y = 2016; y <= 2025; y++) {
    windows.push({ label: `${y}`, startDate: `${y}-01-01`, endDate: `${y}-12-31` });
  }
  // 2年単位
  for (let y = 2016; y <= 2024; y += 2) {
    windows.push({ label: `${y}-${y + 1}`, startDate: `${y}-01-01`, endDate: `${y + 1}-12-31` });
  }
  // 5年単位
  for (let y = 2016; y <= 2021; y += 5) {
    windows.push({ label: `${y}-${y + 4}`, startDate: `${y}-01-01`, endDate: `${y + 4}-12-31` });
  }
  return windows;
}

interface WindowResult {
  symbol: string;
  name: string;
  window: string;
  strategyId: string;
  strategyName: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalReturnPct: number;
  maxTradeReturnPct: number;
  profitFactor: number;
  sharpeRatio: number;
  maxDrawdownPct: number;
  avgDrawdownPct: number;
  recoveryFactor: number;
  avgHoldingDays: number;
  holdingDaysMin: number;
  holdingDaysQ1: number;
  holdingDaysMedian: number;
  holdingDaysQ3: number;
  holdingDaysMax: number;
}

function runWindowBacktests(
  stockDataList: StockData[],
  activeStrategies: StrategyDef[],
): WindowResult[] {
  const windows = generateWindows();
  const results: WindowResult[] = [];

  for (const sd of stockDataList) {
    for (const win of windows) {
      const sliced = sliceData(sd.data, win.startDate, win.endDate);
      if (sliced.length < 30) continue;

      for (const strat of activeStrategies) {
        const params = getStrategyParams(strat.id, "optimized", "daily");
        const bt = runBacktest(sliced, strat, params, INITIAL_CAPITAL);
        const s = bt.stats;
        if (s.numTrades === 0) continue;

        results.push({
          symbol: sd.symbol,
          name: sd.name,
          window: win.label,
          strategyId: strat.id,
          strategyName: strat.name,
          trades: s.numTrades,
          wins: s.numWins,
          losses: s.numLosses,
          winRate: s.winRate,
          totalReturnPct: s.totalReturnPct,
          maxTradeReturnPct: s.maxTradeReturnPct,
          profitFactor: s.profitFactor,
          sharpeRatio: s.sharpeRatio,
          maxDrawdownPct: s.maxDrawdownPct,
          avgDrawdownPct: s.avgDrawdownPct,
          recoveryFactor: s.recoveryFactor,
          avgHoldingDays: s.avgHoldingDays,
          holdingDaysMin: s.holdingDaysMin,
          holdingDaysQ1: s.holdingDaysQ1,
          holdingDaysMedian: s.holdingDaysMedian,
          holdingDaysQ3: s.holdingDaysQ3,
          holdingDaysMax: s.holdingDaysMax,
        });
      }
    }
  }
  return results;
}

function fmtRF(v: number): string {
  if (v === Infinity) return "Inf";
  return v.toFixed(2);
}

function printWindowSummary(results: WindowResult[], activeStrategies: StrategyDef[]) {
  const windows = generateWindows();
  const C = 9; // column width

  for (const strat of activeStrategies) {
    const W = 140;
    console.log("\n" + "=".repeat(W));
    console.log(`${strat.name} (${strat.id})`);
    console.log("=".repeat(W));

    // ヘッダー行1: 基本統計
    console.log(
      "Window".padEnd(14) +
      "N".padStart(4) + "Trades".padStart(C) + "W".padStart(C) + "L".padStart(C) +
      "WR%".padStart(C) + "TotRet%".padStart(C) + "MaxTR%".padStart(C) +
      "PF".padStart(C) + "SR".padStart(C) +
      "AvgDD%".padStart(C) + "MaxDD%".padStart(C) + "RF".padStart(C) +
      "Hold日".padStart(C) + "Min".padStart(6) + "Q1".padStart(6) + "Med".padStart(6) + "Q3".padStart(6) + "Max".padStart(6),
    );
    console.log("-".repeat(W));

    for (const win of windows) {
      const wr = results.filter(r => r.strategyId === strat.id && r.window === win.label && r.trades > 0);
      if (!wr.length) {
        console.log(win.label.padEnd(14) + "0".padStart(4));
        continue;
      }

      const tw = sum(wr.map(r => r.wins));
      const tl = sum(wr.map(r => r.losses));
      const tt = tw + tl;
      const winR = tt > 0 ? (tw / tt) * 100 : 0;
      const totRet = median(wr.map(r => r.totalReturnPct));
      const maxTR = Math.max(...wr.map(r => r.maxTradeReturnPct));
      const medPF = median(wr.map(r => r.profitFactor === Infinity ? 999 : r.profitFactor));
      const medSR = median(wr.map(r => r.sharpeRatio));
      const avgDD = median(wr.map(r => r.avgDrawdownPct));
      const maxDD = median(wr.map(r => r.maxDrawdownPct));
      const medRF = median(wr.map(r => r.recoveryFactor === Infinity ? 999 : r.recoveryFactor));
      const avgHold = median(wr.map(r => r.avgHoldingDays));
      const holdMin = Math.min(...wr.map(r => r.holdingDaysMin));
      const holdQ1 = median(wr.map(r => r.holdingDaysQ1));
      const holdMed = median(wr.map(r => r.holdingDaysMedian));
      const holdQ3 = median(wr.map(r => r.holdingDaysQ3));
      const holdMax = Math.max(...wr.map(r => r.holdingDaysMax));

      console.log(
        win.label.padEnd(14) +
        wr.length.toString().padStart(4) +
        tt.toString().padStart(C) +
        tw.toString().padStart(C) +
        tl.toString().padStart(C) +
        winR.toFixed(1).padStart(C) +
        fmtPct(totRet).padStart(C) +
        fmtPct(maxTR).padStart(C) +
        medPF.toFixed(2).padStart(C) +
        medSR.toFixed(2).padStart(C) +
        avgDD.toFixed(1).padStart(C) +
        maxDD.toFixed(1).padStart(C) +
        fmtRF(medRF).padStart(C) +
        avgHold.toFixed(0).padStart(C) +
        holdMin.toString().padStart(6) +
        holdQ1.toFixed(0).padStart(6) +
        holdMed.toFixed(0).padStart(6) +
        holdQ3.toFixed(0).padStart(6) +
        holdMax.toString().padStart(6)
      );
    }
  }
}

// ============================================================
// Part B: ウォークフォワード分析
// ============================================================

interface WFWindow {
  id: number;
  trainStart: string;
  trainEnd: string;
  testStart: string;
  testEnd: string;
  trainLabel: string;
  testLabel: string;
}

function generateWFWindows(trainYears: number, testYears: number): WFWindow[] {
  const windows: WFWindow[] = [];
  const dataStartYear = 2016;
  const dataEndYear = 2025;
  let id = 0;

  for (let testStart = dataStartYear + trainYears; testStart + testYears - 1 <= dataEndYear; testStart++) {
    const trainStart = testStart - trainYears;
    const trainEnd = testStart - 1;
    const testEnd = testStart + testYears - 1;

    windows.push({
      id: id++,
      trainStart: `${trainStart}-01-01`,
      trainEnd: `${trainEnd}-12-31`,
      testStart: `${testStart}-01-01`,
      testEnd: `${testEnd}-12-31`,
      trainLabel: `${trainStart}-${trainEnd}`,
      testLabel: testYears === 1 ? `${testStart}` : `${testStart}-${testEnd}`,
    });
  }
  return windows;
}

// ── グリッド定義 (optimize-params.ts から移植) ──

function cartesian(...arrays: number[][]): number[][] {
  return arrays.reduce<number[][]>(
    (acc, arr) => acc.flatMap((combo) => arr.map((v) => [...combo, v])),
    [[]],
  );
}

interface ParamCombo {
  params: Record<string, number>;
}

function getParamGrid(strategyId: string): ParamCombo[] | null {
  switch (strategyId) {
    case "ma_cross":
      return cartesian([3, 5, 10, 15, 20], [20, 25, 50, 75])
        .filter(([s, l]) => s < l)
        .map(([s, l]) => ({ params: { shortPeriod: s, longPeriod: l } }));

    case "rsi_reversal":
      return cartesian([7, 10, 14], [20, 30, 40], [65, 70, 80], [1.5, 2, 3], [8, 10, 15])
        .map(([p, os, ob, atrM, sl]) => ({
          params: { period: p, oversold: os, overbought: ob, atrPeriod: 14, atrMultiple: atrM, stopLossPct: sl },
        }));

    case "macd_signal":
      return cartesian([8, 10, 12], [20, 26, 30], [5, 9, 12])
        .filter(([s, l]) => s < l)
        .map(([s, l, sig]) => ({ params: { shortPeriod: s, longPeriod: l, signalPeriod: sig } }));

    case "dip_buy":
      return cartesian([3, 5, 10, 15], [5, 10, 15, 30], [10, 15, 20])
        .map(([dip, rec, sl]) => ({ params: { dipPct: dip, recoveryPct: rec, stopLossPct: sl } }));

    case "dip_kairi":
      return cartesian([-12, -10, -8, -6], [-5, -3, 0], [5, 7, 10], [5, 7, 10])
        .filter(([ek, xk]) => ek < xk)
        .map(([ek, xk, sl, ts]) => ({ params: { entryKairi: ek, exitKairi: xk, stopLossPct: sl, timeStopDays: ts } }));

    case "dip_rsi_volume":
      return cartesian([20, 25, 35], [1.2, 2], [35, 50], [3, 5, 10])
        .map(([rsiTh, vol, rsiEx, tp]) => ({
          params: { rsiThreshold: rsiTh, volumeMultiple: vol, rsiExit: rsiEx, takeProfitPct: tp },
        }));

    case "dip_bb3sigma":
      return [3, 5, 7, 10].map((sl) => ({ params: { stopLossPct: sl } }));

    case "macd_trail":
      return cartesian([10, 12, 15], [20, 26, 30], [7, 9, 12], [8, 12, 15], [3, 5, 7])
        .filter(([s, l]) => s < l)
        .map(([s, l, sig, tr, sl]) => ({
          params: { shortPeriod: s, longPeriod: l, signalPeriod: sig, trailPct: tr, stopLossPct: sl },
        }));

    case "tabata_cwh":
      return cartesian([5, 10, 15, 20, 30], [5, 7, 10, 15])
        .map(([tp, sl]) => ({ params: { takeProfitPct: tp, stopLossPct: sl } }));

    case "cwh_trail":
      return cartesian([8, 10, 12, 15, 20], [5, 7, 10, 12])
        .map(([tr, sl]) => ({ params: { trailPct: tr, stopLossPct: sl } }));

    // 固定パラメータ戦略
    case "choruko_bb":
    case "choruko_shitabanare":
      return null;

    default:
      return null;
  }
}

// ── スコア関数 (optimize-params.ts と同じ) ──

function calcScore(totalWins: number, totalLosses: number, totalReturnPct: number): number {
  const totalTrades = totalWins + totalLosses;
  if (totalTrades < 3) return -Infinity;
  const winRate = (totalWins / totalTrades) * 100;
  const pf = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? 999 : 0;
  return winRate + Math.min(pf, 5) * 2 + Math.min(Math.max(totalReturnPct, 0), 100) * 0.1;
}

// ── ウォークフォワード実行 ──

interface WFResult {
  strategyId: string;
  strategyName: string;
  windowId: number;
  trainLabel: string;
  testLabel: string;
  bestParams: string;
  trainTrades: number;
  trainWinRate: number;
  trainReturnPct: number;
  trainMedianRet: number;
  testTrades: number;
  testWinRate: number;
  testReturnPct: number;
  testMedianRet: number;
  winRateDelta: number;
  returnDelta: number;
  stockCount: number;
}

function runWalkForward(
  stockDataList: StockData[],
  activeStrategies: StrategyDef[],
  trainYears: number,
  testYears: number,
): WFResult[] {
  const wfWindows = generateWFWindows(trainYears, testYears);
  const results: WFResult[] = [];

  console.log(`\n[ウォークフォワード] ${wfWindows.length}ウィンドウ × ${activeStrategies.length}戦略\n`);

  for (const strat of activeStrategies) {
    const grid = getParamGrid(strat.id);
    process.stdout.write(`  ${padEndW(strat.name, 22)}`);

    for (const wf of wfWindows) {
      // 各銘柄のデータを訓練/検証にスライス
      const trainSlices: { data: PriceData[] }[] = [];
      const testSlices: { data: PriceData[] }[] = [];

      for (const sd of stockDataList) {
        const train = sliceData(sd.data, wf.trainStart, wf.trainEnd);
        const test = sliceData(sd.data, wf.testStart, wf.testEnd);
        if (train.length >= 30 && test.length >= 30) {
          trainSlices.push({ data: train });
          testSlices.push({ data: test });
        }
      }

      let bestParams: Record<string, number>;

      if (grid && grid.length > 0) {
        // グリッドサーチで最適パラメータを見つける
        let bestScore = -Infinity;
        bestParams = grid[0].params;

        for (const combo of grid) {
          let totalWins = 0;
          let totalLosses = 0;
          let totalRet = 0;

          for (const ts of trainSlices) {
            const bt = runBacktest(ts.data, strat, combo.params, INITIAL_CAPITAL);
            totalWins += bt.stats.numWins;
            totalLosses += bt.stats.numLosses;
            totalRet += bt.stats.totalReturnPct;
          }

          const score = calcScore(totalWins, totalLosses, totalRet);
          if (score > bestScore) {
            bestScore = score;
            bestParams = combo.params;
          }
        }
      } else {
        // 固定パラメータ戦略
        bestParams = getStrategyParams(strat.id, "optimized", "daily");
      }

      // 訓練データでの成績
      let trainWins = 0, trainLosses = 0, trainRet = 0;
      const trainReturns: number[] = [];
      for (const ts of trainSlices) {
        const bt = runBacktest(ts.data, strat, bestParams, INITIAL_CAPITAL);
        trainWins += bt.stats.numWins;
        trainLosses += bt.stats.numLosses;
        trainRet += bt.stats.totalReturnPct;
        if (bt.stats.numTrades > 0) trainReturns.push(bt.stats.totalReturnPct);
      }
      const trainTrades = trainWins + trainLosses;
      const trainWR = trainTrades > 0 ? (trainWins / trainTrades) * 100 : 0;

      // 検証データでの成績（アウトオブサンプル）
      let testWins = 0, testLosses = 0, testRet = 0;
      const testReturns: number[] = [];
      for (const ts of testSlices) {
        const bt = runBacktest(ts.data, strat, bestParams, INITIAL_CAPITAL);
        testWins += bt.stats.numWins;
        testLosses += bt.stats.numLosses;
        testRet += bt.stats.totalReturnPct;
        if (bt.stats.numTrades > 0) testReturns.push(bt.stats.totalReturnPct);
      }
      const testTrades = testWins + testLosses;
      const testWR = testTrades > 0 ? (testWins / testTrades) * 100 : 0;

      results.push({
        strategyId: strat.id,
        strategyName: strat.name,
        windowId: wf.id,
        trainLabel: wf.trainLabel,
        testLabel: wf.testLabel,
        bestParams: JSON.stringify(bestParams),
        trainTrades,
        trainWinRate: trainWR,
        trainReturnPct: trainRet,
        trainMedianRet: median(trainReturns),
        testTrades,
        testWinRate: testWR,
        testReturnPct: testRet,
        testMedianRet: median(testReturns),
        winRateDelta: testWR - trainWR,
        returnDelta: testRet - trainRet,
        stockCount: trainSlices.length,
      });

      process.stdout.write(".");
    }
    console.log("");
  }

  return results;
}

function printWFSummary(results: WFResult[], activeStrategies: StrategyDef[]) {
  const COL = 12;

  // 1. 戦略別ウォークフォワード詳細
  for (const strat of activeStrategies) {
    const rows = results.filter((r) => r.strategyId === strat.id);
    if (rows.length === 0) continue;

    console.log("\n" + "=".repeat(100));
    console.log(`ウォークフォワード: ${strat.name} (${strat.id})`);
    console.log("=".repeat(100));
    console.log(
      "Window".padEnd(16) +
      "Train WR%".padStart(COL) +
      "Test WR%".padStart(COL) +
      "Delta".padStart(COL) +
      "Train MedR%".padStart(COL) +
      "Test MedR%".padStart(COL) +
      "Delta".padStart(COL) +
      "銘柄".padStart(6),
    );
    console.log("-".repeat(100));

    for (const r of rows) {
      const medDelta = r.testMedianRet - r.trainMedianRet;
      console.log(
        `${r.trainLabel}→${r.testLabel}`.padEnd(16) +
        r.trainWinRate.toFixed(1).padStart(COL) +
        r.testWinRate.toFixed(1).padStart(COL) +
        fmtPct(r.winRateDelta).padStart(COL) +
        fmtPct(r.trainMedianRet).padStart(COL) +
        fmtPct(r.testMedianRet).padStart(COL) +
        fmtPct(medDelta).padStart(COL) +
        r.stockCount.toString().padStart(6),
      );
    }

    // 平均行
    const avgTrainWR = sum(rows.map((r) => r.trainWinRate)) / rows.length;
    const avgTestWR = sum(rows.map((r) => r.testWinRate)) / rows.length;
    const avgTrainMed = sum(rows.map((r) => r.trainMedianRet)) / rows.length;
    const avgTestMed = sum(rows.map((r) => r.testMedianRet)) / rows.length;
    console.log("-".repeat(100));
    console.log(
      "Average".padEnd(16) +
      avgTrainWR.toFixed(1).padStart(COL) +
      avgTestWR.toFixed(1).padStart(COL) +
      fmtPct(avgTestWR - avgTrainWR).padStart(COL) +
      fmtPct(avgTrainMed).padStart(COL) +
      fmtPct(avgTestMed).padStart(COL) +
      fmtPct(avgTestMed - avgTrainMed).padStart(COL),
    );

    // パラメータ安定性
    if (rows[0].bestParams !== "{}") {
      console.log("\nパラメータ変動:");
      for (const r of rows) {
        console.log(`  ${r.trainLabel}→${r.testLabel}: ${r.bestParams}`);
      }
    }
  }

  // 2. 戦略ランキング（平均検証リターン順）
  console.log("\n\n" + "=".repeat(90));
  console.log("戦略ランキング (平均検証中央リターン順)");
  console.log("=".repeat(90));
  console.log(
    padEndW("戦略", 22) +
    "Avg訓練MR%".padStart(12) +
    "Avg検証MR%".padStart(12) +
    "劣化".padStart(10) +
    "Avg訓練WR%".padStart(12) +
    "Avg検証WR%".padStart(12) +
    "劣化".padStart(10),
  );
  console.log("-".repeat(90));

  const stratSummaries = activeStrategies.map((strat) => {
    const rows = results.filter((r) => r.strategyId === strat.id);
    return {
      name: strat.name,
      avgTrainMed: rows.length > 0 ? sum(rows.map((r) => r.trainMedianRet)) / rows.length : 0,
      avgTestMed: rows.length > 0 ? sum(rows.map((r) => r.testMedianRet)) / rows.length : 0,
      avgTrainWR: rows.length > 0 ? sum(rows.map((r) => r.trainWinRate)) / rows.length : 0,
      avgTestWR: rows.length > 0 ? sum(rows.map((r) => r.testWinRate)) / rows.length : 0,
    };
  }).sort((a, b) => b.avgTestMed - a.avgTestMed);

  for (const s of stratSummaries) {
    console.log(
      padEndW(s.name, 22) +
      fmtPct(s.avgTrainMed).padStart(12) +
      fmtPct(s.avgTestMed).padStart(12) +
      fmtPct(s.avgTestMed - s.avgTrainMed).padStart(10) +
      s.avgTrainWR.toFixed(1).padStart(12) +
      s.avgTestWR.toFixed(1).padStart(12) +
      fmtPct(s.avgTestWR - s.avgTrainWR).padStart(10),
    );
  }
}

// ============================================================
// CSV出力
// ============================================================

function writeWindowCSV(results: WindowResult[]) {
  const header = "symbol,name,window,strategy,strategyId,trades,wins,losses,winRate,totalReturnPct,maxTradeReturnPct,profitFactor,sharpeRatio,maxDrawdownPct,avgDrawdownPct,recoveryFactor,avgHoldingDays,holdingDaysMin,holdingDaysQ1,holdingDaysMedian,holdingDaysQ3,holdingDaysMax";
  const fmtRF = (v: number) => v === Infinity ? "Inf" : v.toFixed(2);
  const rows = results.map((r) => [
    r.symbol, `"${r.name}"`, r.window, `"${r.strategyName}"`, r.strategyId,
    r.trades, r.wins, r.losses, r.winRate.toFixed(1), r.totalReturnPct.toFixed(2),
    r.maxTradeReturnPct.toFixed(2),
    r.profitFactor === Infinity ? "Inf" : r.profitFactor.toFixed(2),
    r.sharpeRatio.toFixed(2), r.maxDrawdownPct.toFixed(2), r.avgDrawdownPct.toFixed(2),
    fmtRF(r.recoveryFactor),
    r.avgHoldingDays.toFixed(1), r.holdingDaysMin, r.holdingDaysQ1.toFixed(0),
    r.holdingDaysMedian.toFixed(0), r.holdingDaysQ3.toFixed(0), r.holdingDaysMax,
  ].join(","));
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const path = join(process.cwd(), "data", `backtest-10yr-windows-${ts}.csv`);
  writeFileSync(path, [header, ...rows].join("\n"), "utf-8");
  console.log(`\nCSV出力: ${path} (${results.length}行)`);
}

function writeWFCSV(results: WFResult[]) {
  const header = "strategyId,strategyName,windowId,trainLabel,testLabel,bestParams,trainTrades,trainWinRate,trainReturnPct,trainMedianRet,testTrades,testWinRate,testReturnPct,testMedianRet,winRateDelta,returnDelta,stockCount";
  const rows = results.map((r) => [
    r.strategyId, `"${r.strategyName}"`, r.windowId, r.trainLabel, r.testLabel,
    `"${r.bestParams}"`, r.trainTrades, r.trainWinRate.toFixed(1), r.trainReturnPct.toFixed(2),
    r.trainMedianRet.toFixed(2), r.testTrades, r.testWinRate.toFixed(1), r.testReturnPct.toFixed(2),
    r.testMedianRet.toFixed(2), r.winRateDelta.toFixed(1), r.returnDelta.toFixed(2), r.stockCount,
  ].join(","));
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const path = join(process.cwd(), "data", `walk-forward-${ts}.csv`);
  writeFileSync(path, [header, ...rows].join("\n"), "utf-8");
  console.log(`\nCSV出力: ${path} (${results.length}行)`);
}

// ============================================================
// メイン
// ============================================================

async function main() {
  const opts = parseCliArgs();
  let stocks = loadStocks(opts);
  if (opts.limit) stocks = stocks.slice(0, opts.limit);

  const label = opts.favoritesOnly ? "お気に入り" : opts.allStocks ? "全上場企業" : opts.segment;
  console.log("=".repeat(60));
  console.log("10年バックテスト");
  console.log(`  対象: ${label} (${stocks.length}銘柄)`);
  console.log(`  モード: ${opts.mode}`);
  console.log(`  戦略: ${opts.activeStrategies.length}戦略`);
  if (opts.mode !== "windows") {
    console.log(`  訓練期間: ${opts.trainYears}年, 検証期間: ${opts.testYears}年`);
  }
  console.log("=".repeat(60));

  const startTime = Date.now();

  // キャッシュからデータ読み込み
  console.log("\n[データ読み込み]");
  const stockDataList = loadAllStockData(stocks);
  console.log(`  ${stockDataList.length}銘柄のデータ読み込み完了`);

  // Part A: ウィンドウバックテスト
  if (opts.mode === "windows" || opts.mode === "both") {
    console.log("\n[Part A: マルチウィンドウバックテスト]");
    const windowResults = runWindowBacktests(stockDataList, opts.activeStrategies);
    writeWindowCSV(windowResults);
    printWindowSummary(windowResults, opts.activeStrategies);
  }

  // Part B: ウォークフォワード分析
  if (opts.mode === "walkforward" || opts.mode === "both") {
    console.log("\n[Part B: ウォークフォワード分析]");
    const wfResults = runWalkForward(stockDataList, opts.activeStrategies, opts.trainYears, opts.testYears);
    writeWFCSV(wfResults);
    printWFSummary(wfResults, opts.activeStrategies);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("\n" + "=".repeat(60));
  console.log(`完了 (${elapsed}秒)`);
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

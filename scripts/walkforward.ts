#!/usr/bin/env npx tsx
// ============================================================
// ウォークフォワード分析 + パラメータ安定性評価
//
// 使い方:
//   npx tsx scripts/walkforward.ts                     # お気に入りのみ
//   npx tsx scripts/walkforward.ts --all               # 全銘柄
//   npx tsx scripts/walkforward.ts --strategies macd_trail,tabata_cwh
//   npx tsx scripts/walkforward.ts --train-years 3 --test-years 1
//
// 前提: npx tsx scripts/fetch-10yr-data.ts で10年データをキャッシュ済み
// ============================================================

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getArgs, parseFlag, hasFlag, parseIntFlag } from "@/lib/utils/cli";
import { strategies } from "@/lib/backtest/strategies";
import { runBacktest } from "@/lib/backtest/engine";
import type { PriceData } from "@/types";
import type { StrategyDef, StrategyParam } from "@/lib/backtest/types";
import { loadCached10yr } from "./fetch-10yr-data";

const INITIAL_CAPITAL = 1_000_000;
const EXCLUDE_SYMBOLS = new Set(["7817.T"]);

// ============================================================
// CLI引数
// ============================================================

function parseCliArgs() {
  const args = getArgs();

  const allStocks = hasFlag(args, "--all");
  const favoritesOnly = !allStocks && !hasFlag(args, "--segment");
  const segment = parseFlag(args, "--segment") ?? "プライム";
  const trainYears = parseIntFlag(args, "--train-years", 3);
  const testYears = parseIntFlag(args, "--test-years", 1);
  const strategyFilter = parseFlag(args, "--strategies")?.split(",") ?? null;
  const noOptimize = hasFlag(args, "--no-optimize");

  const activeStrategies = strategies.filter((s) => {
    if (s.id === "dca") return false;
    if (strategyFilter) return strategyFilter.includes(s.id);
    return true;
  });

  return { allStocks, favoritesOnly, segment, trainYears, testYears, activeStrategies, strategyFilter, noOptimize };
}

// ============================================================
// 銘柄・データ読み込み
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
    if (opts.allStocks) return true;
    return s.marketSegment === opts.segment;
  });
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
    console.log(`  ⚠ ${missing}銘柄のキャッシュが見つかりません (先に fetch-10yr-data.ts を実行)`);
  }
  return result;
}

function sliceData(data: PriceData[], startDate: string, endDate: string): PriceData[] {
  return data.filter((d) => d.date >= startDate && d.date <= endDate);
}

// ============================================================
// パラメータグリッド生成
// ============================================================

/** パラメータ数に応じた1パラメータあたりの最大値数 */
function maxValuesPerParam(numParams: number): number {
  if (numParams <= 2) return 8;
  if (numParams <= 4) return 5;
  return 4; // 5-6 params
}

/** min〜maxの範囲をstep刻みで生成し、多い場合はサブサンプル */
function generateValues(p: StrategyParam, maxCount: number): number[] {
  const min = p.min ?? p.default;
  const max = p.max ?? p.default;
  const step = p.step ?? 1;

  const all: number[] = [];
  for (let v = min; v <= max + step * 0.001; v += step) {
    all.push(Math.round(v * 1000) / 1000);
  }

  if (all.length <= maxCount) return all;

  // サブサンプル: min, max, default を含む等間隔抽出
  const result = new Set<number>();
  result.add(all[0]);
  result.add(all[all.length - 1]);
  // defaultを含める
  const defVal = Math.round(p.default * 1000) / 1000;
  if (defVal >= min && defVal <= max) result.add(defVal);

  // 残りを等間隔で埋める
  const target = maxCount;
  for (let i = 1; i < target - 1; i++) {
    const idx = Math.round(i * (all.length - 1) / (target - 1));
    result.add(all[idx]);
  }

  return Array.from(result).sort((a, b) => a - b);
}

/** 戦略パラメータ定義からグリッドを生成 */
function generateParamGrid(strategy: StrategyDef, noOptimize = false): { key: string; params: Record<string, number> }[] {
  if (strategy.params.length === 0) {
    return [{ key: "default", params: {} }];
  }

  if (noOptimize) {
    const defaultParams: Record<string, number> = {};
    const keyParts: string[] = [];
    for (const p of strategy.params) {
      defaultParams[p.key] = p.default;
      keyParts.push(`${p.key.replace(/Pct|Period/g, "")}${p.default}`);
    }
    return [{ key: keyParts.join("/"), params: defaultParams }];
  }

  const maxVals = maxValuesPerParam(strategy.params.length);
  const paramArrays = strategy.params.map((p) => ({
    key: p.key,
    values: generateValues(p, maxVals),
  }));

  // デカルト積
  let combos: Record<string, number>[] = [{}];
  for (const pa of paramArrays) {
    const next: Record<string, number>[] = [];
    for (const combo of combos) {
      for (const val of pa.values) {
        next.push({ ...combo, [pa.key]: val });
      }
    }
    combos = next;
  }

  // 戦略固有のフィルタ
  combos = combos.filter((c) => {
    if (strategy.id === "ma_cross" || strategy.id === "macd_signal" || strategy.id === "macd_trail") {
      if (c.shortPeriod >= c.longPeriod) return false;
    }
    if (strategy.id === "dip_kairi") {
      if (c.entryKairi >= c.exitKairi) return false;
    }
    return true;
  });

  // パラメータキー文字列を生成
  return combos.map((c) => {
    const keyParts = strategy.params.map((p) => {
      const short = p.key.replace(/Period|Pct|Multiple|Threshold/g, "")
        .replace("short", "S").replace("long", "L").replace("signal", "Sig")
        .replace("oversold", "OS").replace("overbought", "OB")
        .replace("entry", "E").replace("exit", "X").replace("recovery", "Rec")
        .replace("dip", "Dip").replace("trail", "Tr").replace("stopLoss", "SL")
        .replace("takeProfit", "TP").replace("atr", "ATR").replace("volume", "Vol")
        .replace("rsi", "RSI").replace("monthly", "Mon").replace("timeStop", "TS");
      return `${short}${c[p.key]}`;
    });
    return { key: keyParts.join("/"), params: c };
  });
}

// ============================================================
// ウォークフォワード ウィンドウ
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
  // 2016→2025 の10年間で trainYears+testYears ずつスライド
  const startYear = 2016;
  const endYear = 2025;
  let id = 1;
  for (let y = startYear; y + trainYears + testYears - 1 <= endYear; y++) {
    const trainEnd = y + trainYears - 1;
    const testStart = trainEnd + 1;
    const testEnd = testStart + testYears - 1;
    windows.push({
      id,
      trainStart: `${y}-01-01`,
      trainEnd: `${trainEnd}-12-31`,
      testStart: `${testStart}-01-01`,
      testEnd: `${testEnd}-12-31`,
      trainLabel: trainYears === 1 ? `${y}` : `${y}-${trainEnd}`,
      testLabel: testYears === 1 ? `${testStart}` : `${testStart}-${testEnd}`,
    });
    id++;
  }
  return windows;
}

// ============================================================
// ウォークフォワード実行
// ============================================================

interface WFRecord {
  strategyId: string;
  strategyName: string;
  paramKey: string;
  paramValues: Record<string, number>;
  windowId: number;
  trainLabel: string;
  testLabel: string;
  trainReturn: number;
  testReturn: number;
  testReturnMean: number;
  testReturnP25: number;
  testReturnP75: number;
  testWinRate: number;
  testTrades: number;
  testStocksWithTrades: number;
  testTotalStocks: number;
  testMaxDD: number;
  testSharpe: number;
}

function runWalkForward(
  stockDataList: StockData[],
  activeStrategies: StrategyDef[],
  windows: WFWindow[],
  noOptimize = false,
): WFRecord[] {
  const allRecords: WFRecord[] = [];
  const totalStrats = activeStrategies.length;

  for (let si = 0; si < totalStrats; si++) {
    const strat = activeStrategies[si];
    const grid = generateParamGrid(strat, noOptimize);
    const t0 = Date.now();
    console.log(`  [${si + 1}/${totalStrats}] ${strat.name} (${grid.length}組合せ × ${windows.length}窓)...`);

    for (const win of windows) {
      for (const combo of grid) {
        let trainReturns: number[] = [];
        let testReturns: number[] = [];
        let testWinRates: number[] = [];
        let testTradesList: number[] = [];
        let testMaxDDs: number[] = [];
        let testSharpes: number[] = [];

        for (const sd of stockDataList) {
          const trainData = sliceData(sd.data, win.trainStart, win.trainEnd);
          const testData = sliceData(sd.data, win.testStart, win.testEnd);

          if (trainData.length < 30) continue;

          // 訓練
          const trainResult = runBacktest(trainData, strat, combo.params, INITIAL_CAPITAL);
          trainReturns.push(trainResult.stats.totalReturnPct);

          // 検証
          if (testData.length >= 20) {
            const testResult = runBacktest(testData, strat, combo.params, INITIAL_CAPITAL);
            testReturns.push(testResult.stats.totalReturnPct);
            testWinRates.push(testResult.stats.winRate);
            testTradesList.push(testResult.stats.numTrades);
            testMaxDDs.push(testResult.stats.maxDrawdownPct);
            testSharpes.push(testResult.stats.sharpeRatio);
          }
        }

        if (testReturns.length === 0) continue;

        allRecords.push({
          strategyId: strat.id,
          strategyName: strat.name,
          paramKey: combo.key,
          paramValues: combo.params,
          windowId: win.id,
          trainLabel: win.trainLabel,
          testLabel: win.testLabel,
          trainReturn: median(trainReturns),
          testReturn: median(testReturns),
          testReturnMean: mean(testReturns),
          testReturnP25: percentile(testReturns, 25),
          testReturnP75: percentile(testReturns, 75),
          testWinRate: median(testWinRates),
          testTrades: sum(testTradesList),
          testStocksWithTrades: testTradesList.filter((t) => t > 0).length,
          testTotalStocks: testReturns.length,
          testMaxDD: median(testMaxDDs),
          testSharpe: median(testSharpes),
        });
      }
    }
    console.log(`    完了 (${((Date.now() - t0) / 1000).toFixed(1)}秒)`);
  }
  return allRecords;
}

// ============================================================
// パラメータ安定性評価
// ============================================================

interface ParamScore {
  strategyId: string;
  strategyName: string;
  paramKey: string;
  paramValues: Record<string, number>;
  testReturnMedian: number;
  testReturnMean: number;
  testReturnP25: number;
  testReturnP75: number;
  testReturnMin: number;
  testReturnStd: number;
  trainReturnMedian: number;
  overfitDegree: number;
  compositeScore: number;
  // 各ウィンドウの検証リターン
  windowReturns: number[];
  // 各ウィンドウの検証Mean
  windowReturnsMean: number[];
  // 各ウィンドウの取引あり銘柄数/全銘柄数
  windowActiveStocks: string[];
}

function evaluateStability(records: WFRecord[], activeStrategies: StrategyDef[], windows: WFWindow[]): ParamScore[] {
  const allScores: ParamScore[] = [];

  for (const strat of activeStrategies) {
    const stratRecords = records.filter((r) => r.strategyId === strat.id);
    if (stratRecords.length === 0) continue;

    // パラメータキーごとに集約
    const byParam = new Map<string, WFRecord[]>();
    for (const r of stratRecords) {
      const existing = byParam.get(r.paramKey) ?? [];
      existing.push(r);
      byParam.set(r.paramKey, existing);
    }

    const rawScores: Omit<ParamScore, "compositeScore">[] = [];

    for (const [paramKey, recs] of Array.from(byParam.entries())) {
      const testRets = recs.map((r) => r.testReturn);
      const testRetsMean = recs.map((r) => r.testReturnMean);
      const trainRets = recs.map((r) => r.trainReturn);

      const testMed = median(testRets);
      const testAvg = mean(testRetsMean);
      const testP25 = percentile(testRets, 25);
      const testP75 = percentile(testRets, 75);
      const testMin = Math.min(...testRets);
      const testStd = stddev(testRets);
      const trainMed = median(trainRets);
      const ofit = trainMed - testMed;

      rawScores.push({
        strategyId: strat.id,
        strategyName: strat.name,
        paramKey,
        paramValues: recs[0].paramValues,
        testReturnMedian: testMed,
        testReturnMean: testAvg,
        testReturnP25: testP25,
        testReturnP75: testP75,
        testReturnMin: testMin,
        testReturnStd: testStd,
        trainReturnMedian: trainMed,
        overfitDegree: ofit,
        windowReturns: windows.map((w) => {
          const wr = recs.find((r) => r.windowId === w.id);
          return wr?.testReturn ?? 0;
        }),
        windowReturnsMean: windows.map((w) => {
          const wr = recs.find((r) => r.windowId === w.id);
          return wr?.testReturnMean ?? 0;
        }),
        windowActiveStocks: windows.map((w) => {
          const wr = recs.find((r) => r.windowId === w.id);
          return wr ? `${wr.testStocksWithTrades}/${wr.testTotalStocks}` : "0/0";
        }),
      });
    }

    if (rawScores.length === 0) continue;

    // min-max正規化 → 複合スコア計算
    const normalize = (values: number[], higherIsBetter: boolean): number[] => {
      const min = Math.min(...values);
      const max = Math.max(...values);
      if (max === min) return values.map(() => 0.5);
      return values.map((v) => higherIsBetter ? (v - min) / (max - min) : (max - v) / (max - min));
    };

    const medNorm = normalize(rawScores.map((s) => s.testReturnMedian), true);
    const minNorm = normalize(rawScores.map((s) => s.testReturnMin), true);
    const stdNorm = normalize(rawScores.map((s) => s.testReturnStd), false); // 低い方が良い
    const ofitNorm = normalize(rawScores.map((s) => s.overfitDegree), false); // 低い方が良い

    for (let i = 0; i < rawScores.length; i++) {
      const score = 0.4 * medNorm[i] + 0.3 * minNorm[i] + 0.2 * stdNorm[i] + 0.1 * ofitNorm[i];
      allScores.push({ ...rawScores[i], compositeScore: score });
    }
  }

  return allScores;
}

// ============================================================
// 出力
// ============================================================

function printStrategySummary(
  scores: ParamScore[],
  records: WFRecord[],
  activeStrategies: StrategyDef[],
  windows: WFWindow[],
) {
  const W = 120;

  for (const strat of activeStrategies) {
    const stratScores = scores
      .filter((s) => s.strategyId === strat.id)
      .sort((a, b) => b.compositeScore - a.compositeScore);
    if (stratScores.length === 0) continue;

    console.log("\n" + "=".repeat(W));
    console.log(`${strat.name} (${strat.id}) — ${stratScores.length}組合せ評価`);
    console.log("=".repeat(W));

    // 推奨パラメータ
    const best = stratScores[0];
    console.log(`\n★ 推奨パラメータ: ${best.paramKey}`);
    console.log(`  パラメータ値: ${JSON.stringify(best.paramValues)}`);
    console.log(`  スコア: ${best.compositeScore.toFixed(3)}`);
    console.log(`  検証中央値: ${fmtPct(best.testReturnMedian)} | 検証平均: ${fmtPct(best.testReturnMean)} | P25: ${fmtPct(best.testReturnP25)} | P75: ${fmtPct(best.testReturnP75)} | 最小: ${fmtPct(best.testReturnMin)} | OFit: ${fmtPct(best.overfitDegree)}`);

    // Top 5
    console.log(`\nスコア上位5:`);
    console.log(
      "  " + "Rank".padEnd(5) +
      "ParamKey".padEnd(40) +
      "Score".padStart(7) +
      "Med%".padStart(8) +
      "Mean%".padStart(8) +
      "P25%".padStart(8) +
      "P75%".padStart(8) +
      "Min%".padStart(8) +
      "OFit%".padStart(8),
    );
    console.log("  " + "-".repeat(100));
    for (let i = 0; i < Math.min(5, stratScores.length); i++) {
      const s = stratScores[i];
      console.log(
        "  " + `#${i + 1}`.padEnd(5) +
        s.paramKey.padEnd(40) +
        s.compositeScore.toFixed(3).padStart(7) +
        fmtPct(s.testReturnMedian).padStart(8) +
        fmtPct(s.testReturnMean).padStart(8) +
        fmtPct(s.testReturnP25).padStart(8) +
        fmtPct(s.testReturnP75).padStart(8) +
        fmtPct(s.testReturnMin).padStart(8) +
        fmtPct(s.overfitDegree).padStart(8),
      );
    }

    // ウィンドウ別 推奨パラメータの検証リターン
    console.log(`\n推奨パラメータのウィンドウ別検証リターン:`);
    for (let wi = 0; wi < windows.length; wi++) {
      const w = windows[wi];
      console.log(`  #${w.id} ${w.trainLabel}→${w.testLabel}: Med ${fmtPct(best.windowReturns[wi])} | Mean ${fmtPct(best.windowReturnsMean[wi])} | Active ${best.windowActiveStocks[wi]}`);
    }

    // パラメータ安定性: 各ウィンドウの訓練1位パラメータ
    console.log(`\n各ウィンドウの訓練1位パラメータ:`);
    const trainBestPerWindow: string[] = [];
    for (const win of windows) {
      const winRecords = records
        .filter((r) => r.strategyId === strat.id && r.windowId === win.id)
        .sort((a, b) => b.trainReturn - a.trainReturn);
      if (winRecords.length > 0) {
        const tb = winRecords[0];
        trainBestPerWindow.push(tb.paramKey);
        console.log(`  #${win.id} ${win.trainLabel}→${win.testLabel}: ${tb.paramKey} (Train:${fmtPct(tb.trainReturn)} → Test:${fmtPct(tb.testReturn)})`);
      }
    }

    // 安定性チェック: ユニークなパラメータキーが多ければ警告
    const uniqueParams = new Set(trainBestPerWindow).size;
    if (uniqueParams > windows.length * 0.7) {
      console.log(`\n  ⚠ パラメータ不安定 — 訓練1位が毎回異なる (${uniqueParams}/${windows.length}ユニーク)。戦略自体のロバスト性に疑問`);
    } else if (uniqueParams <= 2) {
      console.log(`\n  ✓ パラメータ安定 — 訓練1位がほぼ同一 (${uniqueParams}種類)`);
    }
  }
}

function printWindowDetails(records: WFRecord[], activeStrategies: StrategyDef[], windows: WFWindow[]) {
  const W = 120;
  console.log("\n" + "=".repeat(W));
  console.log("ウィンドウ別詳細");
  console.log("=".repeat(W));

  for (const win of windows) {
    console.log(`\n--- #${win.id}: 訓練 ${win.trainLabel} → 検証 ${win.testLabel} ---`);
    console.log(
      "  " + "Strategy".padEnd(20) +
      "TrainBestParam".padEnd(35) +
      "Train%".padStart(8) +
      "Med%".padStart(8) +
      "Mean%".padStart(8) +
      "P25%".padStart(8) +
      "P75%".padStart(8) +
      "Active".padStart(10) +
      "TestTr".padStart(7) +
      "TestSR".padStart(8),
    );
    console.log("  " + "-".repeat(130));

    for (const strat of activeStrategies) {
      const winRecords = records
        .filter((r) => r.strategyId === strat.id && r.windowId === win.id);
      if (winRecords.length === 0) continue;

      // 訓練1位
      const sorted = [...winRecords].sort((a, b) => b.trainReturn - a.trainReturn);
      const best = sorted[0];

      console.log(
        "  " + strat.name.slice(0, 18).padEnd(20) +
        best.paramKey.slice(0, 33).padEnd(35) +
        fmtPct(best.trainReturn).padStart(8) +
        fmtPct(best.testReturn).padStart(8) +
        fmtPct(best.testReturnMean).padStart(8) +
        fmtPct(best.testReturnP25).padStart(8) +
        fmtPct(best.testReturnP75).padStart(8) +
        `${best.testStocksWithTrades}/${best.testTotalStocks}`.padStart(10) +
        best.testTrades.toString().padStart(7) +
        best.testSharpe.toFixed(2).padStart(8),
      );
    }
  }
}

function writeCSV(records: WFRecord[]) {
  const header = "strategy,paramKey,paramValues,window,trainReturn,testReturnMed,testReturnMean,testReturnP25,testReturnP75,testWinRate,testTrades,activeStocks,totalStocks,testMaxDD,testSharpe";
  const rows = records.map((r) => [
    r.strategyId,
    `"${r.paramKey}"`,
    `"${JSON.stringify(r.paramValues).replace(/"/g, "'")}"`,
    `${r.trainLabel}→${r.testLabel}`,
    r.trainReturn.toFixed(2),
    r.testReturn.toFixed(2),
    r.testReturnMean.toFixed(2),
    r.testReturnP25.toFixed(2),
    r.testReturnP75.toFixed(2),
    r.testWinRate.toFixed(1),
    r.testTrades,
    r.testStocksWithTrades,
    r.testTotalStocks,
    r.testMaxDD.toFixed(2),
    r.testSharpe.toFixed(2),
  ].join(","));

  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const path = join(process.cwd(), "data", `walkforward-results-${ts}.csv`);
  writeFileSync(path, [header, ...rows].join("\n"), "utf-8");
  console.log(`\nCSV出力: ${path} (${records.length}行)`);
}

function printPresetsUpdate(scores: ParamScore[], activeStrategies: StrategyDef[]) {
  console.log("\n" + "=".repeat(80));
  console.log("presets.ts 更新案 (ウォークフォワード安定性ベース)");
  console.log("=".repeat(80));

  for (const strat of activeStrategies) {
    if (strat.params.length === 0) continue; // 固定パラメータ戦略はスキップ

    const stratScores = scores
      .filter((s) => s.strategyId === strat.id)
      .sort((a, b) => b.compositeScore - a.compositeScore);
    if (stratScores.length === 0) continue;

    const best = stratScores[0];
    console.log(`\n  ${strat.id}: {`);
    console.log(`    daily: {`);
    console.log(`      params: ${JSON.stringify(best.paramValues)},`);
    console.log(`      winRate: 0,  // WF安定性スコア: ${best.compositeScore.toFixed(3)}`);
    console.log(`      totalReturnPct: ${best.testReturnMedian.toFixed(1)},  // 検証中央値`);
    console.log(`      trades: 0,`);
    console.log(`    },`);
    console.log(`  },`);
  }
}

// ============================================================
// ユーティリティ
// ============================================================

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}

function stddev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = sum(arr) / arr.length;
  const variance = sum(arr.map((v) => (v - m) ** 2)) / (arr.length - 1);
  return Math.sqrt(variance);
}

function fmtPct(v: number): string {
  return (v >= 0 ? "+" : "") + v.toFixed(1);
}

// ============================================================
// メイン
// ============================================================

async function main() {
  const opts = parseCliArgs();
  const stocks = loadStocks(opts);
  const windows = generateWFWindows(opts.trainYears, opts.testYears);

  console.log("============================================================");
  console.log("ウォークフォワード分析 + パラメータ安定性評価");
  console.log(`  対象: ${opts.favoritesOnly ? "お気に入り" : opts.allStocks ? "全銘柄" : opts.segment} (${stocks.length}銘柄)`);
  console.log(`  ウィンドウ: 訓練${opts.trainYears}年→検証${opts.testYears}年 × ${windows.length}窓`);
  console.log(`  戦略: ${opts.activeStrategies.length}戦略`);
  console.log("============================================================");

  // ウィンドウ表示
  console.log("\n[ウォークフォワード ウィンドウ]");
  for (const w of windows) {
    console.log(`  #${w.id}: 訓練 ${w.trainLabel} → 検証 ${w.testLabel}`);
  }

  // データ読み込み
  console.log("\n[データ読み込み]");
  const stockDataList = loadAllStockData(stocks);
  console.log(`  ${stockDataList.length}銘柄のデータ読み込み完了`);

  // グリッドサイズ表示
  console.log("\n[パラメータグリッド]");
  let totalCombos = 0;
  for (const strat of opts.activeStrategies) {
    const grid = generateParamGrid(strat, opts.noOptimize);
    totalCombos += grid.length;
    console.log(`  ${strat.name}: ${grid.length}組合せ`);
  }
  console.log(`  合計: ${totalCombos}組合せ`);
  if (opts.noOptimize) console.log(`  ※ --no-optimize: デフォルトパラメータのみ`);

  // ウォークフォワード実行
  console.log("\n[ウォークフォワード実行]");
  const t0 = Date.now();
  const records = runWalkForward(stockDataList, opts.activeStrategies, windows, opts.noOptimize);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`  完了 (${elapsed}秒, ${records.length}レコード)`);

  // パラメータ安定性評価
  console.log("\n[パラメータ安定性評価]");
  const scores = evaluateStability(records, opts.activeStrategies, windows);

  // 出力
  printStrategySummary(scores, records, opts.activeStrategies, windows);
  printWindowDetails(records, opts.activeStrategies, windows);
  writeCSV(records);
  printPresetsUpdate(scores, opts.activeStrategies);

  console.log("\n" + "=".repeat(60));
  console.log(`完了 (総計 ${elapsed}秒)`);
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

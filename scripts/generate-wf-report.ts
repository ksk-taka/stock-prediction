#!/usr/bin/env npx tsx
// ============================================================
// WF分析結果CSV → レポートデータ変換
//
// 使い方:
//   npx tsx scripts/generate-wf-report.ts
//
// data/walkforward-results-*.csv を読み込み、
// src/lib/reports/wfReportData.ts を自動生成する
// ============================================================

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "fs";
import { join } from "path";

// ============================================================
// CSV読み込み
// ============================================================

interface WFRecord {
  strategyId: string;
  paramKey: string;
  paramValues: Record<string, number>;
  windowLabel: string;    // "2016-2018→2019"
  trainLabel: string;     // "2016-2018"
  testLabel: string;      // "2019"
  windowId: number;
  trainReturn: number;
  testReturn: number;
  testWinRate: number;
  testTrades: number;
  testMaxDD: number;
  testSharpe: number;
}

function findLatestWFCSV(): string {
  const dataDir = join(process.cwd(), "data");
  const files = readdirSync(dataDir)
    .filter((f) => f.startsWith("walkforward-results-") && f.endsWith(".csv"))
    .sort();
  if (files.length === 0) {
    throw new Error("No walkforward-results-*.csv found in data/");
  }
  return join(dataDir, files[files.length - 1]);
}

function parseCSV(path: string): WFRecord[] {
  const content = readFileSync(path, "utf-8");
  const lines = content.trim().split("\n");
  const records: WFRecord[] = [];

  // ウィンドウラベルの一覧を収集してID割当
  const windowLabels = new Set<string>();

  // まず全行パースしてウィンドウラベル収集
  const rawRows: string[][] = [];
  for (let i = 1; i < lines.length; i++) {
    // CSVパース（ダブルクォート対応）
    const row = parseCSVLine(lines[i]);
    if (row.length < 10) continue;
    rawRows.push(row);
    windowLabels.add(row[3]);
  }

  // ウィンドウラベルをソートしてID割当
  const sortedLabels = Array.from(windowLabels).sort();
  const labelToId = new Map<string, number>();
  sortedLabels.forEach((label, idx) => labelToId.set(label, idx + 1));

  for (const row of rawRows) {
    const windowLabel = row[3];
    const parts = windowLabel.split("→");

    // paramValues パース: {'shortPeriod':2,'longPeriod':5} → JSON
    let paramValues: Record<string, number> = {};
    try {
      const jsonStr = row[2].replace(/'/g, '"');
      paramValues = JSON.parse(jsonStr);
    } catch {}

    records.push({
      strategyId: row[0],
      paramKey: row[1],
      paramValues,
      windowLabel,
      trainLabel: parts[0] || "",
      testLabel: parts[1] || "",
      windowId: labelToId.get(windowLabel) || 0,
      trainReturn: parseFloat(row[4]) || 0,
      testReturn: parseFloat(row[5]) || 0,
      testWinRate: parseFloat(row[6]) || 0,
      testTrades: parseInt(row[7]) || 0,
      testMaxDD: parseFloat(row[8]) || 0,
      testSharpe: parseFloat(row[9]) || 0,
    });
  }

  return records;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// ============================================================
// 安定性評価（walkforward.ts と同じロジック）
// ============================================================

interface ParamScore {
  strategyId: string;
  paramKey: string;
  paramValues: Record<string, number>;
  testReturnMedian: number;
  testReturnMin: number;
  testReturnStd: number;
  trainReturnMedian: number;
  overfitDegree: number;
  compositeScore: number;
  windowReturns: number[];
  windowWinRates: number[];
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function stddev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

function evaluateStability(records: WFRecord[], numWindows: number): Map<string, ParamScore[]> {
  // 戦略ごとにグループ化（除外戦略をスキップ）
  const byStrategy = new Map<string, WFRecord[]>();
  for (const r of records) {
    if (EXCLUDE_STRATEGIES.has(r.strategyId)) continue;
    const existing = byStrategy.get(r.strategyId) ?? [];
    existing.push(r);
    byStrategy.set(r.strategyId, existing);
  }

  const result = new Map<string, ParamScore[]>();

  for (const [stratId, stratRecords] of byStrategy) {
    // パラメータキーごとに集約
    const byParam = new Map<string, WFRecord[]>();
    for (const r of stratRecords) {
      const existing = byParam.get(r.paramKey) ?? [];
      existing.push(r);
      byParam.set(r.paramKey, existing);
    }

    const rawScores: Omit<ParamScore, "compositeScore">[] = [];

    for (const [paramKey, recs] of byParam) {
      const testRets = recs.map((r) => r.testReturn);
      const trainRets = recs.map((r) => r.trainReturn);

      const testMed = median(testRets);
      const testMin = Math.min(...testRets);
      const testStd = stddev(testRets);
      const trainMed = median(trainRets);
      const ofit = trainMed - testMed;

      // ウィンドウ別テストリターン
      const windowReturns: number[] = [];
      const windowWinRates: number[] = [];
      for (let wid = 1; wid <= numWindows; wid++) {
        const wr = recs.find((r) => r.windowId === wid);
        windowReturns.push(wr?.testReturn ?? 0);
        windowWinRates.push(wr?.testWinRate ?? 0);
      }

      rawScores.push({
        strategyId: stratId,
        paramKey,
        paramValues: recs[0].paramValues,
        testReturnMedian: testMed,
        testReturnMin: testMin,
        testReturnStd: testStd,
        trainReturnMedian: trainMed,
        overfitDegree: ofit,
        windowReturns,
        windowWinRates,
      });
    }

    if (rawScores.length === 0) continue;

    // min-max正規化 → 複合スコア計算
    const normalize = (values: number[], higherIsBetter: boolean): number[] => {
      const min = Math.min(...values);
      const max = Math.max(...values);
      if (max === min) return values.map(() => 0.5);
      return values.map((v) => (higherIsBetter ? (v - min) / (max - min) : (max - v) / (max - min)));
    };

    const medNorm = normalize(rawScores.map((s) => s.testReturnMedian), true);
    const minNorm = normalize(rawScores.map((s) => s.testReturnMin), true);
    const stdNorm = normalize(rawScores.map((s) => s.testReturnStd), false);
    const ofitNorm = normalize(rawScores.map((s) => s.overfitDegree), false);

    const scored: ParamScore[] = [];
    for (let i = 0; i < rawScores.length; i++) {
      const score = 0.4 * medNorm[i] + 0.3 * minNorm[i] + 0.2 * stdNorm[i] + 0.1 * ofitNorm[i];
      scored.push({ ...rawScores[i], compositeScore: score });
    }

    scored.sort((a, b) => b.compositeScore - a.compositeScore);
    result.set(stratId, scored);
  }

  return result;
}

// ============================================================
// 戦略名マッピング
// ============================================================

const STRATEGY_NAMES: Record<string, string> = {
  ma_cross: "MAクロス(MA5/MA25)",
  rsi_reversal: "RSI逆張り",
  macd_signal: "MACDシグナル",
  dip_buy: "急落買い",
  macd_trail: "MACDトレイル12%",
  tabata_cwh: "CWH(TP20/SL8)",
};

/** レポートから除外する戦略 */
const EXCLUDE_STRATEGIES = new Set([
  "cwh_trail",
  "choruko_bb",
  "choruko_shitabanare",
  "dip_kairi",
  "dip_rsi_volume",
  "dip_bb3sigma",
]);

/** 特定戦略で本番運用パラメータを強制指定 (WFベストではなく実運用パラメータを使う) */
const PARAM_OVERRIDES: Record<string, string> = {
  tabata_cwh: "TP20/SL7",  // 実運用TP20/SL8に最も近いWFグリッド値
  ma_cross: "S5/L25",       // 王道 MA5/MA25
};

// ============================================================
// TypeScriptコード生成
// ============================================================

function generateTSFile(scores: Map<string, ParamScore[]>, numWindows: number, csvPath: string): string {
  // ウィンドウ定義
  const windows = [];
  for (let y = 2016; y + 3 <= 2025; y++) {
    const trainEnd = y + 2;
    const testYear = trainEnd + 1;
    windows.push({
      id: windows.length + 1,
      trainLabel: `${y}-${trainEnd}`,
      testLabel: `${testYear}`,
    });
  }

  // 戦略データ（ベストパラメータのみ）
  const strategyData: Array<{
    strategyId: string;
    strategyName: string;
    stabilityScore: number;
    bestParams: Record<string, number>;
    bestParamLabel: string;
    testReturnMedian: number;
    testReturnMin: number;
    testReturnStd: number;
    trainReturnMedian: number;
    overfitDegree: number;
    testWinRate: number;
    windowReturns: number[];
    windowWinRates: number[];
  }> = [];

  // 全パラメータ組合せ数を計算
  let totalParams = 0;

  for (const [stratId, paramScores] of scores) {
    totalParams += paramScores.length;
    if (paramScores.length === 0) continue;

    // オーバーライド指定がある場合はそのパラメータを使用
    const overrideKey = PARAM_OVERRIDES[stratId];
    let best = paramScores[0];
    if (overrideKey) {
      const found = paramScores.find((s) => s.paramKey === overrideKey);
      if (found) {
        best = found;
        console.log(`  [override] ${stratId}: ${overrideKey} (score ${found.compositeScore.toFixed(3)} → WFベストの代わりに使用)`);
      } else {
        console.log(`  [override] ${stratId}: ${overrideKey} が見つかりません、WFベストを使用`);
      }
    }

    strategyData.push({
      strategyId: stratId,
      strategyName: STRATEGY_NAMES[stratId] || stratId,
      stabilityScore: Math.round(best.compositeScore * 1000) / 1000,
      bestParams: best.paramValues,
      bestParamLabel: best.paramKey,
      testReturnMedian: Math.round(best.testReturnMedian * 10) / 10,
      testReturnMin: Math.round(best.testReturnMin * 10) / 10,
      testReturnStd: Math.round(best.testReturnStd * 10) / 10,
      trainReturnMedian: Math.round(best.trainReturnMedian * 10) / 10,
      overfitDegree: Math.round(best.overfitDegree * 10) / 10,
      testWinRate: Math.round(median(best.windowWinRates) * 10) / 10,
      windowReturns: best.windowReturns.map((v) => Math.round(v * 10) / 10),
      windowWinRates: best.windowWinRates.map((v) => Math.round(v * 10) / 10),
    });
  }

  // スコア降順ソート
  strategyData.sort((a, b) => b.stabilityScore - a.stabilityScore);

  const ts = `// ============================================================
// ウォークフォワード分析レポートデータ (自動生成)
//
// 生成元: ${csvPath.split(/[\\/]/).pop()}
// 生成日: ${new Date().toISOString().slice(0, 10)}
//
// scripts/generate-wf-report.ts で再生成可能
// ============================================================

export interface WFStrategyResult {
  strategyId: string;
  strategyName: string;
  stabilityScore: number;
  bestParams: Record<string, number>;
  bestParamLabel: string;
  testReturnMedian: number;
  testReturnMin: number;
  testReturnStd: number;
  trainReturnMedian: number;
  overfitDegree: number;
  testWinRate: number;
  windowReturns: number[];
  windowWinRates: number[];
}

export interface WFWindowInfo {
  id: number;
  trainLabel: string;
  testLabel: string;
}

export interface WFReportData {
  generatedAt: string;
  config: {
    trainYears: number;
    testYears: number;
    windows: number;
    stocks: number;
    strategies: number;
    paramCombos: number;
  };
  windows: WFWindowInfo[];
  strategies: WFStrategyResult[];
}

export const wfReportData: WFReportData = ${JSON.stringify(
    {
      generatedAt: new Date().toISOString().slice(0, 10),
      config: {
        trainYears: 3,
        testYears: 1,
        windows: numWindows,
        stocks: 22,
        strategies: scores.size,
        paramCombos: totalParams,
      },
      windows,
      strategies: strategyData,
    },
    null,
    2,
  )};
`;

  return ts;
}

// ============================================================
// メイン
// ============================================================

function main() {
  console.log("WF分析レポートデータ生成");
  console.log("========================");

  // CSV検索・読み込み
  const csvPath = findLatestWFCSV();
  console.log(`CSV: ${csvPath}`);

  const records = parseCSV(csvPath);
  console.log(`レコード数: ${records.length}`);

  // ウィンドウ数を推定
  const windowIds = new Set(records.map((r) => r.windowId));
  const numWindows = windowIds.size;
  console.log(`ウィンドウ数: ${numWindows}`);

  // 戦略一覧
  const strategyIds = new Set(records.map((r) => r.strategyId));
  console.log(`戦略数: ${strategyIds.size}`);
  console.log(`戦略: ${Array.from(strategyIds).join(", ")}`);

  // 安定性評価
  const scores = evaluateStability(records, numWindows);

  // 結果サマリ
  console.log("\n戦略別ベストパラメータ:");
  for (const [stratId, paramScores] of scores) {
    if (paramScores.length === 0) continue;
    const best = paramScores[0];
    console.log(
      `  ${(STRATEGY_NAMES[stratId] || stratId).padEnd(20)} ` +
      `スコア: ${best.compositeScore.toFixed(3)} ` +
      `テスト中央値: ${best.testReturnMedian >= 0 ? "+" : ""}${best.testReturnMedian.toFixed(1)}% ` +
      `パラメータ: ${best.paramKey}`,
    );
  }

  // TypeScriptファイル生成
  const outputDir = join(process.cwd(), "src", "lib", "reports");
  mkdirSync(outputDir, { recursive: true });
  const outputPath = join(outputDir, "wfReportData.ts");
  const tsContent = generateTSFile(scores, numWindows, csvPath);
  writeFileSync(outputPath, tsContent, "utf-8");
  console.log(`\n出力: ${outputPath}`);
}

main();

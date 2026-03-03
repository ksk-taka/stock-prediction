#!/usr/bin/env npx tsx
// ============================================================
// ターンアラウンド（営業赤字→黒字転換）バックテスト
//
// ターンアラウンド銘柄の黒字転換後の株価パフォーマンスを検証する。
// エントリー: 黒字転換確認の決算期末日の翌営業日の始値
// イグジット: トレーリングストップ / MACDデッドクロス / 固定TP/SL
//
// Usage:
//   npx tsx scripts/backtest-turnaround.ts               # お気に入りのみ
//   npx tsx scripts/backtest-turnaround.ts --all          # 全銘柄
//   npx tsx scripts/backtest-turnaround.ts --verify       # 検証銘柄のみ
//   npx tsx scripts/backtest-turnaround.ts --csv          # CSV出力
//   npx tsx scripts/backtest-turnaround.ts --exit trail   # イグジット: trail/macd/fixed
// ============================================================

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getArgs, hasFlag, parseFlag, parseIntFlag } from "@/lib/utils/cli";
import { calcMACD } from "@/lib/utils/indicators";
import { loadCached10yr } from "./fetch-10yr-data";
import { getHistoricalPrices } from "@/lib/api/yahooFinance";
import {
  fetchIncomeHistory,
  detectTurnaround,
  DEFAULT_OPTIONS,
  type TurnaroundDetection,
  type TurnaroundScreenerOptions,
} from "@/lib/screener/turnaround";
import type { PriceData } from "@/types";

// ── 定数 ──

const EXCLUDE_SYMBOLS = new Set(["7817.T"]);
const OUTPUT_DIR = join(process.cwd(), "data");

const VERIFY_STOCKS = [
  { symbol: "4506.T", name: "住友ファーマ" },
  { symbol: "7003.T", name: "三井E&S" },
  { symbol: "3401.T", name: "帝人" },
  { symbol: "4324.T", name: "電通グループ" },
  { symbol: "4902.T", name: "コニカミノルタ" },
  { symbol: "5201.T", name: "AGC" },
  { symbol: "6963.T", name: "ローム" },
];

type ExitMode = "trail" | "macd" | "fixed";

// ── 銘柄読み込み ──

interface WatchlistStock {
  symbol: string;
  name: string;
  market: string;
  marketSegment?: string;
  favorite?: boolean;
}

function loadStocks(opts: {
  allStocks: boolean;
  verifyOnly: boolean;
  limit: number;
}): WatchlistStock[] {
  if (opts.verifyOnly) {
    return VERIFY_STOCKS.map((s) => ({
      symbol: s.symbol,
      name: s.name,
      market: "JP",
    }));
  }

  const raw = readFileSync(join(process.cwd(), "data", "watchlist.json"), "utf-8");
  const watchlist = JSON.parse(raw) as { stocks: WatchlistStock[] };
  let stocks = watchlist.stocks.filter((s) => {
    if (EXCLUDE_SYMBOLS.has(s.symbol)) return false;
    if (s.market !== "JP") return false;
    if (opts.allStocks) return true;
    return s.favorite === true;
  });

  if (opts.limit > 0) {
    stocks = stocks.slice(0, opts.limit);
  }

  return stocks;
}

// ── 株価データ取得 ──

async function getPriceData(symbol: string): Promise<PriceData[] | null> {
  // 10年キャッシュ優先
  const cached = loadCached10yr(symbol);
  if (cached && cached.length >= 30) return cached;

  // フォールバック: Yahoo Finance 1年データ
  try {
    const data = await getHistoricalPrices(symbol, "daily");
    return data.length >= 30 ? data : null;
  } catch {
    return null;
  }
}

// ── トレード結果 ──

interface TradeResult {
  symbol: string;
  name: string;
  turnaroundFiscalYear: number;
  consecutiveLossYears: number;
  entryDate: string;
  entryPrice: number;
  exitDate: string;
  exitPrice: number;
  exitReason: string;
  returnPct: number;
  holdingDays: number;
  maxDrawdownPct: number;
  peakPrice: number;
  // 期間リターン（end_of_data でない場合のスナップショット）
  return1y: number | null; // 1年後リターン%
  return2y: number | null; // 2年後リターン%
  return3y: number | null; // 3年後リターン%
}

// ── イグジット戦略 ──

function findEntryIndex(data: PriceData[], turnaroundDate: string): number | null {
  for (let i = 0; i < data.length; i++) {
    if (data[i].date >= turnaroundDate) {
      return i;
    }
  }
  return null;
}

function getPriceAtOffset(data: PriceData[], entryIdx: number, tradingDays: number): number | null {
  const idx = entryIdx + tradingDays;
  if (idx >= data.length) return null;
  return data[idx].close;
}

function simulateTrailingStop(
  data: PriceData[],
  entryIdx: number,
  trailPct: number,
  slPct: number
): { exitIdx: number; exitReason: string } {
  const entryPrice = data[entryIdx].open > 0 ? data[entryIdx].open : data[entryIdx].close;
  let peakPrice = entryPrice;
  const stopLossLevel = entryPrice * (1 - slPct / 100);

  for (let i = entryIdx + 1; i < data.length; i++) {
    const price = data[i].close;

    // 損切り
    if (price <= stopLossLevel) {
      return { exitIdx: i, exitReason: "stop_loss" };
    }

    // 高値更新
    if (price > peakPrice) {
      peakPrice = price;
    }

    // トレーリングストップ
    const trailLevel = peakPrice * (1 - trailPct / 100);
    if (price <= trailLevel) {
      return { exitIdx: i, exitReason: "trailing_stop" };
    }
  }

  return { exitIdx: data.length - 1, exitReason: "end_of_data" };
}

function simulateMacdExit(
  data: PriceData[],
  entryIdx: number,
  slPct: number
): { exitIdx: number; exitReason: string } {
  const entryPrice = data[entryIdx].open > 0 ? data[entryIdx].open : data[entryIdx].close;
  const stopLossLevel = entryPrice * (1 - slPct / 100);
  const macd = calcMACD(data, 12, 26, 9);

  for (let i = entryIdx + 1; i < data.length; i++) {
    const price = data[i].close;

    // 損切り
    if (price <= stopLossLevel) {
      return { exitIdx: i, exitReason: "stop_loss" };
    }

    // MACDデッドクロス (MACD線がシグナル線を下抜け)
    if (
      i > 0 &&
      macd[i].macd != null &&
      macd[i].signal != null &&
      macd[i - 1].macd != null &&
      macd[i - 1].signal != null &&
      macd[i - 1].macd! >= macd[i - 1].signal! &&
      macd[i].macd! < macd[i].signal!
    ) {
      // 含み益がある場合のみ売り（損失時はhold）
      if (price > entryPrice) {
        return { exitIdx: i, exitReason: "macd_dead_cross" };
      }
    }
  }

  return { exitIdx: data.length - 1, exitReason: "end_of_data" };
}

function simulateFixedExit(
  data: PriceData[],
  entryIdx: number,
  tpPct: number,
  slPct: number
): { exitIdx: number; exitReason: string } {
  const entryPrice = data[entryIdx].open > 0 ? data[entryIdx].open : data[entryIdx].close;
  const tpLevel = entryPrice * (1 + tpPct / 100);
  const slLevel = entryPrice * (1 - slPct / 100);

  for (let i = entryIdx + 1; i < data.length; i++) {
    const price = data[i].close;

    if (price >= tpLevel) {
      return { exitIdx: i, exitReason: "take_profit" };
    }
    if (price <= slLevel) {
      return { exitIdx: i, exitReason: "stop_loss" };
    }
  }

  return { exitIdx: data.length - 1, exitReason: "end_of_data" };
}

// ── バックテスト実行 ──

async function runSingleBacktest(
  symbol: string,
  name: string,
  data: PriceData[],
  detection: TurnaroundDetection,
  exitMode: ExitMode,
  trailPct: number,
  slPct: number,
  tpPct: number
): Promise<TradeResult | null> {
  const entryIdx = findEntryIndex(data, detection.turnaroundDate);
  if (entryIdx == null || entryIdx >= data.length - 1) return null;

  const entryPrice = data[entryIdx].open > 0 ? data[entryIdx].open : data[entryIdx].close;

  // イグジット
  let exitResult: { exitIdx: number; exitReason: string };
  switch (exitMode) {
    case "trail":
      exitResult = simulateTrailingStop(data, entryIdx, trailPct, slPct);
      break;
    case "macd":
      exitResult = simulateMacdExit(data, entryIdx, slPct);
      break;
    case "fixed":
      exitResult = simulateFixedExit(data, entryIdx, tpPct, slPct);
      break;
  }

  const exitPrice = data[exitResult.exitIdx].close;
  const returnPct = ((exitPrice - entryPrice) / entryPrice) * 100;

  // 最大ドローダウン
  let peakPrice = entryPrice;
  let maxDrawdown = 0;
  for (let i = entryIdx; i <= exitResult.exitIdx; i++) {
    if (data[i].close > peakPrice) peakPrice = data[i].close;
    const dd = ((peakPrice - data[i].close) / peakPrice) * 100;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  // 保有日数
  const entryDate = new Date(data[entryIdx].date);
  const exitDate = new Date(data[exitResult.exitIdx].date);
  const holdingDays = Math.round(
    (exitDate.getTime() - entryDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  // 期間リターン (営業日250日/年で概算)
  const price1y = getPriceAtOffset(data, entryIdx, 250);
  const price2y = getPriceAtOffset(data, entryIdx, 500);
  const price3y = getPriceAtOffset(data, entryIdx, 750);

  return {
    symbol,
    name,
    turnaroundFiscalYear: detection.turnaroundFiscalYear,
    consecutiveLossYears: detection.consecutiveLossYears,
    entryDate: data[entryIdx].date,
    entryPrice,
    exitDate: data[exitResult.exitIdx].date,
    exitPrice,
    exitReason: exitResult.exitReason,
    returnPct,
    holdingDays,
    maxDrawdownPct: maxDrawdown,
    peakPrice,
    return1y: price1y != null ? ((price1y - entryPrice) / entryPrice) * 100 : null,
    return2y: price2y != null ? ((price2y - entryPrice) / entryPrice) * 100 : null,
    return3y: price3y != null ? ((price3y - entryPrice) / entryPrice) * 100 : null,
  };
}

// ── CLI引数パース ──

function parseCliArgs() {
  const args = getArgs();
  return {
    allStocks: hasFlag(args, "--all"),
    verifyOnly: hasFlag(args, "--verify"),
    outputCsv: hasFlag(args, "--csv"),
    limit: parseIntFlag(args, "--limit", 0),
    exitMode: (parseFlag(args, "--exit") ?? "trail") as ExitMode,
    trailPct: parseIntFlag(args, "--trail-pct", 15),
    slPct: parseIntFlag(args, "--sl-pct", 10),
    tpPct: parseIntFlag(args, "--tp-pct", 50),
    minLoss: parseIntFlag(args, "--min-loss", 1),
  };
}

// ── 表示 ──

function printSummary(trades: TradeResult[]) {
  if (trades.length === 0) {
    console.log("\n  バックテスト対象のトレードがありません。\n");
    return;
  }

  // トレード一覧
  console.log("");
  console.log(
    "銘柄       | 企業名               | 連赤字 | 黒転FY | エントリー    | 価格      | イグジット    | 価格      | 理由            | リターン   | 日数   | DD%"
  );
  console.log(
    "-----------|----------------------|--------|--------|--------------|---------|--------------|---------|----------------|----------|--------|------"
  );

  for (const t of trades) {
    const code = t.symbol.replace(".T", "").padEnd(9);
    const nameStr = (t.name ?? "").padEnd(20).slice(0, 20);
    const lossYrs = String(t.consecutiveLossYears).padStart(5);
    const fy = String(t.turnaroundFiscalYear).padStart(6);
    const entryDate = t.entryDate.padEnd(12);
    const entryPrice = t.entryPrice.toLocaleString().padStart(7);
    const exitDate = t.exitDate.padEnd(12);
    const exitPrice = t.exitPrice.toLocaleString().padStart(7);
    const reason = t.exitReason.padEnd(14);
    const ret = `${t.returnPct >= 0 ? "+" : ""}${t.returnPct.toFixed(1)}%`.padStart(8);
    const days = String(t.holdingDays).padStart(6);
    const dd = t.maxDrawdownPct.toFixed(1).padStart(5);

    console.log(
      `${code}  | ${nameStr} | ${lossYrs}  | ${fy} | ${entryDate}  | ${entryPrice} | ${exitDate}  | ${exitPrice} | ${reason}  | ${ret} | ${days} | ${dd}%`
    );
  }

  // 集計サマリー
  const returns = trades.map((t) => t.returnPct).sort((a, b) => a - b);
  const avg = returns.reduce((a, b) => a + b, 0) / returns.length;
  const median =
    returns.length % 2 === 0
      ? (returns[returns.length / 2 - 1] + returns[returns.length / 2]) / 2
      : returns[Math.floor(returns.length / 2)];
  const winCount = returns.filter((r) => r > 0).length;
  const winRate = (winCount / returns.length) * 100;
  const tenBaggerCount = returns.filter((r) => r >= 900).length;

  console.log("\n" + "=".repeat(70));
  console.log("  バックテスト集計");
  console.log("=".repeat(70));
  console.log(`  トレード数: ${trades.length}`);
  console.log(`  勝率: ${winRate.toFixed(1)}% (${winCount}勝 / ${trades.length - winCount}敗)`);
  console.log(`  平均リターン: ${avg >= 0 ? "+" : ""}${avg.toFixed(1)}%`);
  console.log(`  中央値リターン: ${median >= 0 ? "+" : ""}${median.toFixed(1)}%`);
  console.log(`  最小: ${returns[0].toFixed(1)}% / 最大: ${returns[returns.length - 1].toFixed(1)}%`);
  console.log(`  テンバガー達成 (900%+): ${tenBaggerCount}銘柄 (${((tenBaggerCount / trades.length) * 100).toFixed(1)}%)`);

  // 期間リターン
  const r1y = trades.filter((t) => t.return1y != null);
  const r2y = trades.filter((t) => t.return2y != null);
  const r3y = trades.filter((t) => t.return3y != null);

  if (r1y.length > 0) {
    const avg1y = r1y.reduce((a, b) => a + b.return1y!, 0) / r1y.length;
    console.log(`  1年後平均リターン: ${avg1y >= 0 ? "+" : ""}${avg1y.toFixed(1)}% (${r1y.length}銘柄)`);
  }
  if (r2y.length > 0) {
    const avg2y = r2y.reduce((a, b) => a + b.return2y!, 0) / r2y.length;
    console.log(`  2年後平均リターン: ${avg2y >= 0 ? "+" : ""}${avg2y.toFixed(1)}% (${r2y.length}銘柄)`);
  }
  if (r3y.length > 0) {
    const avg3y = r3y.reduce((a, b) => a + b.return3y!, 0) / r3y.length;
    console.log(`  3年後平均リターン: ${avg3y >= 0 ? "+" : ""}${avg3y.toFixed(1)}% (${r3y.length}銘柄)`);
  }

  // 連続赤字年数別の集計
  const byLossYears = new Map<number, TradeResult[]>();
  for (const t of trades) {
    const arr = byLossYears.get(t.consecutiveLossYears) ?? [];
    arr.push(t);
    byLossYears.set(t.consecutiveLossYears, arr);
  }

  console.log("\n【連続赤字年数別】");
  console.log("  連続赤字 | 銘柄数 | 勝率    | 平均リターン | 中央値リターン");
  console.log("  ---------|--------|---------|-------------|-------------");

  for (const [years, group] of [...byLossYears.entries()].sort((a, b) => a[0] - b[0])) {
    const rets = group.map((t) => t.returnPct).sort((a, b) => a - b);
    const gAvg = rets.reduce((a, b) => a + b, 0) / rets.length;
    const gMedian =
      rets.length % 2 === 0
        ? (rets[rets.length / 2 - 1] + rets[rets.length / 2]) / 2
        : rets[Math.floor(rets.length / 2)];
    const gWinRate = (rets.filter((r) => r > 0).length / rets.length) * 100;

    console.log(
      `  ${String(years).padStart(7)}年 | ${String(group.length).padStart(5)}  | ${gWinRate.toFixed(1).padStart(5)}%  | ${gAvg >= 0 ? "+" : ""}${gAvg.toFixed(1).padStart(10)}% | ${gMedian >= 0 ? "+" : ""}${gMedian.toFixed(1).padStart(11)}%`
    );
  }

  console.log("");
}

function saveCsv(trades: TradeResult[], filename: string) {
  const header = [
    "symbol",
    "name",
    "consecutiveLossYears",
    "turnaroundFiscalYear",
    "entryDate",
    "entryPrice",
    "exitDate",
    "exitPrice",
    "exitReason",
    "returnPct",
    "holdingDays",
    "maxDrawdownPct",
    "peakPrice",
    "return1y",
    "return2y",
    "return3y",
  ].join(",");

  const rows = trades.map((t) =>
    [
      t.symbol,
      `"${t.name}"`,
      t.consecutiveLossYears,
      t.turnaroundFiscalYear,
      t.entryDate,
      t.entryPrice,
      t.exitDate,
      t.exitPrice,
      t.exitReason,
      t.returnPct.toFixed(2),
      t.holdingDays,
      t.maxDrawdownPct.toFixed(2),
      t.peakPrice,
      t.return1y?.toFixed(2) ?? "",
      t.return2y?.toFixed(2) ?? "",
      t.return3y?.toFixed(2) ?? "",
    ].join(",")
  );

  const outPath = join(OUTPUT_DIR, filename);
  writeFileSync(outPath, [header, ...rows].join("\n"), "utf-8");
  console.log(`  CSV saved: ${outPath}`);
}

// ── メイン ──

async function main() {
  const opts = parseCliArgs();
  const stocks = loadStocks(opts);

  console.log("=".repeat(70));
  console.log("  ターンアラウンド戦略バックテスト");
  console.log("=".repeat(70));
  console.log(`  対象: ${stocks.length} 銘柄`);
  console.log(`  イグジット: ${opts.exitMode}`);
  if (opts.exitMode === "trail") {
    console.log(`  トレーリングストップ: ${opts.trailPct}% / 損切り: ${opts.slPct}%`);
  } else if (opts.exitMode === "macd") {
    console.log(`  MACDデッドクロス / 損切り: ${opts.slPct}%`);
  } else {
    console.log(`  利確: +${opts.tpPct}% / 損切り: -${opts.slPct}%`);
  }
  console.log(`  最小連続赤字: ${opts.minLoss}年`);
  console.log("");

  const options: TurnaroundScreenerOptions = {
    ...DEFAULT_OPTIONS,
    minConsecutiveLoss: opts.minLoss,
  };

  const trades: TradeResult[] = [];
  let processed = 0;
  let noData = 0;
  let noTurnaround = 0;

  for (const stock of stocks) {
    processed++;
    process.stdout.write(
      `\r  処理中... ${processed}/${stocks.length} (トレード: ${trades.length})`
    );

    try {
      // 1. ターンアラウンド検出
      const history = await fetchIncomeHistory(stock.symbol);
      const detection = detectTurnaround(history, options);
      if (!detection) {
        noTurnaround++;
        continue;
      }

      // 2. 株価データ取得
      const data = await getPriceData(stock.symbol);
      if (!data) {
        noData++;
        continue;
      }

      // 3. バックテスト
      const result = await runSingleBacktest(
        stock.symbol,
        stock.name,
        data,
        detection,
        opts.exitMode,
        opts.trailPct,
        opts.slPct,
        opts.tpPct
      );

      if (result) {
        trades.push(result);
      }
    } catch {
      // skip
    }
  }

  console.log(
    `\r  完了: ${processed}銘柄, トレード: ${trades.length}, 非検出: ${noTurnaround}, データなし: ${noData}              `
  );

  // リターン降順でソート
  trades.sort((a, b) => b.returnPct - a.returnPct);

  printSummary(trades);

  if (opts.outputCsv) {
    const date = new Date().toISOString().split("T")[0];
    saveCsv(trades, `backtest-turnaround-${date}.csv`);
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});

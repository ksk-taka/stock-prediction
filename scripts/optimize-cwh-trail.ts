#!/usr/bin/env npx tsx
// ============================================================
// CWHトレーリング パラメータ最適化
// trailPct × stopLossPct のグリッドサーチで複合スコア最大化
//
// 使い方:
//   npx tsx scripts/optimize-cwh-trail.ts              # お気に入り22銘柄
//   npx tsx scripts/optimize-cwh-trail.ts --all        # 全上場企業
//   npx tsx scripts/optimize-cwh-trail.ts --segment プライム
// ============================================================

import { readFileSync } from "fs";
import { join } from "path";
import { getArgs, parseFlag, hasFlag } from "@/lib/utils/cli";
import { getHistoricalPrices } from "@/lib/api/yahooFinance";
import { runBacktest } from "@/lib/backtest/engine";
import { detectCupWithHandle } from "@/lib/utils/signals";
import type { PriceData } from "@/types";
import type { Signal, StrategyDef } from "@/lib/backtest/types";

// ── 設定 ──

const TRAIL_RANGE = [5, 8, 10, 12, 15, 18, 20, 25];
const STOP_RANGE = [2, 3, 5, 7, 10, 12, 15];
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
  return { allStocks, favoritesOnly, segment, limit };
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

// ── CWHトレーリング戦略を動的生成 ──

function makeCwhTrailStrategy(trailPct: number, stopLossPct: number, cwhIndices: Set<number>): StrategyDef {
  return {
    id: "cwh_trail_opt",
    name: `CWH Trail(${trailPct}/${stopLossPct})`,
    description: "",
    mode: "all_in_out",
    params: [],
    compute: (data: PriceData[]): Signal[] => {
      let inPosition = false;
      let entryPrice = 0;
      let peakPrice = 0;

      return data.map((d, i): Signal => {
        if (!inPosition) {
          if (cwhIndices.has(i)) {
            inPosition = true;
            entryPrice = d.close;
            peakPrice = d.close;
            return "buy";
          }
        } else {
          if (d.close > peakPrice) peakPrice = d.close;
          const pnl = ((d.close - entryPrice) / entryPrice) * 100;
          if (pnl <= -stopLossPct) {
            inPosition = false;
            return "sell";
          }
          const dropFromPeak = ((peakPrice - d.close) / peakPrice) * 100;
          if (dropFromPeak >= trailPct) {
            inPosition = false;
            return "sell";
          }
        }
        return "hold";
      });
    },
  };
}

// ── 田端式CWH（固定利確）も比較用に生成 ──

function makeCwhFixedStrategy(takeProfitPct: number, stopLossPct: number, cwhIndices: Set<number>): StrategyDef {
  return {
    id: "cwh_fixed",
    name: `CWH Fixed(${takeProfitPct}/${stopLossPct})`,
    description: "",
    mode: "all_in_out",
    params: [],
    compute: (data: PriceData[]): Signal[] => {
      let inPosition = false;
      let entryPrice = 0;
      const tp = takeProfitPct / 100;
      const sl = stopLossPct / 100;

      return data.map((d, i): Signal => {
        if (!inPosition) {
          if (cwhIndices.has(i)) {
            inPosition = true;
            entryPrice = d.close;
            return "buy";
          }
        } else {
          if (d.close >= entryPrice * (1 + tp)) { inPosition = false; return "sell"; }
          if (d.close <= entryPrice * (1 - sl)) { inPosition = false; return "sell"; }
        }
        return "hold";
      });
    },
  };
}

// ── メイン ──

interface GridResult {
  trailPct: number;
  stopLossPct: number;
  stockCount: number;
  totalTrades: number;
  totalWins: number;
  totalLosses: number;
  winRate: number;
  totalReturnPct: number;
  medianReturnPct: number;
  positiveStockPct: number;
  // 複合スコア: winRate(0-100) と totalReturnPct を正規化して合算
  score: number;
}

async function main() {
  const opts = parseCliArgs();
  let stocks = loadStocks(opts);
  if (opts.limit) stocks = stocks.slice(0, opts.limit);

  const label = opts.favoritesOnly ? "お気に入り" : opts.allStocks ? "全上場企業" : opts.segment;
  console.log("=".repeat(60));
  console.log("CWHトレーリング パラメータ最適化");
  console.log(`  対象: ${label} (${stocks.length}銘柄)`);
  console.log(`  trailPct: ${TRAIL_RANGE.join(", ")}`);
  console.log(`  stopLossPct: ${STOP_RANGE.join(", ")}`);
  console.log(`  組み合わせ: ${TRAIL_RANGE.length * STOP_RANGE.length}通り`);
  console.log("=".repeat(60));

  // ── Phase 1: 全銘柄のデータ取得 + CWHシグナル検出（1回だけ） ──
  console.log("\n[Phase 1] データ取得 + CWHシグナル検出...");
  const startTime = Date.now();

  interface StockData {
    symbol: string;
    name: string;
    data: PriceData[];
    cwhIndices: Set<number>;
  }

  const stockDataList: StockData[] = [];
  const BATCH_SIZE = 50;
  let fetched = 0;

  for (let i = 0; i < stocks.length; i += BATCH_SIZE) {
    const batch = stocks.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (stock) => {
        const data = await getHistoricalPrices(stock.symbol, "daily");
        if (data.length < 30) return null;
        const cwhSignals = detectCupWithHandle(data);
        if (cwhSignals.length === 0) return null;
        return {
          symbol: stock.symbol,
          name: stock.name,
          data,
          cwhIndices: new Set(cwhSignals.map((s) => s.index)),
        } satisfies StockData;
      }),
    );

    for (const r of results) {
      fetched++;
      if (r.status === "fulfilled" && r.value) {
        stockDataList.push(r.value);
      }
    }
    process.stdout.write(`\r  [${fetched}/${stocks.length}] ${stockDataList.length}銘柄にCWHシグナルあり`);
  }

  const fetchTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n  完了 (${fetchTime}秒) - ${stockDataList.length}銘柄で最適化実行\n`);

  // ── Phase 2: グリッドサーチ（純CPU計算） ──
  console.log("[Phase 2] グリッドサーチ...");
  const gridStart = Date.now();

  function median(arr: number[]): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  }

  const gridResults: GridResult[] = [];

  for (const trail of TRAIL_RANGE) {
    for (const stop of STOP_RANGE) {
      let totalTrades = 0;
      let totalWins = 0;
      let totalLosses = 0;
      let totalReturn = 0;
      const returns: number[] = [];
      let stockCount = 0;

      for (const sd of stockDataList) {
        const strat = makeCwhTrailStrategy(trail, stop, sd.cwhIndices);
        const result = runBacktest(sd.data, strat, {}, INITIAL_CAPITAL);
        const s = result.stats;
        if (s.numTrades > 0) {
          stockCount++;
          totalTrades += s.numTrades;
          totalWins += s.numWins;
          totalLosses += s.numLosses;
          totalReturn += s.totalReturnPct;
          returns.push(s.totalReturnPct);
        }
      }

      const winRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0;
      const medianRet = median(returns);
      const positiveStocks = returns.filter((r) => r > 0).length;
      const positiveStockPct = returns.length > 0 ? (positiveStocks / returns.length) * 100 : 0;

      gridResults.push({
        trailPct: trail,
        stopLossPct: stop,
        stockCount,
        totalTrades,
        totalWins,
        totalLosses,
        winRate,
        totalReturnPct: totalReturn,
        medianReturnPct: medianRet,
        positiveStockPct,
        score: 0, // 後で正規化して計算
      });
    }
  }

  const gridTime = ((Date.now() - gridStart) / 1000).toFixed(1);
  console.log(`  完了 (${gridTime}秒)\n`);

  // ── 複合スコア計算 ──
  // 正規化: 各指標を0-1に正規化し、重み付き合算
  // Score = 0.3 * norm(winRate) + 0.3 * norm(totalReturn) + 0.2 * norm(medianReturn) + 0.2 * norm(positiveStockPct)
  const maxWR = Math.max(...gridResults.map((r) => r.winRate));
  const minWR = Math.min(...gridResults.map((r) => r.winRate));
  const maxTR = Math.max(...gridResults.map((r) => r.totalReturnPct));
  const minTR = Math.min(...gridResults.map((r) => r.totalReturnPct));
  const maxMR = Math.max(...gridResults.map((r) => r.medianReturnPct));
  const minMR = Math.min(...gridResults.map((r) => r.medianReturnPct));
  const maxPS = Math.max(...gridResults.map((r) => r.positiveStockPct));
  const minPS = Math.min(...gridResults.map((r) => r.positiveStockPct));

  function norm(v: number, min: number, max: number): number {
    return max === min ? 0.5 : (v - min) / (max - min);
  }

  for (const r of gridResults) {
    r.score =
      0.3 * norm(r.winRate, minWR, maxWR) +
      0.3 * norm(r.totalReturnPct, minTR, maxTR) +
      0.2 * norm(r.medianReturnPct, minMR, maxMR) +
      0.2 * norm(r.positiveStockPct, minPS, maxPS);
  }

  // ── 現行CWH（固定利確5%/損切15%）のベースライン ──
  let baseWins = 0, baseLosses = 0, baseReturn = 0;
  const baseReturns: number[] = [];
  let baseStockCount = 0;
  for (const sd of stockDataList) {
    const strat = makeCwhFixedStrategy(5, 15, sd.cwhIndices);
    const result = runBacktest(sd.data, strat, {}, INITIAL_CAPITAL);
    const s = result.stats;
    if (s.numTrades > 0) {
      baseStockCount++;
      baseWins += s.numWins;
      baseLosses += s.numLosses;
      baseReturn += s.totalReturnPct;
      baseReturns.push(s.totalReturnPct);
    }
  }
  const baseWR = (baseWins + baseLosses) > 0 ? (baseWins / (baseWins + baseLosses)) * 100 : 0;
  const baseMedRet = median(baseReturns);
  const basePosPct = baseReturns.length > 0 ? (baseReturns.filter((r) => r > 0).length / baseReturns.length) * 100 : 0;

  // ── 結果表示 ──

  // スコア上位20を表示
  gridResults.sort((a, b) => b.score - a.score);

  function fmtPct(v: number): string { return (v >= 0 ? "+" : "") + v.toFixed(1); }

  console.log("=".repeat(110));
  console.log("スコア上位20 (Score = 0.3×勝率 + 0.3×合計Ret + 0.2×中央Ret + 0.2×勝銘柄%)");
  console.log("=".repeat(110));
  console.log(
    "Rank".padEnd(6) +
    "Trail%".padEnd(8) +
    "Stop%".padEnd(8) +
    "銘柄".padEnd(6) +
    "取引".padEnd(7) +
    "勝".padEnd(6) +
    "負".padEnd(6) +
    "勝率%".padEnd(8) +
    "合計Ret%".padEnd(12) +
    "中央Ret%".padEnd(10) +
    "勝銘柄%".padEnd(9) +
    "Score".padEnd(8),
  );
  console.log("-".repeat(110));

  for (let i = 0; i < Math.min(20, gridResults.length); i++) {
    const r = gridResults[i];
    console.log(
      `#${i + 1}`.padEnd(6) +
      r.trailPct.toString().padEnd(8) +
      r.stopLossPct.toString().padEnd(8) +
      r.stockCount.toString().padEnd(6) +
      r.totalTrades.toString().padEnd(7) +
      r.totalWins.toString().padEnd(6) +
      r.totalLosses.toString().padEnd(6) +
      r.winRate.toFixed(1).padEnd(8) +
      fmtPct(r.totalReturnPct).padEnd(12) +
      fmtPct(r.medianReturnPct).padEnd(10) +
      r.positiveStockPct.toFixed(0).padEnd(9) +
      r.score.toFixed(3).padEnd(8),
    );
  }

  // ── ベースライン比較 ──
  console.log("\n" + "=".repeat(110));
  console.log("ベースライン比較");
  console.log("=".repeat(110));
  console.log(`  現行CWH (固定利確5%/損切15%): 勝率${baseWR.toFixed(1)}% | 合計Ret${fmtPct(baseReturn)}% | 中央Ret${fmtPct(baseMedRet)}% | 勝銘柄${basePosPct.toFixed(0)}%`);
  const best = gridResults[0];
  console.log(`  最適CWH Trail(${best.trailPct}/${best.stopLossPct}):     勝率${best.winRate.toFixed(1)}% | 合計Ret${fmtPct(best.totalReturnPct)}% | 中央Ret${fmtPct(best.medianReturnPct)}% | 勝銘柄${best.positiveStockPct.toFixed(0)}%`);
  console.log(`  スコア改善: ${((best.score / 0.5 - 1) * 100).toFixed(1)}% (0.5がランダム基準)`);

  // ── ヒートマップ: トレーリング% × 損切% → スコア ──
  console.log("\n" + "=".repeat(80));
  console.log("ヒートマップ: Score (行=trailPct, 列=stopLossPct)");
  console.log("=".repeat(80));

  const scoreMap = new Map<string, number>();
  for (const r of gridResults) {
    scoreMap.set(`${r.trailPct}-${r.stopLossPct}`, r.score);
  }

  // ヘッダー
  process.stdout.write("Trail\\Stop".padEnd(12));
  for (const stop of STOP_RANGE) {
    process.stdout.write(`${stop}%`.padStart(8));
  }
  console.log("");
  console.log("-".repeat(12 + STOP_RANGE.length * 8));

  for (const trail of TRAIL_RANGE) {
    process.stdout.write(`${trail}%`.padEnd(12));
    for (const stop of STOP_RANGE) {
      const score = scoreMap.get(`${trail}-${stop}`) ?? 0;
      process.stdout.write(score.toFixed(3).padStart(8));
    }
    console.log("");
  }

  // ── ヒートマップ: 合計リターン ──
  console.log("\n" + "=".repeat(80));
  console.log("ヒートマップ: 合計リターン% (行=trailPct, 列=stopLossPct)");
  console.log("=".repeat(80));

  const retMap = new Map<string, number>();
  for (const r of gridResults) {
    retMap.set(`${r.trailPct}-${r.stopLossPct}`, r.totalReturnPct);
  }

  process.stdout.write("Trail\\Stop".padEnd(12));
  for (const stop of STOP_RANGE) {
    process.stdout.write(`${stop}%`.padStart(10));
  }
  console.log("");
  console.log("-".repeat(12 + STOP_RANGE.length * 10));

  for (const trail of TRAIL_RANGE) {
    process.stdout.write(`${trail}%`.padEnd(12));
    for (const stop of STOP_RANGE) {
      const ret = retMap.get(`${trail}-${stop}`) ?? 0;
      process.stdout.write(fmtPct(ret).padStart(10));
    }
    console.log("");
  }

  // ── ヒートマップ: 勝率 ──
  console.log("\n" + "=".repeat(80));
  console.log("ヒートマップ: 勝率% (行=trailPct, 列=stopLossPct)");
  console.log("=".repeat(80));

  const wrMap = new Map<string, number>();
  for (const r of gridResults) {
    wrMap.set(`${r.trailPct}-${r.stopLossPct}`, r.winRate);
  }

  process.stdout.write("Trail\\Stop".padEnd(12));
  for (const stop of STOP_RANGE) {
    process.stdout.write(`${stop}%`.padStart(8));
  }
  console.log("");
  console.log("-".repeat(12 + STOP_RANGE.length * 8));

  for (const trail of TRAIL_RANGE) {
    process.stdout.write(`${trail}%`.padEnd(12));
    for (const stop of STOP_RANGE) {
      const wr = wrMap.get(`${trail}-${stop}`) ?? 0;
      process.stdout.write(wr.toFixed(1).padStart(8));
    }
    console.log("");
  }

  // ── 完了 ──
  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("\n" + "=".repeat(60));
  console.log(`完了 (${totalElapsed}秒)`);
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

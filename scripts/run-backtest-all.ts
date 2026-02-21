#!/usr/bin/env npx tsx
// ============================================================
// 全銘柄バックテスト - watchlist全銘柄×全戦略×日足/週足
// 使い方:
//   npx tsx scripts/run-backtest-all.ts                   # プライム全銘柄
//   npx tsx scripts/run-backtest-all.ts --segment スタンダード
//   npx tsx scripts/run-backtest-all.ts --daily-only
//   npx tsx scripts/run-backtest-all.ts --strategies classic
// ============================================================

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getArgs, parseFlag, hasFlag } from "@/lib/utils/cli";
import { getHistoricalPrices } from "@/lib/api/yahooFinance";
import { strategies, getStrategyParams } from "@/lib/backtest/strategies";
import { runBacktest } from "@/lib/backtest/engine";
import type { PriceData } from "@/types";
import type { PeriodType } from "@/lib/backtest/presets";

// ── CLI引数パース ──

function parseCliArgs() {
  const args = getArgs();

  const segment = parseFlag(args, "--segment") ?? "プライム";
  const dailyOnly = hasFlag(args, "--daily-only");
  const weeklyOnly = hasFlag(args, "--weekly-only");
  const stratSet = parseFlag(args, "--strategies") ?? "all"; // classic | dip | all
  const limitStr = parseFlag(args, "--limit");
  const limit = limitStr ? parseInt(limitStr, 10) : undefined;
  const favoritesOnly = hasFlag(args, "--favorites");
  const allStocks = hasFlag(args, "--all");

  const periods: PeriodType[] = dailyOnly
    ? ["daily"]
    : weeklyOnly
      ? ["weekly"]
      : ["daily", "weekly"];

  const classicIds = new Set([
    "ma_cross", "rsi_reversal", "macd_signal", "macd_trail",
    "choruko_bb", "choruko_shitabanare", "tabata_cwh", "cwh_trail",
  ]);
  const dipIds = new Set([
    "dip_buy", "dip_kairi", "dip_rsi_volume", "dip_bb3sigma",
  ]);

  // DCA除外 (比較に不適)
  const activeStrategies = strategies.filter((s) => {
    if (s.id === "dca") return false;
    if (stratSet === "classic") return classicIds.has(s.id);
    if (stratSet === "dip") return dipIds.has(s.id);
    return true; // all
  });

  return { segment, periods, activeStrategies, stratSet, limit, favoritesOnly, allStocks };
}

// ── 銘柄読み込み ──

interface WatchlistStock {
  symbol: string;
  name: string;
  market: string;
  marketSegment?: string;
  favorite?: boolean;
}

// Yahoo Financeの株価データが壊れている銘柄（株式調整エラー等）
const EXCLUDE_SYMBOLS = new Set(["7817.T"]); // パラマウントベッドHD

function loadStocks(segment: string, favoritesOnly: boolean, allStocks: boolean): WatchlistStock[] {
  const raw = readFileSync(join(process.cwd(), "data", "watchlist.json"), "utf-8");
  const watchlist = JSON.parse(raw) as { stocks: WatchlistStock[] };
  return watchlist.stocks.filter((s) => {
    if (EXCLUDE_SYMBOLS.has(s.symbol)) return false;
    if (s.market !== "JP") return false;
    if (favoritesOnly) return s.favorite === true;
    if (allStocks) return true;
    return s.marketSegment === segment;
  });
}

// ── CSV行 ──

interface ResultRow {
  symbol: string;
  name: string;
  period: string;
  strategy: string;
  strategyId: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalReturnPct: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  sharpeRatio: number;
  maxDrawdownPct: number;
}

const CSV_HEADER = [
  "symbol", "name", "period", "strategy", "strategyId",
  "trades", "wins", "losses", "winRate", "totalReturnPct",
  "avgWin", "avgLoss", "profitFactor", "sharpeRatio", "maxDrawdownPct",
].join(",");

function rowToCsv(r: ResultRow): string {
  return [
    r.symbol,
    `"${r.name}"`,
    r.period,
    `"${r.strategy}"`,
    r.strategyId,
    r.trades,
    r.wins,
    r.losses,
    r.winRate.toFixed(1),
    r.totalReturnPct.toFixed(2),
    r.avgWin.toFixed(2),
    r.avgLoss.toFixed(2),
    r.profitFactor === Infinity ? "Inf" : r.profitFactor.toFixed(2),
    r.sharpeRatio.toFixed(2),
    r.maxDrawdownPct.toFixed(2),
  ].join(",");
}

// ── 1銘柄処理 ──

async function processStock(
  stock: WatchlistStock,
  periods: PeriodType[],
  activeStrategies: typeof strategies,
): Promise<{ rows: ResultRow[]; errors: number }> {
  const rows: ResultRow[] = [];
  let errors = 0;

  // 期間ごとにデータ取得 (yfQueue経由で自動的に10並列制限)
  for (const period of periods) {
    let data: PriceData[];
    try {
      data = await getHistoricalPrices(stock.symbol, period);
    } catch {
      errors++;
      continue;
    }

    if (data.length < 30) continue;

    // 全戦略を適用 (CPU計算のみ)
    for (const strat of activeStrategies) {
      const params = getStrategyParams(strat.id, "optimized", period);
      const result = runBacktest(data, strat, params, 1_000_000);
      const s = result.stats;

      rows.push({
        symbol: stock.symbol,
        name: stock.name,
        period,
        strategy: strat.name,
        strategyId: strat.id,
        trades: s.numTrades,
        wins: s.numWins,
        losses: s.numLosses,
        winRate: s.winRate,
        totalReturnPct: s.totalReturnPct,
        avgWin: s.avgWin,
        avgLoss: s.avgLoss,
        profitFactor: s.profitFactor,
        sharpeRatio: s.sharpeRatio,
        maxDrawdownPct: s.maxDrawdownPct,
      });
    }
  }

  return { rows, errors };
}

// ── メイン ──

async function main() {
  const { segment, periods, activeStrategies, stratSet, limit, favoritesOnly, allStocks } = parseCliArgs();
  let stocks = loadStocks(segment, favoritesOnly, allStocks);
  if (limit) stocks = stocks.slice(0, limit);

  const label = favoritesOnly ? "お気に入り" : allStocks ? "全上場企業" : segment;
  console.log("=".repeat(60));
  console.log(`全銘柄バックテスト`);
  console.log(`  対象: ${label} (${stocks.length}銘柄)`);
  console.log(`  期間: ${periods.join(", ")}`);
  console.log(`  戦略: ${stratSet} (${activeStrategies.length}戦略)`);
  console.log(`    ${activeStrategies.map((s) => s.name).join(", ")}`);
  console.log("=".repeat(60));

  const startTime = Date.now();
  const allRows: ResultRow[] = [];
  let totalErrors = 0;
  let completed = 0;

  // 10並列でバッチ処理
  // yfQueueが10並列を制御するので、Promise群を一気にキューに投入する
  // ただしメモリ圧迫を防ぐため50銘柄ずつバッチ処理
  const BATCH_SIZE = 50;

  for (let i = 0; i < stocks.length; i += BATCH_SIZE) {
    const batch = stocks.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map((stock) => processStock(stock, periods, activeStrategies)),
    );

    for (const result of results) {
      completed++;
      if (result.status === "fulfilled") {
        allRows.push(...result.value.rows);
        totalErrors += result.value.errors;
      } else {
        totalErrors++;
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const pct = ((completed / stocks.length) * 100).toFixed(1);
    process.stdout.write(
      `\r[${completed}/${stocks.length}] ${pct}% 完了 (${elapsed}秒経過, ${allRows.length}行, エラー${totalErrors}件)`,
    );
  }

  console.log(""); // 改行

  // ── CSV出力 ──
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const csvPath = join(process.cwd(), "data", `backtest-results-${timestamp}.csv`);
  const csvContent = [CSV_HEADER, ...allRows.map(rowToCsv)].join("\n");
  writeFileSync(csvPath, csvContent, "utf-8");
  console.log(`\nCSV出力: ${csvPath} (${allRows.length}行)`);

  // ── サマリー ──

  // 日本語の表示幅を考慮したpad関数
  function displayWidth(str: string): number {
    let w = 0;
    for (const ch of str) {
      w += ch.charCodeAt(0) > 0x7f ? 2 : 1;
    }
    return w;
  }
  function padEndW(str: string, width: number): string {
    return str + " ".repeat(Math.max(0, width - displayWidth(str)));
  }

  const COL_NAME = 22;
  const C = 10; // column width

  function median(arr: number[]): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  }
  function sum(arr: number[]): number { return arr.reduce((a, b) => a + b, 0); }
  function fmtPct(v: number): string { return (v >= 0 ? "+" : "") + v.toFixed(1); }
  function fmtBig(v: number): string {
    if (Math.abs(v) >= 1_000_000) return fmtPct(v / 10000) + "万";
    if (Math.abs(v) >= 10000) return fmtPct(Math.round(v));
    return fmtPct(v);
  }

  const W = COL_NAME + C * 10;
  console.log("\n" + "=".repeat(W));
  console.log("戦略別サマリー (trades>0 の銘柄のみ集計)");
  console.log("=".repeat(W));

  for (const period of periods) {
    console.log(`\n【${period === "daily" ? "日足" : "週足"}】`);
    console.log(
      padEndW("戦略", COL_NAME) +
      "銘柄数".padStart(C) +
      "合計勝".padStart(C) +
      "合計負".padStart(C) +
      "勝率%".padStart(C) +
      "合計Ret%".padStart(C) +
      "中央Ret%".padStart(C) +
      "中央PF".padStart(C) +
      "中央SR".padStart(C) +
      "中央DD%".padStart(C) +
      "勝銘柄%".padStart(C),
    );
    console.log("-".repeat(W));

    for (const strat of activeStrategies) {
      const rows = allRows.filter(
        (r) => r.strategyId === strat.id && r.period === period && r.trades > 0,
      );
      if (rows.length === 0) {
        console.log(`${padEndW(strat.name, COL_NAME)}${"0".padStart(C)}`);
        continue;
      }

      const totalWins = sum(rows.map((r) => r.wins));
      const totalLosses = sum(rows.map((r) => r.losses));
      const totalTrades = totalWins + totalLosses;
      const winRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0;
      const totalRet = sum(rows.map((r) => r.totalReturnPct));
      const medRet = median(rows.map((r) => r.totalReturnPct));
      const finitePF = rows.map((r) => r.profitFactor === Infinity ? 999 : r.profitFactor);
      const medPF = median(finitePF);
      const medSR = median(rows.map((r) => r.sharpeRatio));
      const medDD = median(rows.map((r) => r.maxDrawdownPct));
      const positiveStocks = rows.filter((r) => r.totalReturnPct > 0).length;
      const positivePct = (positiveStocks / rows.length) * 100;

      console.log(
        padEndW(strat.name, COL_NAME) +
        rows.length.toString().padStart(C) +
        totalWins.toString().padStart(C) +
        totalLosses.toString().padStart(C) +
        winRate.toFixed(1).padStart(C) +
        fmtBig(totalRet).padStart(C) +
        fmtPct(medRet).padStart(C) +
        medPF.toFixed(2).padStart(C) +
        medSR.toFixed(2).padStart(C) +
        medDD.toFixed(1).padStart(C) +
        positivePct.toFixed(0).padStart(C),
      );
    }
  }

  // ── 完了 ──
  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("\n" + "=".repeat(60));
  console.log(`完了 (${totalElapsed}秒)`);
  console.log(`  処理銘柄: ${stocks.length}`);
  console.log(`  結果行数: ${allRows.length}`);
  console.log(`  エラー: ${totalErrors}`);
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

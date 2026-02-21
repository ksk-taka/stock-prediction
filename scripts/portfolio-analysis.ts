#!/usr/bin/env npx tsx
// ============================================================
// ポートフォリオ合算分析
//
// 複数戦略を同時運用した場合の合算エクイティカーブ、
// 最大DD、戦略間DD相関を分析する。
//
// 使い方:
//   npx tsx scripts/portfolio-analysis.ts
//   npx tsx scripts/portfolio-analysis.ts --strategies macd_trail,rsi_reversal,dip_buy
//   npx tsx scripts/portfolio-analysis.ts --all
//   npx tsx scripts/portfolio-analysis.ts --period 2020-01-01,2025-12-31
// ============================================================

import { readFileSync } from "fs";
import { join } from "path";
import { getArgs, parseFlag, hasFlag } from "@/lib/utils/cli";
import { strategies } from "@/lib/backtest/strategies";
import { runBacktest } from "@/lib/backtest/engine";
import { optimizedPresets } from "@/lib/backtest/presets";
import type { PriceData } from "@/types";
import { loadCached10yr } from "./fetch-10yr-data";

const INITIAL_CAPITAL = 1_000_000;
const EXCLUDE_SYMBOLS = new Set(["7817.T"]);

// デフォルト分析対象
const DEFAULT_STRATEGIES = ["macd_trail", "rsi_reversal", "dip_buy"];

// ============================================================
// CLI引数
// ============================================================

function parseCliArgs() {
  const args = getArgs();

  const allStocks = hasFlag(args, "--all");
  const favoritesOnly = !allStocks;
  const strategyFilter = parseFlag(args, "--strategies")?.split(",") ?? DEFAULT_STRATEGIES;
  const periodStr = parseFlag(args, "--period");
  const periodStart = periodStr?.split(",")[0] ?? "2016-01-01";
  const periodEnd = periodStr?.split(",")[1] ?? "2025-12-31";

  const activeStrategies = strategies.filter((s) => strategyFilter.includes(s.id));

  return { allStocks, favoritesOnly, activeStrategies, strategyFilter, periodStart, periodEnd };
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

function loadAllStockData(stocks: WatchlistStock[], start: string, end: string): StockData[] {
  const result: StockData[] = [];
  for (const stock of stocks) {
    const data = loadCached10yr(stock.symbol);
    if (data && data.length >= 30) {
      const filtered = data.filter((d) => d.date >= start && d.date <= end);
      if (filtered.length >= 30) {
        result.push({ symbol: stock.symbol, name: stock.name, data: filtered });
      }
    }
  }
  return result;
}

// ============================================================
// 戦略別 日次エクイティ収集
// ============================================================

interface DailyEquity {
  /** 日付 → equity値 のMap */
  byDate: Map<string, number>;
  /** 日付 → drawdown% のMap */
  ddByDate: Map<string, number>;
  /** ソートされた日付リスト */
  dates: string[];
  /** 戦略名 */
  strategyName: string;
  strategyId: string;
  /** 統計 */
  totalReturnPct: number;
  maxDrawdownPct: number;
  numTrades: number;
  winRate: number;
  sharpeRatio: number;
}

function buildStrategyEquity(
  stratId: string,
  stratName: string,
  allData: StockData[],
): DailyEquity {
  const strat = strategies.find((s) => s.id === stratId)!;
  const preset = optimizedPresets[stratId]?.daily;
  const params = preset?.params ?? {};

  // 各銘柄のequity曲線を日付でマージ（合算）
  // 各銘柄にINITIAL_CAPITALを割り当て、合算は全銘柄の平均リターン率ベースで計算
  const returnsByDate = new Map<string, number[]>();  // date → 各銘柄のリターン率

  let totalTrades = 0;
  let totalWins = 0;
  let totalRoundTrips = 0;
  const sharpes: number[] = [];

  for (const sd of allData) {
    const result = runBacktest(sd.data, strat, params, INITIAL_CAPITAL);
    totalTrades += result.stats.numTrades;
    totalWins += result.stats.numWins;
    totalRoundTrips += result.stats.numTrades;
    if (result.stats.sharpeRatio !== 0) sharpes.push(result.stats.sharpeRatio);

    // 日次リターン率を記録
    for (const ep of result.equity) {
      const ret = (ep.equity - INITIAL_CAPITAL) / INITIAL_CAPITAL;
      const arr = returnsByDate.get(ep.date) ?? [];
      arr.push(ret);
      returnsByDate.set(ep.date, arr);
    }
  }

  // 日次の平均リターン率 → equity曲線に変換
  const dates = Array.from(returnsByDate.keys()).sort();
  const byDate = new Map<string, number>();
  const ddByDate = new Map<string, number>();
  let peakEquity = INITIAL_CAPITAL;

  for (const date of dates) {
    const returns = returnsByDate.get(date)!;
    const avgReturn = returns.reduce((s, r) => s + r, 0) / returns.length;
    const equity = INITIAL_CAPITAL * (1 + avgReturn);
    byDate.set(date, equity);

    if (equity > peakEquity) peakEquity = equity;
    const dd = peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0;
    ddByDate.set(date, dd);
  }

  const finalEquity = byDate.get(dates[dates.length - 1]) ?? INITIAL_CAPITAL;
  const totalReturnPct = ((finalEquity - INITIAL_CAPITAL) / INITIAL_CAPITAL) * 100;
  const maxDd = dates.reduce((max, d) => Math.max(max, ddByDate.get(d) ?? 0), 0);
  const winRate = totalRoundTrips > 0 ? (totalWins / totalRoundTrips) * 100 : 0;
  const avgSharpe = sharpes.length > 0 ? sharpes.reduce((s, v) => s + v, 0) / sharpes.length : 0;

  return {
    byDate,
    ddByDate,
    dates,
    strategyName: stratName,
    strategyId: stratId,
    totalReturnPct,
    maxDrawdownPct: maxDd,
    numTrades: totalTrades,
    winRate,
    sharpeRatio: avgSharpe,
  };
}

// ============================================================
// 合算ポートフォリオ
// ============================================================

interface PortfolioResult {
  dates: string[];
  /** 合算equity (均等配分) */
  equity: number[];
  /** 合算drawdown% */
  drawdownPct: number[];
  /** 合算統計 */
  totalReturnPct: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  /** 最大DD期間 */
  maxDdStart: string;
  maxDdBottom: string;
  maxDdRecovery: string;
  /** 年別リターン */
  annualReturns: Map<string, number>;
}

function buildPortfolio(stratEquities: DailyEquity[]): PortfolioResult {
  // 全戦略に共通の日付を使用
  const allDatesSet = new Set<string>();
  for (const se of stratEquities) {
    for (const d of se.dates) allDatesSet.add(d);
  }
  const dates = Array.from(allDatesSet).sort();

  const numStrats = stratEquities.length;
  const perStratCapital = INITIAL_CAPITAL / numStrats;
  const totalCapital = INITIAL_CAPITAL;

  const equity: number[] = [];
  const drawdownPct: number[] = [];
  let peakEquity = totalCapital;
  let maxDd = 0;
  let maxDdPeakIdx = 0;
  let maxDdBottomIdx = 0;

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    let totalEquity = 0;

    for (const se of stratEquities) {
      const stratEq = se.byDate.get(date);
      if (stratEq != null) {
        // 各戦略のリターン率を均等配分に適用
        const retRate = (stratEq - INITIAL_CAPITAL) / INITIAL_CAPITAL;
        totalEquity += perStratCapital * (1 + retRate);
      } else {
        // データがない日は前日の値をキープ（or元本）
        totalEquity += perStratCapital;
      }
    }

    equity.push(totalEquity);
    if (totalEquity > peakEquity) peakEquity = totalEquity;
    const dd = peakEquity > 0 ? ((peakEquity - totalEquity) / peakEquity) * 100 : 0;
    drawdownPct.push(dd);

    if (dd > maxDd) {
      maxDd = dd;
      maxDdBottomIdx = i;
      // ピークを遡って見つける
      for (let j = i; j >= 0; j--) {
        if (drawdownPct[j] === 0) { maxDdPeakIdx = j; break; }
      }
    }
  }

  // 最大DD回復日
  let recoveryIdx = dates.length - 1;
  for (let i = maxDdBottomIdx; i < dates.length; i++) {
    if (drawdownPct[i] === 0) { recoveryIdx = i; break; }
  }

  // 年別リターン
  const annualReturns = new Map<string, number>();
  const yearStart = new Map<string, number>();
  for (let i = 0; i < dates.length; i++) {
    const year = dates[i].substring(0, 4);
    if (!yearStart.has(year)) yearStart.set(year, equity[i]);
    annualReturns.set(year, ((equity[i] - yearStart.get(year)!) / yearStart.get(year)!) * 100);
  }

  // シャープレシオ
  const dailyReturns: number[] = [];
  for (let i = 1; i < equity.length; i++) {
    if (equity[i - 1] > 0) {
      dailyReturns.push((equity[i] - equity[i - 1]) / equity[i - 1]);
    }
  }
  let sharpeRatio = 0;
  if (dailyReturns.length > 1) {
    const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
    const variance = dailyReturns.reduce((a, r) => a + (r - mean) ** 2, 0) / (dailyReturns.length - 1);
    const stdDev = Math.sqrt(variance);
    if (stdDev > 0) sharpeRatio = (mean / stdDev) * Math.sqrt(250);
  }

  return {
    dates,
    equity,
    drawdownPct,
    totalReturnPct: ((equity[equity.length - 1] - totalCapital) / totalCapital) * 100,
    maxDrawdownPct: maxDd,
    sharpeRatio,
    maxDdStart: dates[maxDdPeakIdx] ?? "",
    maxDdBottom: dates[maxDdBottomIdx] ?? "",
    maxDdRecovery: recoveryIdx < dates.length ? dates[recoveryIdx] : "未回復",
    annualReturns,
  };
}

// ============================================================
// 戦略間DD相関
// ============================================================

interface CorrelationResult {
  strat1: string;
  strat2: string;
  /** ピアソン相関係数 (-1 to +1) */
  correlation: number;
  /** 同時DD日数 (両方がDD>5%の日数) */
  simultaneousDdDays: number;
  /** 同時DD日数 / 全日数 */
  simultaneousDdPct: number;
}

function calcCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 2) return 0;

  const meanX = x.reduce((s, v) => s + v, 0) / n;
  const meanY = y.reduce((s, v) => s + v, 0) / n;

  let sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    sumXY += dx * dy;
    sumX2 += dx * dx;
    sumY2 += dy * dy;
  }

  const denom = Math.sqrt(sumX2 * sumY2);
  return denom > 0 ? sumXY / denom : 0;
}

function analyzeCorrelations(
  stratEquities: DailyEquity[],
  commonDates: string[],
): CorrelationResult[] {
  const results: CorrelationResult[] = [];

  for (let i = 0; i < stratEquities.length; i++) {
    for (let j = i + 1; j < stratEquities.length; j++) {
      const se1 = stratEquities[i];
      const se2 = stratEquities[j];

      // 共通日付のDD%を収集
      const dd1: number[] = [];
      const dd2: number[] = [];
      let simDdDays = 0;

      for (const date of commonDates) {
        const d1 = se1.ddByDate.get(date) ?? 0;
        const d2 = se2.ddByDate.get(date) ?? 0;
        dd1.push(d1);
        dd2.push(d2);
        if (d1 > 5 && d2 > 5) simDdDays++;
      }

      const corr = calcCorrelation(dd1, dd2);

      results.push({
        strat1: se1.strategyName,
        strat2: se2.strategyName,
        correlation: Math.round(corr * 1000) / 1000,
        simultaneousDdDays: simDdDays,
        simultaneousDdPct: commonDates.length > 0
          ? Math.round((simDdDays / commonDates.length) * 10000) / 100
          : 0,
      });
    }
  }

  return results;
}

// ============================================================
// DD期間分析
// ============================================================

interface DdPeriod {
  strategy: string;
  start: string;
  bottom: string;
  end: string;
  depth: number;
  durationDays: number;
}

function findDdPeriods(se: DailyEquity, threshold: number = 5): DdPeriod[] {
  const periods: DdPeriod[] = [];
  let inDd = false;
  let ddStart = "";
  let ddBottom = "";
  let maxDepth = 0;

  for (const date of se.dates) {
    const dd = se.ddByDate.get(date) ?? 0;

    if (!inDd && dd >= threshold) {
      inDd = true;
      ddStart = date;
      ddBottom = date;
      maxDepth = dd;
    } else if (inDd) {
      if (dd > maxDepth) {
        maxDepth = dd;
        ddBottom = date;
      }
      if (dd < threshold * 0.3) {
        // DD終了（閾値の30%以下に回復）
        const startMs = new Date(ddStart).getTime();
        const endMs = new Date(date).getTime();
        const days = Math.round((endMs - startMs) / (1000 * 60 * 60 * 24));
        periods.push({
          strategy: se.strategyName,
          start: ddStart,
          bottom: ddBottom,
          end: date,
          depth: Math.round(maxDepth * 100) / 100,
          durationDays: days,
        });
        inDd = false;
        maxDepth = 0;
      }
    }
  }

  // 期末にまだDD中なら追加
  if (inDd) {
    const lastDate = se.dates[se.dates.length - 1];
    const startMs = new Date(ddStart).getTime();
    const endMs = new Date(lastDate).getTime();
    const days = Math.round((endMs - startMs) / (1000 * 60 * 60 * 24));
    periods.push({
      strategy: se.strategyName,
      start: ddStart,
      bottom: ddBottom,
      end: lastDate + " (未回復)",
      depth: Math.round(maxDepth * 100) / 100,
      durationDays: days,
    });
  }

  return periods;
}

// ============================================================
// 日次リターン相関（DDだけでなくリターンの相関も）
// ============================================================

function analyzeDailyReturnCorrelations(
  stratEquities: DailyEquity[],
  commonDates: string[],
): CorrelationResult[] {
  const results: CorrelationResult[] = [];

  for (let i = 0; i < stratEquities.length; i++) {
    for (let j = i + 1; j < stratEquities.length; j++) {
      const se1 = stratEquities[i];
      const se2 = stratEquities[j];

      const ret1: number[] = [];
      const ret2: number[] = [];

      for (let k = 1; k < commonDates.length; k++) {
        const prev = commonDates[k - 1];
        const curr = commonDates[k];
        const e1Prev = se1.byDate.get(prev);
        const e1Curr = se1.byDate.get(curr);
        const e2Prev = se2.byDate.get(prev);
        const e2Curr = se2.byDate.get(curr);

        if (e1Prev && e1Curr && e2Prev && e2Curr && e1Prev > 0 && e2Prev > 0) {
          ret1.push((e1Curr - e1Prev) / e1Prev);
          ret2.push((e2Curr - e2Prev) / e2Prev);
        }
      }

      const corr = calcCorrelation(ret1, ret2);
      results.push({
        strat1: se1.strategyName,
        strat2: se2.strategyName,
        correlation: Math.round(corr * 1000) / 1000,
        simultaneousDdDays: 0,
        simultaneousDdPct: 0,
      });
    }
  }

  return results;
}

// ============================================================
// 表示
// ============================================================

function printResults(
  stratEquities: DailyEquity[],
  portfolio: PortfolioResult,
  ddCorrelations: CorrelationResult[],
  retCorrelations: CorrelationResult[],
  ddPeriods: DdPeriod[],
) {
  console.log("\n" + "=".repeat(80));
  console.log("1. 各戦略の個別パフォーマンス（全銘柄平均）");
  console.log("=".repeat(80));

  console.log(
    "  戦略".padEnd(22) +
    "リターン%".padStart(10) +
    "最大DD%".padStart(10) +
    "勝率%".padStart(8) +
    "取引数".padStart(8) +
    "Sharpe".padStart(8)
  );
  console.log("  " + "-".repeat(64));

  for (const se of stratEquities) {
    console.log(
      `  ${se.strategyName.padEnd(20)}` +
      `${se.totalReturnPct.toFixed(1).padStart(10)}` +
      `${se.maxDrawdownPct.toFixed(1).padStart(10)}` +
      `${se.winRate.toFixed(1).padStart(8)}` +
      `${String(se.numTrades).padStart(8)}` +
      `${se.sharpeRatio.toFixed(2).padStart(8)}`
    );
  }

  console.log("\n" + "=".repeat(80));
  console.log("2. 合算ポートフォリオ（均等配分）");
  console.log("=".repeat(80));

  console.log(`  合算リターン: ${portfolio.totalReturnPct.toFixed(1)}%`);
  console.log(`  合算最大DD: ${portfolio.maxDrawdownPct.toFixed(1)}%`);
  console.log(`  合算Sharpe: ${portfolio.sharpeRatio.toFixed(2)}`);
  console.log(`  リターン/最大DD比: ${(portfolio.totalReturnPct / portfolio.maxDrawdownPct).toFixed(2)}`);
  console.log(`  最大DDピーク: ${portfolio.maxDdStart}`);
  console.log(`  最大DD底: ${portfolio.maxDdBottom}`);
  console.log(`  最大DD回復: ${portfolio.maxDdRecovery}`);

  console.log("\n  年別リターン:");
  for (const [year, ret] of Array.from(portfolio.annualReturns.entries()).sort()) {
    const bar = ret >= 0
      ? "+" + "█".repeat(Math.min(Math.round(ret / 2), 40))
      : "-" + "█".repeat(Math.min(Math.round(Math.abs(ret) / 2), 40));
    console.log(`    ${year}: ${ret.toFixed(1).padStart(8)}%  ${bar}`);
  }

  // 分散効果
  const avgIndividualDd = stratEquities.reduce((s, se) => s + se.maxDrawdownPct, 0) / stratEquities.length;
  const diversificationBenefit = avgIndividualDd - portfolio.maxDrawdownPct;
  console.log(`\n  分散効果:`);
  console.log(`    個別戦略の平均最大DD: ${avgIndividualDd.toFixed(1)}%`);
  console.log(`    合算ポートフォリオ最大DD: ${portfolio.maxDrawdownPct.toFixed(1)}%`);
  console.log(`    DD削減効果: ${diversificationBenefit.toFixed(1)}% (${(diversificationBenefit / avgIndividualDd * 100).toFixed(0)}%削減)`);

  console.log("\n" + "=".repeat(80));
  console.log("3. 戦略間DD相関（ピアソン相関係数）");
  console.log("=".repeat(80));

  console.log("  DD%系列の相関:");
  for (const c of ddCorrelations) {
    const label = c.correlation >= 0.7 ? "⚠ 高相関" :
                  c.correlation >= 0.4 ? "△ 中相関" :
                  c.correlation >= 0.0 ? "○ 低相関" : "◎ 逆相関";
    console.log(
      `    ${c.strat1} × ${c.strat2}: ` +
      `r=${c.correlation.toFixed(3).padStart(7)} ${label}` +
      `  (同時DD>5%: ${c.simultaneousDdDays}日 = ${c.simultaneousDdPct}%)`
    );
  }

  console.log("\n  日次リターンの相関:");
  for (const c of retCorrelations) {
    const label = c.correlation >= 0.7 ? "⚠ 高相関" :
                  c.correlation >= 0.4 ? "△ 中相関" :
                  c.correlation >= 0.0 ? "○ 低相関" : "◎ 逆相関";
    console.log(
      `    ${c.strat1} × ${c.strat2}: ` +
      `r=${c.correlation.toFixed(3).padStart(7)} ${label}`
    );
  }

  console.log("\n" + "=".repeat(80));
  console.log("4. 主なDD期間（>5%）の重なり分析");
  console.log("=".repeat(80));

  // 戦略別DD期間を表示
  for (const se of stratEquities) {
    const periods = ddPeriods.filter((p) => p.strategy === se.strategyName);
    console.log(`\n  [${se.strategyName}] DD>5%期間: ${periods.length}回`);
    for (const p of periods.slice(0, 10)) {
      console.log(`    ${p.start} ~ ${p.end} (${p.durationDays}日, 最大-${p.depth}%)`);
    }
  }

  // 時系列でDD重なりを確認
  console.log("\n  --- DD重なりタイムライン（全戦略がDD>3%の期間）---");
  const commonDates = portfolio.dates;
  let overlapStart: string | null = null;
  let overlapMaxDd = 0;

  for (let i = 0; i < commonDates.length; i++) {
    const date = commonDates[i];
    const allInDd = stratEquities.every((se) => (se.ddByDate.get(date) ?? 0) > 3);

    if (allInDd && !overlapStart) {
      overlapStart = date;
      overlapMaxDd = 0;
    }
    if (allInDd) {
      const portfolioDd = portfolio.drawdownPct[i];
      if (portfolioDd > overlapMaxDd) overlapMaxDd = portfolioDd;
    }
    if ((!allInDd || i === commonDates.length - 1) && overlapStart) {
      console.log(
        `    ${overlapStart} ~ ${commonDates[i - 1] ?? date}` +
        ` (合算DD最大: -${overlapMaxDd.toFixed(1)}%` +
        ` | 各戦略DD: ${stratEquities.map((se) => {
          const dd = se.ddByDate.get(date) ?? 0;
          return `${se.strategyId}:-${dd.toFixed(1)}%`;
        }).join(", ")})`
      );
      overlapStart = null;
    }
  }

  // 月次エクイティカーブ（簡易テキスト）
  console.log("\n" + "=".repeat(80));
  console.log("5. 月次エクイティ推移（合算 vs 個別）");
  console.log("=".repeat(80));

  const monthlyDates = commonDates.filter((_, i) => {
    if (i === 0 || i === commonDates.length - 1) return true;
    // 月末のデータを取る（翌日が別月）
    return i + 1 < commonDates.length && commonDates[i].substring(0, 7) !== commonDates[i + 1].substring(0, 7);
  });

  // 四半期に間引き
  const quarterlyDates = monthlyDates.filter((d) => {
    const month = parseInt(d.substring(5, 7));
    return month === 3 || month === 6 || month === 9 || month === 12 || d === monthlyDates[0];
  });

  console.log(
    "  日付".padEnd(14) +
    "合算".padStart(10) +
    stratEquities.map((se) => se.strategyId.substring(0, 10).padStart(12)).join("") +
    "合算DD%".padStart(10)
  );
  console.log("  " + "-".repeat(14 + 10 + 12 * stratEquities.length + 10));

  for (const date of quarterlyDates) {
    const idx = commonDates.indexOf(date);
    if (idx < 0) continue;

    const portfolioRet = ((portfolio.equity[idx] - INITIAL_CAPITAL) / INITIAL_CAPITAL * 100).toFixed(1);
    const stratRets = stratEquities.map((se) => {
      const eq = se.byDate.get(date) ?? INITIAL_CAPITAL;
      return ((eq - INITIAL_CAPITAL) / INITIAL_CAPITAL * 100).toFixed(1);
    });
    const dd = portfolio.drawdownPct[idx].toFixed(1);

    console.log(
      `  ${date}` +
      `${portfolioRet.padStart(10)}%` +
      stratRets.map((r) => `${r.padStart(11)}%`).join("") +
      `${dd.padStart(9)}%`
    );
  }
}

// ============================================================
// メイン
// ============================================================

async function main() {
  const opts = parseCliArgs();
  const stocks = loadStocks(opts);
  const allData = loadAllStockData(stocks, opts.periodStart, opts.periodEnd);

  console.log("=".repeat(80));
  console.log("ポートフォリオ合算分析");
  console.log(`  対象: ${opts.favoritesOnly ? "お気に入り" : "全銘柄"} (${allData.length}銘柄)`);
  console.log(`  期間: ${opts.periodStart} ~ ${opts.periodEnd}`);
  console.log(`  戦略: ${opts.activeStrategies.map((s) => s.name).join(", ")}`);
  console.log(`  初期資本: ¥${INITIAL_CAPITAL.toLocaleString()} (均等配分)`);
  console.log("=".repeat(80));

  // 各戦略のエクイティ曲線を構築
  console.log("\n戦略別エクイティ曲線を構築中...");
  const stratEquities: DailyEquity[] = [];
  for (const strat of opts.activeStrategies) {
    console.log(`  ${strat.name}...`);
    const eq = buildStrategyEquity(strat.id, strat.name, allData);
    stratEquities.push(eq);
  }

  // 合算ポートフォリオを構築
  console.log("合算ポートフォリオを構築中...");
  const portfolio = buildPortfolio(stratEquities);

  // 共通日付
  const allDatesSet = new Set<string>();
  for (const se of stratEquities) {
    for (const d of se.dates) allDatesSet.add(d);
  }
  const commonDates = Array.from(allDatesSet).sort();

  // DD相関分析
  console.log("DD相関を分析中...");
  const ddCorrelations = analyzeCorrelations(stratEquities, commonDates);
  const retCorrelations = analyzeDailyReturnCorrelations(stratEquities, commonDates);

  // DD期間抽出
  const allDdPeriods: DdPeriod[] = [];
  for (const se of stratEquities) {
    allDdPeriods.push(...findDdPeriods(se, 5));
  }

  // 結果表示
  printResults(stratEquities, portfolio, ddCorrelations, retCorrelations, allDdPeriods);

  console.log("\n" + "=".repeat(80));
  console.log("分析完了");
  console.log("=".repeat(80));
}

main().catch(console.error);

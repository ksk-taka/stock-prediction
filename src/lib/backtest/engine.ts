import type { PriceData } from "@/types";
import type {
  StrategyDef,
  Trade,
  EquityPoint,
  BacktestResult,
  BacktestStats,
} from "./types";

/**
 * バックテストエンジン
 * 戦略のシグナルに従って売買をシミュレーションし、パフォーマンスを算出する。
 */
export function runBacktest(
  data: PriceData[],
  strategy: StrategyDef,
  params: Record<string, number>,
  initialCapital: number
): BacktestResult {
  if (data.length === 0) {
    return emptyResult(initialCapital);
  }

  const signals = strategy.compute(data, params);

  if (strategy.mode === "fixed_amount") {
    return runFixedAmount(data, signals, params, initialCapital);
  }
  return runAllInOut(data, signals, initialCapital);
}

/** 全額売買モード */
function runAllInOut(
  data: PriceData[],
  signals: ReturnType<StrategyDef["compute"]>,
  initialCapital: number
): BacktestResult {
  const trades: Trade[] = [];
  const equity: EquityPoint[] = [];

  let cash = initialCapital;
  let shares = 0;
  let peakEquity = initialCapital;
  let buyPrice = 0;

  for (let i = 0; i < data.length; i++) {
    const d = data[i];
    const signal = signals[i];
    const price = d.close;

    if (signal === "buy" && shares === 0 && cash > 0) {
      shares = Math.floor(cash / price);
      if (shares > 0) {
        const cost = shares * price;
        cash -= cost;
        buyPrice = price;
        trades.push({
          date: d.date,
          type: "buy",
          price,
          shares,
          value: cost,
          reason: "シグナル: 買い",
        });
      }
    } else if (signal === "sell" && shares > 0) {
      const proceeds = shares * price;
      cash += proceeds;
      trades.push({
        date: d.date,
        type: "sell",
        price,
        shares,
        value: proceeds,
        reason: "シグナル: 売り",
      });
      shares = 0;
      buyPrice = 0;
    }

    const currentEquity = cash + shares * price;
    if (currentEquity > peakEquity) peakEquity = currentEquity;
    const drawdown = peakEquity > 0 ? (peakEquity - currentEquity) / peakEquity : 0;

    equity.push({
      date: d.date,
      equity: currentEquity,
      cash,
      position: shares * price,
      drawdown,
    });
  }

  const finalEquity = equity[equity.length - 1]?.equity ?? initialCapital;
  const stats = calcStats(trades, equity, initialCapital, finalEquity, data);

  return { trades, equity, stats, initialCapital, finalEquity };
}

/** 定額買付モード（売りなし、保有し続ける） */
function runFixedAmount(
  data: PriceData[],
  signals: ReturnType<StrategyDef["compute"]>,
  params: Record<string, number>,
  initialCapital: number
): BacktestResult {
  const trades: Trade[] = [];
  const equity: EquityPoint[] = [];

  let cash = initialCapital;
  let totalShares = 0;
  let peakEquity = initialCapital;
  const amount = params.monthlyAmount ?? 100000;

  for (let i = 0; i < data.length; i++) {
    const d = data[i];
    const signal = signals[i];
    const price = d.close;

    if (signal === "buy" && cash >= price) {
      const buyShares = Math.floor(Math.min(amount, cash) / price);
      if (buyShares > 0) {
        const cost = buyShares * price;
        cash -= cost;
        totalShares += buyShares;
        trades.push({
          date: d.date,
          type: "buy",
          price,
          shares: buyShares,
          value: cost,
          reason: "定額積立",
        });
      }
    }

    const currentEquity = cash + totalShares * price;
    if (currentEquity > peakEquity) peakEquity = currentEquity;
    const drawdown = peakEquity > 0 ? (peakEquity - currentEquity) / peakEquity : 0;

    equity.push({
      date: d.date,
      equity: currentEquity,
      cash,
      position: totalShares * price,
      drawdown,
    });
  }

  const finalEquity = equity[equity.length - 1]?.equity ?? initialCapital;
  const stats = calcStats(trades, equity, initialCapital, finalEquity, data);

  return { trades, equity, stats, initialCapital, finalEquity };
}

/** 日付文字列間のカレンダー日数 */
function daysBetween(d1: string, d2: string): number {
  const t1 = new Date(d1).getTime();
  const t2 = new Date(d2).getTime();
  return Math.round((t2 - t1) / (1000 * 60 * 60 * 24));
}

/** ソート済み配列のパーセンタイル */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** パフォーマンス統計を算出 */
function calcStats(
  trades: Trade[],
  equity: EquityPoint[],
  initialCapital: number,
  finalEquity: number,
  data: PriceData[]
): BacktestStats {
  const totalReturn = finalEquity - initialCapital;
  const totalReturnPct = initialCapital > 0 ? (totalReturn / initialCapital) * 100 : 0;

  // 勝敗計算（買い→売りのペア）
  interface RoundTrip {
    profit: number;
    returnPct: number;
    entryDate: string;
    exitDate: string;
    holdingDays: number;
  }
  const roundTrips: RoundTrip[] = [];
  let lastBuy: Trade | null = null;
  for (const t of trades) {
    if (t.type === "buy") {
      lastBuy = t;
    } else if (t.type === "sell" && lastBuy) {
      const profit = (t.price - lastBuy.price) * t.shares;
      const returnPct = lastBuy.price > 0 ? ((t.price - lastBuy.price) / lastBuy.price) * 100 : 0;
      roundTrips.push({
        profit,
        returnPct,
        entryDate: lastBuy.date,
        exitDate: t.date,
        holdingDays: daysBetween(lastBuy.date, t.date),
      });
      lastBuy = null;
    }
  }

  const wins = roundTrips.filter((r) => r.profit > 0);
  const losses = roundTrips.filter((r) => r.profit <= 0);

  const winRate = roundTrips.length > 0 ? (wins.length / roundTrips.length) * 100 : 0;
  const avgWin = wins.length > 0 ? wins.reduce((s, w) => s + w.profit, 0) / wins.length : 0;
  const avgLoss =
    losses.length > 0 ? Math.abs(losses.reduce((s, l) => s + l.profit, 0) / losses.length) : 0;

  // 最大ドローダウン
  const maxDrawdownPct = equity.length > 0
    ? Math.max(...equity.map((e) => e.drawdown)) * 100
    : 0;
  const maxDrawdown = (maxDrawdownPct / 100) * initialCapital;

  // 平均ドローダウン
  const avgDrawdownPct = equity.length > 0
    ? (equity.reduce((s, e) => s + e.drawdown, 0) / equity.length) * 100
    : 0;

  // プロフィットファクター
  const grossProfit = wins.reduce((s, w) => s + w.profit, 0);
  const grossLoss = Math.abs(losses.reduce((s, l) => s + l.profit, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  // シャープレシオ（日次リターンベース、年換算）
  const sharpeRatio = calcSharpeRatio(equity, data);

  // 最大トレードリターン%
  const maxTradeReturnPct = roundTrips.length > 0
    ? Math.max(...roundTrips.map((r) => r.returnPct))
    : 0;

  // リカバリーファクター = トータルリターン / 最大ドローダウン
  const recoveryFactor = maxDrawdown > 0 ? totalReturn / maxDrawdown : totalReturn > 0 ? Infinity : 0;

  // 保有期間統計
  const holdingDays = roundTrips.map((r) => r.holdingDays).sort((a, b) => a - b);
  const avgHoldingDays = holdingDays.length > 0
    ? holdingDays.reduce((s, d) => s + d, 0) / holdingDays.length
    : 0;

  return {
    totalReturn,
    totalReturnPct,
    winRate,
    numTrades: roundTrips.length,
    numWins: wins.length,
    numLosses: losses.length,
    maxDrawdown,
    maxDrawdownPct,
    avgDrawdownPct,
    sharpeRatio,
    profitFactor,
    avgWin,
    avgLoss,
    maxTradeReturnPct,
    recoveryFactor,
    avgHoldingDays,
    holdingDaysMin: holdingDays.length > 0 ? holdingDays[0] : 0,
    holdingDaysQ1: percentile(holdingDays, 0.25),
    holdingDaysMedian: percentile(holdingDays, 0.5),
    holdingDaysQ3: percentile(holdingDays, 0.75),
    holdingDaysMax: holdingDays.length > 0 ? holdingDays[holdingDays.length - 1] : 0,
  };
}

function calcSharpeRatio(equity: EquityPoint[], data: PriceData[]): number {
  if (equity.length < 2) return 0;

  const dailyReturns: number[] = [];
  for (let i = 1; i < equity.length; i++) {
    if (equity[i - 1].equity > 0) {
      dailyReturns.push(
        (equity[i].equity - equity[i - 1].equity) / equity[i - 1].equity
      );
    }
  }

  if (dailyReturns.length < 2) return 0;

  const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const variance =
    dailyReturns.reduce((a, r) => a + (r - mean) ** 2, 0) / (dailyReturns.length - 1);
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return 0;

  // 年換算（取引日数250日）
  return (mean / stdDev) * Math.sqrt(250);
}

function emptyResult(initialCapital: number): BacktestResult {
  return {
    trades: [],
    equity: [],
    stats: {
      totalReturn: 0,
      totalReturnPct: 0,
      winRate: 0,
      numTrades: 0,
      numWins: 0,
      numLosses: 0,
      maxDrawdown: 0,
      maxDrawdownPct: 0,
      avgDrawdownPct: 0,
      sharpeRatio: 0,
      profitFactor: 0,
      avgWin: 0,
      avgLoss: 0,
      maxTradeReturnPct: 0,
      recoveryFactor: 0,
      avgHoldingDays: 0,
      holdingDaysMin: 0,
      holdingDaysQ1: 0,
      holdingDaysMedian: 0,
      holdingDaysQ3: 0,
      holdingDaysMax: 0,
    },
    initialCapital,
    finalEquity: initialCapital,
  };
}

/**
 * シグナル計算の共通ロジック
 * signals/route.ts と signals/scan/route.ts で共有
 */

import { getHistoricalPrices } from "@/lib/api/yahooFinance";
import { strategies, getStrategyParams } from "@/lib/backtest/strategies";
import { getExitLevels } from "@/lib/utils/exitLevels";
import { setCachedSignals } from "@/lib/cache/signalsCache";
import { detectBuySignals, detectCupWithHandle } from "@/lib/utils/signals";
import type { PriceData } from "@/types";
import type { Signal } from "@/lib/backtest/types";
import type { PeriodType } from "@/lib/backtest/presets";

export interface ActiveSignalInfo {
  strategyId: string;
  strategyName: string;
  buyDate: string;
  buyPrice: number;
  currentPrice: number;
  pnlPct: number;
  takeProfitPrice?: number;
  takeProfitLabel?: string;
  stopLossPrice?: number;
  stopLossLabel?: string;
}

export interface RecentSignalInfo {
  strategyId: string;
  strategyName: string;
  date: string;
  price: number;
}

export interface StockSignalsResult {
  daily: {
    choruko: { count: number; latest: string | null };
    cwh: { count: number; latest: string | null };
  };
  weekly: {
    choruko: { count: number; latest: string | null };
    cwh: { count: number; latest: string | null };
  };
  activeSignals: {
    daily: ActiveSignalInfo[];
    weekly: ActiveSignalInfo[];
  };
  recentSignals: {
    daily: RecentSignalInfo[];
    weekly: RecentSignalInfo[];
  };
}

// シグナル検出対象の戦略ID
export const SIGNAL_STRATEGY_IDS = [
  "choruko_bb", "choruko_shitabanare", "tabata_cwh",
  "rsi_reversal", "ma_cross", "macd_signal", "dip_buy",
  "macd_trail", "cwh_trail",
];

/** アクティブ（未決済）ポジションを検出 */
export function findActivePosition(
  data: PriceData[],
  signals: Signal[]
): { buyDate: string; buyPrice: number; buyIndex: number } | null {
  let lastBuyIdx = -1;
  let inPosition = false;

  for (let i = 0; i < signals.length; i++) {
    if (signals[i] === "buy" && !inPosition) {
      inPosition = true;
      lastBuyIdx = i;
    } else if (signals[i] === "sell" && inPosition) {
      inPosition = false;
    }
  }

  if (inPosition && lastBuyIdx >= 0) {
    return {
      buyDate: data[lastBuyIdx].date,
      buyPrice: data[lastBuyIdx].close,
      buyIndex: lastBuyIdx,
    };
  }
  return null;
}

/** 直近N日以内のbuyシグナルを検出 */
export function findRecentBuySignals(
  data: PriceData[],
  signals: Signal[],
  lookbackDays: number,
): { date: string; price: number }[] {
  const results: { date: string; price: number }[] = [];
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

  for (let i = signals.length - 1; i >= 0; i--) {
    if (new Date(data[i].date) < cutoffDate) break;
    if (signals[i] === "buy") {
      results.push({
        date: data[i].date,
        price: Math.round(data[i].close * 100) / 100,
      });
    }
  }
  return results;
}

/** 単一銘柄のシグナルを計算（price data は外から渡す） */
export function detectSignalsFromData(
  data: PriceData[],
  periodKey: PeriodType,
): { active: ActiveSignalInfo[]; recent: RecentSignalInfo[] } {
  if (data.length === 0) return { active: [], recent: [] };
  const currentPrice = data[data.length - 1].close;
  const active: ActiveSignalInfo[] = [];
  const recent: RecentSignalInfo[] = [];
  const lookbackDays = periodKey === "daily" ? 90 : 270;

  for (const stratId of SIGNAL_STRATEGY_IDS) {
    const strat = strategies.find((s) => s.id === stratId);
    if (!strat) continue;

    const params = getStrategyParams(stratId, "optimized", periodKey);
    const signals = strat.compute(data, params);

    const activePos = findActivePosition(data, signals);
    if (activePos) {
      const pnlPct =
        ((currentPrice - activePos.buyPrice) / activePos.buyPrice) * 100;
      const exits = getExitLevels(stratId, data, activePos.buyIndex, activePos.buyPrice, params);
      active.push({
        strategyId: stratId,
        strategyName: strat.name,
        buyDate: activePos.buyDate,
        buyPrice: Math.round(activePos.buyPrice * 100) / 100,
        currentPrice: Math.round(currentPrice * 100) / 100,
        pnlPct: Math.round(pnlPct * 100) / 100,
        ...exits,
      });
    }

    const recentBuys = findRecentBuySignals(data, signals, lookbackDays);
    for (const r of recentBuys) {
      recent.push({
        strategyId: stratId,
        strategyName: strat.name,
        date: r.date,
        price: r.price,
      });
    }
  }

  return { active, recent };
}

/** 単一銘柄の全シグナルを計算してキャッシュに保存 */
export async function computeAndCacheSignals(symbol: string): Promise<StockSignalsResult> {
  const [dailyData, weeklyData] = await Promise.all([
    getHistoricalPrices(symbol, "daily"),
    getHistoricalPrices(symbol, "weekly"),
  ]);

  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  const dailyChoruko = detectBuySignals(dailyData).filter(
    (s) => new Date(s.date) >= threeMonthsAgo
  );
  const weeklyChoruko = detectBuySignals(weeklyData).filter(
    (s) => new Date(s.date) >= oneYearAgo
  );
  const dailyCWH = detectCupWithHandle(dailyData).filter(
    (s) => new Date(s.date) >= threeMonthsAgo
  );
  const weeklyCWH = detectCupWithHandle(weeklyData).filter(
    (s) => new Date(s.date) >= oneYearAgo
  );

  const summarize = (signals: { date: string }[]) => ({
    count: signals.length,
    latest: signals.length > 0 ? signals[signals.length - 1].date : null,
  });

  const dailySignals = detectSignalsFromData(dailyData, "daily");
  const weeklySignals = detectSignalsFromData(weeklyData, "weekly");

  const result: StockSignalsResult = {
    daily: {
      choruko: summarize(dailyChoruko),
      cwh: summarize(dailyCWH),
    },
    weekly: {
      choruko: summarize(weeklyChoruko),
      cwh: summarize(weeklyCWH),
    },
    activeSignals: {
      daily: dailySignals.active,
      weekly: weeklySignals.active,
    },
    recentSignals: {
      daily: dailySignals.recent,
      weekly: weeklySignals.recent,
    },
  };

  setCachedSignals(symbol, result);
  return result;
}

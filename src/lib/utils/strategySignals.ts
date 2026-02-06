import type { PriceData } from "@/types";
import type { Signal } from "@/lib/backtest/types";
import { strategies, getStrategyParams } from "@/lib/backtest/strategies";
import type { PeriodType } from "@/lib/backtest/presets";
import { calcMACD } from "@/lib/utils/indicators";

export type StrategySignalType = "rsi_reversal" | "ma_cross" | "macd_signal" | "macd_trail12";

export interface StrategySignalPoint {
  index: number;
  date: string;
  price: number;
  action: "buy" | "take_profit" | "stop_loss" | "dead_cross";
  label: string;
}

export interface StrategySignalsResult {
  signals: Record<StrategySignalType, StrategySignalPoint[]>;
  trailStopLevels: (number | null)[];
}

const STRATEGY_LABELS: Record<StrategySignalType, { buy: string; tp: string; sl: string }> = {
  rsi_reversal: { buy: "RSI買い", tp: "RSI利確", sl: "RSI損切" },
  ma_cross: { buy: "GC", tp: "DC", sl: "DC" },
  macd_signal: { buy: "MACD買い", tp: "MACD利確", sl: "MACD損切" },
  macd_trail12: { buy: "MACD買い", tp: "Trail利確", sl: "Trail損切" },
};

function extractSignalPoints(
  strategyId: StrategySignalType,
  data: PriceData[],
  signals: Signal[],
): StrategySignalPoint[] {
  const labels = STRATEGY_LABELS[strategyId];
  const points: StrategySignalPoint[] = [];
  let lastBuyPrice = 0;

  for (let i = 0; i < signals.length; i++) {
    if (signals[i] === "buy") {
      lastBuyPrice = data[i].close;
      points.push({
        index: i,
        date: data[i].date,
        price: data[i].close,
        action: "buy",
        label: labels.buy,
      });
    } else if (signals[i] === "sell" && lastBuyPrice > 0) {
      // MAクロスのsellはデッドクロス（利確/損切ではなくクロスシグナル）
      if (strategyId === "ma_cross") {
        points.push({
          index: i,
          date: data[i].date,
          price: data[i].close,
          action: "dead_cross",
          label: "DC",
        });
      } else {
        const isTakeProfit = data[i].close >= lastBuyPrice;
        points.push({
          index: i,
          date: data[i].date,
          price: data[i].close,
          action: isTakeProfit ? "take_profit" : "stop_loss",
          label: isTakeProfit ? labels.tp : labels.sl,
        });
      }
      lastBuyPrice = 0;
    }
  }

  return points;
}

/**
 * MACD Trail 12% - MACD GCで買い、高値から12%下落でトレーリングストップ売り
 */
function computeMacdTrail12(
  data: PriceData[],
  period: PeriodType,
): { signals: StrategySignalPoint[]; trailLevels: (number | null)[] } {
  const params = getStrategyParams("macd_signal", "optimized", period);
  const macd = calcMACD(data, params.shortPeriod, params.longPeriod, params.signalPeriod);
  const points: StrategySignalPoint[] = [];
  const trailLevels: (number | null)[] = new Array(data.length).fill(null);

  let inPosition = false;
  let buyPrice = 0;
  let peakSinceBuy = 0;

  for (let i = 1; i < data.length; i++) {
    const prev = macd[i - 1];
    const cur = macd[i];

    if (!inPosition) {
      if (prev.macd != null && prev.signal != null && cur.macd != null && cur.signal != null) {
        if (prev.macd <= prev.signal && cur.macd > cur.signal) {
          inPosition = true;
          buyPrice = data[i].close;
          peakSinceBuy = data[i].close;
          trailLevels[i] = Math.round(peakSinceBuy * 0.88 * 100) / 100;
          points.push({
            index: i,
            date: data[i].date,
            price: data[i].close,
            action: "buy",
            label: "MACD買い",
          });
        }
      }
    } else {
      if (data[i].close > peakSinceBuy) {
        peakSinceBuy = data[i].close;
      }
      const trailLevel = peakSinceBuy * 0.88;
      trailLevels[i] = Math.round(trailLevel * 100) / 100;

      if (data[i].close <= trailLevel) {
        const isTakeProfit = data[i].close >= buyPrice;
        points.push({
          index: i,
          date: data[i].date,
          price: data[i].close,
          action: isTakeProfit ? "take_profit" : "stop_loss",
          label: isTakeProfit ? "Trail利確" : "Trail損切",
        });
        inPosition = false;
        buyPrice = 0;
        peakSinceBuy = 0;
      }
    }
  }

  return { signals: points, trailLevels };
}

/**
 * 4戦略(RSI逆張り, MAクロス, MACD, MACD Trail12%)のシグナルポイントを計算
 * 最適化プリセットを使用
 */
export function computeStrategySignals(
  data: PriceData[],
  period: PeriodType,
): StrategySignalsResult {
  const signals = {} as Record<StrategySignalType, StrategySignalPoint[]>;
  const ids: StrategySignalType[] = ["rsi_reversal", "ma_cross", "macd_signal"];

  for (const id of ids) {
    const strat = strategies.find((s) => s.id === id);
    if (!strat) {
      signals[id] = [];
      continue;
    }
    const params = getStrategyParams(id, "optimized", period);
    const sigs = strat.compute(data, params);
    signals[id] = extractSignalPoints(id, data, sigs);
  }

  // MACD Trail 12% (custom computation - not in strategies.ts)
  const trail12 = computeMacdTrail12(data, period);
  signals["macd_trail12"] = trail12.signals;

  return { signals, trailStopLevels: trail12.trailLevels };
}

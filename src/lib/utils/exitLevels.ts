// ============================================================
// 戦略ごとの利確/損切レベル算出（共通関数）
// signals/route.ts と monitor-signals.ts で共有
// ============================================================

import type { PriceData } from "@/types";
import { calcBollingerBands } from "./indicators";

export interface ExitLevels {
  takeProfitPrice?: number;
  takeProfitLabel?: string;
  stopLossPrice?: number;
  stopLossLabel?: string;
}

export function getExitLevels(
  strategyId: string,
  data: PriceData[],
  buyIndex: number,
  buyPrice: number,
  params: Record<string, number>,
): ExitLevels {
  switch (strategyId) {
    case "choruko_bb": {
      const bb = calcBollingerBands(data, 25);
      const currentMA25 = bb[data.length - 1]?.middle;
      return {
        takeProfitPrice: currentMA25 ? Math.round(currentMA25 * 100) / 100 : undefined,
        takeProfitLabel: "MA25タッチ",
        stopLossPrice: Math.round(data[buyIndex].low * 100) / 100,
        stopLossLabel: "エントリー安値割れ",
      };
    }
    case "choruko_shitabanare": {
      const gapUpper = buyIndex >= 2 ? data[buyIndex - 2]?.low : undefined;
      return {
        takeProfitPrice: gapUpper ? Math.round(gapUpper * 100) / 100 : undefined,
        takeProfitLabel: "窓上限到達",
        stopLossPrice: Math.round(data[buyIndex].low * 100) / 100,
        stopLossLabel: "エントリー安値割れ",
      };
    }
    case "tabata_cwh": {
      const tp = params.takeProfitPct ?? 20;
      const sl = params.stopLossPct ?? 7;
      return {
        takeProfitPrice: Math.round(buyPrice * (1 + tp / 100) * 100) / 100,
        takeProfitLabel: `+${tp}%`,
        stopLossPrice: Math.round(buyPrice * (1 - sl / 100) * 100) / 100,
        stopLossLabel: `-${sl}%`,
      };
    }
    case "ma_cross": {
      const short = params.shortPeriod ?? 5;
      const long = params.longPeriod ?? 25;
      return {
        stopLossLabel: `MA${short}/MA${long} デッドクロスで売却`,
      };
    }
    case "macd_signal": {
      const sp = params.shortPeriod ?? 12;
      const lp = params.longPeriod ?? 26;
      const sig = params.signalPeriod ?? 9;
      return {
        stopLossLabel: `MACD(${sp},${lp},${sig}) デッドクロスで売却`,
      };
    }
    case "rsi_reversal": {
      const rsiPeriod = params.period ?? 14;
      const oversold = params.oversold ?? 30;
      const overbought = params.overbought ?? 70;
      return {
        stopLossLabel: `RSI(${rsiPeriod}) >${overbought}で売却 (買い: <${oversold})`,
      };
    }
    default:
      return {};
  }
}

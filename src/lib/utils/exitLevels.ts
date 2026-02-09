// ============================================================
// 戦略ごとの利確/損切レベル算出（共通関数）
// signals/route.ts と monitor-signals.ts で共有
// ============================================================

import type { PriceData } from "@/types";
import { calcBollingerBands, calcATR } from "./indicators";

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
      const sl = params.stopLossPct ?? 8;
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
      const overbought = params.overbought ?? 70;
      const atrPeriod = params.atrPeriod ?? 14;
      const atrMultiple = params.atrMultiple ?? 2;
      const rsiStopPct = params.stopLossPct ?? 10;
      // ATR×N or -M% の厳しい方
      const atrValues = calcATR(data, atrPeriod);
      const atrAtEntry = atrValues[buyIndex];
      const atrStop = atrAtEntry != null ? buyPrice - atrAtEntry * atrMultiple : 0;
      const pctStop = buyPrice * (1 - rsiStopPct / 100);
      const stopPrice = Math.max(atrStop, pctStop);
      const stopLabel = atrAtEntry != null && atrStop >= pctStop
        ? `ATR(${rsiPeriod})×${atrMultiple} = -${((buyPrice - stopPrice) / buyPrice * 100).toFixed(1)}%`
        : `-${rsiStopPct}%`;
      return {
        takeProfitLabel: `RSI >${overbought}で利確`,
        stopLossPrice: Math.round(stopPrice * 100) / 100,
        stopLossLabel: `損切: ${stopLabel}`,
      };
    }
    case "dip_buy": {
      const recoveryPct = params.recoveryPct ?? 15;
      const dipStopPct = params.stopLossPct ?? 15;
      return {
        takeProfitPrice: Math.round(buyPrice * (1 + recoveryPct / 100) * 100) / 100,
        takeProfitLabel: `+${recoveryPct}%回復`,
        stopLossPrice: Math.round(buyPrice * (1 - dipStopPct / 100) * 100) / 100,
        stopLossLabel: `-${dipStopPct}%`,
      };
    }
    case "macd_trail": {
      const trailPct = params.trailPct ?? 12;
      const macdSlPct = params.stopLossPct ?? 5;
      return {
        takeProfitLabel: `トレーリングストップ ${trailPct}%（高値追従）`,
        stopLossPrice: Math.round(buyPrice * (1 - macdSlPct / 100) * 100) / 100,
        stopLossLabel: `-${macdSlPct}%（初期損切）`,
      };
    }
    default:
      return {};
  }
}

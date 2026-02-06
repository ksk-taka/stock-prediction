import type { StrategyDef, Signal } from "./types";
import type { PriceData } from "@/types";
import { calcRSI, calcMACD } from "@/lib/utils/indicators";

function calcMA(data: PriceData[], window: number): (number | null)[] {
  return data.map((_, i) => {
    if (i < window - 1) return null;
    const sum = data.slice(i - window + 1, i + 1).reduce((acc, d) => acc + d.close, 0);
    return sum / window;
  });
}

export const strategies: StrategyDef[] = [
  {
    id: "ma_cross",
    name: "ゴールデンクロス/デッドクロス",
    description: "短期MAが長期MAを上抜けで買い、下抜けで売り",
    mode: "all_in_out",
    params: [
      { key: "shortPeriod", label: "短期MA", default: 5, min: 2, max: 50 },
      { key: "longPeriod", label: "長期MA", default: 25, min: 5, max: 200 },
    ],
    compute: (data, params) => {
      const shortMA = calcMA(data, params.shortPeriod);
      const longMA = calcMA(data, params.longPeriod);
      return data.map((_, i): Signal => {
        if (i < 1 || shortMA[i] == null || longMA[i] == null || shortMA[i - 1] == null || longMA[i - 1] == null) return "hold";
        if (shortMA[i - 1]! <= longMA[i - 1]! && shortMA[i]! > longMA[i]!) return "buy";
        if (shortMA[i - 1]! >= longMA[i - 1]! && shortMA[i]! < longMA[i]!) return "sell";
        return "hold";
      });
    },
  },
  {
    id: "rsi_reversal",
    name: "RSI逆張り",
    description: "RSIが売られすぎで買い、買われすぎで売り",
    mode: "all_in_out",
    params: [
      { key: "period", label: "RSI期間", default: 14, min: 5, max: 30 },
      { key: "oversold", label: "買い(RSI<)", default: 30, min: 10, max: 50 },
      { key: "overbought", label: "売り(RSI>)", default: 70, min: 50, max: 90 },
    ],
    compute: (data, params) => {
      const rsi = calcRSI(data, params.period);
      let inPosition = false;
      return data.map((_, i): Signal => {
        if (rsi[i] == null) return "hold";
        if (!inPosition && rsi[i]! < params.oversold) { inPosition = true; return "buy"; }
        if (inPosition && rsi[i]! > params.overbought) { inPosition = false; return "sell"; }
        return "hold";
      });
    },
  },
  {
    id: "macd_signal",
    name: "MACDシグナル",
    description: "MACDがシグナル線を上抜けで買い、下抜けで売り",
    mode: "all_in_out",
    params: [
      { key: "shortPeriod", label: "短期EMA", default: 12, min: 5, max: 30 },
      { key: "longPeriod", label: "長期EMA", default: 26, min: 10, max: 50 },
      { key: "signalPeriod", label: "シグナル", default: 9, min: 3, max: 20 },
    ],
    compute: (data, params) => {
      const macd = calcMACD(data, params.shortPeriod, params.longPeriod, params.signalPeriod);
      return data.map((_, i): Signal => {
        if (i < 1 || !macd[i] || !macd[i - 1]) return "hold";
        const prev = macd[i - 1];
        const cur = macd[i];
        if (prev.macd == null || prev.signal == null || cur.macd == null || cur.signal == null) return "hold";
        if (prev.macd <= prev.signal && cur.macd > cur.signal) return "buy";
        if (prev.macd >= prev.signal && cur.macd < cur.signal) return "sell";
        return "hold";
      });
    },
  },
  {
    id: "dca",
    name: "定額積立（DCA）",
    description: "毎月一定額を購入するドルコスト平均法",
    mode: "fixed_amount",
    params: [
      { key: "monthlyAmount", label: "月額投資額", default: 100000, min: 10000, max: 10000000, step: 10000 },
    ],
    compute: (data) => {
      let lastMonth = -1;
      return data.map((d): Signal => {
        const month = new Date(d.date).getMonth();
        if (month !== lastMonth) {
          lastMonth = month;
          return "buy";
        }
        return "hold";
      });
    },
  },
  {
    id: "dip_buy",
    name: "急落買い",
    description: "直近高値からN%下落で買い、M%回復で売り",
    mode: "all_in_out",
    params: [
      { key: "dipPct", label: "下落率(%)", default: 10, min: 3, max: 30, step: 1 },
      { key: "recoveryPct", label: "回復率(%)", default: 15, min: 5, max: 50, step: 1 },
    ],
    compute: (data, params) => {
      let peak = data[0]?.close ?? 0;
      let buyPrice = 0;
      let inPosition = false;
      return data.map((d): Signal => {
        if (d.close > peak) peak = d.close;
        if (!inPosition) {
          const dropPct = ((peak - d.close) / peak) * 100;
          if (dropPct >= params.dipPct) {
            inPosition = true;
            buyPrice = d.close;
            return "buy";
          }
        } else {
          const gainPct = ((d.close - buyPrice) / buyPrice) * 100;
          if (gainPct >= params.recoveryPct) {
            inPosition = false;
            peak = d.close;
            return "sell";
          }
        }
        return "hold";
      });
    },
  },
];

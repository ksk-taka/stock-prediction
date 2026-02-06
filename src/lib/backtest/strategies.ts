import type { StrategyDef, Signal } from "./types";
import type { PriceData } from "@/types";
import { calcRSI, calcMACD, calcBollingerBands } from "@/lib/utils/indicators";
import { detectCupWithHandle } from "@/lib/utils/signals";
import { getPresetParams, type PresetType, type PeriodType } from "./presets";

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
  // ── ちょる子式BB逆張り ──
  {
    id: "choruko_bb",
    name: "ちょる子式BB逆張り",
    description: "BB -2σ割れ後の反転陽線で買い、MA25到達で利確、エントリー安値割れで損切り",
    mode: "all_in_out",
    params: [],
    compute: (data) => {
      const bb = calcBollingerBands(data, 25);
      const ma25 = calcMA(data, 25);
      let inPosition = false;
      let entryLow = 0;
      let belowBand = false;

      return data.map((d, i): Signal => {
        const lower2 = bb[i]?.lower2;
        if (lower2 == null) return "hold";

        if (!inPosition) {
          if (d.close < lower2) { belowBand = true; return "hold"; }
          if (belowBand && d.close > d.open) {
            inPosition = true;
            entryLow = d.low;
            belowBand = false;
            return "buy";
          }
          if (d.close > lower2) belowBand = false;
        } else {
          // 利確: 終値 >= MA25
          if (ma25[i] != null && d.close >= ma25[i]!) {
            inPosition = false;
            return "sell";
          }
          // 損切: 終値 < エントリー安値
          if (d.close < entryLow) {
            inPosition = false;
            return "sell";
          }
        }
        return "hold";
      });
    },
  },
  // ── ちょる子式 下放れ二本黒 ──
  {
    id: "choruko_shitabanare",
    name: "ちょる子式 下放れ二本黒",
    description: "ギャップダウン+陰線2本@BB-2σで買い、窓上限で利確、直近安値割れで損切り",
    mode: "all_in_out",
    params: [],
    compute: (data) => {
      const bb = calcBollingerBands(data, 25);
      let inPosition = false;
      let entryLow = 0;
      let gapUpper = 0;

      return data.map((d, i): Signal => {
        if (i < 2) return "hold";
        const lower2 = bb[i]?.lower2;
        if (lower2 == null) return "hold";

        if (!inPosition) {
          // ギャップダウン + 陰線2本 + BB-2σ付近
          const gapDown = data[i - 1].open < data[i - 2].low;
          const bearish1 = data[i - 1].close < data[i - 1].open;
          const bearish2 = d.close < d.open;
          const nearLower = d.close <= lower2 * 1.10;
          if (gapDown && bearish1 && bearish2 && nearLower) {
            inPosition = true;
            entryLow = d.low;
            gapUpper = data[i - 2].low; // 窓の上限
            return "buy";
          }
        } else {
          // 利確: 終値 >= 窓上限
          if (d.close >= gapUpper) {
            inPosition = false;
            return "sell";
          }
          // 損切: 終値 < エントリー安値
          if (d.close < entryLow) {
            inPosition = false;
            return "sell";
          }
        }
        return "hold";
      });
    },
  },
  // ── 急落買い(乖離率) ──
  {
    id: "dip_kairi",
    name: "急落買い(乖離率)",
    description: "MA25乖離-10%で買い、乖離-5%orMA5タッチで利確、-7%損切り+タイムストップ5日",
    mode: "all_in_out",
    params: [
      { key: "entryKairi", label: "エントリー乖離(%)", default: -10, min: -30, max: -5, step: 1 },
      { key: "exitKairi", label: "利確乖離(%)", default: -5, min: -15, max: 0, step: 1 },
      { key: "stopLossPct", label: "損切(%)", default: 7, min: 3, max: 15, step: 1 },
      { key: "timeStopDays", label: "タイムストップ(日)", default: 5, min: 2, max: 10, step: 1 },
    ],
    compute: (data, params) => {
      const ma25 = calcMA(data, 25);
      const ma5 = calcMA(data, 5);
      let inPosition = false;
      let entryPrice = 0;
      let entryIdx = 0;

      return data.map((d, i): Signal => {
        if (ma25[i] == null) return "hold";
        const kairi = ((d.close - ma25[i]!) / ma25[i]!) * 100;

        if (!inPosition) {
          if (kairi <= params.entryKairi) {
            inPosition = true;
            entryPrice = d.close;
            entryIdx = i;
            return "buy";
          }
        } else {
          // 利確: 乖離率が回復
          const currentKairi = ((d.close - ma25[i]!) / ma25[i]!) * 100;
          if (currentKairi >= params.exitKairi) {
            inPosition = false;
            return "sell";
          }
          // 利確: MA5タッチ
          if (ma5[i] != null && d.close >= ma5[i]!) {
            inPosition = false;
            return "sell";
          }
          // 損切: エントリーから-N%
          const lossPct = ((d.close - entryPrice) / entryPrice) * 100;
          if (lossPct <= -params.stopLossPct) {
            inPosition = false;
            return "sell";
          }
          // タイムストップ: N日経過で含み益なし
          if (i - entryIdx >= params.timeStopDays && d.close <= entryPrice) {
            inPosition = false;
            return "sell";
          }
        }
        return "hold";
      });
    },
  },
  // ── 急落買い(RSI+出来高) ──
  {
    id: "dip_rsi_volume",
    name: "急落買い(RSI+出来高)",
    description: "RSI≤20+出来高2倍で買い、RSI40-50or+5%で利確、安値割れで損切り",
    mode: "all_in_out",
    params: [
      { key: "rsiThreshold", label: "RSI閾値", default: 20, min: 10, max: 30, step: 1 },
      { key: "volumeMultiple", label: "出来高倍率", default: 2, min: 1.5, max: 5, step: 0.5 },
      { key: "rsiExit", label: "利確RSI", default: 40, min: 30, max: 60, step: 5 },
      { key: "takeProfitPct", label: "利確(%)", default: 5, min: 3, max: 15, step: 1 },
    ],
    compute: (data, params) => {
      const rsi = calcRSI(data, 14);
      let inPosition = false;
      let entryPrice = 0;
      let entryLow = 0;

      return data.map((d, i): Signal => {
        if (i < 5 || rsi[i] == null) return "hold";

        // 過去5日の平均出来高
        const avgVol = data.slice(Math.max(0, i - 5), i).reduce((a, x) => a + x.volume, 0) / 5;

        if (!inPosition) {
          if (rsi[i]! <= params.rsiThreshold && d.volume >= avgVol * params.volumeMultiple) {
            inPosition = true;
            entryPrice = d.close;
            entryLow = d.low;
            return "buy";
          }
        } else {
          // 利確: RSI回復
          if (rsi[i]! >= params.rsiExit) {
            inPosition = false;
            return "sell";
          }
          // 利確: 固定%
          const gainPct = ((d.close - entryPrice) / entryPrice) * 100;
          if (gainPct >= params.takeProfitPct) {
            inPosition = false;
            return "sell";
          }
          // 損切: エントリー日の安値割れ
          if (d.close < entryLow) {
            inPosition = false;
            return "sell";
          }
        }
        return "hold";
      });
    },
  },
  // ── 急落買い(BB-3σ) ──
  {
    id: "dip_bb3sigma",
    name: "急落買い(BB-3σ)",
    description: "BB-3σタッチで買い、-2σ回帰で利確、-5%損切り",
    mode: "all_in_out",
    params: [
      { key: "stopLossPct", label: "損切(%)", default: 5, min: 3, max: 10, step: 1 },
    ],
    compute: (data, params) => {
      const bb = calcBollingerBands(data, 25);
      let inPosition = false;
      let entryPrice = 0;

      return data.map((d, i): Signal => {
        const lower3 = bb[i]?.lower3;
        const lower2 = bb[i]?.lower2;
        if (lower3 == null || lower2 == null) return "hold";

        if (!inPosition) {
          // エントリー: 終値がBB-3σ以下
          if (d.close <= lower3) {
            inPosition = true;
            entryPrice = d.close;
            return "buy";
          }
        } else {
          // 利確: -2σまで回帰
          if (d.close >= lower2) {
            inPosition = false;
            return "sell";
          }
          // 損切: エントリーから-N%
          const lossPct = ((d.close - entryPrice) / entryPrice) * 100;
          if (lossPct <= -params.stopLossPct) {
            inPosition = false;
            return "sell";
          }
        }
        return "hold";
      });
    },
  },
  // ── 田端式CWH ──
  {
    id: "tabata_cwh",
    name: "田端式CWH",
    description: "カップウィズハンドルのブレイクアウトで買い、+20%利確、-7%損切り",
    mode: "all_in_out",
    params: [
      { key: "takeProfitPct", label: "利確(%)", default: 20, min: 5, max: 50, step: 1 },
      { key: "stopLossPct", label: "損切(%)", default: 7, min: 2, max: 20, step: 1 },
    ],
    compute: (data, params) => {
      const cwhSignals = detectCupWithHandle(data);
      const signalIndices = new Set(cwhSignals.map((s) => s.index));
      let inPosition = false;
      let entryPrice = 0;
      const tp = params.takeProfitPct / 100;
      const sl = params.stopLossPct / 100;

      return data.map((d, i): Signal => {
        if (!inPosition) {
          if (signalIndices.has(i)) {
            inPosition = true;
            entryPrice = d.close;
            return "buy";
          }
        } else {
          // 利確: +N%
          if (d.close >= entryPrice * (1 + tp)) {
            inPosition = false;
            return "sell";
          }
          // 損切: -M%
          if (d.close <= entryPrice * (1 - sl)) {
            inPosition = false;
            return "sell";
          }
        }
        return "hold";
      });
    },
  },
];

/**
 * 戦略のデフォルトパラメータを取得
 */
export function getDefaultParams(strategyId: string): Record<string, number> {
  const strat = strategies.find((s) => s.id === strategyId);
  if (!strat) return {};
  return Object.fromEntries(strat.params.map((p) => [p.key, p.default]));
}

/**
 * 指定プリセット・期間のパラメータを取得
 */
export function getStrategyParams(
  strategyId: string,
  preset: PresetType,
  period: PeriodType
): Record<string, number> {
  const defaults = getDefaultParams(strategyId);
  return getPresetParams(strategyId, preset, period, defaults);
}

import type { PriceData } from "@/types";

/**
 * EMA (指数移動平均) を計算
 */
function calcEMA(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    ema.push(values[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

/**
 * RSI (Relative Strength Index)
 * 期間14がデフォルト。Wilder's smoothing method を使用。
 */
export function calcRSI(
  data: PriceData[],
  period: number = 14
): (number | null)[] {
  const result: (number | null)[] = new Array(data.length).fill(null);
  if (data.length < period + 1) return result;

  // 最初のperiod分の平均gain/lossを計算
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = data[i].close - data[i - 1].close;
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;

  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  result[period] = Math.round((100 - 100 / (1 + rs)) * 100) / 100;

  // Wilder's smoothing
  for (let i = period + 1; i < data.length; i++) {
    const change = data[i].close - data[i - 1].close;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    const rsi =
      avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    result[i] = Math.round(rsi * 100) / 100;
  }

  return result;
}

export interface MACDPoint {
  macd: number | null;
  signal: number | null;
  histogram: number | null;
}

/**
 * MACD (Moving Average Convergence Divergence)
 * 短期EMA(12) - 長期EMA(26) = MACD線
 * MACD線のEMA(9) = シグナル線
 * MACD線 - シグナル線 = ヒストグラム
 */
export function calcMACD(
  data: PriceData[],
  shortPeriod: number = 12,
  longPeriod: number = 26,
  signalPeriod: number = 9
): MACDPoint[] {
  const result: MACDPoint[] = data.map(() => ({
    macd: null,
    signal: null,
    histogram: null,
  }));

  if (data.length < longPeriod) return result;

  const closes = data.map((d) => d.close);
  const shortEMA = calcEMA(closes, shortPeriod);
  const longEMA = calcEMA(closes, longPeriod);

  // MACD線 = 短期EMA - 長期EMA （longPeriod以降から有効）
  const macdLine: number[] = [];
  for (let i = 0; i < data.length; i++) {
    macdLine.push(shortEMA[i] - longEMA[i]);
  }

  // シグナル線 = MACD線のEMA（longPeriod以降の値でEMA計算）
  const validMacd = macdLine.slice(longPeriod - 1);
  const signalLine = calcEMA(validMacd, signalPeriod);

  // 結果をマッピング
  for (let i = longPeriod - 1; i < data.length; i++) {
    const mi = i - (longPeriod - 1);
    const macd = Math.round(macdLine[i] * 100) / 100;
    result[i].macd = macd;

    if (mi >= signalPeriod - 1) {
      const sig = Math.round(signalLine[mi] * 100) / 100;
      result[i].signal = sig;
      result[i].histogram = Math.round((macd - sig) * 100) / 100;
    }
  }

  return result;
}

export interface BollingerPoint {
  middle: number | null;
  upper1: number | null;
  lower1: number | null;
  upper2: number | null;
  lower2: number | null;
  upper3: number | null;
  lower3: number | null;
}

/**
 * ボリンジャーバンド（1σ, 2σ, 3σ を一括計算）
 * middle = SMA(period)
 * upperN = middle + N * 標準偏差
 * lowerN = middle - N * 標準偏差
 */
/**
 * ATR (Average True Range)
 * True Range = max(high-low, |high-prevClose|, |low-prevClose|)
 * ATR = SMA of True Range over period
 */
export function calcATR(
  data: PriceData[],
  period: number = 14
): (number | null)[] {
  const result: (number | null)[] = new Array(data.length).fill(null);
  if (data.length < period + 1) return result;

  // True Range計算
  const tr: number[] = [data[0].high - data[0].low];
  for (let i = 1; i < data.length; i++) {
    const hl = data[i].high - data[i].low;
    const hc = Math.abs(data[i].high - data[i - 1].close);
    const lc = Math.abs(data[i].low - data[i - 1].close);
    tr.push(Math.max(hl, hc, lc));
  }

  // 最初のATR = SMA
  let atr = tr.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  result[period] = Math.round(atr * 100) / 100;

  // Wilder's smoothing
  for (let i = period + 1; i < data.length; i++) {
    atr = (atr * (period - 1) + tr[i]) / period;
    result[i] = Math.round(atr * 100) / 100;
  }

  return result;
}

export function calcBollingerBands(
  data: PriceData[],
  period: number = 25
): BollingerPoint[] {
  const result: BollingerPoint[] = data.map(() => ({
    middle: null,
    upper1: null, lower1: null,
    upper2: null, lower2: null,
    upper3: null, lower3: null,
  }));

  if (data.length < period) return result;

  for (let i = period - 1; i < data.length; i++) {
    const slice = data.slice(i - period + 1, i + 1);
    const sum = slice.reduce((acc, d) => acc + d.close, 0);
    const mean = sum / period;

    const variance =
      slice.reduce((acc, d) => acc + (d.close - mean) ** 2, 0) / period;
    const stdDev = Math.sqrt(variance);
    const r = (v: number) => Math.round(v * 100) / 100;

    result[i] = {
      middle: r(mean),
      upper1: r(mean + stdDev),
      lower1: r(mean - stdDev),
      upper2: r(mean + 2 * stdDev),
      lower2: r(mean - 2 * stdDev),
      upper3: r(mean + 3 * stdDev),
      lower3: r(mean - 3 * stdDev),
    };
  }

  return result;
}

/**
 * シャープレシオ（価格データから直接算出）
 * 日次リターンの平均と標準偏差から年率化して計算。RFR = 0。
 */
export function calcSharpeRatioFromPrices(
  data: PriceData[],
  tradingDays: number = 252
): number | null {
  if (data.length < 20) return null;

  const returns: number[] = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i - 1].close > 0) {
      returns.push((data[i].close - data[i - 1].close) / data[i - 1].close);
    }
  }
  if (returns.length < 2) return null;

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((a, r) => a + (r - mean) ** 2, 0) / (returns.length - 1);
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return null;

  return Math.round((mean / stdDev) * Math.sqrt(tradingDays) * 100) / 100;
}

/**
 * マルチ期間シャープレシオ（3ヶ月/6ヶ月/1年）
 * 価格データの末尾から各期間分を切り出して年率化シャープを算出。
 */
export function calcMultiPeriodSharpe(
  data: PriceData[],
): { sharpe3m: number | null; sharpe6m: number | null; sharpe1y: number | null } {
  const calc = (days: number): number | null => {
    const slice = data.length > days ? data.slice(-days) : data;
    return calcSharpeRatioFromPrices(slice);
  };
  return {
    sharpe3m: calc(63),   // 約3ヶ月 (21日×3)
    sharpe6m: calc(126),  // 約6ヶ月 (21日×6)
    sharpe1y: calc(252),  // 約1年
  };
}

/** リターン抽出の種類 */
export type ReturnType = "close_to_close" | "open_to_close" | "close_to_open";

/**
 * 指定したリターン方式でシャープレシオを算出
 * - close_to_close: (今日終値 - 昨日終値) / 昨日終値  ← 通常
 * - open_to_close:  (今日終値 - 今日始値) / 今日始値    ← 日中リターン
 * - close_to_open:  (今日始値 - 昨日終値) / 昨日終値    ← オーバーナイトギャップ
 */
function extractReturns(data: PriceData[], type: ReturnType): number[] {
  const returns: number[] = [];
  for (let i = 1; i < data.length; i++) {
    let r: number | null = null;
    if (type === "close_to_close") {
      if (data[i - 1].close > 0) r = (data[i].close - data[i - 1].close) / data[i - 1].close;
    } else if (type === "open_to_close") {
      if (data[i].open > 0) r = (data[i].close - data[i].open) / data[i].open;
    } else if (type === "close_to_open") {
      if (data[i - 1].close > 0) r = (data[i].open - data[i - 1].close) / data[i - 1].close;
    }
    if (r != null) returns.push(r);
  }
  return returns;
}

function sharpeFromReturns(returns: number[], tradingDays: number = 252): number | null {
  if (returns.length < 2) return null;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, r) => a + (r - mean) ** 2, 0) / (returns.length - 1);
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return null;
  return Math.round((mean / stdDev) * Math.sqrt(tradingDays) * 100) / 100;
}

/**
 * 3種リターン × 3期間 のシャープレシオを一括算出
 */
export function calcAllReturnTypeSharpe(data: PriceData[]): Record<ReturnType, { m3: number | null; m6: number | null; y1: number | null }> {
  const types: ReturnType[] = ["close_to_close", "open_to_close", "close_to_open"];
  const periods = [
    { key: "m3" as const, days: 63 },
    { key: "m6" as const, days: 126 },
    { key: "y1" as const, days: 252 },
  ];
  const result = {} as Record<ReturnType, { m3: number | null; m6: number | null; y1: number | null }>;
  for (const type of types) {
    const row = { m3: null as number | null, m6: null as number | null, y1: null as number | null };
    for (const { key, days } of periods) {
      const slice = data.length > days ? data.slice(-days) : data;
      const returns = extractReturns(slice, type);
      row[key] = sharpeFromReturns(returns);
    }
    result[type] = row;
  }
  return result;
}

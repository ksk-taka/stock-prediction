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

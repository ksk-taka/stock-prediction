import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance();

interface PriceData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ── 指標計算 ──
function calcMA(data: PriceData[], window: number): (number | null)[] {
  return data.map((_, i) => {
    if (i < window - 1) return null;
    const sum = data.slice(i - window + 1, i + 1).reduce((a, d) => a + d.close, 0);
    return sum / window;
  });
}

function calcBB(data: PriceData[], period = 25) {
  return data.map((_, i) => {
    if (i < period - 1) return { lower2: null as number | null, lower3: null as number | null };
    const slice = data.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, d) => a + d.close, 0) / period;
    const variance = slice.reduce((a, d) => a + (d.close - mean) ** 2, 0) / period;
    const stdDev = Math.sqrt(variance);
    return { lower2: mean - 2 * stdDev, lower3: mean - 3 * stdDev };
  });
}

function calcATR(data: PriceData[], period: number = 14): (number | null)[] {
  const result: (number | null)[] = new Array(data.length).fill(null);
  if (data.length < period + 1) return result;
  const tr: number[] = [data[0].high - data[0].low];
  for (let i = 1; i < data.length; i++) {
    const hl = data[i].high - data[i].low;
    const hc = Math.abs(data[i].high - data[i - 1].close);
    const lc = Math.abs(data[i].low - data[i - 1].close);
    tr.push(Math.max(hl, hc, lc));
  }
  let atr = tr.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  result[period] = atr;
  for (let i = period + 1; i < data.length; i++) {
    atr = (atr * (period - 1) + tr[i]) / period;
    result[i] = atr;
  }
  return result;
}

function calcEMA(data: PriceData[], period: number): (number | null)[] {
  const k = 2 / (period + 1);
  const result: (number | null)[] = [];
  let ema: number | null = null;
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    if (ema === null) {
      ema = data.slice(0, period).reduce((a, d) => a + d.close, 0) / period;
    } else {
      ema = data[i].close * k + ema * (1 - k);
    }
    result.push(ema);
  }
  return result;
}

function calcRSI(data: PriceData[], period: number): (number | null)[] {
  const result: (number | null)[] = [null];
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i < data.length; i++) {
    const change = data[i].close - data[i - 1].close;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    if (i <= period) {
      avgGain += gain; avgLoss += loss;
      if (i === period) { avgGain /= period; avgLoss /= period; result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)); }
      else result.push(null);
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
    }
  }
  return result;
}

function calcMACD(data: PriceData[], short: number, long: number, sig: number) {
  const emaS = calcEMA(data, short);
  const emaL = calcEMA(data, long);
  const macdLine: (number | null)[] = data.map((_, i) =>
    emaS[i] != null && emaL[i] != null ? emaS[i]! - emaL[i]! : null
  );
  const k = 2 / (sig + 1);
  const signalLine: (number | null)[] = [];
  let sEma: number | null = null;
  let count = 0;
  for (let i = 0; i < macdLine.length; i++) {
    if (macdLine[i] == null) { signalLine.push(null); continue; }
    count++;
    if (count < sig) { signalLine.push(null); continue; }
    if (sEma === null) {
      const vals: number[] = [];
      for (let j = 0; j <= i; j++) { if (macdLine[j] != null) vals.push(macdLine[j]!); }
      sEma = vals.slice(-sig).reduce((a, v) => a + v, 0) / sig;
    } else {
      sEma = macdLine[i]! * k + sEma * (1 - k);
    }
    signalLine.push(sEma);
  }
  return { macd: macdLine, signal: signalLine };
}

// CWH検出
function detectCWH(data: PriceData[]): number[] {
  if (data.length < 30) return [];
  const PEAK_W = 5;
  const peaks: number[] = [];
  for (let i = PEAK_W; i < data.length - 1; i++) {
    let isPeak = true;
    for (let j = Math.max(0, i - PEAK_W); j <= Math.min(data.length - 1, i + PEAK_W); j++) {
      if (j !== i && data[j].high > data[i].high) { isPeak = false; break; }
    }
    if (isPeak) peaks.push(i);
  }
  const indices: number[] = [];
  for (let p1 = 0; p1 < peaks.length; p1++) {
    for (let p2 = p1 + 1; p2 < peaks.length; p2++) {
      const li = peaks[p1], ri = peaks[p2];
      const days = ri - li;
      if (days < 15 || days > 120) continue;
      const lh = data[li].high, rh = data[ri].high;
      if (Math.abs(lh - rh) / Math.max(lh, rh) > 0.06) continue;
      let bl = Infinity, bi = li + 1;
      for (let j = li + 1; j < ri; j++) { if (data[j].low < bl) { bl = data[j].low; bi = j; } }
      const rim = Math.max(lh, rh);
      const depth = (rim - bl) / rim;
      if (depth < 0.08 || depth > 0.50) continue;
      const bpos = (bi - li) / days;
      if (bpos < 0.15 || bpos > 0.85) continue;
      const end = Math.min(ri + 25, data.length - 1);
      let hLow = Infinity;
      for (let h = ri + 1; h <= end; h++) {
        if (data[h].low < hLow) hLow = data[h].low;
        if (h - ri < 3) continue;
        const pb = (rh - hLow) / rh;
        if (pb > 0.12) break;
        if (pb < 0.01) continue;
        if (data[h].close > rh && data[h].close > data[h].open) {
          indices.push(h);
          break;
        }
      }
    }
  }
  const deduped: number[] = [];
  for (const idx of indices) {
    if (deduped.length === 0 || idx - deduped[deduped.length - 1] > 3) deduped.push(idx);
  }
  return deduped;
}

// ── バックテストエンジン ──
type Signal = "buy" | "sell" | "hold";
interface Result {
  trades: number; wins: number; losses: number;
  totalPct: number; winRate: number; avgWin: number; avgLoss: number; pf: number;
}

function backtest(data: PriceData[], signals: Signal[]): Result {
  const roundTrips: { pct: number }[] = [];
  let inPosition = false;
  let entryPrice = 0;

  for (let i = 0; i < data.length; i++) {
    if (signals[i] === "buy" && !inPosition) {
      inPosition = true;
      entryPrice = data[i].close;
    } else if (signals[i] === "sell" && inPosition) {
      inPosition = false;
      roundTrips.push({ pct: ((data[i].close - entryPrice) / entryPrice) * 100 });
    }
  }

  const wins = roundTrips.filter((r) => r.pct > 0);
  const losses = roundTrips.filter((r) => r.pct <= 0);
  const totalPct = roundTrips.reduce((a, r) => a + r.pct, 0);
  const avgWin = wins.length > 0 ? wins.reduce((a, r) => a + r.pct, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((a, r) => a + r.pct, 0) / losses.length : 0;
  const grossProfit = wins.reduce((a, r) => a + r.pct, 0);
  const grossLoss = Math.abs(losses.reduce((a, r) => a + r.pct, 0));
  const pf = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  return {
    trades: roundTrips.length,
    wins: wins.length,
    losses: losses.length,
    totalPct: Math.round(totalPct * 100) / 100,
    winRate: roundTrips.length > 0 ? Math.round((wins.length / roundTrips.length) * 1000) / 10 : 0,
    avgWin: Math.round(avgWin * 100) / 100,
    avgLoss: Math.round(avgLoss * 100) / 100,
    pf: Math.round(pf * 100) / 100,
  };
}

// ── 戦略関数（パラメータ付き） ──

function maCross(data: PriceData[], shortP: number, longP: number): Signal[] {
  const shortMA = calcMA(data, shortP);
  const longMA = calcMA(data, longP);
  return data.map((_, i): Signal => {
    if (i < 1 || shortMA[i] == null || longMA[i] == null || shortMA[i - 1] == null || longMA[i - 1] == null) return "hold";
    if (shortMA[i - 1]! <= longMA[i - 1]! && shortMA[i]! > longMA[i]!) return "buy";
    if (shortMA[i - 1]! >= longMA[i - 1]! && shortMA[i]! < longMA[i]!) return "sell";
    return "hold";
  });
}

function rsiReversal(data: PriceData[], period: number, oversold: number, overbought: number, atrPeriod = 14, atrMultiple = 2, stopLossPct = 10): Signal[] {
  const rsi = calcRSI(data, period);
  const atr = calcATR(data, atrPeriod);
  let inPos = false;
  let entryPrice = 0;
  let stopLevel = 0;
  return data.map((d, i): Signal => {
    if (rsi[i] == null) return "hold";
    if (!inPos && rsi[i]! < oversold) {
      inPos = true;
      entryPrice = d.close;
      const atrStop = atr[i] != null ? entryPrice - atr[i]! * atrMultiple : 0;
      const pctStop = entryPrice * (1 - stopLossPct / 100);
      stopLevel = Math.max(atrStop, pctStop);
      return "buy";
    }
    if (inPos) {
      if (rsi[i]! > overbought) { inPos = false; return "sell"; }
      if (d.close <= stopLevel) { inPos = false; return "sell"; }
    }
    return "hold";
  });
}

function macdSignal(data: PriceData[], shortP: number, longP: number, sigP: number): Signal[] {
  const { macd, signal } = calcMACD(data, shortP, longP, sigP);
  return data.map((_, i): Signal => {
    if (i < 1 || macd[i] == null || signal[i] == null || macd[i - 1] == null || signal[i - 1] == null) return "hold";
    if (macd[i - 1]! <= signal[i - 1]! && macd[i]! > signal[i]!) return "buy";
    if (macd[i - 1]! >= signal[i - 1]! && macd[i]! < signal[i]!) return "sell";
    return "hold";
  });
}

function dipBuy(data: PriceData[], dipPct: number, recoveryPct: number, stopLossPct = 15): Signal[] {
  let peak = data[0]?.close ?? 0;
  let buyPrice = 0;
  let inPos = false;
  return data.map((d): Signal => {
    if (d.close > peak) peak = d.close;
    if (!inPos) {
      const dropPct = ((peak - d.close) / peak) * 100;
      if (dropPct >= dipPct) { inPos = true; buyPrice = d.close; return "buy"; }
    } else {
      const gainPct = ((d.close - buyPrice) / buyPrice) * 100;
      if (gainPct >= recoveryPct) { inPos = false; peak = d.close; return "sell"; }
      if (gainPct <= -stopLossPct) { inPos = false; peak = d.close; return "sell"; }
    }
    return "hold";
  });
}

function chorukoBB(data: PriceData[]): Signal[] {
  const bb = calcBB(data);
  const ma25 = calcMA(data, 25);
  let inPos = false, entryLow = 0, below = false;
  return data.map((d, i): Signal => {
    const l2 = bb[i]?.lower2;
    if (l2 == null) return "hold";
    if (!inPos) {
      if (d.close < l2) { below = true; return "hold"; }
      if (below && d.close > d.open) { inPos = true; entryLow = d.low; below = false; return "buy"; }
      if (d.close > l2) below = false;
    } else {
      if (ma25[i] != null && d.close >= ma25[i]!) { inPos = false; return "sell"; }
      if (d.close < entryLow) { inPos = false; return "sell"; }
    }
    return "hold";
  });
}

function chorukoShitabanare(data: PriceData[]): Signal[] {
  const bb = calcBB(data);
  let inPos = false, entryLow = 0, gapUp = 0;
  return data.map((d, i): Signal => {
    if (i < 2) return "hold";
    const l2 = bb[i]?.lower2;
    if (l2 == null) return "hold";
    if (!inPos) {
      const gap = data[i - 1].open < data[i - 2].low;
      const b1 = data[i - 1].close < data[i - 1].open;
      const b2 = d.close < d.open;
      if (gap && b1 && b2 && d.close <= l2 * 1.10) {
        inPos = true; entryLow = d.low; gapUp = data[i - 2].low;
        return "buy";
      }
    } else {
      if (d.close >= gapUp) { inPos = false; return "sell"; }
      if (d.close < entryLow) { inPos = false; return "sell"; }
    }
    return "hold";
  });
}

function dipKairi(data: PriceData[], entryK: number, exitK: number, slPct: number, tsDay: number): Signal[] {
  const ma25 = calcMA(data, 25);
  const ma5 = calcMA(data, 5);
  let inPos = false, entry = 0, entryIdx = 0;
  return data.map((d, i): Signal => {
    if (ma25[i] == null) return "hold";
    const kairi = ((d.close - ma25[i]!) / ma25[i]!) * 100;
    if (!inPos) {
      if (kairi <= entryK) { inPos = true; entry = d.close; entryIdx = i; return "buy"; }
    } else {
      const curKairi = ((d.close - ma25[i]!) / ma25[i]!) * 100;
      if (curKairi >= exitK) { inPos = false; return "sell"; }
      if (ma5[i] != null && d.close >= ma5[i]!) { inPos = false; return "sell"; }
      const loss = ((d.close - entry) / entry) * 100;
      if (loss <= -slPct) { inPos = false; return "sell"; }
      if (i - entryIdx >= tsDay && d.close <= entry) { inPos = false; return "sell"; }
    }
    return "hold";
  });
}

function dipRsiVol(data: PriceData[], rsiTh: number, volMul: number, rsiExit: number, tpPct: number): Signal[] {
  const rsi = calcRSI(data, 14);
  let inPos = false, entry = 0, entryLow = 0;
  return data.map((d, i): Signal => {
    if (i < 5 || rsi[i] == null) return "hold";
    const avgVol = data.slice(Math.max(0, i - 5), i).reduce((a, x) => a + x.volume, 0) / 5;
    if (!inPos) {
      if (rsi[i]! <= rsiTh && d.volume >= avgVol * volMul) {
        inPos = true; entry = d.close; entryLow = d.low;
        return "buy";
      }
    } else {
      if (rsi[i]! >= rsiExit) { inPos = false; return "sell"; }
      const gain = ((d.close - entry) / entry) * 100;
      if (gain >= tpPct) { inPos = false; return "sell"; }
      if (d.close < entryLow) { inPos = false; return "sell"; }
    }
    return "hold";
  });
}

function dipBB3(data: PriceData[], slPct: number): Signal[] {
  const bb = calcBB(data);
  let inPos = false, entry = 0;
  return data.map((d, i): Signal => {
    const l3 = bb[i]?.lower3;
    const l2 = bb[i]?.lower2;
    if (l3 == null || l2 == null) return "hold";
    if (!inPos) {
      if (d.close <= l3) { inPos = true; entry = d.close; return "buy"; }
    } else {
      if (d.close >= l2) { inPos = false; return "sell"; }
      const loss = ((d.close - entry) / entry) * 100;
      if (loss <= -slPct) { inPos = false; return "sell"; }
    }
    return "hold";
  });
}

function tabataCWH(data: PriceData[], tpPct: number, slPct: number): Signal[] {
  const cwhIdx = new Set(detectCWH(data));
  let inPos = false, entry = 0;
  return data.map((d, i): Signal => {
    if (!inPos) {
      if (cwhIdx.has(i)) { inPos = true; entry = d.close; return "buy"; }
    } else {
      if (d.close >= entry * (1 + tpPct / 100)) { inPos = false; return "sell"; }
      if (d.close <= entry * (1 - slPct / 100)) { inPos = false; return "sell"; }
    }
    return "hold";
  });
}

// ── パラメータグリッド定義 ──
interface ParamCombo {
  label: string;
  params: Record<string, number>;
}

interface StrategyGrid {
  id: string;
  name: string;
  defaults: Record<string, number>;
  grid: ParamCombo[];
  run: (data: PriceData[], params: Record<string, number>) => Signal[];
}

function range(start: number, end: number, step: number): number[] {
  const arr: number[] = [];
  for (let v = start; v <= end + step * 0.01; v += step) arr.push(Math.round(v * 100) / 100);
  return arr;
}

function cartesian(...arrays: number[][]): number[][] {
  return arrays.reduce<number[][]>(
    (acc, arr) => acc.flatMap((combo) => arr.map((v) => [...combo, v])),
    [[]]
  );
}

const strategyGrids: StrategyGrid[] = [
  {
    id: "ma_cross",
    name: "MAクロス",
    defaults: { shortPeriod: 5, longPeriod: 25 },
    grid: cartesian(
      [3, 5, 8, 10, 13, 15, 20],
      [15, 20, 25, 30, 50, 75, 100]
    )
      .filter(([s, l]) => s < l)
      .map(([s, l]) => ({ label: `S${s}/L${l}`, params: { shortPeriod: s, longPeriod: l } })),
    run: (d, p) => maCross(d, p.shortPeriod, p.longPeriod),
  },
  {
    id: "rsi_reversal",
    name: "RSI逆張り",
    defaults: { period: 14, oversold: 30, overbought: 70, atrPeriod: 14, atrMultiple: 2, stopLossPct: 10 },
    grid: cartesian(
      [7, 10, 14, 20],
      [20, 25, 30, 35, 40],
      [60, 65, 70, 75, 80],
      [1.5, 2, 3],
      [8, 10, 15]
    ).map(([p, os, ob, atrM, sl]) => ({
      label: `P${p}/OS${os}/OB${ob}/ATR${atrM}/SL${sl}`,
      params: { period: p, oversold: os, overbought: ob, atrPeriod: 14, atrMultiple: atrM, stopLossPct: sl },
    })),
    run: (d, p) => rsiReversal(d, p.period, p.oversold, p.overbought, p.atrPeriod, p.atrMultiple, p.stopLossPct),
  },
  {
    id: "macd_signal",
    name: "MACDシグナル",
    defaults: { shortPeriod: 12, longPeriod: 26, signalPeriod: 9 },
    grid: cartesian(
      [8, 10, 12, 15],
      [20, 24, 26, 30],
      [5, 7, 9, 12]
    )
      .filter(([s, l]) => s < l)
      .map(([s, l, sig]) => ({
        label: `S${s}/L${l}/Sig${sig}`,
        params: { shortPeriod: s, longPeriod: l, signalPeriod: sig },
      })),
    run: (d, p) => macdSignal(d, p.shortPeriod, p.longPeriod, p.signalPeriod),
  },
  {
    id: "dip_buy",
    name: "急落買い(旧)",
    defaults: { dipPct: 10, recoveryPct: 15, stopLossPct: 15 },
    grid: cartesian(
      [3, 5, 7, 10, 15, 20],
      [5, 8, 10, 15, 20, 30],
      [10, 15, 20]
    ).map(([dip, rec, sl]) => ({
      label: `Dip${dip}%/Rec${rec}%/SL${sl}%`,
      params: { dipPct: dip, recoveryPct: rec, stopLossPct: sl },
    })),
    run: (d, p) => dipBuy(d, p.dipPct, p.recoveryPct, p.stopLossPct),
  },
  {
    id: "dip_kairi",
    name: "急落買い(乖離率)",
    defaults: { entryKairi: -10, exitKairi: -5, stopLossPct: 7, timeStopDays: 5 },
    grid: cartesian(
      [-15, -12, -10, -8, -6],
      [-8, -5, -3, 0],
      [5, 7, 10],
      [3, 5, 7, 10]
    )
      .filter(([ek, xk]) => ek < xk)
      .map(([ek, xk, sl, ts]) => ({
        label: `E${ek}/X${xk}/SL${sl}/TS${ts}`,
        params: { entryKairi: ek, exitKairi: xk, stopLossPct: sl, timeStopDays: ts },
      })),
    run: (d, p) => dipKairi(d, p.entryKairi, p.exitKairi, p.stopLossPct, p.timeStopDays),
  },
  {
    id: "dip_rsi_volume",
    name: "急落買い(RSI+出来高)",
    defaults: { rsiThreshold: 20, volumeMultiple: 2, rsiExit: 40, takeProfitPct: 5 },
    grid: cartesian(
      [15, 20, 25, 30, 35],
      [1.2, 1.5, 2, 3],
      [35, 40, 50, 60],
      [3, 5, 8, 10, 15]
    ).map(([rsiTh, vol, rsiEx, tp]) => ({
      label: `RSI${rsiTh}/V${vol}x/Ex${rsiEx}/TP${tp}%`,
      params: { rsiThreshold: rsiTh, volumeMultiple: vol, rsiExit: rsiEx, takeProfitPct: tp },
    })),
    run: (d, p) => dipRsiVol(d, p.rsiThreshold, p.volumeMultiple, p.rsiExit, p.takeProfitPct),
  },
  {
    id: "dip_bb3sigma",
    name: "急落買い(BB-3σ)",
    defaults: { stopLossPct: 5 },
    grid: range(2, 10, 1).map((sl) => ({
      label: `SL${sl}%`,
      params: { stopLossPct: sl },
    })),
    run: (d, p) => dipBB3(d, p.stopLossPct),
  },
  {
    id: "tabata_cwh",
    name: "田端式CWH",
    defaults: { takeProfitPct: 20, stopLossPct: 7 },
    grid: cartesian(
      [5, 10, 15, 20, 25, 30, 40],
      [3, 5, 7, 10, 15]
    ).map(([tp, sl]) => ({
      label: `TP${tp}%/SL${sl}%`,
      params: { takeProfitPct: tp, stopLossPct: sl },
    })),
    run: (d, p) => tabataCWH(d, p.takeProfitPct, p.stopLossPct),
  },
];

// パラメータなし戦略（参考値として出力）
const fixedStrategies = [
  { id: "choruko_bb", name: "BB逆張り", run: (d: PriceData[]) => chorukoBB(d) },
  { id: "choruko_shitabanare", name: "下放れ二本黒", run: (d: PriceData[]) => chorukoShitabanare(d) },
];

// ── 評価スコア: 勝率 × trade頻度ボーナス + 収益考慮 ──
// ── メイン ──
async function main() {
  const stocks = [
    { symbol: "7203.T", name: "トヨタ自動車" },
    { symbol: "7011.T", name: "三菱重工業" },
    { symbol: "6701.T", name: "NEC" },
    { symbol: "6503.T", name: "三菱電機" },
    { symbol: "6758.T", name: "ソニーG" },
    { symbol: "8035.T", name: "東京エレクトロン" },
    { symbol: "8306.T", name: "三菱UFJ" },
    { symbol: "1605.T", name: "INPEX" },
    { symbol: "6501.T", name: "日立製作所" },
    { symbol: "6920.T", name: "レーザーテック" },
    { symbol: "6526.T", name: "ソシオネクスト" },
    { symbol: "6723.T", name: "ルネサス" },
    { symbol: "285A.T", name: "キオクシア" },
    { symbol: "3993.T", name: "PKSHA" },
    { symbol: "3778.T", name: "さくらインターネット" },
    { symbol: "9613.T", name: "NTTデータG" },
    { symbol: "7014.T", name: "名村造船所" },
    { symbol: "7003.T", name: "三井E&S" },
    { symbol: "7012.T", name: "川崎重工業" },
    { symbol: "9101.T", name: "日本郵船" },
    { symbol: "9104.T", name: "商船三井" },
    { symbol: "6702.T", name: "富士通" },
    { symbol: "6965.T", name: "浜松ホトニクス" },
    { symbol: "2802.T", name: "味の素" },
    { symbol: "4202.T", name: "ダイセル" },
    { symbol: "4118.T", name: "カネカ" },
    { symbol: "4151.T", name: "協和キリン" },
    { symbol: "7013.T", name: "IHI" },
    { symbol: "186A.T", name: "アストロスケールHD" },
    { symbol: "5765.T", name: "QPS研究所" },
    { symbol: "9432.T", name: "NTT" },
    { symbol: "4704.T", name: "トレンドマイクロ" },
    { symbol: "3857.T", name: "ラック" },
    { symbol: "2326.T", name: "デジタルアーツ" },
    { symbol: "3692.T", name: "FFRIセキュリティ" },
    { symbol: "7974.T", name: "任天堂" },
    { symbol: "7832.T", name: "バンナムHD" },
    { symbol: "4816.T", name: "東映アニメーション" },
    { symbol: "9468.T", name: "KADOKAWA" },
    { symbol: "4751.T", name: "サイバーエージェント" },
    { symbol: "6326.T", name: "クボタ" },
    { symbol: "6310.T", name: "井関農機" },
    { symbol: "2897.T", name: "日清食品HD" },
    { symbol: "1333.T", name: "マルハニチロ" },
    { symbol: "2931.T", name: "ユーグレナ" },
    { symbol: "5020.T", name: "ENEOS HD" },
    { symbol: "4204.T", name: "積水化学工業" },
    { symbol: "9531.T", name: "東京ガス" },
    { symbol: "9532.T", name: "大阪ガス" },
    { symbol: "9519.T", name: "レノバ" },
    { symbol: "1801.T", name: "大成建設" },
    { symbol: "1812.T", name: "鹿島建設" },
    { symbol: "1802.T", name: "大林組" },
    { symbol: "1803.T", name: "清水建設" },
    { symbol: "1721.T", name: "コムシスHD" },
    { symbol: "9755.T", name: "応用地質" },
    { symbol: "7821.T", name: "前田工繊" },
    { symbol: "4519.T", name: "中外製薬" },
    { symbol: "4568.T", name: "第一三共" },
    { symbol: "4502.T", name: "武田薬品" },
    { symbol: "4523.T", name: "エーザイ" },
    { symbol: "4587.T", name: "ペプチドリーム" },
    { symbol: "4565.T", name: "そーせいG" },
    { symbol: "7711.T", name: "助川電気工業" },
    { symbol: "4026.T", name: "神島化学工業" },
    { symbol: "5310.T", name: "東洋炭素" },
    { symbol: "5713.T", name: "住友金属鉱山" },
    { symbol: "4063.T", name: "信越化学工業" },
    { symbol: "6988.T", name: "日東電工" },
    { symbol: "5706.T", name: "三井金属鉱業" },
    { symbol: "6269.T", name: "三井海洋開発" },
    { symbol: "9301.T", name: "三菱倉庫" },
    { symbol: "9303.T", name: "住友倉庫" },
    { symbol: "1893.T", name: "五洋建設" },
    { symbol: "1890.T", name: "東洋建設" },
    { symbol: "7701.T", name: "島津製作所" },
    { symbol: "7721.T", name: "東京計器" },
    { symbol: "9433.T", name: "KDDI" },
    { symbol: "9434.T", name: "ソフトバンク" },
    { symbol: "5803.T", name: "フジクラ" },
    { symbol: "5802.T", name: "住友電工" },
    { symbol: "6330.T", name: "東洋エンジニアリング" },
    { symbol: "6814.T", name: "古野電気" },
  ];

  const periods = [
    { label: "日足(3年)", interval: "1d" as const, years: 3 },
    { label: "週足(3年)", interval: "1wk" as const, years: 3 },
  ];

  // データ取得（全銘柄 × 全期間）
  console.log("== データ取得中 ==");
  const allData: Map<string, PriceData[]> = new Map();

  for (const period of periods) {
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - period.years);

    for (const stock of stocks) {
      const key = `${stock.symbol}_${period.interval}`;
      try {
        const result = await yf.historical(stock.symbol, {
          period1: startDate,
          period2: new Date(),
          interval: period.interval,
        });
        const data: PriceData[] = result
          .filter((r) => (r.open ?? 0) > 0)
          .map((r) => ({
            date: r.date instanceof Date ? r.date.toISOString().split("T")[0] : String(r.date),
            open: r.open ?? 0,
            high: r.high ?? 0,
            low: r.low ?? 0,
            close: r.close ?? 0,
            volume: r.volume ?? 0,
          }));
        allData.set(key, data);
        process.stdout.write(".");
      } catch (e: any) {
        console.log(`\n  ${stock.name}(${period.label}): エラー ${e.message}`);
      }
    }
  }
  console.log("\nデータ取得完了\n");

  // ── パラメータなし戦略の参考値 ──
  console.log("=".repeat(120));
  console.log("  パラメータ固定戦略（参考値）");
  console.log("=".repeat(120));

  for (const strat of fixedStrategies) {
    console.log(`\n--- ${strat.name} ---`);
    for (const period of periods) {
      let totalTrades = 0, totalWins = 0, totalPctSum = 0, stockCount = 0;
      console.log(`  [${period.label}]`);
      for (const stock of stocks) {
        const key = `${stock.symbol}_${period.interval}`;
        const data = allData.get(key);
        if (!data) continue;
        const signals = strat.run(data);
        const r = backtest(data, signals);
        if (r.trades > 0) {
          console.log(`    ${stock.name}: ${r.wins}勝${r.losses}敗 WR=${r.winRate}% 合計${r.totalPct > 0 ? "+" : ""}${r.totalPct}% PF=${r.pf}`);
          totalTrades += r.trades;
          totalWins += r.wins;
          totalPctSum += r.totalPct;
          stockCount++;
        }
      }
      if (totalTrades > 0) {
        console.log(`    → 全体: ${totalWins}勝${totalTrades - totalWins}敗 WR=${(totalWins / totalTrades * 100).toFixed(1)}% 合計${totalPctSum > 0 ? "+" : ""}${totalPctSum.toFixed(1)}%`);
      }
    }
  }

  // ── グリッドサーチ ──
  for (const strat of strategyGrids) {
    console.log(`\n${"=".repeat(120)}`);
    console.log(`  ${strat.name} (${strat.id}) - ${strat.grid.length}パターン探索`);
    console.log(`  デフォルト: ${JSON.stringify(strat.defaults)}`);
    console.log(`${"=".repeat(120)}`);

    for (const period of periods) {
      console.log(`\n  [${period.label}]`);

      // 各パラメータ組合せの全銘柄合算成績を集計
      interface AggResult {
        combo: ParamCombo;
        totalTrades: number;
        totalWins: number;
        totalLosses: number;
        totalPctSum: number;
        avgWinRate: number;
        stockResults: { name: string; result: Result }[];
      }

      const aggResults: AggResult[] = [];
      let defaultAgg: AggResult | null = null;

      for (const combo of strat.grid) {
        let totalTrades = 0, totalWins = 0, totalLosses = 0, totalPctSum = 0;
        const stockResults: { name: string; result: Result }[] = [];

        for (const stock of stocks) {
          const key = `${stock.symbol}_${period.interval}`;
          const data = allData.get(key);
          if (!data) continue;
          const signals = strat.run(data, combo.params);
          const r = backtest(data, signals);
          totalTrades += r.trades;
          totalWins += r.wins;
          totalLosses += r.losses;
          totalPctSum += r.totalPct;
          stockResults.push({ name: stock.name, result: r });
        }

        const avgWinRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0;

        aggResults.push({
          combo,
          totalTrades,
          totalWins,
          totalLosses,
          totalPctSum: Math.round(totalPctSum * 100) / 100,
          avgWinRate: Math.round(avgWinRate * 10) / 10,
          stockResults,
        });
      }

      // デフォルト params の成績
      {
        let totalTrades = 0, totalWins = 0, totalLosses = 0, totalPctSum = 0;
        const stockResults: { name: string; result: Result }[] = [];
        for (const stock of stocks) {
          const key = `${stock.symbol}_${period.interval}`;
          const data = allData.get(key);
          if (!data) continue;
          const signals = strat.run(data, strat.defaults);
          const r = backtest(data, signals);
          totalTrades += r.trades;
          totalWins += r.wins;
          totalLosses += r.losses;
          totalPctSum += r.totalPct;
          stockResults.push({ name: stock.name, result: r });
        }
        const avgWinRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0;
        defaultAgg = {
          combo: { label: "DEFAULT", params: strat.defaults },
          totalTrades,
          totalWins,
          totalLosses,
          totalPctSum: Math.round(totalPctSum * 100) / 100,
          avgWinRate: Math.round(avgWinRate * 10) / 10,
          stockResults,
        };
      }

      // スコア順ソート
      const scored = aggResults
        .filter((a) => a.totalTrades >= 3)
        .sort((a, b) => {
          // 勝率 → PF相当(利益/損失) → 総収益
          if (b.avgWinRate !== a.avgWinRate) return b.avgWinRate - a.avgWinRate;
          return b.totalPctSum - a.totalPctSum;
        });

      // トップ5表示
      console.log(`  ── トップ5パラメータ (勝率順) ──`);
      console.log(`  ${"パラメータ".padEnd(35)} ${"取引数".padStart(6)} ${"勝".padStart(4)} ${"敗".padStart(4)} ${"勝率".padStart(8)} ${"合計収益".padStart(12)}`);
      console.log(`  ${"-".repeat(80)}`);

      // デフォルト表示
      if (defaultAgg) {
        const d = defaultAgg;
        const sign = d.totalPctSum >= 0 ? "+" : "";
        console.log(
          `  ${"★DEFAULT ".padEnd(35)} ${String(d.totalTrades).padStart(6)} ${String(d.totalWins).padStart(4)} ${String(d.totalLosses).padStart(4)} ${(d.avgWinRate + "%").padStart(8)} ${(sign + d.totalPctSum + "%").padStart(12)}`
        );
      }

      for (let rank = 0; rank < Math.min(5, scored.length); rank++) {
        const a = scored[rank];
        const sign = a.totalPctSum >= 0 ? "+" : "";
        const isDefault = JSON.stringify(a.combo.params) === JSON.stringify(strat.defaults);
        const marker = isDefault ? " ★" : "";
        console.log(
          `  ${(rank + 1 + ". " + a.combo.label + marker).padEnd(35)} ${String(a.totalTrades).padStart(6)} ${String(a.totalWins).padStart(4)} ${String(a.totalLosses).padStart(4)} ${(a.avgWinRate + "%").padStart(8)} ${(sign + a.totalPctSum + "%").padStart(12)}`
        );
      }

      // ベスト vs デフォルト比較
      if (scored.length > 0 && defaultAgg) {
        const best = scored[0];
        const d = defaultAgg;
        const wrDiff = best.avgWinRate - d.avgWinRate;
        const pctDiff = best.totalPctSum - d.totalPctSum;
        console.log(`\n  >>> ベスト: ${best.combo.label}`);
        console.log(`      パラメータ: ${JSON.stringify(best.combo.params)}`);
        console.log(`      勝率: ${best.avgWinRate}% (デフォルト ${d.avgWinRate}%, ${wrDiff >= 0 ? "+" : ""}${wrDiff.toFixed(1)}pt)`);
        console.log(`      収益: ${best.totalPctSum > 0 ? "+" : ""}${best.totalPctSum}% (デフォルト ${d.totalPctSum > 0 ? "+" : ""}${d.totalPctSum}%, ${pctDiff >= 0 ? "+" : ""}${pctDiff.toFixed(1)}pt)`);

        // ベストパラメータの銘柄別内訳
        console.log(`\n  ── ベストパラメータ 銘柄別内訳 ──`);
        for (const sr of best.stockResults) {
          const r = sr.result;
          if (r.trades > 0) {
            console.log(
              `    ${sr.name.padEnd(14)} ${r.wins}勝${r.losses}敗 WR=${r.winRate}% 合計${r.totalPct > 0 ? "+" : ""}${r.totalPct}% PF=${r.pf} 平均勝ち+${r.avgWin}% 平均負け${r.avgLoss}%`
            );
          } else {
            console.log(`    ${sr.name.padEnd(14)} シグナルなし`);
          }
        }
      }

      // 勝率だけでなく収益面でのベストも表示
      const byProfit = [...aggResults]
        .filter((a) => a.totalTrades >= 3)
        .sort((a, b) => b.totalPctSum - a.totalPctSum);

      if (byProfit.length > 0 && byProfit[0].combo.label !== scored[0]?.combo.label) {
        const bp = byProfit[0];
        console.log(`\n  >>> 収益最大: ${bp.combo.label}`);
        console.log(`      パラメータ: ${JSON.stringify(bp.combo.params)}`);
        console.log(`      勝率: ${bp.avgWinRate}%, 収益: ${bp.totalPctSum > 0 ? "+" : ""}${bp.totalPctSum}%`);
      }
    }
  }

  // ── 最終サマリー ──
  console.log(`\n\n${"#".repeat(120)}`);
  console.log(`  最適パラメータ サマリー`);
  console.log(`${"#".repeat(120)}`);

  for (const strat of strategyGrids) {
    console.log(`\n${strat.name} (${strat.id}):`);
    console.log(`  デフォルト: ${JSON.stringify(strat.defaults)}`);

    for (const period of periods) {
      const results: { combo: ParamCombo; totalTrades: number; totalWins: number; totalPctSum: number }[] = [];

      for (const combo of strat.grid) {
        let totalTrades = 0, totalWins = 0, totalPctSum = 0;
        for (const stock of stocks) {
          const key = `${stock.symbol}_${period.interval}`;
          const data = allData.get(key);
          if (!data) continue;
          const signals = strat.run(data, combo.params);
          const r = backtest(data, signals);
          totalTrades += r.trades;
          totalWins += r.wins;
          totalPctSum += r.totalPct;
        }
        results.push({ combo, totalTrades, totalWins, totalPctSum });
      }

      const best = results.filter((r) => r.totalTrades >= 3).sort((a, b) => {
        const wrA = a.totalTrades > 0 ? (a.totalWins / a.totalTrades) * 100 : 0;
        const wrB = b.totalTrades > 0 ? (b.totalWins / b.totalTrades) * 100 : 0;
        if (wrB !== wrA) return wrB - wrA;
        return b.totalPctSum - a.totalPctSum;
      })[0];

      if (best) {
        const wr = best.totalTrades > 0 ? ((best.totalWins / best.totalTrades) * 100).toFixed(1) : "0";
        console.log(`  ${period.label}: ${JSON.stringify(best.combo.params)} → WR=${wr}% 収益${best.totalPctSum > 0 ? "+" : ""}${best.totalPctSum.toFixed(1)}% (${best.totalTrades}trades)`);
      }
    }
  }
}

main();

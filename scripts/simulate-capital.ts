/**
 * 元本100万円シミュレーション
 * 各戦略×最適化パラメータで全銘柄×日足/週足を回し、
 * 具体的な金額（最終資産、最大ドローダウン額、最大単一損失額）を表示
 */
import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance({ suppressNotices: ["ripHistorical"] });
const INITIAL_CAPITAL = 1_000_000; // 100万円

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

type Signal = "buy" | "sell" | "hold";

// ── 戦略関数（最適化パラメータ版）──

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

function rsiReversal(data: PriceData[], period: number, oversold: number, overbought: number): Signal[] {
  const rsi = calcRSI(data, period);
  let inPos = false;
  return data.map((_, i): Signal => {
    if (rsi[i] == null) return "hold";
    if (!inPos && rsi[i]! < oversold) { inPos = true; return "buy"; }
    if (inPos && rsi[i]! > overbought) { inPos = false; return "sell"; }
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

function dipBuy(data: PriceData[], dipPct: number, recoveryPct: number): Signal[] {
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

// ── 資金シミュレーション（全額投入型） ──
interface TradeLog {
  buyDate: string;
  sellDate: string;
  buyPrice: number;
  sellPrice: number;
  shares: number;
  pnl: number;        // 損益額(円)
  pnlPct: number;     // 損益率(%)
  capitalBefore: number;
  capitalAfter: number;
}

interface SimResult {
  trades: TradeLog[];
  finalCapital: number;
  maxDrawdown: number;       // 最大ドローダウン額(円)
  maxDrawdownPct: number;    // 最大ドローダウン率(%)
  maxSingleLoss: number;     // 最大単一損失額(円)
  maxSingleLossPct: number;  // 最大単一損失率(%)
  winRate: number;
  totalReturn: number;       // 最終リターン額(円)
  totalReturnPct: number;
}

function simulateCapital(data: PriceData[], signals: Signal[], initialCapital: number): SimResult {
  const trades: TradeLog[] = [];
  let capital = initialCapital;
  let shares = 0;
  let buyPrice = 0;
  let buyDate = "";
  let capitalBefore = 0;
  let peakCapital = initialCapital;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;
  let maxSingleLoss = 0;
  let maxSingleLossPct = 0;

  for (let i = 0; i < data.length; i++) {
    if (signals[i] === "buy" && shares === 0) {
      buyPrice = data[i].close;
      buyDate = data[i].date;
      // 全額投入（端数切り捨て）
      shares = Math.floor(capital / buyPrice);
      if (shares <= 0) continue;
      capitalBefore = capital;
      capital -= shares * buyPrice;
    } else if (signals[i] === "sell" && shares > 0) {
      const sellValue = shares * data[i].close;
      const pnl = sellValue - shares * buyPrice;
      const pnlPct = ((data[i].close - buyPrice) / buyPrice) * 100;
      capital += sellValue;

      trades.push({
        buyDate,
        sellDate: data[i].date,
        buyPrice,
        sellPrice: data[i].close,
        shares,
        pnl: Math.round(pnl),
        pnlPct: Math.round(pnlPct * 100) / 100,
        capitalBefore,
        capitalAfter: Math.round(capital),
      });

      // 損失記録
      if (pnl < maxSingleLoss) {
        maxSingleLoss = pnl;
        maxSingleLossPct = pnlPct;
      }

      // ドローダウン計算
      if (capital > peakCapital) peakCapital = capital;
      const dd = peakCapital - capital;
      const ddPct = (dd / peakCapital) * 100;
      if (dd > maxDrawdown) {
        maxDrawdown = dd;
        maxDrawdownPct = ddPct;
      }

      shares = 0;
    }

    // ポジション保有中のドローダウンも考慮
    if (shares > 0) {
      const currentValue = capital + shares * data[i].close;
      if (currentValue > peakCapital) peakCapital = currentValue;
      const dd = peakCapital - currentValue;
      const ddPct = (dd / peakCapital) * 100;
      if (dd > maxDrawdown) {
        maxDrawdown = dd;
        maxDrawdownPct = ddPct;
      }
    }
  }

  // 未決済ポジションは最終日で時価計算
  const finalCapital = shares > 0
    ? capital + shares * data[data.length - 1].close
    : capital;

  const wins = trades.filter((t) => t.pnl > 0).length;

  return {
    trades,
    finalCapital: Math.round(finalCapital),
    maxDrawdown: Math.round(maxDrawdown),
    maxDrawdownPct: Math.round(maxDrawdownPct * 10) / 10,
    maxSingleLoss: Math.round(maxSingleLoss),
    maxSingleLossPct: Math.round(maxSingleLossPct * 100) / 100,
    winRate: trades.length > 0 ? Math.round((wins / trades.length) * 1000) / 10 : 0,
    totalReturn: Math.round(finalCapital - initialCapital),
    totalReturnPct: Math.round(((finalCapital - initialCapital) / initialCapital) * 1000) / 10,
  };
}

// ── メイン ──
async function main() {
  const stocks = [
    { symbol: "7203.T", name: "トヨタ" },
    { symbol: "7011.T", name: "三菱重工" },
    { symbol: "6701.T", name: "NEC" },
    { symbol: "6503.T", name: "三菱電機" },
    { symbol: "6758.T", name: "ソニーG" },
    { symbol: "8035.T", name: "東エレク" },
    { symbol: "8306.T", name: "三菱UFJ" },
    { symbol: "1605.T", name: "INPEX" },
    { symbol: "6501.T", name: "日立" },
    { symbol: "6920.T", name: "レーザーテック" },
    { symbol: "6526.T", name: "ソシオネクスト" },
    { symbol: "6723.T", name: "ルネサス" },
    { symbol: "285A.T", name: "キオクシア" },
    { symbol: "3993.T", name: "PKSHA" },
    { symbol: "3778.T", name: "さくらネット" },
    { symbol: "9613.T", name: "NTTデータG" },
    { symbol: "7014.T", name: "名村造船" },
    { symbol: "7003.T", name: "三井E&S" },
    { symbol: "7012.T", name: "川崎重工" },
    { symbol: "9101.T", name: "日本郵船" },
    { symbol: "9104.T", name: "商船三井" },
    { symbol: "6702.T", name: "富士通" },
    { symbol: "6965.T", name: "浜松ホトニクス" },
    { symbol: "2802.T", name: "味の素" },
    { symbol: "4202.T", name: "ダイセル" },
    { symbol: "4118.T", name: "カネカ" },
    { symbol: "4151.T", name: "協和キリン" },
    { symbol: "7013.T", name: "IHI" },
    { symbol: "186A.T", name: "アストロスケール" },
    { symbol: "5765.T", name: "QPS研究所" },
    { symbol: "9432.T", name: "NTT" },
    { symbol: "4704.T", name: "トレンドマイクロ" },
    { symbol: "3857.T", name: "ラック" },
    { symbol: "2326.T", name: "デジタルアーツ" },
    { symbol: "3692.T", name: "FFRI" },
    { symbol: "7974.T", name: "任天堂" },
    { symbol: "7832.T", name: "バンナム" },
    { symbol: "4816.T", name: "東映アニメ" },
    { symbol: "9468.T", name: "KADOKAWA" },
    { symbol: "4751.T", name: "サイバーA" },
    { symbol: "6326.T", name: "クボタ" },
    { symbol: "6310.T", name: "井関農機" },
    { symbol: "2897.T", name: "日清食品" },
    { symbol: "1333.T", name: "マルハニチロ" },
    { symbol: "2931.T", name: "ユーグレナ" },
    { symbol: "5020.T", name: "ENEOS" },
    { symbol: "4204.T", name: "積水化学" },
    { symbol: "9531.T", name: "東京ガス" },
    { symbol: "9532.T", name: "大阪ガス" },
    { symbol: "9519.T", name: "レノバ" },
    { symbol: "1801.T", name: "大成建設" },
    { symbol: "1812.T", name: "鹿島建設" },
    { symbol: "1802.T", name: "大林組" },
    { symbol: "1803.T", name: "清水建設" },
    { symbol: "1721.T", name: "コムシス" },
    { symbol: "9755.T", name: "応用地質" },
    { symbol: "7821.T", name: "前田工繊" },
    { symbol: "4519.T", name: "中外製薬" },
    { symbol: "4568.T", name: "第一三共" },
    { symbol: "4502.T", name: "武田薬品" },
    { symbol: "4523.T", name: "エーザイ" },
    { symbol: "4587.T", name: "ペプチドリーム" },
    { symbol: "4565.T", name: "そーせい" },
    { symbol: "7711.T", name: "助川電気" },
    { symbol: "4026.T", name: "神島化学" },
    { symbol: "5310.T", name: "東洋炭素" },
    { symbol: "5713.T", name: "住友鉱山" },
    { symbol: "4063.T", name: "信越化学" },
    { symbol: "6988.T", name: "日東電工" },
    { symbol: "5706.T", name: "三井金属" },
    { symbol: "6269.T", name: "三井海洋" },
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
    { symbol: "6330.T", name: "東洋エンジ" },
    { symbol: "6814.T", name: "古野電気" },
  ];

  const periods = [
    { label: "日足(3年)", interval: "1d" as const, years: 3 },
    { label: "週足(3年)", interval: "1wk" as const, years: 3 },
  ];

  // 全戦略（最適化パラメータ）
  const strats: {
    id: string;
    name: string;
    fn: (d: PriceData[], interval: string) => Signal[];
    paramLabel: (interval: string) => string;
  }[] = [
    {
      id: "ma_cross", name: "MAクロス",
      fn: (d, iv) => iv === "1d" ? maCross(d, 20, 50) : maCross(d, 10, 20),
      paramLabel: (iv) => iv === "1d" ? "S20/L50" : "S10/L20",
    },
    {
      id: "rsi_reversal", name: "RSI逆張り",
      fn: (d, iv) => iv === "1d" ? rsiReversal(d, 10, 20, 80) : rsiReversal(d, 10, 40, 75),
      paramLabel: (iv) => iv === "1d" ? "P10/OS20/OB80" : "P10/OS40/OB75",
    },
    {
      id: "macd_signal", name: "MACDシグナル",
      fn: (d, iv) => iv === "1d" ? macdSignal(d, 10, 20, 9) : macdSignal(d, 10, 30, 12),
      paramLabel: (iv) => iv === "1d" ? "S10/L20/Sig9" : "S10/L30/Sig12",
    },
    {
      id: "dip_buy", name: "急落買い",
      fn: (d, iv) => iv === "1d" ? dipBuy(d, 3, 15) : dipBuy(d, 3, 30),
      paramLabel: (iv) => iv === "1d" ? "Dip3%/Rec15%" : "Dip3%/Rec30%",
    },
    {
      id: "choruko_bb", name: "BB逆張り",
      fn: (d) => chorukoBB(d),
      paramLabel: () => "固定",
    },
    {
      id: "choruko_shitabanare", name: "下放れ",
      fn: (d) => chorukoShitabanare(d),
      paramLabel: () => "固定",
    },
    {
      id: "dip_kairi", name: "急落(乖離率)",
      fn: (d, iv) => iv === "1d" ? dipKairi(d, -8, -3, 10, 10) : dipKairi(d, -8, -5, 7, 5),
      paramLabel: (iv) => iv === "1d" ? "E-8/X-3/SL10/TS10" : "E-8/X-5/SL7/TS5",
    },
    {
      id: "dip_rsi_volume", name: "急落(RSI+出来高)",
      fn: (d, iv) => iv === "1d" ? dipRsiVol(d, 25, 1.2, 35, 3) : dipRsiVol(d, 35, 1.2, 35, 3),
      paramLabel: (iv) => iv === "1d" ? "RSI25/V1.2x" : "RSI35/V1.2x",
    },
    {
      id: "dip_bb3sigma", name: "急落(BB-3σ)",
      fn: (d, iv) => iv === "1d" ? dipBB3(d, 7) : dipBB3(d, 5),
      paramLabel: (iv) => iv === "1d" ? "SL7%" : "SL5%",
    },
    {
      id: "tabata_cwh", name: "CWH",
      fn: (d, iv) => iv === "1d" ? tabataCWH(d, 5, 15) : tabataCWH(d, 20, 5),
      paramLabel: (iv) => iv === "1d" ? "TP5%/SL15%" : "TP20%/SL5%",
    },
  ];

  // データ取得
  console.log("== データ取得中 ==");
  const allData: Map<string, PriceData[]> = new Map();
  for (const period of periods) {
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - period.years);
    for (const stock of stocks) {
      const key = `${stock.symbol}_${period.interval}`;
      try {
        const result = await yf.historical(stock.symbol, {
          period1: startDate, period2: new Date(), interval: period.interval,
        });
        allData.set(key, result.filter((r) => (r.open ?? 0) > 0).map((r) => ({
          date: r.date instanceof Date ? r.date.toISOString().split("T")[0] : String(r.date),
          open: r.open ?? 0, high: r.high ?? 0, low: r.low ?? 0,
          close: r.close ?? 0, volume: r.volume ?? 0,
        })));
        process.stdout.write(".");
      } catch (e: any) {
        console.log(`\n  ${stock.name}: エラー ${e.message}`);
      }
    }
  }
  console.log("\n");

  const yen = (n: number) => {
    const sign = n >= 0 ? "+" : "";
    return `${sign}${n.toLocaleString()}円`;
  };

  // ── 戦略ごとの全銘柄合算シミュレーション ──
  for (const period of periods) {
    console.log(`${"=".repeat(130)}`);
    console.log(`  ${period.label} ／ 元本 ${INITIAL_CAPITAL.toLocaleString()}円 シミュレーション（最適化パラメータ使用）`);
    console.log(`${"=".repeat(130)}`);

    for (const strat of strats) {
      const results: { stock: string; sim: SimResult }[] = [];

      for (const stock of stocks) {
        const key = `${stock.symbol}_${period.interval}`;
        const data = allData.get(key);
        if (!data) continue;
        const signals = strat.fn(data, period.interval);
        const sim = simulateCapital(data, signals, INITIAL_CAPITAL);
        results.push({ stock: stock.name, sim });
      }

      const totalTrades = results.reduce((a, r) => a + r.sim.trades.length, 0);
      if (totalTrades === 0) continue;

      console.log(`\n── ${strat.name} [${strat.paramLabel(period.interval)}] ──`);
      console.log(`  ${"銘柄".padEnd(10)} ${"取引数".padStart(6)} ${"WR".padStart(7)} ${"最終資産".padStart(14)} ${"リターン".padStart(14)} ${"最大DD".padStart(14)} ${"DD率".padStart(7)} ${"最大単一損失".padStart(14)} ${"損失率".padStart(8)}`);
      console.log(`  ${"-".repeat(110)}`);

      let aggFinal = 0, aggReturn = 0;
      let worstDD = 0, worstDDPct = 0;
      let worstLoss = 0, worstLossPct = 0;
      let aggTrades = 0, aggWins = 0;

      for (const { stock, sim } of results) {
        if (sim.trades.length === 0) continue;
        const wins = sim.trades.filter(t => t.pnl > 0).length;
        console.log(
          `  ${stock.padEnd(10)} ${String(sim.trades.length).padStart(6)} ${(sim.winRate + "%").padStart(7)} ${(sim.finalCapital.toLocaleString() + "円").padStart(14)} ${yen(sim.totalReturn).padStart(14)} ${yen(-sim.maxDrawdown).padStart(14)} ${(sim.maxDrawdownPct + "%").padStart(7)} ${yen(sim.maxSingleLoss).padStart(14)} ${(sim.maxSingleLossPct + "%").padStart(8)}`
        );

        aggFinal += sim.finalCapital;
        aggReturn += sim.totalReturn;
        aggTrades += sim.trades.length;
        aggWins += wins;
        if (sim.maxDrawdown > worstDD) { worstDD = sim.maxDrawdown; worstDDPct = sim.maxDrawdownPct; }
        if (sim.maxSingleLoss < worstLoss) { worstLoss = sim.maxSingleLoss; worstLossPct = sim.maxSingleLossPct; }

        // 最悪のトレード3件
        const worstTrades = [...sim.trades].sort((a, b) => a.pnl - b.pnl).slice(0, 3);
        for (const t of worstTrades) {
          if (t.pnl < 0) {
            console.log(`    └ 損失: ${t.buyDate}→${t.sellDate} ${yen(t.pnl)} (${t.pnlPct}%) 資産:${t.capitalBefore.toLocaleString()}→${t.capitalAfter.toLocaleString()}`);
          }
        }
      }

      const avgWR = aggTrades > 0 ? ((aggWins / aggTrades) * 100).toFixed(1) : "0";
      const avgFinal = Math.round(aggFinal / results.filter(r => r.sim.trades.length > 0).length);
      const avgReturn = Math.round(aggReturn / results.filter(r => r.sim.trades.length > 0).length);
      const activeStocks = results.filter(r => r.sim.trades.length > 0).length;

      console.log(`  ${"-".repeat(110)}`);
      console.log(`  全体サマリー (${activeStocks}銘柄):`);
      console.log(`    平均最終資産: ${avgFinal.toLocaleString()}円  平均リターン: ${yen(avgReturn)}  全体WR: ${avgWR}%`);
      console.log(`    最悪ドローダウン: ${yen(-worstDD)} (${worstDDPct}%)  最悪単一損失: ${yen(worstLoss)} (${worstLossPct}%)`);
    }
  }
}

main();

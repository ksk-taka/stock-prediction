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

// ── CWH検出（簡易版） ──
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
  // 重複排除
  const deduped: number[] = [];
  for (const idx of indices) {
    if (deduped.length === 0 || idx - deduped[deduped.length - 1] > 3) deduped.push(idx);
  }
  return deduped;
}

// ── バックテストエンジン ──
type Signal = "buy" | "sell" | "hold";
interface Result { trades: number; wins: number; losses: number; totalPct: number; winRate: number; avgWin: number; avgLoss: number; pf: number; }

function backtest(data: PriceData[], signals: Signal[]): Result {
  const roundTrips: { entryPrice: number; exitPrice: number; pct: number }[] = [];
  let inPosition = false;
  let entryPrice = 0;

  for (let i = 0; i < data.length; i++) {
    if (signals[i] === "buy" && !inPosition) {
      inPosition = true;
      entryPrice = data[i].close;
    } else if (signals[i] === "sell" && inPosition) {
      inPosition = false;
      const pct = ((data[i].close - entryPrice) / entryPrice) * 100;
      roundTrips.push({ entryPrice, exitPrice: data[i].close, pct });
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

// ── 追加指標 ──
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
  // signal line (EMA of MACD)
  const k = 2 / (sig + 1);
  const signalLine: (number | null)[] = [];
  let sEma: number | null = null;
  let count = 0;
  for (let i = 0; i < macdLine.length; i++) {
    if (macdLine[i] == null) { signalLine.push(null); continue; }
    count++;
    if (count < sig) { signalLine.push(null); continue; }
    if (sEma === null) {
      // initial: average of first `sig` non-null MACD values
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

// ── 戦略 ──

// 1. ゴールデンクロス/デッドクロス
function maCross(data: PriceData[], shortP = 5, longP = 25): Signal[] {
  const shortMA = calcMA(data, shortP);
  const longMA = calcMA(data, longP);
  return data.map((_, i): Signal => {
    if (i < 1 || shortMA[i] == null || longMA[i] == null || shortMA[i - 1] == null || longMA[i - 1] == null) return "hold";
    if (shortMA[i - 1]! <= longMA[i - 1]! && shortMA[i]! > longMA[i]!) return "buy";
    if (shortMA[i - 1]! >= longMA[i - 1]! && shortMA[i]! < longMA[i]!) return "sell";
    return "hold";
  });
}

// 2. RSI逆張り
function rsiReversal(data: PriceData[], period = 14, oversold = 30, overbought = 70): Signal[] {
  const rsi = calcRSI(data, period);
  let inPos = false;
  return data.map((_, i): Signal => {
    if (rsi[i] == null) return "hold";
    if (!inPos && rsi[i]! < oversold) { inPos = true; return "buy"; }
    if (inPos && rsi[i]! > overbought) { inPos = false; return "sell"; }
    return "hold";
  });
}

// 3. MACDシグナル
function macdSignal(data: PriceData[], shortP = 12, longP = 26, sigP = 9): Signal[] {
  const { macd, signal } = calcMACD(data, shortP, longP, sigP);
  return data.map((_, i): Signal => {
    if (i < 1 || macd[i] == null || signal[i] == null || macd[i - 1] == null || signal[i - 1] == null) return "hold";
    if (macd[i - 1]! <= signal[i - 1]! && macd[i]! > signal[i]!) return "buy";
    if (macd[i - 1]! >= signal[i - 1]! && macd[i]! < signal[i]!) return "sell";
    return "hold";
  });
}

// 4. 急落買い
function dipBuy(data: PriceData[], dipPct = 10, recoveryPct = 15): Signal[] {
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

// 5. BB逆張り
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

// 8. 急落買い(乖離率) - MA25乖離率モデル
function dipKairi(data: PriceData[], entryK = -10, exitK = -5, slPct = 7, tsDay = 5): Signal[] {
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

// 9. 急落買い(RSI+出来高) - セリクラモデル
function dipRsiVol(data: PriceData[], rsiTh = 20, volMul = 2, rsiExit = 40, tpPct = 5): Signal[] {
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

// 10. 急落買い(BB-3σ) - ちょる子ハードモード
function dipBB3(data: PriceData[], slPct = 5): Signal[] {
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

function tabataCWH(data: PriceData[], tpPct = 20, slPct = 7): Signal[] {
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

  // 戦略セット切り替え: 引数 --classic で MAクロス等6戦略を実行
  const useClassic = process.argv.includes("--classic");

  const dipStrats = [
    { id: "急落(旧)", fn: (d: PriceData[]) => dipBuy(d) },
    { id: "乖離率", fn: (d: PriceData[]) => dipKairi(d) },
    { id: "RSI出来高", fn: (d: PriceData[]) => dipRsiVol(d) },
    { id: "BB-3σ", fn: (d: PriceData[]) => dipBB3(d) },
  ];

  const classicStrats = [
    { id: "MAクロス", fn: (d: PriceData[]) => maCross(d) },
    { id: "RSI逆張り", fn: (d: PriceData[]) => rsiReversal(d) },
    { id: "MACD", fn: (d: PriceData[]) => macdSignal(d) },
    { id: "BB逆張り", fn: (d: PriceData[]) => chorukoBB(d) },
    { id: "下放れ", fn: (d: PriceData[]) => chorukoShitabanare(d) },
    { id: "CWH", fn: (d: PriceData[]) => tabataCWH(d) },
  ];

  const strats = useClassic ? classicStrats : dipStrats;
  const W = strats.length * 14 + 14 + 4 + strats.length * 12;

  for (const period of periods) {
    console.log(`\n${"=".repeat(W)}`);
    console.log(`  ${period.label}${useClassic ? " [クラシック戦略]" : " [急落買い系]"}`);
    console.log(`${"=".repeat(W)}`);
    console.log(
      "銘柄".padEnd(14) +
      strats.map((s) => s.id.padStart(14)).join("") +
      "  | " +
      strats.map((s) => (s.id + "_WR").padStart(12)).join("")
    );
    console.log("-".repeat(W));

    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - period.years);

    for (const stock of stocks) {
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

        const results: Result[] = strats.map((s) => backtest(data, s.fn(data)));

        const retStr = results.map((r) => {
          const sign = r.totalPct >= 0 ? "+" : "";
          return `${sign}${r.totalPct}%(${r.trades})`.padStart(14);
        }).join("");

        const wrStr = results.map((r) => {
          return `${r.winRate}%`.padStart(12);
        }).join("");

        console.log(`${stock.name.padEnd(14)}${retStr}  | ${wrStr}`);

        // 詳細（トレードがある戦略のみ）
        for (let si = 0; si < strats.length; si++) {
          const r = results[si];
          if (r.trades > 0) {
            console.log(
              `  └ ${strats[si].id}: ${r.wins}勝${r.losses}敗 平均勝ち${r.avgWin > 0 ? "+" : ""}${r.avgWin}% 平均負け${r.avgLoss}% PF=${r.pf}`
            );
          }
        }
      } catch (e: any) {
        console.log(`${stock.name.padEnd(14)} エラー: ${e.message}`);
      }
    }
  }
}

main();

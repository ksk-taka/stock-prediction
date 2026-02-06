import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance();

interface PriceData {
  date: string; open: number; high: number; low: number; close: number; volume: number;
}
type Signal = "buy" | "sell" | "hold";
interface Result { trades: number; wins: number; losses: number; totalPct: number; winRate: number; avgWin: number; avgLoss: number; pf: number; }

// ── 指標計算 ──
function calcMA(data: PriceData[], window: number): (number | null)[] {
  return data.map((_, i) => {
    if (i < window - 1) return null;
    return data.slice(i - window + 1, i + 1).reduce((a, d) => a + d.close, 0) / window;
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

// ── バックテストエンジン ──
function backtest(data: PriceData[], signals: Signal[]): Result {
  const roundTrips: { pct: number }[] = [];
  let inPosition = false, entryPrice = 0;
  for (let i = 0; i < data.length; i++) {
    if (signals[i] === "buy" && !inPosition) { inPosition = true; entryPrice = data[i].close; }
    else if (signals[i] === "sell" && inPosition) {
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
    trades: roundTrips.length, wins: wins.length, losses: losses.length,
    totalPct: Math.round(totalPct * 100) / 100,
    winRate: roundTrips.length > 0 ? Math.round((wins.length / roundTrips.length) * 1000) / 10 : 0,
    avgWin: Math.round(avgWin * 100) / 100, avgLoss: Math.round(avgLoss * 100) / 100,
    pf: Math.round(pf * 100) / 100,
  };
}

// ── MACD戦略バリエーション ──

// A) ベースライン: MACD only
function macdBase(data: PriceData[]): Signal[] {
  const { macd, signal } = calcMACD(data, 12, 26, 9);
  return data.map((_, i): Signal => {
    if (i < 1 || macd[i] == null || signal[i] == null || macd[i - 1] == null || signal[i - 1] == null) return "hold";
    if (macd[i - 1]! <= signal[i - 1]! && macd[i]! > signal[i]!) return "buy";
    if (macd[i - 1]! >= signal[i - 1]! && macd[i]! < signal[i]!) return "sell";
    return "hold";
  });
}

// B) MACD + RSIフィルタ: RSI < 60 で買い許可（買われすぎでは買わない）
function macdRsiFilter(data: PriceData[]): Signal[] {
  const { macd, signal } = calcMACD(data, 12, 26, 9);
  const rsi = calcRSI(data, 14);
  let inPos = false;
  return data.map((_, i): Signal => {
    if (i < 1 || macd[i] == null || signal[i] == null || macd[i - 1] == null || signal[i - 1] == null) return "hold";
    const isBuyCross = macd[i - 1]! <= signal[i - 1]! && macd[i]! > signal[i]!;
    const isSellCross = macd[i - 1]! >= signal[i - 1]! && macd[i]! < signal[i]!;
    if (!inPos && isBuyCross && rsi[i] != null && rsi[i]! < 60) { inPos = true; return "buy"; }
    if (inPos && isSellCross) { inPos = false; return "sell"; }
    return "hold";
  });
}

// C) MACD + MA25トレンドフィルタ: 価格 > MA25 でのみ買い
function macdTrend(data: PriceData[]): Signal[] {
  const { macd, signal } = calcMACD(data, 12, 26, 9);
  const ma25 = calcMA(data, 25);
  let inPos = false;
  return data.map((d, i): Signal => {
    if (i < 1 || macd[i] == null || signal[i] == null || macd[i - 1] == null || signal[i - 1] == null) return "hold";
    const isBuyCross = macd[i - 1]! <= signal[i - 1]! && macd[i]! > signal[i]!;
    const isSellCross = macd[i - 1]! >= signal[i - 1]! && macd[i]! < signal[i]!;
    if (!inPos && isBuyCross && ma25[i] != null && d.close > ma25[i]!) { inPos = true; return "buy"; }
    if (inPos && isSellCross) { inPos = false; return "sell"; }
    return "hold";
  });
}

// D) MACD + ゼロラインフィルタ: MACDが0以下でゴールデンクロスした時のみ買い
function macdZeroLine(data: PriceData[]): Signal[] {
  const { macd, signal } = calcMACD(data, 12, 26, 9);
  let inPos = false;
  return data.map((_, i): Signal => {
    if (i < 1 || macd[i] == null || signal[i] == null || macd[i - 1] == null || signal[i - 1] == null) return "hold";
    const isBuyCross = macd[i - 1]! <= signal[i - 1]! && macd[i]! > signal[i]!;
    const isSellCross = macd[i - 1]! >= signal[i - 1]! && macd[i]! < signal[i]!;
    if (!inPos && isBuyCross && macd[i]! < 0) { inPos = true; return "buy"; }
    if (inPos && isSellCross) { inPos = false; return "sell"; }
    return "hold";
  });
}

// E) MACD + RSI + MA25 (ダブルフィルタ)
function macdDoubleFilter(data: PriceData[]): Signal[] {
  const { macd, signal } = calcMACD(data, 12, 26, 9);
  const rsi = calcRSI(data, 14);
  const ma25 = calcMA(data, 25);
  let inPos = false;
  return data.map((d, i): Signal => {
    if (i < 1 || macd[i] == null || signal[i] == null || macd[i - 1] == null || signal[i - 1] == null) return "hold";
    const isBuyCross = macd[i - 1]! <= signal[i - 1]! && macd[i]! > signal[i]!;
    const isSellCross = macd[i - 1]! >= signal[i - 1]! && macd[i]! < signal[i]!;
    if (!inPos && isBuyCross && rsi[i] != null && rsi[i]! < 60 && ma25[i] != null && d.close > ma25[i]!) {
      inPos = true; return "buy";
    }
    if (inPos && isSellCross) { inPos = false; return "sell"; }
    return "hold";
  });
}

// F) MACD + 出来高フィルタ: 買いシグナル時に出来高 > 20日平均の1.2倍
function macdVolume(data: PriceData[]): Signal[] {
  const { macd, signal } = calcMACD(data, 12, 26, 9);
  let inPos = false;
  return data.map((d, i): Signal => {
    if (i < 20 || macd[i] == null || signal[i] == null || macd[i - 1] == null || signal[i - 1] == null) return "hold";
    const isBuyCross = macd[i - 1]! <= signal[i - 1]! && macd[i]! > signal[i]!;
    const isSellCross = macd[i - 1]! >= signal[i - 1]! && macd[i]! < signal[i]!;
    const avgVol = data.slice(i - 20, i).reduce((a, x) => a + x.volume, 0) / 20;
    if (!inPos && isBuyCross && d.volume >= avgVol * 1.2) { inPos = true; return "buy"; }
    if (inPos && isSellCross) { inPos = false; return "sell"; }
    return "hold";
  });
}

// G) MACD + ゼロライン + RSI (トリプルフィルタ)
function macdZeroRsi(data: PriceData[]): Signal[] {
  const { macd, signal } = calcMACD(data, 12, 26, 9);
  const rsi = calcRSI(data, 14);
  let inPos = false;
  return data.map((_, i): Signal => {
    if (i < 1 || macd[i] == null || signal[i] == null || macd[i - 1] == null || signal[i - 1] == null) return "hold";
    const isBuyCross = macd[i - 1]! <= signal[i - 1]! && macd[i]! > signal[i]!;
    const isSellCross = macd[i - 1]! >= signal[i - 1]! && macd[i]! < signal[i]!;
    if (!inPos && isBuyCross && macd[i]! < 0 && rsi[i] != null && rsi[i]! < 50) { inPos = true; return "buy"; }
    if (inPos && isSellCross) { inPos = false; return "sell"; }
    return "hold";
  });
}

// ── データ取得 ──
async function fetchData(symbol: string): Promise<PriceData[]> {
  const now = new Date();
  const period1 = new Date(now);
  period1.setFullYear(period1.getFullYear() - 3);
  const result = await yf.chart(symbol, { period1, period2: now, interval: "1d" });
  return (result.quotes ?? [])
    .filter((q: { close?: number | null }) => q.close != null)
    .map((q: { date: Date; open?: number | null; high?: number | null; low?: number | null; close?: number | null; volume?: number | null }) => ({
      date: q.date.toISOString().split("T")[0],
      open: q.open ?? 0, high: q.high ?? 0, low: q.low ?? 0,
      close: q.close ?? 0, volume: q.volume ?? 0,
    }));
}

// ── メイン ──
async function main() {
  const stocks = [
    { symbol: "7203.T", name: "トヨタ自動車" }, { symbol: "7011.T", name: "三菱重工業" },
    { symbol: "6701.T", name: "NEC" }, { symbol: "6503.T", name: "三菱電機" },
    { symbol: "6758.T", name: "ソニーG" }, { symbol: "8035.T", name: "東京エレクトロン" },
    { symbol: "8306.T", name: "三菱UFJ" }, { symbol: "1605.T", name: "INPEX" },
    { symbol: "6501.T", name: "日立製作所" }, { symbol: "6920.T", name: "レーザーテック" },
    { symbol: "6526.T", name: "ソシオネクスト" }, { symbol: "6723.T", name: "ルネサス" },
    { symbol: "3993.T", name: "PKSHA" }, { symbol: "3778.T", name: "さくらインターネット" },
    { symbol: "7014.T", name: "名村造船所" }, { symbol: "7003.T", name: "三井E&S" },
    { symbol: "7012.T", name: "川崎重工業" }, { symbol: "9101.T", name: "日本郵船" },
    { symbol: "9104.T", name: "商船三井" }, { symbol: "6702.T", name: "富士通" },
    { symbol: "6965.T", name: "浜松ホトニクス" }, { symbol: "2802.T", name: "味の素" },
    { symbol: "4202.T", name: "ダイセル" }, { symbol: "4118.T", name: "カネカ" },
    { symbol: "4151.T", name: "協和キリン" }, { symbol: "7013.T", name: "IHI" },
    { symbol: "9432.T", name: "NTT" }, { symbol: "4704.T", name: "トレンドマイクロ" },
    { symbol: "2326.T", name: "デジタルアーツ" }, { symbol: "3692.T", name: "FFRIセキュリティ" },
    { symbol: "7974.T", name: "任天堂" }, { symbol: "7832.T", name: "バンナムHD" },
    { symbol: "4816.T", name: "東映アニメーション" }, { symbol: "9468.T", name: "KADOKAWA" },
    { symbol: "4751.T", name: "サイバーエージェント" }, { symbol: "6326.T", name: "クボタ" },
    { symbol: "6310.T", name: "井関農機" }, { symbol: "2897.T", name: "日清食品HD" },
    { symbol: "1333.T", name: "マルハニチロ" }, { symbol: "2931.T", name: "ユーグレナ" },
    { symbol: "5020.T", name: "ENEOS HD" }, { symbol: "4204.T", name: "積水化学工業" },
    { symbol: "9531.T", name: "東京ガス" }, { symbol: "9532.T", name: "大阪ガス" },
    { symbol: "9519.T", name: "レノバ" }, { symbol: "1801.T", name: "大成建設" },
    { symbol: "1812.T", name: "鹿島建設" }, { symbol: "1802.T", name: "大林組" },
    { symbol: "1803.T", name: "清水建設" }, { symbol: "1721.T", name: "コムシスHD" },
    { symbol: "9755.T", name: "応用地質" }, { symbol: "7821.T", name: "前田工繊" },
    { symbol: "4519.T", name: "中外製薬" }, { symbol: "4568.T", name: "第一三共" },
    { symbol: "4502.T", name: "武田薬品" }, { symbol: "4523.T", name: "エーザイ" },
    { symbol: "4587.T", name: "ペプチドリーム" }, { symbol: "4565.T", name: "そーせいG" },
    { symbol: "7711.T", name: "助川電気工業" }, { symbol: "4026.T", name: "神島化学工業" },
    { symbol: "5310.T", name: "東洋炭素" }, { symbol: "5713.T", name: "住友金属鉱山" },
    { symbol: "4063.T", name: "信越化学工業" }, { symbol: "6988.T", name: "日東電工" },
    { symbol: "5706.T", name: "三井金属鉱業" }, { symbol: "6269.T", name: "三井海洋開発" },
    { symbol: "9301.T", name: "三菱倉庫" }, { symbol: "9303.T", name: "住友倉庫" },
    { symbol: "1893.T", name: "五洋建設" }, { symbol: "1890.T", name: "東洋建設" },
    { symbol: "7701.T", name: "島津製作所" }, { symbol: "7721.T", name: "東京計器" },
    { symbol: "9433.T", name: "KDDI" }, { symbol: "9434.T", name: "ソフトバンク" },
    { symbol: "5803.T", name: "フジクラ" }, { symbol: "5802.T", name: "住友電工" },
    { symbol: "6330.T", name: "東洋エンジニアリング" }, { symbol: "6814.T", name: "古野電気" },
  ];

  type StratFn = (data: PriceData[]) => Signal[];
  const strategies: { id: string; name: string; fn: StratFn }[] = [
    { id: "A", name: "MACD(ベース)", fn: macdBase },
    { id: "B", name: "MACD+RSI<60", fn: macdRsiFilter },
    { id: "C", name: "MACD+MA25↑", fn: macdTrend },
    { id: "D", name: "MACD+ゼロ下", fn: macdZeroLine },
    { id: "E", name: "MACD+RSI+MA25", fn: macdDoubleFilter },
    { id: "F", name: "MACD+出来高", fn: macdVolume },
    { id: "G", name: "MACD+ゼロ+RSI", fn: macdZeroRsi },
  ];

  // 集計用
  const totals: Record<string, { returns: number[]; winRates: number[]; pfs: number[]; trades: number[] }> = {};
  for (const s of strategies) totals[s.id] = { returns: [], winRates: [], pfs: [], trades: [] };

  console.log("=".repeat(160));
  console.log("  MACD戦略フィルタ比較テスト（日足3年 x 76銘柄）");
  console.log("=".repeat(160));

  // ヘッダー
  const hdr = strategies.map((s) => `${s.name.padEnd(14)}`).join(" | ");
  console.log(`${"銘柄".padEnd(12)} | ${hdr}`);
  console.log("-".repeat(160));

  for (const stock of stocks) {
    try {
      const data = await fetchData(stock.symbol);
      if (data.length < 50) { console.log(`${stock.name.padEnd(12)} | データ不足`); continue; }

      const cells: string[] = [];
      for (const strat of strategies) {
        const sigs = strat.fn(data);
        const res = backtest(data, sigs);
        totals[strat.id].returns.push(res.totalPct);
        totals[strat.id].winRates.push(res.winRate);
        totals[strat.id].pfs.push(res.pf === Infinity ? 100 : res.pf);
        totals[strat.id].trades.push(res.trades);
        const sign = res.totalPct >= 0 ? "+" : "";
        cells.push(`${sign}${res.totalPct.toFixed(1)}%(${res.trades}) WR${res.winRate}%`.padEnd(14));
      }
      console.log(`${stock.name.padEnd(12)} | ${cells.join(" | ")}`);
    } catch (e: unknown) {
      console.log(`${stock.name.padEnd(12)} | エラー: ${(e as Error).message?.slice(0, 40)}`);
    }
  }

  // サマリ
  console.log("\n" + "=".repeat(160));
  console.log("  サマリ（全銘柄平均）");
  console.log("=".repeat(160));
  console.log(`${"指標".padEnd(16)} | ${strategies.map((s) => s.name.padEnd(14)).join(" | ")}`);
  console.log("-".repeat(160));

  const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const med = (arr: number[]) => {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  };

  const rows = [
    { label: "平均リターン", fn: (id: string) => `${avg(totals[id].returns) >= 0 ? "+" : ""}${avg(totals[id].returns).toFixed(1)}%` },
    { label: "中央値リターン", fn: (id: string) => `${med(totals[id].returns) >= 0 ? "+" : ""}${med(totals[id].returns).toFixed(1)}%` },
    { label: "平均勝率", fn: (id: string) => `${avg(totals[id].winRates).toFixed(1)}%` },
    { label: "平均PF", fn: (id: string) => `${avg(totals[id].pfs).toFixed(2)}` },
    { label: "平均取引数", fn: (id: string) => `${avg(totals[id].trades).toFixed(1)}回` },
    { label: "プラス銘柄数", fn: (id: string) => `${totals[id].returns.filter((r) => r > 0).length}/${totals[id].returns.length}` },
  ];

  for (const row of rows) {
    const vals = strategies.map((s) => row.fn(s.id).padEnd(14)).join(" | ");
    console.log(`${row.label.padEnd(16)} | ${vals}`);
  }
}

main().catch(console.error);

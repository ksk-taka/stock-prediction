import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance();

interface PriceData {
  date: string; open: number; high: number; low: number; close: number; volume: number;
}

// ── 指標計算 ──
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

// ── MACD GC検出（エントリー共通） ──
function detectMACDGoldenCross(data: PriceData[]) {
  const { macd, signal } = calcMACD(data, 12, 26, 9);
  const gcIndices: number[] = [];
  const dcIndices: number[] = [];
  for (let i = 1; i < data.length; i++) {
    if (macd[i] == null || signal[i] == null || macd[i - 1] == null || signal[i - 1] == null) continue;
    if (macd[i - 1]! <= signal[i - 1]! && macd[i]! > signal[i]!) gcIndices.push(i);
    if (macd[i - 1]! >= signal[i - 1]! && macd[i]! < signal[i]!) dcIndices.push(i);
  }
  return { gcIndices: new Set(gcIndices), dcIndices: new Set(dcIndices), macd, signal };
}

// ── 拡張バックテスト（分割利確対応） ──
interface Trade { entryIdx: number; exitIdx: number; entryPrice: number; exitPrice: number; pct: number; weight: number; }
interface Result {
  trades: number; wins: number; losses: number;
  totalPct: number; winRate: number; avgWin: number; avgLoss: number; pf: number;
  maxDD: number;
}

function summarize(trades: Trade[]): Result {
  const wins = trades.filter((r) => r.pct > 0);
  const losses = trades.filter((r) => r.pct <= 0);
  const totalPct = trades.reduce((a, r) => a + r.pct * r.weight, 0);
  const avgWin = wins.length > 0 ? wins.reduce((a, r) => a + r.pct, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((a, r) => a + r.pct, 0) / losses.length : 0;
  const grossProfit = wins.reduce((a, r) => a + r.pct * r.weight, 0);
  const grossLoss = Math.abs(losses.reduce((a, r) => a + r.pct * r.weight, 0));
  const pf = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  // MaxDD (equity curve based)
  let equity = 0, peak = 0, maxDD = 0;
  for (const t of trades) {
    equity += t.pct * t.weight;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDD) maxDD = dd;
  }

  return {
    trades: trades.length,
    wins: wins.length, losses: losses.length,
    totalPct: Math.round(totalPct * 100) / 100,
    winRate: trades.length > 0 ? Math.round((wins.length / trades.length) * 1000) / 10 : 0,
    avgWin: Math.round(avgWin * 100) / 100,
    avgLoss: Math.round(avgLoss * 100) / 100,
    pf: Math.round(pf * 100) / 100,
    maxDD: Math.round(maxDD * 100) / 100,
  };
}

// ══════════════════════════════════════════
//  出口戦略バリエーション
// ══════════════════════════════════════════

// A) ベースMACD: GCで買い、DCで売り
function exitBase(data: PriceData[]): Trade[] {
  const { gcIndices, dcIndices } = detectMACDGoldenCross(data);
  const trades: Trade[] = [];
  let inPos = false, entryPrice = 0, entryIdx = 0;
  for (let i = 0; i < data.length; i++) {
    if (!inPos && gcIndices.has(i)) { inPos = true; entryPrice = data[i].close; entryIdx = i; }
    else if (inPos && dcIndices.has(i)) {
      inPos = false;
      trades.push({ entryIdx, exitIdx: i, entryPrice, exitPrice: data[i].close, pct: ((data[i].close - entryPrice) / entryPrice) * 100, weight: 1 });
    }
  }
  return trades;
}

// B) トレーリングストップ 8%: 高値から-8%で利確（DCは無視）
function exitTrail(data: PriceData[], trailPct: number): Trade[] {
  const { gcIndices } = detectMACDGoldenCross(data);
  const trades: Trade[] = [];
  let inPos = false, entryPrice = 0, entryIdx = 0, peakPrice = 0;
  for (let i = 0; i < data.length; i++) {
    if (!inPos && gcIndices.has(i)) {
      inPos = true; entryPrice = data[i].close; entryIdx = i; peakPrice = data[i].close;
    } else if (inPos) {
      if (data[i].close > peakPrice) peakPrice = data[i].close;
      const dropFromPeak = ((peakPrice - data[i].close) / peakPrice) * 100;
      if (dropFromPeak >= trailPct) {
        inPos = false;
        trades.push({ entryIdx, exitIdx: i, entryPrice, exitPrice: data[i].close, pct: ((data[i].close - entryPrice) / entryPrice) * 100, weight: 1 });
      }
    }
  }
  return trades;
}

// C) DC + 固定損切り: DCで利確 OR エントリーから-N%で損切り
function exitDCSL(data: PriceData[], slPct: number): Trade[] {
  const { gcIndices, dcIndices } = detectMACDGoldenCross(data);
  const trades: Trade[] = [];
  let inPos = false, entryPrice = 0, entryIdx = 0;
  for (let i = 0; i < data.length; i++) {
    if (!inPos && gcIndices.has(i)) {
      inPos = true; entryPrice = data[i].close; entryIdx = i;
    } else if (inPos) {
      const pnl = ((data[i].close - entryPrice) / entryPrice) * 100;
      const shouldSell = dcIndices.has(i) || pnl <= -slPct;
      if (shouldSell) {
        inPos = false;
        trades.push({ entryIdx, exitIdx: i, entryPrice, exitPrice: data[i].close, pct: pnl, weight: 1 });
      }
    }
  }
  return trades;
}

// D) トレーリング + 固定損切り
function exitTrailSL(data: PriceData[], trailPct: number, slPct: number): Trade[] {
  const { gcIndices } = detectMACDGoldenCross(data);
  const trades: Trade[] = [];
  let inPos = false, entryPrice = 0, entryIdx = 0, peakPrice = 0;
  for (let i = 0; i < data.length; i++) {
    if (!inPos && gcIndices.has(i)) {
      inPos = true; entryPrice = data[i].close; entryIdx = i; peakPrice = data[i].close;
    } else if (inPos) {
      if (data[i].close > peakPrice) peakPrice = data[i].close;
      const pnl = ((data[i].close - entryPrice) / entryPrice) * 100;
      const dropFromPeak = ((peakPrice - data[i].close) / peakPrice) * 100;
      if (pnl <= -slPct || dropFromPeak >= trailPct) {
        inPos = false;
        trades.push({ entryIdx, exitIdx: i, entryPrice, exitPrice: data[i].close, pct: pnl, weight: 1 });
      }
    }
  }
  return trades;
}

// E) 分割利確: +N%で半分決済、残りはトレーリングM%で決済
function exitPartialProfit(data: PriceData[], takeProfitPct: number, trailPct: number): Trade[] {
  const { gcIndices } = detectMACDGoldenCross(data);
  const trades: Trade[] = [];
  let inPos = false, entryPrice = 0, entryIdx = 0, peakPrice = 0, partialDone = false;
  for (let i = 0; i < data.length; i++) {
    if (!inPos && gcIndices.has(i)) {
      inPos = true; entryPrice = data[i].close; entryIdx = i; peakPrice = data[i].close; partialDone = false;
    } else if (inPos) {
      if (data[i].close > peakPrice) peakPrice = data[i].close;
      const pnl = ((data[i].close - entryPrice) / entryPrice) * 100;

      // 半分利確
      if (!partialDone && pnl >= takeProfitPct) {
        partialDone = true;
        trades.push({ entryIdx, exitIdx: i, entryPrice, exitPrice: data[i].close, pct: pnl, weight: 0.5 });
        peakPrice = data[i].close; // トレーリングリセット
      }

      // 残り半分 or 全量: トレーリング
      const dropFromPeak = ((peakPrice - data[i].close) / peakPrice) * 100;
      if (dropFromPeak >= trailPct) {
        inPos = false;
        const remainPnl = ((data[i].close - entryPrice) / entryPrice) * 100;
        trades.push({ entryIdx, exitIdx: i, entryPrice, exitPrice: data[i].close, pct: remainPnl, weight: partialDone ? 0.5 : 1 });
      }
    }
  }
  return trades;
}

// F) DC + 利確ターゲット: DCで売り、ただし+N%到達で即利確
function exitDCTP(data: PriceData[], tpPct: number): Trade[] {
  const { gcIndices, dcIndices } = detectMACDGoldenCross(data);
  const trades: Trade[] = [];
  let inPos = false, entryPrice = 0, entryIdx = 0;
  for (let i = 0; i < data.length; i++) {
    if (!inPos && gcIndices.has(i)) {
      inPos = true; entryPrice = data[i].close; entryIdx = i;
    } else if (inPos) {
      const pnl = ((data[i].close - entryPrice) / entryPrice) * 100;
      if (dcIndices.has(i) || pnl >= tpPct) {
        inPos = false;
        trades.push({ entryIdx, exitIdx: i, entryPrice, exitPrice: data[i].close, pct: pnl, weight: 1 });
      }
    }
  }
  return trades;
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

  type StratFn = (data: PriceData[]) => Trade[];
  const strategies: { id: string; name: string; fn: StratFn }[] = [
    { id: "A", name: "ベースMACD(DC売)", fn: exitBase },
    { id: "B", name: "トレーリング8%", fn: (d) => exitTrail(d, 8) },
    { id: "C", name: "トレーリング12%", fn: (d) => exitTrail(d, 12) },
    { id: "D", name: "トレーリング15%", fn: (d) => exitTrail(d, 15) },
    { id: "E", name: "DC+損切5%", fn: (d) => exitDCSL(d, 5) },
    { id: "F", name: "DC+損切8%", fn: (d) => exitDCSL(d, 8) },
    { id: "G", name: "Trail10%+SL5%", fn: (d) => exitTrailSL(d, 10, 5) },
    { id: "H", name: "Trail12%+SL5%", fn: (d) => exitTrailSL(d, 12, 5) },
    { id: "I", name: "半利確10%+T10%", fn: (d) => exitPartialProfit(d, 10, 10) },
    { id: "J", name: "半利確15%+T12%", fn: (d) => exitPartialProfit(d, 15, 12) },
    { id: "K", name: "DC+利確20%", fn: (d) => exitDCTP(d, 20) },
  ];

  // 集計用
  const totals: Record<string, { returns: number[]; winRates: number[]; pfs: number[]; trades: number[]; maxDDs: number[]; avgWins: number[]; avgLosses: number[] }> = {};
  for (const s of strategies) totals[s.id] = { returns: [], winRates: [], pfs: [], trades: [], maxDDs: [], avgWins: [], avgLosses: [] };

  console.log("=".repeat(180));
  console.log("  MACD出口戦略比較テスト（日足3年 x 76銘柄）");
  console.log("  エントリー: MACDゴールデンクロス共通、出口のみ変更");
  console.log("=".repeat(180));

  console.log("\n戦略一覧:");
  console.log("  A) ベースMACD: DCで売り（現行）");
  console.log("  B) トレーリング8%: 保有中の高値から-8%で決済（DC無視）");
  console.log("  C) トレーリング12%: 高値から-12%で決済");
  console.log("  D) トレーリング15%: 高値から-15%で決済");
  console.log("  E) DC+損切5%: DCで売り + エントリーから-5%で早期損切り");
  console.log("  F) DC+損切8%: DCで売り + エントリーから-8%で早期損切り");
  console.log("  G) Trail10%+SL5%: 高値-10%で利確 + -5%損切り");
  console.log("  H) Trail12%+SL5%: 高値-12%で利確 + -5%損切り");
  console.log("  I) 半利確10%+T10%: +10%で半分決済、残りは高値-10%トレーリング");
  console.log("  J) 半利確15%+T12%: +15%で半分決済、残りは高値-12%トレーリング");
  console.log("  K) DC+利確20%: DCで売り OR +20%到達で即利確");
  console.log("");

  // ヘッダー
  const hdr = strategies.map((s) => `${s.id})${s.name}`.substring(0, 16).padEnd(16)).join(" | ");
  console.log(`${"銘柄".padEnd(12)} | ${hdr}`);
  console.log("-".repeat(180));

  let processed = 0;
  for (const stock of stocks) {
    try {
      const data = await fetchData(stock.symbol);
      if (data.length < 50) { console.log(`${stock.name.padEnd(12)} | データ不足`); continue; }

      const cells: string[] = [];
      for (const strat of strategies) {
        const trades = strat.fn(data);
        const res = summarize(trades);
        totals[strat.id].returns.push(res.totalPct);
        totals[strat.id].winRates.push(res.winRate);
        totals[strat.id].pfs.push(res.pf === Infinity ? 100 : res.pf);
        totals[strat.id].trades.push(res.trades);
        totals[strat.id].maxDDs.push(res.maxDD);
        totals[strat.id].avgWins.push(res.avgWin);
        totals[strat.id].avgLosses.push(res.avgLoss);
        const sign = res.totalPct >= 0 ? "+" : "";
        cells.push(`${sign}${res.totalPct.toFixed(1)}%(${res.trades})`.padEnd(16));
      }
      console.log(`${stock.name.padEnd(12)} | ${cells.join(" | ")}`);
      processed++;
    } catch (e: unknown) {
      console.log(`${stock.name.padEnd(12)} | エラー: ${(e as Error).message?.slice(0, 40)}`);
    }
  }

  // ═══ サマリ ═══
  console.log("\n" + "=".repeat(180));
  console.log(`  サマリ（${processed}銘柄平均）`);
  console.log("=".repeat(180));
  console.log(`${"指標".padEnd(18)} | ${strategies.map((s) => `${s.id})${s.name}`.substring(0, 16).padEnd(16)).join(" | ")}`);
  console.log("-".repeat(180));

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
    { label: "平均最大DD", fn: (id: string) => `-${avg(totals[id].maxDDs).toFixed(1)}%` },
    { label: "平均勝ちpct", fn: (id: string) => `+${avg(totals[id].avgWins).toFixed(1)}%` },
    { label: "平均負けpct", fn: (id: string) => `${avg(totals[id].avgLosses).toFixed(1)}%` },
  ];

  for (const row of rows) {
    const vals = strategies.map((s) => row.fn(s.id).padEnd(16)).join(" | ");
    console.log(`${row.label.padEnd(18)} | ${vals}`);
  }

  // ═══ ベスト/ワースト分析 ═══
  console.log("\n" + "=".repeat(100));
  console.log("  戦略別ランキング");
  console.log("=".repeat(100));

  const ranking = strategies.map((s) => ({
    id: s.id,
    name: s.name,
    avgReturn: avg(totals[s.id].returns),
    medReturn: med(totals[s.id].returns),
    avgWR: avg(totals[s.id].winRates),
    avgPF: avg(totals[s.id].pfs),
    avgMaxDD: avg(totals[s.id].maxDDs),
    plusCount: totals[s.id].returns.filter((r) => r > 0).length,
    total: totals[s.id].returns.length,
  }));

  console.log("\n【リターン順位】");
  const byReturn = [...ranking].sort((a, b) => b.avgReturn - a.avgReturn);
  byReturn.forEach((r, i) => console.log(`  ${i + 1}. ${r.id}) ${r.name.padEnd(16)} 平均: ${r.avgReturn >= 0 ? "+" : ""}${r.avgReturn.toFixed(1)}%  中央値: ${r.medReturn >= 0 ? "+" : ""}${r.medReturn.toFixed(1)}%  プラス: ${r.plusCount}/${r.total}`));

  console.log("\n【勝率順位】");
  const byWR = [...ranking].sort((a, b) => b.avgWR - a.avgWR);
  byWR.forEach((r, i) => console.log(`  ${i + 1}. ${r.id}) ${r.name.padEnd(16)} WR: ${r.avgWR.toFixed(1)}%  PF: ${r.avgPF.toFixed(2)}`));

  console.log("\n【リスク調整後(PF)順位】");
  const byPF = [...ranking].sort((a, b) => b.avgPF - a.avgPF);
  byPF.forEach((r, i) => console.log(`  ${i + 1}. ${r.id}) ${r.name.padEnd(16)} PF: ${r.avgPF.toFixed(2)}  MaxDD: -${r.avgMaxDD.toFixed(1)}%  Return: ${r.avgReturn >= 0 ? "+" : ""}${r.avgReturn.toFixed(1)}%`));

  console.log("\n【総合評価】リターン×PF×プラス銘柄率 スコア");
  const scored = ranking.map((r) => ({
    ...r,
    score: r.avgReturn * r.avgPF * (r.plusCount / r.total),
  }));
  scored.sort((a, b) => b.score - a.score);
  scored.forEach((r, i) => console.log(`  ${i + 1}. ${r.id}) ${r.name.padEnd(16)} Score: ${r.score.toFixed(0)}  (Return:${r.avgReturn >= 0 ? "+" : ""}${r.avgReturn.toFixed(1)}% × PF:${r.avgPF.toFixed(2)} × Plus:${(r.plusCount / r.total * 100).toFixed(0)}%)`));
}

main().catch(console.error);

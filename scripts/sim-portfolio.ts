import YahooFinance from "yahoo-finance2";
import { readFileSync } from "fs";
import { join } from "path";
const yf = new YahooFinance();

interface PriceData { date: string; open: number; high: number; low: number; close: number; volume: number; }
interface Trade { symbol: string; name: string; entryDate: string; exitDate: string; entryPrice: number; exitPrice: number; pct: number; near52wHigh: boolean; }

// ── CWH検出 ──
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
          indices.push(h); break;
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

// ── 52週高値判定 (エントリー時点で過去252営業日の高値付近か) ──
function isNear52wHigh(data: PriceData[], idx: number, tolerance: number = 0.005): boolean {
  const lookback = Math.min(252, idx); // 52週 ≒ 252営業日
  let high52w = 0;
  for (let j = idx - lookback; j <= idx; j++) {
    if (j >= 0 && data[j].high > high52w) high52w = data[j].high;
  }
  return data[idx].close >= high52w * (1 - tolerance);
}

// ── CWH戦略でトレード一覧を生成 (52週高値フラグ付き) ──
// mode: "fixed" = 固定TP/SL, "trail" = トレーリングストップ, "breakeven" = SL8%+20%超えたら建値撤退
function getCWHTrades(data: PriceData[], symbol: string, name: string, tpPct: number, slPct: number, mode: "fixed" | "trail" | "breakeven" = "fixed", trailPct: number = 8): Trade[] {
  const cwhIdx = new Set(detectCWH(data));
  const trades: Trade[] = [];
  let inPos = false, entry = 0, entryDate = "", entryNear52w = false;
  let highSinceEntry = 0;
  let hitThreshold = false; // breakeven mode: +20%を超えたか

  for (let i = 0; i < data.length; i++) {
    if (!inPos) {
      if (cwhIdx.has(i)) {
        inPos = true; entry = data[i].close; entryDate = data[i].date;
        entryNear52w = isNear52wHigh(data, i);
        highSinceEntry = data[i].close;
        hitThreshold = false;
      }
    } else {
      // 高値更新
      if (data[i].high > highSinceEntry) highSinceEntry = data[i].high;

      let shouldExit = false;
      if (mode === "trail") {
        // トレーリングストップ: 高値から-trailPct%で撤退
        const trailStop = highSinceEntry * (1 - trailPct / 100);
        shouldExit = data[i].close <= trailStop;
      } else if (mode === "breakeven") {
        // +20%を一度でも超えたかチェック
        if (highSinceEntry >= entry * 1.20) hitThreshold = true;
        if (hitThreshold) {
          // +20%到達後: 高値-15%トレーリングストップ
          const trailStop = highSinceEntry * (1 - 15 / 100);
          shouldExit = data[i].close <= trailStop;
        } else {
          // まだ+20%到達前: 固定SL -8%
          shouldExit = data[i].close <= entry * (1 - slPct / 100);
        }
      } else {
        // 固定TP/SL
        shouldExit = data[i].close >= entry * (1 + tpPct / 100) || data[i].close <= entry * (1 - slPct / 100);
      }

      if (shouldExit) {
        const pct = ((data[i].close - entry) / entry) * 100;
        trades.push({ symbol, name, entryDate, exitDate: data[i].date, entryPrice: entry, exitPrice: data[i].close, pct, near52wHigh: entryNear52w });
        inPos = false;
      }
    }
  }
  return trades;
}

// ── メイン ──
async function main() {
  const INITIAL_CAPITAL = 5_000_000;
  const POS_SIZE = 1_000_000;  // 1ポジション100万円
  const NO_LIMIT = process.argv.includes("--no-limit");
  const MAX_POS = NO_LIMIT ? 9999 : 5;  // --no-limit: 制限なし

  // 銘柄読み込み
  const EXCLUDE_SYMBOLS = new Set(["7817.T"]);
  const args = process.argv.slice(2);
  const getArg = (flag: string) => { const i = args.indexOf(flag); return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined; };
  const segment = getArg("--segment") ?? "all";
  const favOnly = args.includes("--favorites");
  const raw = readFileSync(join(process.cwd(), "data", "watchlist.json"), "utf-8");
  const watchlist = JSON.parse(raw) as { stocks: { symbol: string; name: string; market: string; marketSegment?: string; favorite?: boolean }[] };
  const stocks = watchlist.stocks.filter(s => {
    if (EXCLUDE_SYMBOLS.has(s.symbol) || s.market !== "JP") return false;
    if (favOnly) return s.favorite === true;
    if (segment !== "all") return s.marketSegment === segment;
    return true;
  });
  console.log(`対象: ${stocks.length}銘柄 (${favOnly ? "お気に入り" : segment})`);

  console.log("データ取得中...");
  const allTrades: Trade[] = [];
  const periodYears = getArg("--period") ? parseInt(getArg("--period")!) : 3;
  const startDate = new Date(); startDate.setFullYear(startDate.getFullYear() - periodYears);
  let fetched = 0, errors = 0;
  const CONCURRENCY = 10;

  for (let i = 0; i < stocks.length; i += CONCURRENCY) {
    const batch = stocks.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(batch.map(async (stock) => {
      const result = await yf.historical(stock.symbol, { period1: startDate, period2: new Date(), interval: "1d" as const });
      const data: PriceData[] = result.filter((r) => (r.open ?? 0) > 0).map((r) => ({
        date: r.date instanceof Date ? r.date.toISOString().split("T")[0] : String(r.date),
        open: r.open ?? 0, high: r.high ?? 0, low: r.low ?? 0, close: r.close ?? 0, volume: r.volume ?? 0,
      }));
      const trailMode = args.includes("--trail");
      const beMode = args.includes("--breakeven");
      const trailPct = getArg("--trail-pct") ? parseFloat(getArg("--trail-pct")!) : 8;
      const exitMode = beMode ? "breakeven" : trailMode ? "trail" : "fixed";
      return getCWHTrades(data, stock.symbol, stock.name, 20, 8, exitMode, trailPct);
    }));
    for (const r of results) {
      if (r.status === "fulfilled") { allTrades.push(...r.value); fetched++; }
      else errors++;
    }
    process.stdout.write(`\r  ${fetched + errors}/${stocks.length}銘柄処理 (${fetched}成功, ${errors}エラー)`);
  }
  console.log("");
  const trades52w = allTrades.filter(t => t.near52wHigh);
  const tradesNon52w = allTrades.filter(t => !t.near52wHigh);
  console.log(`${fetched}銘柄取得完了, ${allTrades.length}トレード検出 (52週高値付近: ${trades52w.length}, それ以外: ${tradesNon52w.length})\n`);

  // ── 52週高値フィルタ比較サマリー ──
  function tradeStats(label: string, trades: Trade[]) {
    if (trades.length === 0) { console.log(`  ${label}: トレードなし`); return; }
    const wins = trades.filter(t => t.pct > 0);
    const losses = trades.filter(t => t.pct <= 0);
    const avgPct = trades.reduce((s, t) => s + t.pct, 0) / trades.length;
    const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pct, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + t.pct, 0) / losses.length : 0;
    const totalPct = trades.reduce((s, t) => s + t.pct, 0);
    const pf = losses.length > 0 ? wins.reduce((s, t) => s + t.pct, 0) / Math.abs(losses.reduce((s, t) => s + t.pct, 0)) : Infinity;
    console.log(`  ${label}: ${trades.length}件 | 勝率${(wins.length / trades.length * 100).toFixed(1)}% (${wins.length}W/${losses.length}L) | 平均${avgPct >= 0 ? "+" : ""}${avgPct.toFixed(2)}% | 平均勝+${avgWin.toFixed(1)}%/平均負${avgLoss.toFixed(1)}% | PF${pf.toFixed(2)} | 合計${totalPct >= 0 ? "+" : ""}${totalPct.toFixed(1)}%`);
  }
  const isTrail = args.includes("--trail");
  const isBE = args.includes("--breakeven");
  const trailPctDisplay = getArg("--trail-pct") ? parseFloat(getArg("--trail-pct")!) : 8;
  const modeLabel = isBE ? "SL8%→+20%後Trail15%" : isTrail ? `トレーリングストップ${trailPctDisplay}%` : "TP20/SL8";
  console.log("═".repeat(95));
  console.log(`  52週高値フィルタ比較 (CWH ${modeLabel})`);
  console.log("═".repeat(95));
  tradeStats("全CWHシグナル    ", allTrades);
  tradeStats("52週高値付近のみ ", trades52w);
  tradeStats("52週高値以外     ", tradesNon52w);
  console.log("");

  // ── 年別サマリー (52週高値フィルタ適用) ──
  const yearSet = new Set(trades52w.map(t => t.entryDate.substring(0, 4)));
  const years = [...yearSet].sort();
  if (years.length > 1) {
    console.log("═".repeat(95));
    console.log(`  年別成績 (52週高値CWH ${modeLabel})`);
    console.log("═".repeat(95));
    for (const y of years) {
      const yTrades = trades52w.filter(t => t.entryDate.startsWith(y));
      tradeStats(`${y}年`, yTrades);
    }
    console.log("");
  }

  // 銘柄別内訳
  console.log("─ 銘柄別 52週高値CWHトレード ─");
  const bySymbol = new Map<string, Trade[]>();
  for (const t of trades52w) {
    if (!bySymbol.has(t.symbol)) bySymbol.set(t.symbol, []);
    bySymbol.get(t.symbol)!.push(t);
  }
  for (const [sym, trades] of [...bySymbol.entries()].sort((a, b) => b[1].reduce((s, t) => s + t.pct, 0) - a[1].reduce((s, t) => s + t.pct, 0))) {
    const w = trades.filter(t => t.pct > 0).length;
    const total = trades.reduce((s, t) => s + t.pct, 0);
    console.log(`  ${trades[0].name.padEnd(14)} ${trades.length}件 ${w}W/${trades.length - w}L 合計${total >= 0 ? "+" : ""}${total.toFixed(1)}%`);
  }
  console.log("");

  // ── ポートフォリオシミュレーション (52週高値フィルタ適用) ──
  const USE_52W_FILTER = process.argv.includes("--52w");
  const simTrades = USE_52W_FILTER ? trades52w : allTrades;
  console.log(`▶ ポートフォリオシミュレーション: ${USE_52W_FILTER ? "52週高値フィルタ適用" : "全CWHシグナル"}`);

  // ── イベントリスト作成 (エントリー/イグジット) ──
  interface Event { date: string; type: "entry" | "exit"; trade: Trade; }
  const events: Event[] = [];
  for (const t of simTrades) {
    events.push({ date: t.entryDate, type: "entry", trade: t });
    events.push({ date: t.exitDate, type: "exit", trade: t });
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || (a.type === "exit" ? -1 : 1)); // exitを先に処理

  // ── ポートフォリオシミュレーション ──
  let cash = INITIAL_CAPITAL;
  const activePositions: Map<string, { trade: Trade; amount: number }> = new Map();
  let totalRealized = 0;
  let skippedSignals = 0;
  let takenTrades = 0;

  // 月次トラッキング
  interface MonthRecord {
    month: string;
    startEquity: number;
    endEquity: number;
    realized: number;
    trades: number;
    wins: number;
    losses: number;
    maxPositions: number;
    skipped: number;
  }
  const monthlyData: MonthRecord[] = [];
  let currentMonth = "";
  let monthRealized = 0, monthTrades = 0, monthWins = 0, monthLosses = 0, monthMaxPos = 0, monthSkipped = 0;
  let monthStartEquity = INITIAL_CAPITAL;

  function getEquity() {
    let posValue = 0;
    for (const [, pos] of activePositions) posValue += pos.amount;
    return cash + posValue;
  }

  function flushMonth(month: string) {
    if (!month) return;
    monthlyData.push({
      month, startEquity: monthStartEquity, endEquity: getEquity(),
      realized: monthRealized, trades: monthTrades, wins: monthWins, losses: monthLosses,
      maxPositions: monthMaxPos, skipped: monthSkipped,
    });
    monthStartEquity = getEquity();
    monthRealized = 0; monthTrades = 0; monthWins = 0; monthLosses = 0; monthMaxPos = 0; monthSkipped = 0;
  }

  for (const event of events) {
    const month = event.date.substring(0, 7);
    if (month !== currentMonth) {
      flushMonth(currentMonth);
      currentMonth = month;
    }

    const key = `${event.trade.symbol}_${event.trade.entryDate}`;

    if (event.type === "exit") {
      const pos = activePositions.get(key);
      if (pos) {
        const pnl = pos.amount * (event.trade.pct / 100);
        cash += pos.amount + pnl;
        totalRealized += pnl;
        monthRealized += pnl;
        monthTrades++;
        if (pnl > 0) monthWins++; else monthLosses++;
        activePositions.delete(key);
      }
    } else { // entry
      if (!NO_LIMIT && (activePositions.size >= MAX_POS || cash < POS_SIZE)) {
        skippedSignals++;
        monthSkipped++;
        continue;
      }
      const amount = POS_SIZE;
      if (!NO_LIMIT && cash < amount) { skippedSignals++; monthSkipped++; continue; }
      if (NO_LIMIT) cash = Math.max(cash, amount); // 無制限モード: 常に資金確保
      cash -= amount;
      activePositions.set(key, { trade: event.trade, amount });
      takenTrades++;
    }
    if (activePositions.size > monthMaxPos) monthMaxPos = activePositions.size;
  }
  flushMonth(currentMonth);

  // ── 結果出力 ──
  const finalEquity = getEquity();
  const totalPnl = finalEquity - INITIAL_CAPITAL;
  const totalWins = monthlyData.reduce((s, m) => s + m.wins, 0);
  const totalLosses = monthlyData.reduce((s, m) => s + m.losses, 0);
  const totalTrades = totalWins + totalLosses;

  console.log("═".repeat(95));
  console.log(`  CWH(${modeLabel}) ポートフォリオシミュレーション${NO_LIMIT ? " 【制限なし】" : ""}${USE_52W_FILTER ? " 【52週高値フィルタ】" : ""}`);
  console.log(`  初期資金: ${(INITIAL_CAPITAL / 10000).toFixed(0)}万円 | 1ポジション: ${(POS_SIZE / 10000).toFixed(0)}万円 | 最大同時保有: ${NO_LIMIT ? "無制限" : String(MAX_POS)} | 対象: ${simTrades.length}トレード`);
  console.log("═".repeat(95));
  console.log(
    "月".padEnd(10) +
    "月初残高".padStart(12) +
    "月末残高".padStart(12) +
    "損益".padStart(12) +
    "月利".padStart(8) +
    "取引".padStart(6) +
    "勝".padStart(4) +
    "負".padStart(4) +
    "最大POS".padStart(8) +
    "見送り".padStart(7) +
    "  累積損益"
  );
  console.log("─".repeat(95));

  let cumPnl = 0;
  let peakEquity = INITIAL_CAPITAL;
  let maxDD = 0;
  let maxDDMonth = "";

  for (const m of monthlyData) {
    const pnl = m.endEquity - m.startEquity;
    cumPnl = m.endEquity - INITIAL_CAPITAL;
    const monthPct = ((m.endEquity - m.startEquity) / m.startEquity * 100);

    if (m.endEquity > peakEquity) peakEquity = m.endEquity;
    const dd = ((peakEquity - m.endEquity) / peakEquity * 100);
    if (dd > maxDD) { maxDD = dd; maxDDMonth = m.month; }

    const pnlStr = pnl >= 0 ? `+${(pnl / 10000).toFixed(1)}万` : `${(pnl / 10000).toFixed(1)}万`;
    const cumStr = cumPnl >= 0 ? `+${(cumPnl / 10000).toFixed(1)}万` : `${(cumPnl / 10000).toFixed(1)}万`;
    const pctStr = monthPct >= 0 ? `+${monthPct.toFixed(1)}%` : `${monthPct.toFixed(1)}%`;
    const bar = pnl >= 0
      ? "█".repeat(Math.min(30, Math.round(pnl / 50000)))
      : "▓".repeat(Math.min(30, Math.round(-pnl / 50000)));

    console.log(
      m.month.padEnd(10) +
      `${(m.startEquity / 10000).toFixed(1)}万`.padStart(12) +
      `${(m.endEquity / 10000).toFixed(1)}万`.padStart(12) +
      pnlStr.padStart(12) +
      pctStr.padStart(8) +
      String(m.trades).padStart(6) +
      String(m.wins).padStart(4) +
      String(m.losses).padStart(4) +
      String(m.maxPositions).padStart(8) +
      String(m.skipped).padStart(7) +
      `  ${cumStr}  ${bar}`
    );
  }

  console.log("─".repeat(95));
  console.log(`\n${"═".repeat(60)}`);
  console.log("  サマリー");
  console.log("═".repeat(60));
  console.log(`初期資金:         ${(INITIAL_CAPITAL / 10000).toFixed(0)}万円`);
  console.log(`最終資金:         ${(finalEquity / 10000).toFixed(1)}万円`);
  console.log(`合計損益:         ${totalPnl >= 0 ? "+" : ""}${(totalPnl / 10000).toFixed(1)}万円 (${((totalPnl / INITIAL_CAPITAL) * 100).toFixed(1)}%)`);
  console.log(`元本倍率:         ${(finalEquity / INITIAL_CAPITAL).toFixed(2)}倍`);
  console.log(`年率リターン:     ${((totalPnl / INITIAL_CAPITAL) / periodYears * 100).toFixed(1)}%`);
  console.log(`─────────────────────────────────`);
  console.log(`実行トレード:     ${takenTrades}`);
  console.log(`勝ち:             ${totalWins}`);
  console.log(`負け:             ${totalLosses}`);
  console.log(`勝率:             ${(totalWins / totalTrades * 100).toFixed(1)}%`);
  console.log(`見送りシグナル:   ${skippedSignals}`);
  console.log(`─────────────────────────────────`);
  console.log(`最大DD:           -${maxDD.toFixed(1)}% (${maxDDMonth})`);
  console.log(`最高残高:         ${(peakEquity / 10000).toFixed(1)}万円`);

  const profitMonths = monthlyData.filter(m => m.endEquity > m.startEquity).length;
  console.log(`月間プラス率:     ${profitMonths}/${monthlyData.length} (${(profitMonths / monthlyData.length * 100).toFixed(1)}%)`);
}

main();

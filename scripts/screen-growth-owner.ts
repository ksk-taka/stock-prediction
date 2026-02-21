/**
 * 成長オーナー企業スクリーニング
 * 条件:
 *   1. 売上高成長 20%以上 (YoY)
 *   2. 営業利益率 10%以上
 *   3. 上場5年以内 (2021年以降IPO)
 *   4. オーナー企業 (筆頭株主が個人 = 大株主持株比率から推定)
 *
 * Usage:
 *   npx tsx scripts/screen-growth-owner.ts
 *   npx tsx scripts/screen-growth-owner.ts --csv
 *   npx tsx scripts/screen-growth-owner.ts --market prime
 */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import YahooFinance from "yahoo-finance2";
import { RequestQueue } from "@/lib/utils/requestQueue";

const yf = new YahooFinance();
const queue = new RequestQueue(8);

interface WatchlistStock {
  symbol: string;
  name: string;
  favorite?: boolean;
  market?: string;
  marketSegment?: string;
}

interface ScreenResult {
  symbol: string;
  name: string;
  marketSegment: string;
  firstTradeDate: string;
  revenueGrowth: number;       // % (e.g., 25.3)
  operatingMargin: number;     // % (e.g., 12.5)
  marketCap: number;           // 億円
  per: number | null;
  pbr: number | null;
  roe: number | null;
  insiderHeld: number | null;  // % (大株主持株比率)
  sector: string;
}

// ── args ──
const args = process.argv.slice(2);
const csvMode = args.includes("--csv");
const marketFilter = args.includes("--market")
  ? args[args.indexOf("--market") + 1]
  : null;
const IPO_CUTOFF = new Date();
IPO_CUTOFF.setFullYear(IPO_CUTOFF.getFullYear() - 5);

// ── 1. 全銘柄ロード ──
function loadStocks(): WatchlistStock[] {
  const raw = readFileSync(join(process.cwd(), "data", "watchlist.json"), "utf-8");
  const wl = JSON.parse(raw) as { stocks: WatchlistStock[] };
  let stocks = wl.stocks.filter((s) => s.market === "JP");
  if (marketFilter) {
    const seg = marketFilter === "prime" ? "プライム"
      : marketFilter === "standard" ? "スタンダード"
      : marketFilter === "growth" ? "グロース"
      : marketFilter;
    stocks = stocks.filter((s) => s.marketSegment === seg);
  }
  return stocks;
}

// ── 2. IPOフィルタ (firstTradeDate) ──
async function filterByIPO(stocks: WatchlistStock[]): Promise<Map<string, { firstTradeDate: string; name: string; marketSegment: string }>> {
  const result = new Map<string, { firstTradeDate: string; name: string; marketSegment: string }>();

  // バッチ quote で firstTradeDate 取得 (100件ずつ)
  const BATCH = 100;
  for (let i = 0; i < stocks.length; i += BATCH) {
    const batch = stocks.slice(i, i + BATCH);
    const symbols = batch.map((s) => s.symbol);
    try {
      const quotes = await queue.add(() => yf.quote(symbols));
      const arr = Array.isArray(quotes) ? quotes : [quotes];
      for (const q of arr) {
        const r = q as Record<string, unknown>;
        const ftd = r.firstTradeDateMilliseconds;
        if (ftd instanceof Date && ftd >= IPO_CUTOFF) {
          const stock = batch.find((s) => s.symbol === q.symbol);
          result.set(q.symbol, {
            firstTradeDate: ftd.toISOString().split("T")[0],
            name: (r.shortName as string) ?? stock?.name ?? q.symbol,
            marketSegment: stock?.marketSegment ?? "",
          });
        }
      }
    } catch (e) {
      console.error(`  quote batch error (${i}-${i + BATCH}):`, (e as Error).message);
    }
    if (i + BATCH < stocks.length) {
      process.stdout.write(`\r  IPOフィルタ: ${Math.min(i + BATCH, stocks.length)}/${stocks.length}`);
    }
  }
  console.log(`\r  IPOフィルタ: ${stocks.length}/${stocks.length} → ${result.size}銘柄が上場5年以内`);
  return result;
}

// ── 3. 財務データ取得 + スクリーニング ──
async function screenFinancials(
  candidates: Map<string, { firstTradeDate: string; name: string; marketSegment: string }>
): Promise<ScreenResult[]> {
  const results: ScreenResult[] = [];
  const symbols = [...candidates.keys()];
  let done = 0;

  await Promise.all(
    symbols.map((symbol) =>
      queue.add(async () => {
        try {
          const summary = await yf.quoteSummary(symbol, {
            modules: ["financialData", "defaultKeyStatistics", "summaryDetail", "majorHoldersBreakdown"],
          });

          const fd = summary.financialData as Record<string, unknown> | undefined;
          const ks = summary.defaultKeyStatistics as Record<string, unknown> | undefined;
          const sd = summary.summaryDetail as Record<string, unknown> | undefined;
          const mh = summary.majorHoldersBreakdown as Record<string, unknown> | undefined;

          let revenueGrowth = fd?.revenueGrowth as number | undefined;
          let operatingMargins = fd?.operatingMargins as number | undefined;

          // EDINET XBRL フォールバック: YFで成長率/利益率が取れない場合
          if (revenueGrowth == null || operatingMargins == null) {
            try {
              const { getCachedEdinetFinancials } = await import("../src/lib/cache/edinetCache");
              const edinet = getCachedEdinetFinancials(symbol);
              if (edinet?.netSales != null && edinet.netSales > 0 && edinet.operatingIncome != null) {
                if (operatingMargins == null) {
                  operatingMargins = edinet.operatingIncome / edinet.netSales;
                }
              }
            } catch { /* EDINET cache not available */ }
          }

          // フィルタ: 売上成長20%以上 & 営業利益率10%以上
          if (
            revenueGrowth != null && revenueGrowth >= 0.20 &&
            operatingMargins != null && operatingMargins >= 0.10
          ) {
            const info = candidates.get(symbol)!;
            const marketCap = (fd?.totalRevenue as number ?? 0) > 0
              ? ((sd?.marketCap ?? fd?.marketCap ?? 0) as number)
              : 0;

            // insidersPercentHeld = 個人大株主の持ち分 (オーナー企業判定に使用)
            const insiderPct = mh?.insidersPercentHeld as number | undefined;

            results.push({
              symbol,
              name: info.name,
              marketSegment: info.marketSegment,
              firstTradeDate: info.firstTradeDate,
              revenueGrowth: Math.round(revenueGrowth * 1000) / 10,
              operatingMargin: Math.round((operatingMargins as number) * 1000) / 10,
              marketCap: Math.round(marketCap / 1e8),
              per: (sd?.trailingPE as number) ?? null,
              pbr: (sd?.priceToBook as number) ?? null,
              roe: (fd?.returnOnEquity as number) != null
                ? Math.round((fd?.returnOnEquity as number) * 1000) / 10
                : null,
              insiderHeld: insiderPct != null ? Math.round(insiderPct * 1000) / 10 : null,
              sector: "",
            });
          }
        } catch {
          // skip
        }
        done++;
        if (done % 50 === 0 || done === symbols.length) {
          process.stdout.write(`\r  財務スクリーニング: ${done}/${symbols.length}`);
        }
      })
    )
  );

  console.log();
  return results.sort((a, b) => b.revenueGrowth - a.revenueGrowth);
}

// ── main ──
async function main() {
  console.log("=== 成長オーナー企業スクリーニング ===");
  console.log(`条件: 売上成長≥20% / 営業利益率≥10% / 上場5年以内 (${IPO_CUTOFF.toISOString().split("T")[0]}以降)`);
  if (marketFilter) console.log(`市場: ${marketFilter}`);
  console.log();

  // 1. 全銘柄ロード
  const stocks = loadStocks();
  console.log(`対象: ${stocks.length}銘柄`);

  // 2. IPOフィルタ
  const ipoCandidates = await filterByIPO(stocks);
  if (ipoCandidates.size === 0) {
    console.log("上場5年以内の銘柄が見つかりませんでした");
    return;
  }

  // 3. 財務スクリーニング
  console.log(`\n財務データ取得中 (${ipoCandidates.size}銘柄)...`);
  const results = await screenFinancials(ipoCandidates);

  // 4. 結果表示
  console.log(`\n=== 結果: ${results.length}銘柄 ===\n`);

  if (results.length === 0) {
    console.log("条件に合致する銘柄はありませんでした");
    return;
  }

  // テーブル表示
  console.log(
    "コード".padEnd(10) +
    "銘柄名".padEnd(24) +
    "市場".padEnd(10) +
    "上場日".padEnd(12) +
    "売上成長%".padStart(10) +
    "営業利益率%".padStart(12) +
    "ROE%".padStart(8) +
    "PER".padStart(8) +
    "PBR".padStart(8) +
    "時価総額(億)".padStart(14) +
    "Insider%".padStart(10)
  );
  console.log("-".repeat(126));

  for (const r of results) {
    console.log(
      r.symbol.padEnd(10) +
      r.name.slice(0, 20).padEnd(24) +
      r.marketSegment.padEnd(10) +
      r.firstTradeDate.padEnd(12) +
      `${r.revenueGrowth.toFixed(1)}%`.padStart(10) +
      `${r.operatingMargin.toFixed(1)}%`.padStart(12) +
      (r.roe != null ? `${r.roe.toFixed(1)}%` : "N/A").padStart(8) +
      (r.per != null ? r.per.toFixed(1) : "N/A").padStart(8) +
      (r.pbr != null ? r.pbr.toFixed(2) : "N/A").padStart(8) +
      `${r.marketCap}`.padStart(14) +
      (r.insiderHeld != null ? `${r.insiderHeld.toFixed(1)}%` : "N/A").padStart(10)
    );
  }

  // Insider% が高い銘柄をオーナー企業候補として表示
  const ownerCandidates = results.filter((r) => r.insiderHeld != null && r.insiderHeld >= 20);
  if (ownerCandidates.length > 0) {
    console.log(`\n=== オーナー企業候補 (Insider保有≥20%): ${ownerCandidates.length}銘柄 ===`);
    for (const r of ownerCandidates) {
      console.log(`  ${r.symbol} ${r.name} - Insider ${r.insiderHeld!.toFixed(1)}% / 売上+${r.revenueGrowth.toFixed(1)}% / 営利${r.operatingMargin.toFixed(1)}%`);
    }
  }

  // CSV出力
  if (csvMode) {
    const header = "コード,銘柄名,市場,上場日,売上成長%,営業利益率%,ROE%,PER,PBR,時価総額(億),Insider%";
    const rows = results.map((r) =>
      [
        r.symbol, r.name, r.marketSegment, r.firstTradeDate,
        r.revenueGrowth, r.operatingMargin, r.roe ?? "", r.per ?? "", r.pbr ?? "",
        r.marketCap, r.insiderHeld ?? "",
      ].join(",")
    );
    const csv = [header, ...rows].join("\n");
    const outPath = join(process.cwd(), "data", "screen-growth-owner.csv");
    writeFileSync(outPath, csv);
    console.log(`\nCSV出力: ${outPath}`);
  }
}

main().catch(console.error);

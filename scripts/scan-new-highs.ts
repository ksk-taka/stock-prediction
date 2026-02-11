#!/usr/bin/env npx tsx
// ============================================================
// 新高値スキャナー - Kabutan年初来高値 + 52週高値ブレイクアウト検出
//
// 使い方:
//   npx tsx scripts/scan-new-highs.ts                # コンソール出力
//   npx tsx scripts/scan-new-highs.ts --csv           # CSV出力あり
//   npx tsx scripts/scan-new-highs.ts --per 15,25     # PER範囲指定
//   npx tsx scripts/scan-new-highs.ts --market prime  # 市場区分フィルタ
//   npx tsx scripts/scan-new-highs.ts --all-ytd       # 52w判定なし全件表示
//   npx tsx scripts/scan-new-highs.ts --pages 2       # テスト用(2ページのみ)
//   npx tsx scripts/scan-new-highs.ts --debug         # HTMLデバッグ出力
//   npx tsx scripts/scan-new-highs.ts --supabase      # Supabaseにアップロード
//   npx tsx scripts/scan-new-highs.ts --scan-id 42    # 既存レコードを更新 (GitHub Actions用)
// ============================================================

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { writeFileSync } from "fs";
import { join } from "path";
import { createServiceClient } from "@/lib/supabase/service";
import * as cheerio from "cheerio";
import YahooFinance from "yahoo-finance2";
import { yfQueue } from "@/lib/utils/requestQueue";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

// ── Types ──────────────────────────────────────────────────

interface KabutanStock {
  code: string;
  name: string;
  market: string;
  price: number;
  changePct: number;
  volume: number;
  per: number | null;
  pbr: number | null;
  yield: number | null;
}

interface BreakoutStock extends KabutanStock {
  symbol: string;
  fiftyTwoWeekHigh: number;
  currentYfPrice: number;
  isTrue52wBreakout: boolean;
  pctAbove52wHigh: number;
  consolidationDays: number;
  consolidationRangePct: number;
  simpleNcRatio: number | null;
}

// ── CLI Args ───────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const idx = args.indexOf(flag);
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
  };

  const outputCsv = args.includes("--csv");
  const perRange = get("--per")?.split(",").map(Number) ?? [10, 30];
  const perMin = perRange[0] ?? 10;
  const perMax = perRange[1] ?? 30;
  const marketFilter = get("--market");
  const maxPages = get("--pages") ? parseInt(get("--pages")!, 10) : undefined;
  const breakoutOnly = !args.includes("--all-ytd");
  const debug = args.includes("--debug");

  const uploadToSupabase = args.includes("--supabase");
  const scanId = get("--scan-id") ? parseInt(get("--scan-id")!, 10) : undefined;

  return { outputCsv, perMin, perMax, marketFilter, maxPages, breakoutOnly, debug, uploadToSupabase, scanId };
}

// ── Kabutan Scraping ───────────────────────────────────────

const KABUTAN_BASE_URL = "https://kabutan.jp/warning/";
const KABUTAN_DELAY_MS = 800;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchKabutanPage(
  page: number,
  debug: boolean,
): Promise<{ stocks: KabutanStock[]; hasNextPage: boolean; totalStocks?: number }> {
  const url = `${KABUTAN_BASE_URL}?mode=2_1&market=0&capitalization=-1&stc=&stm=0&page=${page}`;

  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "Accept-Language": "ja,en;q=0.9",
    },
  });

  if (!res.ok) {
    throw new Error(`Kabutan fetch failed: ${res.status} ${res.statusText}`);
  }

  const html = await res.text();
  return parseKabutanHtml(html, debug);
}

function parseKabutanHtml(
  html: string,
  debug: boolean,
): { stocks: KabutanStock[]; hasNextPage: boolean; totalStocks?: number } {
  const $ = cheerio.load(html);
  const stocks: KabutanStock[] = [];

  if (debug) {
    const tables = $("table");
    console.log(`[DEBUG] Found ${tables.length} tables`);
    tables.each((i, el) => {
      const cls = $(el).attr("class") ?? "(none)";
      const rows = $(el).find("tr").length;
      console.log(`  table[${i}]: class="${cls}", rows=${rows}`);
    });
  }

  // Kabutan stock_table structure:
  //   row[0]: header (all <th>: コード, 銘柄名, 市場, ..., PER, PBR, 利回り)
  //   row[1+]: data — name in <th>, rest in <td>
  //     td[0]=code, td[1]=market, td[2,3]=empty, td[4]=price, td[5]=flag(S等),
  //     td[6]=change, td[7]=change%, td[8]=volume, td[9]=PER, td[10]=PBR, td[11]=yield
  const stockTable = $("table.stock_table");
  const dataRows = stockTable.find("tr").filter((_, el) => {
    return $(el).find("td").length > 0;
  });

  if (debug) {
    console.log(`[DEBUG] stock_table found: ${stockTable.length}`);
    console.log(`[DEBUG] Data rows: ${dataRows.length}`);
  }

  const parseNum = (s: string): number | null => {
    const cleaned = s.replace(/[,+%　 ]/g, "");
    if (cleaned === "－" || cleaned === "---" || cleaned === "" || cleaned === "S") return null;
    const n = parseFloat(cleaned);
    return isNaN(n) ? null : n;
  };

  dataRows.each((_, row) => {
    const tds = $(row).find("td");
    const name = $(row).find("th").first().text().trim();
    if (tds.length < 10 || !name) return;

    const code = $(tds[0]).text().trim();
    if (!/^\d{4}$/.test(code)) return;

    const market = $(tds[1]).text().trim();
    const price = parseNum($(tds[4]).text().trim());
    if (price === null) return;

    const changePct = parseNum($(tds[7]).text().trim()) ?? 0;
    const volume = parseNum($(tds[8]).text().trim()) ?? 0;
    const per = parseNum($(tds[9]).text().trim());
    const pbr = parseNum($(tds[10]).text().trim());
    const yieldVal = tds.length > 11 ? parseNum($(tds[11]).text().trim()) : null;

    stocks.push({
      code,
      name: name.replace(/\s+/g, ""),
      market,
      price,
      changePct,
      volume,
      per,
      pbr,
      yield: yieldVal,
    });
  });

  // Check for next page
  const hasNextPage =
    $('a:contains("次へ")').length > 0 || $('a[href*="page="]').last().text().includes("次");

  // Total count
  let totalStocks: number | undefined;
  const totalMatch = $.text().match(/(\d[\d,]*)\s*銘柄/);
  if (totalMatch) {
    totalStocks = parseInt(totalMatch[1].replace(/,/g, ""), 10);
  }

  return { stocks, hasNextPage, totalStocks };
}

async function fetchAllKabutanPages(maxPages?: number, debug = false, scanId?: number): Promise<KabutanStock[]> {
  const allStocks: KabutanStock[] = [];
  let page = 1;
  let hasNext = true;
  let estimatedTotalPages = maxPages ?? 130; // 推定値

  console.log("Kabutan 年初来高値ページをスクレイピング中...");

  while (hasNext) {
    if (maxPages && page > maxPages) break;

    try {
      const result = await fetchKabutanPage(page, debug && page === 1);
      allStocks.push(...result.stocks);
      hasNext = result.hasNextPage;

      if (page === 1 && result.totalStocks) {
        estimatedTotalPages = Math.ceil(result.totalStocks / 50);
        console.log(`  合計: ${result.totalStocks}銘柄 (推定${estimatedTotalPages}ページ)`);
      }

      if (page === 1 && result.stocks.length === 0) {
        console.error("  ページ1から0件取得 — HTML構造が変更された可能性があります");
        if (debug) {
          console.log("  --debug で出力されたテーブル構造を確認してください");
        } else {
          console.log("  --debug フラグを付けて再実行してください");
        }
        break;
      }

      process.stdout.write(`\r  ページ ${page} 取得完了 (累計 ${allStocks.length} 銘柄)`);

      // 10ページごとに進捗報告
      if (scanId && page % 10 === 0) {
        const total = maxPages ? Math.min(maxPages, estimatedTotalPages) : estimatedTotalPages;
        await updateProgress(scanId, {
          stage: "kabutan",
          current: page,
          total,
          message: `Kabutan: ${page}/${total}ページ取得中`,
        });
      }

      if (hasNext && !(maxPages && page >= maxPages)) {
        await sleep(KABUTAN_DELAY_MS);
      }
      page++;
    } catch (err) {
      console.error(
        `\n  ページ ${page} でエラー: ${err instanceof Error ? err.message : err}`,
      );
      if (page > 3 && allStocks.length === 0) {
        console.error("  連続エラー — 中断します");
        break;
      }
      page++;
      await sleep(KABUTAN_DELAY_MS);
    }
  }

  console.log(`\n  スクレイピング完了: ${allStocks.length} 銘柄取得\n`);
  return allStocks;
}

// ── Filters ────────────────────────────────────────────────

const MARKET_MAP: Record<string, string[]> = {
  prime: ["東Ｐ", "東P"],
  standard: ["東Ｓ", "東S"],
  growth: ["東Ｇ", "東G"],
};

function filterByMarket(stocks: KabutanStock[], marketFilter?: string): KabutanStock[] {
  if (!marketFilter) return stocks;
  const allowed = MARKET_MAP[marketFilter.toLowerCase()];
  if (!allowed) {
    console.warn(`  Unknown market filter: ${marketFilter} (valid: prime, standard, growth)`);
    return stocks;
  }
  return stocks.filter((s) => allowed.some((m) => s.market.includes(m)));
}

function filterByPer(stocks: KabutanStock[], perMin: number, perMax: number): KabutanStock[] {
  return stocks.filter((s) => s.per !== null && s.per >= perMin && s.per <= perMax);
}

// ── Consolidation Detection ──────────────────────────────

const CONSOLIDATION_THRESHOLD = 0.10; // 10% range

function detectConsolidation(
  closes: number[],
  threshold = CONSOLIDATION_THRESHOLD,
): { days: number; rangePct: number } {
  if (closes.length < 3) return { days: 0, rangePct: 0 };

  // Work backward from the end to find the longest tight-range period
  let maxP = closes[closes.length - 1];
  let minP = closes[closes.length - 1];
  let sum = closes[closes.length - 1];
  let days = 1;

  for (let i = closes.length - 2; i >= 0 && i >= closes.length - 60; i--) {
    const c = closes[i];
    const newMax = Math.max(maxP, c);
    const newMin = Math.min(minP, c);
    const newAvg = (sum + c) / (days + 1);

    if ((newMax - newMin) / newAvg > threshold) break;

    maxP = newMax;
    minP = newMin;
    sum += c;
    days++;
  }

  const avg = sum / days;
  const rangePct = days > 1 ? ((maxP - minP) / avg) * 100 : 0;

  return { days, rangePct };
}

async function addConsolidationData(stocks: BreakoutStock[], scanId?: number): Promise<void> {
  const targets = stocks.filter((s) => s.isTrue52wBreakout);
  if (targets.length === 0) return;

  console.log(`\nもみ合い分析中... (${targets.length} 銘柄)`);

  const BATCH_SIZE = 30;
  let completed = 0;

  const period1 = new Date();
  period1.setDate(period1.getDate() - 120);

  if (scanId) {
    await updateProgress(scanId, {
      stage: "consolidation",
      current: 0,
      total: targets.length,
      message: `もみ合い分析: 0/${targets.length}銘柄`,
    });
  }

  for (let i = 0; i < targets.length; i += BATCH_SIZE) {
    const batch = targets.slice(i, i + BATCH_SIZE);

    await Promise.allSettled(
      batch.map(async (stock) => {
        try {
          const result = await yfQueue.add(() =>
            yf.chart(stock.symbol, { period1, interval: "1d" }),
          );
          const quotes = (result as unknown as { quotes: { close: number }[] }).quotes;
          if (!quotes?.length || quotes.length < 5) return;

          // Exclude the last day (today's breakout move)
          const closes = quotes
            .slice(0, -1)
            .map((q) => q.close)
            .filter((c) => c > 0);

          const { days, rangePct } = detectConsolidation(closes);
          stock.consolidationDays = days;
          stock.consolidationRangePct = rangePct;
        } catch {
          // leave defaults (0)
        }
      }),
    );

    completed += batch.length;
    process.stdout.write(`\r  [${completed}/${targets.length}] 分析完了`);

    if (scanId) {
      await updateProgress(scanId, {
        stage: "consolidation",
        current: Math.min(completed, targets.length),
        total: targets.length,
        message: `もみ合い分析: ${Math.min(completed, targets.length)}/${targets.length}銘柄`,
      });
    }
  }
  console.log("");
}

// ── 簡易ネットキャッシュ比率 ──────────────────────────────

async function addNetCashData(stocks: BreakoutStock[]): Promise<void> {
  if (stocks.length === 0) return;

  console.log(`\n簡易NC率計算中... (${stocks.length} 銘柄)`);

  const BATCH_SIZE = 30;
  let completed = 0;

  const period1 = new Date();
  period1.setFullYear(period1.getFullYear() - 1);

  for (let i = 0; i < stocks.length; i += BATCH_SIZE) {
    const batch = stocks.slice(i, i + BATCH_SIZE);

    await Promise.allSettled(
      batch.map(async (stock) => {
        try {
          const [bsResult, quoteResult] = await Promise.all([
            yfQueue.add(() =>
              yf.fundamentalsTimeSeries(stock.symbol, {
                period1,
                type: "quarterly",
                module: "balance-sheet",
              })
            ),
            yfQueue.add(() => yf.quote(stock.symbol)),
          ]);

          const q = quoteResult as Record<string, unknown>;
          const marketCap = (q.marketCap as number) ?? 0;
          if (marketCap <= 0 || !bsResult || bsResult.length === 0) return;

          const bs = bsResult[bsResult.length - 1] as Record<string, unknown>;
          const currentAssets = (bs.currentAssets as number) ?? 0;
          const investmentInFA =
            (bs.investmentinFinancialAssets as number) ??
            (bs.availableForSaleSecurities as number) ??
            (bs.investmentsAndAdvances as number) ??
            0;
          const totalLiabilities = (bs.totalLiabilitiesNetMinorityInterest as number) ?? 0;

          if (currentAssets === 0 && totalLiabilities === 0) return;

          const netCash = currentAssets + investmentInFA * 0.7 - totalLiabilities;
          stock.simpleNcRatio = Math.round((netCash / marketCap) * 1000) / 10;
        } catch {
          // leave null
        }
      }),
    );

    completed += batch.length;
    process.stdout.write(`\r  [${completed}/${stocks.length}] 計算完了`);
  }
  console.log("");
}

// ── 52-Week High Check ─────────────────────────────────────

async function checkFiftyTwoWeekBreakouts(stocks: KabutanStock[], scanId?: number): Promise<BreakoutStock[]> {
  const results: BreakoutStock[] = [];
  let completed = 0;
  let errors = 0;

  console.log(`52週高値チェック中... (${stocks.length} 銘柄)`);

  const BATCH_SIZE = 30;

  for (let i = 0; i < stocks.length; i += BATCH_SIZE) {
    const batch = stocks.slice(i, i + BATCH_SIZE);

    const batchResults = await Promise.allSettled(
      batch.map(async (stock) => {
        const symbol = `${stock.code}.T`;

        try {
          const result = await yfQueue.add(() => yf.quote(symbol));
          const r = result as Record<string, unknown>;

          const fiftyTwoWeekHigh = r.fiftyTwoWeekHigh as number | undefined;
          const currentYfPrice = (r.regularMarketPrice as number) ?? stock.price;

          if (fiftyTwoWeekHigh == null || fiftyTwoWeekHigh === 0) {
            return null;
          }

          const pctAbove52wHigh =
            ((currentYfPrice - fiftyTwoWeekHigh) / fiftyTwoWeekHigh) * 100;
          const isTrue52wBreakout = pctAbove52wHigh >= -0.5;

          return {
            ...stock,
            symbol,
            fiftyTwoWeekHigh,
            currentYfPrice,
            isTrue52wBreakout,
            pctAbove52wHigh,
            consolidationDays: 0,
            consolidationRangePct: 0,
            simpleNcRatio: null,
          } as BreakoutStock;
        } catch {
          return null;
        }
      }),
    );

    for (const result of batchResults) {
      completed++;
      if (result.status === "fulfilled" && result.value) {
        results.push(result.value);
      } else if (result.status === "rejected") {
        errors++;
      }
    }

    process.stdout.write(
      `\r  [${completed}/${stocks.length}] チェック完了${errors > 0 ? ` (エラー: ${errors}件)` : ""}`,
    );

    // 3バッチ(90銘柄)ごとに進捗報告
    if (scanId && Math.floor(i / BATCH_SIZE) % 3 === 0) {
      await updateProgress(scanId, {
        stage: "yf_check",
        current: completed,
        total: stocks.length,
        message: `52週高値チェック: ${completed}/${stocks.length}銘柄`,
      });
    }
  }

  console.log("");
  return results;
}

// ── Output ─────────────────────────────────────────────────

function displayWidth(str: string): number {
  let w = 0;
  for (const ch of str) {
    w += ch.charCodeAt(0) > 0x7f ? 2 : 1;
  }
  return w;
}

function padEndW(str: string, width: number): string {
  return str + " ".repeat(Math.max(0, width - displayWidth(str)));
}

function truncateName(name: string, maxWidth: number): string {
  let w = 0;
  let result = "";
  for (const ch of name) {
    const cw = ch.charCodeAt(0) > 0x7f ? 2 : 1;
    if (w + cw > maxWidth) break;
    result += ch;
    w += cw;
  }
  return result;
}

function printResults(stocks: BreakoutStock[], breakoutOnly: boolean): void {
  const filtered = breakoutOnly ? stocks.filter((s) => s.isTrue52wBreakout) : stocks;
  filtered.sort((a, b) => b.pctAbove52wHigh - a.pctAbove52wHigh);

  console.log("\n" + "=".repeat(110));
  console.log(
    breakoutOnly
      ? `52週高値ブレイクアウト銘柄 (${filtered.length}銘柄)`
      : `年初来高値銘柄 PERフィルタ済 (${filtered.length}銘柄)`,
  );
  console.log("=".repeat(110));

  const header =
    "コード  " +
    padEndW("銘柄名", 20) +
    "  市場 " +
    "    株価" +
    " 前日比%" +
    "    PER" +
    "   PBR" +
    "  52w高値" +
    "  乖離%" +
    " もみ合" +
    " ﾚﾝｼﾞ%";
  console.log(header);
  console.log("-".repeat(110));

  for (const s of filtered) {
    const aboveStr =
      s.pctAbove52wHigh >= 0
        ? `+${s.pctAbove52wHigh.toFixed(1)}%`
        : `${s.pctAbove52wHigh.toFixed(1)}%`;

    const consStr = s.consolidationDays > 0 ? `${s.consolidationDays}日` : "  －";
    const consRangeStr =
      s.consolidationDays > 0 ? `${s.consolidationRangePct.toFixed(1)}%` : " －";

    const line =
      s.code.padEnd(8) +
      padEndW(truncateName(s.name, 18), 20) +
      "  " +
      padEndW(s.market, 5) +
      s.currentYfPrice.toLocaleString().padStart(8) +
      `${s.changePct >= 0 ? "+" : ""}${s.changePct.toFixed(1)}%`.padStart(8) +
      (s.per !== null ? s.per.toFixed(1) : "  －").padStart(7) +
      (s.pbr !== null ? s.pbr.toFixed(2) : " －").padStart(6) +
      s.fiftyTwoWeekHigh.toLocaleString().padStart(9) +
      aboveStr.padStart(8) +
      consStr.padStart(6) +
      consRangeStr.padStart(7);

    console.log(line);
  }
}

function writeCsv(stocks: BreakoutStock[]): string {
  const header = [
    "code",
    "symbol",
    "name",
    "market",
    "price",
    "changePct",
    "volume",
    "per",
    "pbr",
    "yield",
    "fiftyTwoWeekHigh",
    "currentYfPrice",
    "isTrue52wBreakout",
    "pctAbove52wHigh",
    "consolidationDays",
    "consolidationRangePct",
    "simpleNcRatio",
  ].join(",");

  const rows = stocks.map((s) =>
    [
      s.code,
      s.symbol,
      `"${s.name}"`,
      `"${s.market}"`,
      s.price,
      s.changePct.toFixed(2),
      s.volume,
      s.per ?? "",
      s.pbr ?? "",
      s.yield ?? "",
      s.fiftyTwoWeekHigh,
      s.currentYfPrice,
      s.isTrue52wBreakout ? "TRUE" : "FALSE",
      s.pctAbove52wHigh.toFixed(2),
      s.consolidationDays,
      s.consolidationRangePct.toFixed(2),
      s.simpleNcRatio != null ? s.simpleNcRatio.toFixed(1) : "",
    ].join(","),
  );

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const csvPath = join(process.cwd(), "data", `new-highs-${timestamp}.csv`);
  const content = [header, ...rows].join("\n");
  writeFileSync(csvPath, content, "utf-8");
  return csvPath;
}

// ── Supabase Progress ─────────────────────────────────────

interface ScanProgress {
  stage: "kabutan" | "yf_check" | "consolidation" | "uploading";
  current: number;
  total: number;
  message: string;
}

async function updateProgress(scanId: number | undefined, progress: ScanProgress): Promise<void> {
  if (!scanId) return;
  try {
    const supabase = createServiceClient();
    await supabase
      .from("new_highs_scans")
      .update({ progress })
      .eq("id", scanId);
  } catch { /* best effort */ }
}

// ── Supabase Upload ──────────────────────────────────────

async function uploadScanResults(
  stocks: BreakoutStock[],
  scanId?: number,
): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error("Supabase env vars not set, skipping upload");
    return;
  }

  const supabase = createServiceClient();
  const breakouts = stocks.filter((s) => s.isTrue52wBreakout);

  const payload = {
    status: "completed" as const,
    stocks: JSON.stringify(stocks),
    stock_count: stocks.length,
    breakout_count: breakouts.length,
    completed_at: new Date().toISOString(),
  };

  if (scanId) {
    const { error } = await supabase
      .from("new_highs_scans")
      .update(payload)
      .eq("id", scanId);
    if (error) console.error("Supabase update error:", error);
    else console.log(`Supabase scan #${scanId} updated`);
  } else {
    const { error } = await supabase
      .from("new_highs_scans")
      .insert(payload);
    if (error) console.error("Supabase insert error:", error);
    else console.log("Supabase scan result uploaded");
  }
}

async function markScanFailed(scanId: number, errorMsg: string): Promise<void> {
  try {
    const supabase = createServiceClient();
    await supabase
      .from("new_highs_scans")
      .update({ status: "failed", error_message: errorMsg, completed_at: new Date().toISOString() })
      .eq("id", scanId);
  } catch { /* best effort */ }
}

// ── Main ───────────────────────────────────────────────────

async function main() {
  const { outputCsv, perMin, perMax, marketFilter, maxPages, breakoutOnly, debug, uploadToSupabase: doSupabase, scanId } = parseArgs();
  const startTime = Date.now();

  console.log("=".repeat(60));
  console.log(
    `新高値スキャナー (${new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })})`,
  );
  console.log(`  PERフィルタ: ${perMin} - ${perMax}`);
  if (marketFilter) console.log(`  市場区分: ${marketFilter}`);
  console.log(`  出力: ${breakoutOnly ? "52週高値ブレイクアウトのみ" : "年初来高値全件"}`);
  console.log("=".repeat(60));

  // 初期進捗 (GitHub Actions 用)
  if (doSupabase && scanId) {
    await updateProgress(scanId, {
      stage: "kabutan",
      current: 0,
      total: maxPages ?? 130,
      message: "Kabutan スクレイピング開始...",
    });
  }

  // Step 1: Scrape Kabutan
  const allStocks = await fetchAllKabutanPages(maxPages, debug, doSupabase ? scanId : undefined);
  if (allStocks.length === 0) {
    console.error("Kabutan からデータを取得できませんでした。");
    process.exit(1);
  }

  // Step 2: Market filter
  const marketFiltered = filterByMarket(allStocks, marketFilter);
  console.log(`市場フィルタ後: ${marketFiltered.length} 銘柄`);

  // Step 3: PER filter
  const perFiltered = filterByPer(marketFiltered, perMin, perMax);
  console.log(`PERフィルタ後 (${perMin}-${perMax}): ${perFiltered.length} 銘柄\n`);

  if (perFiltered.length === 0) {
    console.log("条件に合う銘柄がありませんでした。");
    return;
  }

  // Step 4: 52-week high check
  const breakouts = await checkFiftyTwoWeekBreakouts(perFiltered, doSupabase ? scanId : undefined);
  const true52wBreakouts = breakouts.filter((s) => s.isTrue52wBreakout);

  console.log(`\n52週高値ブレイクアウト: ${true52wBreakouts.length} / ${breakouts.length} 銘柄`);

  // Step 5: Consolidation analysis
  await addConsolidationData(breakouts, doSupabase ? scanId : undefined);
  const withConsolidation = true52wBreakouts.filter((s) => s.consolidationDays >= 10);
  console.log(`もみ合い (≥10日) 付きブレイクアウト: ${withConsolidation.length} 銘柄`);

  // Step 5.5: 簡易ネットキャッシュ比率
  await addNetCashData(true52wBreakouts);

  // Step 6: Display
  printResults(breakouts, breakoutOnly);

  // Step 7: CSV
  const displayStocks = breakoutOnly ? true52wBreakouts : breakouts;
  displayStocks.sort((a, b) => b.pctAbove52wHigh - a.pctAbove52wHigh);

  if (outputCsv) {
    const csvPath = writeCsv(displayStocks);
    console.log(`\nCSV出力: ${csvPath}`);
  }

  // Step 8: Supabase upload
  if (doSupabase) {
    if (scanId) {
      await updateProgress(scanId, {
        stage: "uploading",
        current: 0,
        total: 0,
        message: "結果アップロード中...",
      });
    }
    await uploadScanResults(displayStocks, scanId);
  }

  // Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("\n" + "=".repeat(60));
  console.log(`完了 (${elapsed}秒)`);
  console.log(`  Kabutan取得: ${allStocks.length} 銘柄`);
  console.log(`  PERフィルタ通過: ${perFiltered.length} 銘柄`);
  console.log(`  52週ブレイクアウト: ${true52wBreakouts.length} 銘柄`);
  console.log("=".repeat(60));
}

main().catch(async (err) => {
  console.error("Fatal error:", err);
  const { scanId, uploadToSupabase: doSupabase } = parseArgs();
  if (doSupabase && scanId) {
    await markScanFailed(scanId, String(err));
  }
  process.exit(1);
});

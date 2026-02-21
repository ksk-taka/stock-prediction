#!/usr/bin/env npx tsx
// ============================================================
// 決算資料ダウンロード - Kabutan (決算短信) + TDnet (説明資料) + EDINET (有報)
//
// お気に入り銘柄の決算資料PDFをローカルに保存する。
// 各銘柄ごとにディレクトリを作り、直近N件ずつ格納。
//
// データソース:
//   - Kabutan: 決算短信PDF (過去数年分、高速取得)
//   - TDnet:   決算説明資料/プレゼンテーション資料 (直近~30営業日)
//   - EDINET:  有価証券報告書/四半期報告書 (APIキー必要)
//
// 使い方:
//   npx tsx scripts/fetch-earnings.ts                  # 全ソース
//   npx tsx scripts/fetch-earnings.ts --symbol 7203.T  # 特定銘柄のみ
//   npx tsx scripts/fetch-earnings.ts --kabutan-only   # Kabutanのみ
//   npx tsx scripts/fetch-earnings.ts --tdnet-only     # TDnetのみ
//   npx tsx scripts/fetch-earnings.ts --edinet-only    # EDINETのみ
//   npx tsx scripts/fetch-earnings.ts --group "CNPER低" # 特定グループのみ
//   npx tsx scripts/fetch-earnings.ts --count 4        # 直近4件ずつ
//   npx tsx scripts/fetch-earnings.ts --days 365       # EDINET検索期間
//   npx tsx scripts/fetch-earnings.ts --tdnet-days 60  # TDnet検索期間
//   npx tsx scripts/fetch-earnings.ts --dry-run        # DL実行せず一覧表示
// ============================================================

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { mkdirSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";
import { sleep, getArgs, parseFlag, hasFlag, parseIntFlag } from "@/lib/utils/cli";

// ── 設定 ──

const OUTPUT_DIR = join(process.cwd(), "data", "earnings");
const EDINET_API_BASE = "https://api.edinet-fsa.go.jp/api/v2";
const TDNET_BASE = "https://www.release.tdnet.info/inbs";
const REQUEST_DELAY_MS = 500;
const EDINET_CONCURRENCY = 5;

// ── CLI引数 ──

interface CLIArgs {
  symbol?: string;
  group?: string;
  kabutanOnly: boolean;
  tdnetOnly: boolean;
  edinetOnly: boolean;
  count: number;
  days: number;
  tdnetDays: number;
  dryRun: boolean;
}

function parseCliArgs(): CLIArgs {
  const args = getArgs();
  return {
    symbol: parseFlag(args, "--symbol"),
    group: parseFlag(args, "--group"),
    kabutanOnly: hasFlag(args, "--kabutan-only"),
    tdnetOnly: hasFlag(args, "--tdnet-only"),
    edinetOnly: hasFlag(args, "--edinet-only"),
    count: parseIntFlag(args, "--count", 2),
    days: parseIntFlag(args, "--days", 365),
    tdnetDays: parseIntFlag(args, "--tdnet-days", 30),
    dryRun: hasFlag(args, "--dry-run"),
  };
}

// ── ユーティリティ ──

function formatDateHyphen(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDateCompact(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/** "7203.T" → "7203" */
function extractCode(symbol: string): string {
  return symbol.replace(".T", "");
}

/** "7203.T" → "72030" (EDINET/TDnet secCode) */
function toSecCode(symbol: string): string {
  return extractCode(symbol) + "0";
}

function sanitizeFilename(s: string): string {
  return s.replace(/[<>:"/\\|?*\u3000]/g, "_").replace(/\s+/g, "_");
}

// ── Supabase ──

function createServiceClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

interface StockInfo {
  symbol: string;
  name: string;
}

async function getFavoriteStocks(supabase: SupabaseClient): Promise<StockInfo[]> {
  const PAGE_SIZE = 1000;
  const allStocks: StockInfo[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("stocks")
      .select("symbol, name")
      .eq("favorite", true)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as Array<{ symbol: string; name: string }>;
    allStocks.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }

  return allStocks;
}

async function getGroupStocks(supabase: SupabaseClient, groupName: string): Promise<StockInfo[]> {
  const userId = process.env.SUPABASE_TARGET_USER_ID;
  if (!userId) throw new Error("SUPABASE_TARGET_USER_ID が必要です");

  // グループID取得
  const { data: group, error: gErr } = await supabase
    .from("watchlist_groups")
    .select("id")
    .eq("user_id", userId)
    .eq("name", groupName)
    .single();
  if (gErr || !group) throw new Error(`グループ「${groupName}」が見つかりません`);

  // メンバーシップからシンボル取得
  const PAGE_SIZE = 1000;
  const symbols: string[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("stock_group_memberships")
      .select("symbol")
      .eq("user_id", userId)
      .eq("group_id", group.id)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as Array<{ symbol: string }>;
    symbols.push(...rows.map((r) => r.symbol));
    if (rows.length < PAGE_SIZE) break;
  }

  // 銘柄名を取得
  const allStocks: StockInfo[] = [];
  for (let i = 0; i < symbols.length; i += PAGE_SIZE) {
    const batch = symbols.slice(i, i + PAGE_SIZE);
    const { data, error } = await supabase
      .from("stocks")
      .select("symbol, name")
      .eq("user_id", userId)
      .in("symbol", batch);
    if (error) throw error;
    allStocks.push(...(data ?? []) as StockInfo[]);
  }

  // シンボル順でソート
  allStocks.sort((a, b) => a.symbol.localeCompare(b.symbol));
  return allStocks;
}

// ── Kabutan 決算短信取得 ──

interface KabutanEarningsDoc {
  period: string;   // e.g. "25.10-12", "2025.03"
  date: string;     // e.g. "2026-02-06"
  pdfUrl: string;
  type: "annual" | "quarterly";
}

/**
 * Kabutan の決算ページから決算短信PDFリンクを取得
 * URL: https://kabutan.jp/stock/finance/?code={code}
 */
async function fetchKabutanEarnings(code: string, count: number): Promise<KabutanEarningsDoc[]> {
  const url = `https://kabutan.jp/stock/finance/?code=${code}`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });
    if (!res.ok) {
      console.error(`  Kabutan error: ${res.status} for ${code}`);
      return [];
    }

    const html = await res.text();
    const $ = cheerio.load(html);
    const docs: KabutanEarningsDoc[] = [];

    $("a[href*='disclosures/pdf']").each((_, el) => {
      const href = $(el).attr("href") ?? "";
      const dateText = $(el).text().trim(); // "YY/MM/DD"

      const row = $(el).closest("tr");
      const firstCell = row.find("td, th").first().text().trim();

      const dateMatch = dateText.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
      if (!dateMatch) return;
      const date = `20${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;

      const isQuarterly = /\d{2}\.\d{2}-\d{2}/.test(firstCell);

      docs.push({
        period: firstCell.replace(/\s+/g, " ").trim().substring(0, 30),
        date,
        pdfUrl: href.startsWith("http") ? href : `https://kabutan.jp${href}`,
        type: isQuarterly ? "quarterly" : "annual",
      });
    });

    // Deduplicate by URL
    const seen = new Set<string>();
    const unique = docs.filter((d) => {
      if (seen.has(d.pdfUrl)) return false;
      seen.add(d.pdfUrl);
      return true;
    });

    unique.sort((a, b) => b.date.localeCompare(a.date));
    return unique.slice(0, count);
  } catch (e) {
    console.error(`  Kabutan fetch error for ${code}:`, e);
    return [];
  }
}

// ── TDnet 決算説明資料取得 ──

interface TDnetDoc {
  code: string;     // "72030"
  name: string;     // company name
  title: string;    // document title
  pdfUrl: string;   // full URL
  date: string;     // "YYYY-MM-DD"
}

/** 決算説明資料に該当するタイトルパターン */
const TDNET_MATERIAL_PATTERNS = [
  /決算説明/,
  /プレゼンテーション/,
  /説明会資料/,
  /決算補足/,
  /補足説明/,
  /業績説明/,
  /決算概要/,
  /investor/i,
  /presentation/i,
];

/**
 * TDnet の適時開示一覧から決算説明資料を取得
 * URL: https://www.release.tdnet.info/inbs/I_list_{page}_{YYYYMMDD}.html
 * ※ TDnetは直近約1ヶ月分のみ保持
 */
async function fetchTDnetPage(dateStr: string, page: number): Promise<TDnetDoc[]> {
  const pageStr = String(page).padStart(3, "0");
  const url = `${TDNET_BASE}/I_list_${pageStr}_${dateStr}.html`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });
    if (!res.ok) return [];

    const html = await res.text();
    const $ = cheerio.load(html);
    const docs: TDnetDoc[] = [];

    $("table#main-list-table tbody tr").each((_, row) => {
      const code = $(row).find("td.kjCode, td[class*=kjCode]").text().trim();
      const name = $(row).find("td.kjName, td[class*=kjName]").text().trim();
      const titleCell = $(row).find("td.kjTitle, td[class*=kjTitle]");
      const title = titleCell.text().trim();
      const pdfFile = titleCell.find("a").attr("href") ?? "";

      if (!code || !pdfFile) return;

      docs.push({
        code,
        name,
        title,
        pdfUrl: `${TDNET_BASE}/${pdfFile}`,
        date: `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`,
      });
    });

    return docs;
  } catch {
    return [];
  }
}

async function searchTDnetMaterials(
  symbols: string[],
  days: number,
  count: number,
): Promise<Map<string, TDnetDoc[]>> {
  const targetCodes = new Set(symbols.map(toSecCode));
  const results = new Map<string, TDnetDoc[]>();
  for (const sym of symbols) results.set(extractCode(sym), []);

  const today = new Date();
  let searched = 0;
  let totalFound = 0;

  console.log(`  TDnet: 過去${days}日間を検索中...`);

  for (let d = 0; d < days; d++) {
    const date = new Date(today);
    date.setDate(today.getDate() - d);

    const dow = date.getDay();
    if (dow === 0 || dow === 6) continue;

    const dateStr = formatDateCompact(date);

    // Scan all pages for this date
    for (let page = 1; page <= 30; page++) {
      const docs = await fetchTDnetPage(dateStr, page);
      if (docs.length === 0) break;

      for (const doc of docs) {
        if (!targetCodes.has(doc.code)) continue;

        // Filter: only 決算説明資料 related docs
        const isMaterial = TDNET_MATERIAL_PATTERNS.some((p) => p.test(doc.title));
        if (!isMaterial) continue;

        const symCode = doc.code.substring(0, 4); // "72030" → "7203"
        const current = results.get(symCode);
        if (current && current.length < count) {
          current.push(doc);
          totalFound++;
        }
      }

      await sleep(200); // gentle rate limit for TDnet pages
    }

    searched++;
    if (searched % 5 === 0) {
      process.stdout.write(`  ... ${searched}営業日検索, ${totalFound}件発見\r`);
    }

    await sleep(REQUEST_DELAY_MS);
  }

  console.log(`  TDnet: ${searched}営業日検索完了, ${totalFound}件の説明資料を発見`);
  return results;
}

// ── EDINET 有報取得 ──

interface EDINETDoc {
  docID: string;
  secCode: string;
  filerName: string;
  docDescription: string;
  docTypeCode: string;
  date: string;
}

async function fetchEDINETDocList(date: string, apiKey: string): Promise<EDINETDoc[]> {
  const url = `${EDINET_API_BASE}/documents.json?date=${date}&type=2&Subscription-Key=${apiKey}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 404) return [];
      console.error(`  EDINET API error: ${res.status} for ${date}`);
      return [];
    }
    const json = await res.json();

    if (!json.results) return [];

    return (json.results as Array<Record<string, string>>)
      .filter((r) => r.secCode && r.pdfFlag === "1")
      .map((r) => ({
        docID: r.docID,
        secCode: r.secCode,
        filerName: r.filerName,
        docDescription: r.docDescription ?? "",
        docTypeCode: r.docTypeCode,
        date,
      }));
  } catch (e) {
    console.error(`  EDINET fetch error for ${date}:`, e);
    return [];
  }
}

async function downloadEDINETpdf(docID: string, apiKey: string): Promise<Buffer | null> {
  const url = `${EDINET_API_BASE}/documents/${docID}?type=2&Subscription-Key=${apiKey}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`  EDINET PDF download error: ${res.status} for ${docID}`);
      return null;
    }
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (e) {
    console.error(`  EDINET PDF download error for ${docID}:`, e);
    return null;
  }
}

const EDINET_EARNINGS_TYPES = new Set(["120", "130", "140", "150", "160", "170"]);

const EDINET_TYPE_LABELS: Record<string, string> = {
  "120": "有報",
  "130": "訂正有報",
  "140": "四半期報",
  "150": "訂正四半期報",
  "160": "半期報",
  "170": "訂正半期報",
};

async function searchEDINETEarnings(
  symbols: string[],
  days: number,
  count: number,
  apiKey: string,
): Promise<Map<string, EDINETDoc[]>> {
  const secCodeToSymbol = new Map<string, string>();
  for (const sym of symbols) {
    secCodeToSymbol.set(toSecCode(sym), sym);
  }
  const targetSecCodes = new Set(secCodeToSymbol.keys());

  const results = new Map<string, EDINETDoc[]>();
  for (const sym of symbols) results.set(extractCode(sym), []);

  const isDone = () => {
    for (const sym of symbols) {
      if ((results.get(extractCode(sym))?.length ?? 0) < count) return false;
    }
    return true;
  };

  // Build list of business dates to scan
  const today = new Date();
  const datesToScan: string[] = [];
  for (let d = 0; d < days && datesToScan.length < days; d++) {
    const date = new Date(today);
    date.setDate(today.getDate() - d);
    const dow = date.getDay();
    if (dow === 0 || dow === 6) continue;
    datesToScan.push(formatDateHyphen(date));
  }

  console.log(`  EDINET: ${datesToScan.length}営業日を${EDINET_CONCURRENCY}並列で検索中...`);
  let searched = 0;

  // Process in chunks of EDINET_CONCURRENCY
  for (let i = 0; i < datesToScan.length && !isDone(); i += EDINET_CONCURRENCY) {
    const chunk = datesToScan.slice(i, i + EDINET_CONCURRENCY);
    const chunkResults = await Promise.all(
      chunk.map((dateStr) => fetchEDINETDocList(dateStr, apiKey)),
    );

    for (let j = 0; j < chunkResults.length; j++) {
      const docs = chunkResults[j];
      const dateStr = chunk[j];

      for (const doc of docs) {
        if (!targetSecCodes.has(doc.secCode)) continue;
        if (!EDINET_EARNINGS_TYPES.has(doc.docTypeCode)) continue;

        const sym = secCodeToSymbol.get(doc.secCode)!;
        const code = extractCode(sym);
        const current = results.get(code)!;
        if (current.length < count) {
          current.push({ ...doc, date: dateStr });
        }
      }
    }

    searched += chunk.length;
    const found = Array.from(results.values()).reduce((sum, arr) => sum + arr.length, 0);
    process.stdout.write(`  ... ${searched}/${datesToScan.length}営業日, ${found}件発見\r`);

    await sleep(200); // short delay between batches
  }

  const total = Array.from(results.values()).reduce((sum, arr) => sum + arr.length, 0);
  console.log(`  EDINET: ${searched}営業日検索完了, ${total}件の有報を発見        `);

  return results;
}

// ── PDF ダウンロード ──

async function downloadPDF(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });
    if (!res.ok) {
      console.error(`  PDF download error: ${res.status} for ${url}`);
      return null;
    }
    const arrayBuffer = await res.arrayBuffer();
    const buf = Buffer.from(arrayBuffer);

    // Kabutan disclosure URLs return an HTML wrapper page with an embedded PDF viewer.
    // Extract the actual TDnet PDF URL from the <object data="..."> tag.
    if (buf.subarray(0, 15).toString("utf-8").startsWith("<!DOCTYPE")) {
      const html = buf.toString("utf-8");
      const $ = cheerio.load(html);
      const actualPdfUrl = $("object#pdf").attr("data")
        ?? $("a[href*='tdnet-pdf']").attr("href");
      if (!actualPdfUrl) {
        console.error(`  Could not find actual PDF URL in HTML wrapper: ${url}`);
        return null;
      }
      console.log(`      → TDnet PDF: ${actualPdfUrl}`);
      return downloadPDF(actualPdfUrl);
    }

    return buf;
  } catch (e) {
    console.error(`  PDF download error:`, e);
    return null;
  }
}

// ── メイン処理 ──

async function main() {
  const opts = parseCliArgs();
  const edinetApiKey = process.env.EDINET_API_KEY;
  const onlyOne = opts.kabutanOnly || opts.tdnetOnly || opts.edinetOnly;

  console.log("=== 決算資料ダウンロード ===");
  console.log(`出力先: ${OUTPUT_DIR}`);
  console.log(`直近件数: ${opts.count}件/銘柄`);
  if (opts.dryRun) console.log("(dry-run モード)");

  // ── 銘柄リスト取得 ──
  let stocks: StockInfo[];
  if (opts.symbol) {
    stocks = [{ symbol: opts.symbol, name: opts.symbol }];
  } else if (opts.group) {
    const supabase = createServiceClient();
    stocks = await getGroupStocks(supabase, opts.group);
    console.log(`グループ「${opts.group}」: ${stocks.length}銘柄`);
  } else {
    const supabase = createServiceClient();
    stocks = await getFavoriteStocks(supabase);
  }

  if (stocks.length === 0) {
    console.log("対象銘柄なし");
    return;
  }

  console.log(`対象銘柄: ${stocks.length}件`);
  console.log(stocks.map((s) => `  ${s.symbol} ${s.name}`).join("\n"));
  console.log("");

  if (!opts.dryRun) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const codeToStock = new Map(stocks.map((s) => [extractCode(s.symbol), s]));
  let totalDownloaded = 0;

  // ── Kabutan (決算短信) ──
  if (!onlyOne || opts.kabutanOnly) {
    console.log("── Kabutan (決算短信) ──");

    for (const stock of stocks) {
      const code = extractCode(stock.symbol);
      const docs = await fetchKabutanEarnings(code, opts.count);

      if (docs.length === 0) {
        console.log(`  ${code} ${stock.name}: 決算短信なし`);
        continue;
      }

      const dir = join(OUTPUT_DIR, `${code}_${sanitizeFilename(stock.name)}`);
      console.log(`\n  ${code} ${stock.name}: ${docs.length}件`);

      for (const doc of docs) {
        const periodLabel = sanitizeFilename(doc.period);
        const filename = `決算短信_${doc.date}_${periodLabel}.pdf`;
        const filepath = join(dir, filename);

        console.log(`    ${doc.date} [${doc.type}] ${doc.period}`);

        if (opts.dryRun) {
          console.log(`      → (dry-run)`);
          continue;
        }

        if (existsSync(filepath)) {
          console.log(`      → スキップ (既存)`);
          continue;
        }

        const pdf = await downloadPDF(doc.pdfUrl);
        if (pdf) {
          mkdirSync(dir, { recursive: true });
          writeFileSync(filepath, pdf);
          console.log(`      → 保存完了 (${(pdf.length / 1024).toFixed(0)} KB)`);
          totalDownloaded++;
        } else {
          console.log(`      → ダウンロード失敗`);
        }

        await sleep(REQUEST_DELAY_MS);
      }

      await sleep(REQUEST_DELAY_MS);
    }
  }

  // ── TDnet (決算説明資料) ──
  if (!onlyOne || opts.tdnetOnly) {
    console.log("\n── TDnet (決算説明資料) ──");

    const tdnetResults = await searchTDnetMaterials(
      stocks.map((s) => s.symbol),
      opts.tdnetDays,
      opts.count,
    );

    for (const [code, docs] of tdnetResults) {
      if (docs.length === 0) continue;
      const stock = codeToStock.get(code);
      const stockName = stock?.name ?? code;
      const dir = join(OUTPUT_DIR, `${code}_${sanitizeFilename(stockName)}`);

      console.log(`\n  ${code} ${stockName}: ${docs.length}件`);

      for (const doc of docs) {
        const titleShort = sanitizeFilename(doc.title.substring(0, 50));
        const filename = `説明資料_${doc.date}_${titleShort}.pdf`;
        const filepath = join(dir, filename);

        console.log(`    ${doc.date} ${doc.title.substring(0, 60)}`);

        if (opts.dryRun) {
          console.log(`      → (dry-run)`);
          continue;
        }

        if (existsSync(filepath)) {
          console.log(`      → スキップ (既存)`);
          continue;
        }

        const pdf = await downloadPDF(doc.pdfUrl);
        if (pdf) {
          mkdirSync(dir, { recursive: true });
          writeFileSync(filepath, pdf);
          console.log(`      → 保存完了 (${(pdf.length / 1024).toFixed(0)} KB)`);
          totalDownloaded++;
        } else {
          console.log(`      → ダウンロード失敗`);
        }

        await sleep(REQUEST_DELAY_MS);
      }
    }
  }

  // ── EDINET (有報/四半期報告書) ──
  if (!onlyOne || opts.edinetOnly) {
    if (!edinetApiKey) {
      console.log("\n── EDINET (有報) ──");
      console.log("  EDINET_API_KEY が未設定のためスキップ");
      console.log("  https://disclosure.edinet-fsa.go.jp/ でAPIキーを取得し .env.local に設定してください");
    } else {
      console.log("\n── EDINET (有報/四半期報告書) ──");
      const edinetResults = await searchEDINETEarnings(
        stocks.map((s) => s.symbol),
        opts.days,
        opts.count,
        edinetApiKey,
      );

      for (const [code, docs] of edinetResults) {
        if (docs.length === 0) continue;
        const stock = codeToStock.get(code)!;
        const dir = join(OUTPUT_DIR, `${code}_${sanitizeFilename(stock.name)}`);

        console.log(`\n  ${code} ${stock.name}: ${docs.length}件`);

        for (const doc of docs) {
          const typeLabel = EDINET_TYPE_LABELS[doc.docTypeCode] ?? "報告書";
          const desc = doc.docDescription || typeLabel;
          const filename = `${typeLabel}_${doc.date}_${sanitizeFilename(desc.substring(0, 60))}.pdf`;
          const filepath = join(dir, filename);

          console.log(`    ${doc.date} ${desc.substring(0, 50)}`);

          if (opts.dryRun) {
            console.log(`      → (dry-run)`);
            continue;
          }

          if (existsSync(filepath)) {
            console.log(`      → スキップ (既存)`);
            continue;
          }

          const pdf = await downloadEDINETpdf(doc.docID, edinetApiKey);
          if (pdf) {
            mkdirSync(dir, { recursive: true });
            writeFileSync(filepath, pdf);
            console.log(`      → 保存完了 (${(pdf.length / 1024).toFixed(0)} KB)`);
            totalDownloaded++;
          }

          await sleep(REQUEST_DELAY_MS);
        }
      }
    }
  }

  console.log(`\n=== 完了: ${totalDownloaded}件ダウンロード ===`);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});

#!/usr/bin/env npx tsx
// ============================================================
// 四季報パフォーマンス検証スクリプト
//
// Notion「四季報予測」DBから「会社比強気」「大幅強気」銘柄を取得し、
// 四季報発売日を起点として株価パフォーマンスを検証・集計する。
//
// 使い方:
//   npx tsx scripts/shikiho-performance.ts                  # 全銘柄検証+コンソール出力
//   npx tsx scripts/shikiho-performance.ts --csv            # CSV出力
//   npx tsx scripts/shikiho-performance.ts --notion         # 結果をNotionに書き戻し
//   npx tsx scripts/shikiho-performance.ts --dry-run        # Notion書き込みなし
//   npx tsx scripts/shikiho-performance.ts --today              # 今日更新分のみ
//   npx tsx scripts/shikiho-performance.ts --start 2025-12-18 --end 2026-03-18
//   npx tsx scripts/shikiho-performance.ts --earnings-window 3  # 決算前後N日
// ============================================================

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import * as cheerio from "cheerio";
import YahooFinance from "yahoo-finance2";
import { yfQueue, kabutanQueue } from "@/lib/utils/requestQueue";
import { sleep, getArgs, parseFlag, hasFlag } from "@/lib/utils/cli";

// ---------- 型定義 ----------

interface ShikihoEntry {
  code: string;         // "1723" (Notion上の証券コード)
  symbol: string;       // "1723.T" (Yahoo Finance用)
  companyName: string;
  shikihoEval: string;  // "😄会社比強気" | "😄😄大幅強気"
  evalCategory: "会社比強気" | "大幅強気";
}

interface DayPrice {
  date: string;   // YYYY-MM-DD
  close: number;
}

interface EarningsInfo {
  earningsDate: string | null;       // YYYY-MM-DD
  preDate: string | null;            // 決算前日の日付
  postDate: string | null;           // 決算後N営業日目の日付
  preDayClose: number | null;        // 決算発表前日の終値
  postDayClose: number | null;       // 決算発表翌営業日の終値
  earningsReturn: number | null;     // 決算前後の絶対リターン
}

interface StockResult {
  code: string;
  symbol: string;
  companyName: string;
  evalCategory: "会社比強気" | "大幅強気";
  basePrice: number | null;          // 基準日の終値
  endPrice: number | null;           // 終了日の終値
  absoluteReturn: number | null;     // 絶対リターン (%)
  relReturnTopix: number | null;     // TOPIX相対リターン (%)
  relReturnN225: number | null;      // N225相対リターン (%)
  earningsDate: string | null;
  earningsPreDate: string | null;    // 決算前日の日付
  earningsPostDate: string | null;   // 決算後N営業日目の日付
  earningsPreClose: number | null;   // 決算前日の終値
  earningsPostClose: number | null;  // 決算後N営業日目の終値
  earningsReturn: number | null;     // 決算前後リターン (%)
  earningsRelTopix: number | null;   // 決算前後TOPIX相対リターン (%)
  preEarningsReturn: number | null;  // 基準日→決算前日リターン (%)
  preEarningsRelTopix: number | null; // 基準日→決算前日 TOPIX相対 (%)
  preEarningsRelN225: number | null;  // 基準日→決算前日 N225相対 (%)
  error: string | null;
}

// ---------- 定数 ----------

const DEFAULT_START_DATE = "2025-12-18"; // 四季報新春号発売日
const DEFAULT_END_DATE = "2026-03-18";
// TOPIX: ^TPX はYFで取得不可のため 1306.T (TOPIX連動型ETF) を代替使用
const BENCHMARK_TOPIX = "1306.T";
const BENCHMARK_N225 = "^N225";
const yf = new YahooFinance({ suppressNotices: ["ripHistorical", "yahooSurvey"] });
const OUTPUT_DIR = join(process.cwd(), "data", "shikiho");

// ---------- Notion読み込み ----------

function notionHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json",
  };
}

async function fetchShikihoEntries(todayOnly?: string): Promise<ShikihoEntry[]> {
  const dbId = process.env.NOTION_SHIKIHO_DATABASE_ID;
  if (!dbId) throw new Error("NOTION_SHIKIHO_DATABASE_ID が未設定です");

  const entries: ShikihoEntry[] = [];
  let startCursor: string | undefined;

  do {
    const body: Record<string, unknown> = { page_size: 100 };
    if (startCursor) body.start_cursor = startCursor;

    // --today: 今日作成されたページのみ取得
    if (todayOnly) {
      body.filter = {
        timestamp: "created_time",
        created_time: { on_or_after: todayOnly + "T00:00:00+09:00" },
      };
    }

    const res = await fetch(
      `https://api.notion.com/v1/databases/${dbId}/query`,
      { method: "POST", headers: notionHeaders(), body: JSON.stringify(body) },
    );
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`Notion API エラー: ${res.status} ${errBody.slice(0, 200)}`);
    }

    const data = await res.json() as {
      results: Array<{
        properties: Record<string, unknown>;
      }>;
      has_more: boolean;
      next_cursor: string | null;
    };

    for (const page of data.results) {
      const props = page.properties;

      // 銘柄コード (title)
      const titleProp = props["銘柄コード"] as { title?: Array<{ plain_text?: string }> };
      const code = titleProp?.title?.map((t) => t.plain_text ?? "").join("") ?? "";
      if (!code) continue;

      // 企業名 (rich_text)
      const nameProp = props["企業名"] as { rich_text?: Array<{ plain_text?: string }> };
      const companyName = nameProp?.rich_text?.map((t) => t.plain_text ?? "").join("") ?? "";

      // 四季報予測 (select)
      const evalProp = props["四季報予測"] as { select?: { name?: string } };
      const shikihoEval = evalProp?.select?.name ?? "";

      // カテゴリ判定
      let evalCategory: "会社比強気" | "大幅強気";
      if (shikihoEval.includes("大幅強気")) {
        evalCategory = "大幅強気";
      } else if (shikihoEval.includes("会社比強気")) {
        evalCategory = "会社比強気";
      } else {
        continue; // 不明な評価はスキップ
      }

      // Yahoo Finance用シンボル変換 (英字コードはそのまま.T追加)
      const symbol = `${code}.T`;

      entries.push({ code, symbol, companyName, shikihoEval, evalCategory });
    }

    startCursor = data.has_more ? (data.next_cursor ?? undefined) : undefined;
  } while (startCursor);

  return entries;
}

// ---------- 株価取得 ----------

async function fetchHistoricalPrices(
  symbol: string,
  fromDate: string,
  toDate: string,
): Promise<DayPrice[]> {
  const period2 = new Date(toDate + "T15:00:00+09:00");
  // 終了日が未来の場合は今日までに制限
  const now = new Date();
  const effectiveEnd = period2 > now ? now : period2;

  const results = await yfQueue.add(() =>
    yf.historical(symbol, {
      period1: fromDate,
      period2: effectiveEnd,
      interval: "1d",
    }),
  );

  return (results ?? [])
    .filter((r: { close?: number }) => r.close && r.close > 0)
    .map((r: { date: Date; close: number }) => ({
      date: r.date instanceof Date
        ? r.date.toISOString().slice(0, 10)
        : String(r.date).slice(0, 10),
      close: r.close,
    }));
}

// ---------- 決算日取得 ----------

/**
 * 四半期決算発表日を取得。
 * 1. yf.quote() の earningsTimestamp を試行
 * 2. 取得できなければ Kabutan 決算ページをスクレイピング
 */
async function fetchEarningsDate(
  symbol: string,
  startDate: string,
  endDate: string,
): Promise<string | null> {
  // 1) Yahoo Finance
  try {
    const q = await yfQueue.add(() => yf.quote(symbol));
    const ts = (q as Record<string, unknown>).earningsTimestamp;
    if (ts instanceof Date) {
      const dateStr = ts.toISOString().slice(0, 10);
      if (dateStr >= startDate && dateStr <= endDate) {
        return dateStr;
      }
    }
    const tsStart = (q as Record<string, unknown>).earningsTimestampStart;
    if (tsStart instanceof Date) {
      const dateStr = tsStart.toISOString().slice(0, 10);
      const today = new Date().toISOString().slice(0, 10);
      if (dateStr >= startDate && dateStr <= today && dateStr <= endDate) {
        return dateStr;
      }
    }
  } catch {
    // YF取得失敗は無視してフォールバックへ
  }

  // 2) Kabutan フォールバック
  const code = symbol.replace(/\.T$/, "");
  return fetchEarningsDateFromKabutan(code, startDate, endDate);
}

/**
 * Kabutan 決算ページから四半期決算の「発表日」をスクレイピングで取得。
 * Yahoo Finance で取れない銘柄のフォールバック用。
 * 発表日が分析期間内にある場合のみ返す。
 */
async function fetchEarningsDateFromKabutan(
  code: string,
  startDate: string,
  endDate: string,
): Promise<string | null> {
  try {
    const html = await kabutanQueue.add(async () => {
      const res = await fetch(`https://kabutan.jp/stock/finance?code=${code}`, {
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      if (!res.ok) return "";
      return res.text();
    });
    if (!html) return null;

    const $ = cheerio.load(html);
    const earningsDates: string[] = [];

    // 四半期業績テーブル（"発表日" カラムを含む）を探索
    $("table").each((_i, table) => {
      const headerText = $(table).text();
      if (!headerText.includes("発表日")) return;

      // ヘッダー行から「発表日」の位置を特定
      // Kabutan: ヘッダーは全てth、データ行は最初の列がth(決算期) + 残りがtd
      const headerThs: string[] = [];
      $(table).find("tr").first().find("th").each((_j, th) => {
        headerThs.push($(th).text().trim());
      });
      const announceIdx = headerThs.indexOf("発表日");
      if (announceIdx < 0) return;

      // データ行のtdインデックス = ヘッダーインデックス - 1 (最初の列がthのため)
      const tdIdx = announceIdx - 1;
      if (tdIdx < 0) return;

      // データ行から発表日を抽出
      $(table).find("tr").each((_j, tr) => {
        const cells = $(tr).find("td");
        if (cells.length <= tdIdx) return;
        const dateText = $(cells[tdIdx]).text().trim();
        // "YY/MM/DD" 形式 (例: "26/01/28")
        const m = dateText.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
        if (m) {
          const year = parseInt(m[1], 10) + 2000;
          const dateStr = `${year}-${m[2]}-${m[3]}`;
          earningsDates.push(dateStr);
        }
      });
    });

    // 分析期間内の日付のうち、最も新しいものを返す
    const inRange = earningsDates
      .filter((d) => d >= startDate && d <= endDate)
      .sort();
    return inRange.length > 0 ? inRange[inRange.length - 1] : null;
  } catch {
    return null;
  }
}

// ---------- ベンチマーク取得 ----------

interface BenchmarkData {
  prices: DayPrice[];
  returnPct: number | null;
  // dateStr → close のマップ (決算前後リターン計算用)
  priceMap: Map<string, number>;
}

async function fetchBenchmark(
  symbol: string,
  fromDate: string,
  toDate: string,
): Promise<BenchmarkData> {
  const prices = await fetchHistoricalPrices(symbol, fromDate, toDate);
  const priceMap = new Map<string, number>();
  for (const p of prices) priceMap.set(p.date, p.close);

  let returnPct: number | null = null;
  if (prices.length >= 2) {
    const first = prices[0].close;
    const last = prices[prices.length - 1].close;
    returnPct = ((last - first) / first) * 100;
  }

  return { prices, returnPct, priceMap };
}

// ---------- 決算前後リターン計算 ----------

function calcEarningsReturn(
  earningsDate: string | null,
  prices: DayPrice[],
  earningsWindow: number,
): EarningsInfo {
  const empty: EarningsInfo = {
    earningsDate, preDate: null, postDate: null,
    preDayClose: null, postDayClose: null, earningsReturn: null,
  };
  if (!earningsDate || prices.length === 0) return empty;

  // 決算日の前日終値を探す
  const sortedDates = prices.map((p) => p.date).sort();
  const preDates = sortedDates.filter((d) => d < earningsDate);
  const postDates = sortedDates.filter((d) => d > earningsDate);

  if (preDates.length === 0 || postDates.length === 0) return empty;

  const preDate = preDates[preDates.length - 1]; // 決算前日
  // 決算後N営業日目
  const postDate = postDates.length >= earningsWindow
    ? postDates[earningsWindow - 1]
    : postDates[postDates.length - 1];

  const preDayClose = prices.find((p) => p.date === preDate)?.close ?? null;
  const postDayClose = prices.find((p) => p.date === postDate)?.close ?? null;

  if (preDayClose == null || postDayClose == null || preDayClose <= 0) {
    return { earningsDate, preDate, postDate, preDayClose, postDayClose, earningsReturn: null };
  }

  const earningsReturn = ((postDayClose - preDayClose) / preDayClose) * 100;
  return { earningsDate, preDate, postDate, preDayClose, postDayClose, earningsReturn };
}

function calcBenchmarkEarningsReturn(
  earningsDate: string | null,
  benchmarkPrices: DayPrice[],
  earningsWindow: number,
): number | null {
  if (!earningsDate) return null;
  const info = calcEarningsReturn(earningsDate, benchmarkPrices, earningsWindow);
  return info.earningsReturn;
}

// ---------- 集計ロジック ----------

function calcStats(values: number[]): {
  mean: number;
  median: number;
  winRate: number;
  min: number;
  max: number;
  stdDev: number;
} {
  if (values.length === 0) {
    return { mean: 0, median: 0, winRate: 0, min: 0, max: 0, stdDev: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((s, v) => s + v, 0);
  const mean = sum / values.length;
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
  const winRate = (values.filter((v) => v > 0).length / values.length) * 100;
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  const stdDev = Math.sqrt(variance);

  return { mean, median, winRate, min, max, stdDev };
}

// ---------- Notion結果書き戻し ----------

async function addNotionResultProperties(dbId: string): Promise<void> {
  // DBに結果用プロパティを追加（存在しなければ作成）
  const newProps: Record<string, unknown> = {
    "絶対リターン": { number: { format: "percent" } },
    "TOPIX相対リターン": { number: { format: "percent" } },
    "N225相対リターン": { number: { format: "percent" } },
    "決算日": { date: {} },
    "決算前日": { date: {} },
    "決算前日終値": { number: { format: "number" } },
    "決算後日": { date: {} },
    "決算後日終値": { number: { format: "number" } },
    "決算前後リターン": { number: { format: "percent" } },
    "決算前日までリターン": { number: { format: "percent" } },
    "決算前日までTOPIX相対": { number: { format: "percent" } },
    "決算前日までN225相対": { number: { format: "percent" } },
    "基準日終値": { number: { format: "number" } },
    "現在終値": { number: { format: "number" } },
    "検証日": { date: {} },
  };

  const res = await fetch(`https://api.notion.com/v1/databases/${dbId}`, {
    method: "PATCH",
    headers: notionHeaders(),
    body: JSON.stringify({ properties: newProps }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    console.warn(`[Notion] プロパティ追加失敗 (既に存在する場合は無視): ${res.status} ${errBody.slice(0, 200)}`);
  }
}

async function writeResultToNotion(
  entry: ShikihoEntry,
  result: StockResult,
  today: string,
): Promise<void> {
  const dbId = process.env.NOTION_SHIKIHO_DATABASE_ID!;

  // 既存ページを検索
  const searchRes = await fetch(
    `https://api.notion.com/v1/databases/${dbId}/query`,
    {
      method: "POST",
      headers: notionHeaders(),
      body: JSON.stringify({
        filter: { property: "銘柄コード", title: { equals: entry.code } },
        page_size: 1,
      }),
    },
  );

  if (!searchRes.ok) return;
  const searchData = await searchRes.json() as { results: Array<{ id: string }> };
  if (searchData.results.length === 0) return;

  const pageId = searchData.results[0].id;

  // プロパティ更新
  const props: Record<string, unknown> = {
    "検証日": { date: { start: today } },
  };
  if (result.basePrice != null) {
    props["基準日終値"] = { number: result.basePrice };
  }
  if (result.endPrice != null) {
    props["現在終値"] = { number: result.endPrice };
  }
  if (result.absoluteReturn != null) {
    props["絶対リターン"] = { number: Math.round(result.absoluteReturn * 100) / 10000 };
  }
  if (result.relReturnTopix != null) {
    props["TOPIX相対リターン"] = { number: Math.round(result.relReturnTopix * 100) / 10000 };
  }
  if (result.relReturnN225 != null) {
    props["N225相対リターン"] = { number: Math.round(result.relReturnN225 * 100) / 10000 };
  }
  if (result.earningsDate) {
    props["決算日"] = { date: { start: result.earningsDate } };
  }
  if (result.earningsPreDate) {
    props["決算前日"] = { date: { start: result.earningsPreDate } };
  }
  if (result.earningsPreClose != null) {
    props["決算前日終値"] = { number: result.earningsPreClose };
  }
  if (result.earningsPostDate) {
    props["決算後日"] = { date: { start: result.earningsPostDate } };
  }
  if (result.earningsPostClose != null) {
    props["決算後日終値"] = { number: result.earningsPostClose };
  }
  if (result.earningsReturn != null) {
    props["決算前後リターン"] = { number: Math.round(result.earningsReturn * 100) / 10000 };
  }
  if (result.preEarningsReturn != null) {
    props["決算前日までリターン"] = { number: Math.round(result.preEarningsReturn * 100) / 10000 };
  }
  if (result.preEarningsRelTopix != null) {
    props["決算前日までTOPIX相対"] = { number: Math.round(result.preEarningsRelTopix * 100) / 10000 };
  }
  if (result.preEarningsRelN225 != null) {
    props["決算前日までN225相対"] = { number: Math.round(result.preEarningsRelN225 * 100) / 10000 };
  }

  const updateRes = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: "PATCH",
    headers: notionHeaders(),
    body: JSON.stringify({ properties: props }),
  });
  if (!updateRes.ok) {
    const errBody = await updateRes.text().catch(() => "");
    console.warn(`  [Notion] ${entry.code} 更新失敗: ${updateRes.status} ${errBody.slice(0, 200)}`);
  }
}

// ---------- 表示ヘルパー ----------

function fmtPct(n: number | null): string {
  if (n == null) return "-";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

// ---------- CLI引数 ----------

function parseCliArgs() {
  const args = getArgs();
  const csv = hasFlag(args, "--csv");
  const notion = hasFlag(args, "--notion");
  const dryRun = hasFlag(args, "--dry-run");
  const todayFlag = hasFlag(args, "--today");
  const startDate = parseFlag(args, "--start") ?? DEFAULT_START_DATE;
  const endDate = parseFlag(args, "--end") ?? DEFAULT_END_DATE;
  const earningsWindow = parseInt(parseFlag(args, "--earnings-window") ?? "1", 10);
  return { csv, notion, dryRun, todayFlag, startDate, endDate, earningsWindow };
}

// ---------- メイン ----------

async function main() {
  const { csv, notion, dryRun, todayFlag, startDate, endDate, earningsWindow } = parseCliArgs();

  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const modeLabel = [
    dryRun ? "dry-run" : "",
    todayFlag ? "today-only" : "",
  ].filter(Boolean).join(", ");
  const modeSuffix = modeLabel ? ` (${modeLabel})` : "";

  console.log(`\n${"=".repeat(62)}`);
  console.log(`  四季報パフォーマンス検証${modeSuffix}`);
  console.log(`${"=".repeat(62)}`);
  console.log(`  基準日: ${startDate} (四季報発売日)`);
  console.log(`  終了日: ${endDate}`);
  console.log(`  検証日: ${today}`);
  console.log(`  決算前後ウィンドウ: ${earningsWindow}営業日後`);
  if (todayFlag) console.log(`  フィルタ: 今日(${today})更新分のみ`);
  console.log();

  // 1. Notion読み込み
  console.log("  [1/4] Notion「四季報予測」DB読み込み中...");
  const entries = await fetchShikihoEntries(todayFlag ? today : undefined);
  const bullishCount = entries.filter((e) => e.evalCategory === "会社比強気").length;
  const strongCount = entries.filter((e) => e.evalCategory === "大幅強気").length;
  console.log(`    → ${entries.length}銘柄 (会社比強気: ${bullishCount}, 大幅強気: ${strongCount})`);

  // 2. ベンチマーク取得
  console.log("\n  [2/4] ベンチマーク取得中...");
  const [topix, n225] = await Promise.all([
    fetchBenchmark(BENCHMARK_TOPIX, startDate, endDate),
    fetchBenchmark(BENCHMARK_N225, startDate, endDate),
  ]);
  console.log(`    TOPIX: ${fmtPct(topix.returnPct)} (${topix.prices.length}日)`);
  console.log(`    N225:  ${fmtPct(n225.returnPct)} (${n225.prices.length}日)`);

  // 3. 個別銘柄処理
  console.log("\n  [3/4] 個別銘柄のデータ取得・計算中...");
  const results: StockResult[] = [];
  let processed = 0;
  let errCount = 0;

  // Notion結果書き戻し用: DBプロパティ追加
  if (notion && !dryRun) {
    try {
      await addNotionResultProperties(process.env.NOTION_SHIKIHO_DATABASE_ID!);
      console.log("    → Notion DBに結果用プロパティを追加しました");
    } catch (e) {
      console.warn(`    → プロパティ追加失敗: ${e}`);
    }
  }

  // バッチ処理 (10並列)
  const BATCH_SIZE = 10;
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map(async (entry) => {
        try {
          // 株価データ取得
          const prices = await fetchHistoricalPrices(entry.symbol, startDate, endDate);

          if (prices.length < 2) {
            return {
              code: entry.code,
              symbol: entry.symbol,
              companyName: entry.companyName,
              evalCategory: entry.evalCategory,
              basePrice: null,
              endPrice: null,
              absoluteReturn: null,
              relReturnTopix: null,
              relReturnN225: null,
              earningsDate: null,
              earningsPreDate: null,
              earningsPostDate: null,
              earningsPreClose: null,
              earningsPostClose: null,
              earningsReturn: null,
              earningsRelTopix: null,
              preEarningsReturn: null,
              preEarningsRelTopix: null,
              preEarningsRelN225: null,
              error: "株価データ不足",
            } as StockResult;
          }

          const basePrice = prices[0].close;
          const endPrice = prices[prices.length - 1].close;
          const absoluteReturn = ((endPrice - basePrice) / basePrice) * 100;
          const relReturnTopix = topix.returnPct != null
            ? absoluteReturn - topix.returnPct : null;
          const relReturnN225 = n225.returnPct != null
            ? absoluteReturn - n225.returnPct : null;

          // 決算日取得
          const earningsDate = await fetchEarningsDate(entry.symbol, startDate, endDate);
          const earningsInfo = calcEarningsReturn(earningsDate, prices, earningsWindow);

          // 決算前後のベンチマーク相対リターン
          let earningsRelTopix: number | null = null;
          if (earningsInfo.earningsReturn != null && earningsDate) {
            const topixER = calcBenchmarkEarningsReturn(earningsDate, topix.prices, earningsWindow);
            if (topixER != null) {
              earningsRelTopix = earningsInfo.earningsReturn - topixER;
            }
          }

          // 基準日→決算前日リターン
          let preEarningsReturn: number | null = null;
          let preEarningsRelTopix: number | null = null;
          let preEarningsRelN225: number | null = null;
          if (earningsInfo.preDayClose != null && basePrice > 0) {
            preEarningsReturn = ((earningsInfo.preDayClose - basePrice) / basePrice) * 100;
            // ベンチマークの同期間リターン (基準日→決算前日)
            const preDate = earningsInfo.preDate!;
            const topixPreClose = topix.priceMap.get(preDate);
            const topixBase = topix.prices[0]?.close;
            if (topixPreClose != null && topixBase != null && topixBase > 0) {
              const topixPreReturn = ((topixPreClose - topixBase) / topixBase) * 100;
              preEarningsRelTopix = preEarningsReturn - topixPreReturn;
            }
            const n225PreClose = n225.priceMap.get(preDate);
            const n225Base = n225.prices[0]?.close;
            if (n225PreClose != null && n225Base != null && n225Base > 0) {
              const n225PreReturn = ((n225PreClose - n225Base) / n225Base) * 100;
              preEarningsRelN225 = preEarningsReturn - n225PreReturn;
            }
          }

          return {
            code: entry.code,
            symbol: entry.symbol,
            companyName: entry.companyName,
            evalCategory: entry.evalCategory,
            basePrice,
            endPrice,
            absoluteReturn,
            relReturnTopix,
            relReturnN225,
            earningsDate: earningsInfo.earningsDate,
            earningsPreDate: earningsInfo.preDate,
            earningsPostDate: earningsInfo.postDate,
            earningsPreClose: earningsInfo.preDayClose,
            earningsPostClose: earningsInfo.postDayClose,
            earningsReturn: earningsInfo.earningsReturn,
            earningsRelTopix,
            preEarningsReturn,
            preEarningsRelTopix,
            preEarningsRelN225,
            error: null,
          } as StockResult;
        } catch (e) {
          return {
            code: entry.code,
            symbol: entry.symbol,
            companyName: entry.companyName,
            evalCategory: entry.evalCategory,
            basePrice: null,
            endPrice: null,
            absoluteReturn: null,
            relReturnTopix: null,
            relReturnN225: null,
            earningsDate: null,
            earningsPreDate: null,
            earningsPostDate: null,
            earningsPreClose: null,
            earningsPostClose: null,
            earningsReturn: null,
            earningsRelTopix: null,
            preEarningsReturn: null,
            preEarningsRelTopix: null,
            preEarningsRelN225: null,
            error: String(e).slice(0, 100),
          } as StockResult;
        }
      }),
    );

    for (const r of batchResults) {
      if (r.status === "fulfilled") {
        results.push(r.value);
        if (r.value.error) errCount++;
      } else {
        errCount++;
      }
    }
    processed += batch.length;

    // 進捗表示
    if (processed % 50 === 0 || processed === entries.length) {
      console.log(`    ${processed}/${entries.length} 完了 (エラー: ${errCount})`);
    }

    await sleep(200); // レート制限対策
  }

  // Notion書き戻し
  if (notion && !dryRun) {
    console.log("\n  Notion結果書き戻し中...");
    let notionOk = 0;
    for (const result of results) {
      if (result.error) continue;
      const entry = entries.find((e) => e.code === result.code)!;
      try {
        await writeResultToNotion(entry, result, today);
        notionOk++;
      } catch {
        // 個別失敗は無視
      }
      await sleep(350); // Notion rate limit
    }
    console.log(`    → ${notionOk}/${results.filter((r) => !r.error).length}件 書き込み完了`);
  }

  // 4. 集計・出力
  console.log(`\n  [4/4] 集計中...\n`);

  const validResults = results.filter((r) => !r.error && r.absoluteReturn != null);

  // カテゴリ別集計
  const categories: { label: string; filter: (r: StockResult) => boolean }[] = [
    { label: "全体", filter: () => true },
    { label: "会社比強気", filter: (r) => r.evalCategory === "会社比強気" },
    { label: "大幅強気", filter: (r) => r.evalCategory === "大幅強気" },
  ];

  console.log("=".repeat(62));
  console.log("  パフォーマンスサマリー");
  console.log("=".repeat(62));
  console.log(`  基準期間: ${startDate} → ${endDate}`);
  console.log(`  TOPIX: ${fmtPct(topix.returnPct)} / N225: ${fmtPct(n225.returnPct)}`);
  console.log(`  対象: ${entries.length}銘柄 / 有効: ${validResults.length}銘柄 / エラー: ${errCount}銘柄`);
  console.log();

  for (const cat of categories) {
    const catResults = validResults.filter(cat.filter);
    if (catResults.length === 0) continue;

    const absReturns = catResults
      .map((r) => r.absoluteReturn!)
      .filter((v) => v != null);
    const relTopixReturns = catResults
      .map((r) => r.relReturnTopix!)
      .filter((v) => v != null);
    const relN225Returns = catResults
      .map((r) => r.relReturnN225!)
      .filter((v) => v != null);
    const earningsReturns = catResults
      .map((r) => r.earningsReturn!)
      .filter((v) => v != null);
    const earningsRelReturns = catResults
      .map((r) => r.earningsRelTopix!)
      .filter((v) => v != null);

    const absStats = calcStats(absReturns);
    const relTopixStats = calcStats(relTopixReturns);
    const relN225Stats = calcStats(relN225Returns);
    const earningsStats = calcStats(earningsReturns);
    const earningsRelStats = calcStats(earningsRelReturns);

    console.log(`  ── ${cat.label} (${catResults.length}銘柄) ${"─".repeat(40)}`);
    console.log();
    console.log(`  【絶対リターン】`);
    console.log(`    平均: ${fmtPct(absStats.mean)}  中央値: ${fmtPct(absStats.median)}  標準偏差: ${absStats.stdDev.toFixed(2)}%`);
    console.log(`    勝率: ${absStats.winRate.toFixed(1)}%  最大: ${fmtPct(absStats.max)}  最小: ${fmtPct(absStats.min)}`);
    console.log();
    console.log(`  【TOPIX相対リターン】`);
    console.log(`    平均: ${fmtPct(relTopixStats.mean)}  中央値: ${fmtPct(relTopixStats.median)}  勝率: ${relTopixStats.winRate.toFixed(1)}%`);
    console.log();
    console.log(`  【N225相対リターン】`);
    console.log(`    平均: ${fmtPct(relN225Stats.mean)}  中央値: ${fmtPct(relN225Stats.median)}  勝率: ${relN225Stats.winRate.toFixed(1)}%`);

    // 基準日→決算前日リターン
    const preEarningsReturns = catResults
      .map((r) => r.preEarningsReturn!)
      .filter((v) => v != null);
    const preEarningsRelTopixArr = catResults
      .map((r) => r.preEarningsRelTopix!)
      .filter((v) => v != null);
    const preEarningsRelN225Arr = catResults
      .map((r) => r.preEarningsRelN225!)
      .filter((v) => v != null);

    if (preEarningsReturns.length > 0) {
      const preStats = calcStats(preEarningsReturns);
      const preRelTopixStats = calcStats(preEarningsRelTopixArr);
      const preRelN225Stats = calcStats(preEarningsRelN225Arr);
      console.log();
      console.log(`  【決算前日までリターン】(${preEarningsReturns.length}銘柄, 基準日→決算前日)`);
      console.log(`    平均: ${fmtPct(preStats.mean)}  中央値: ${fmtPct(preStats.median)}  勝率: ${preStats.winRate.toFixed(1)}%`);
      console.log(`    標準偏差: ${preStats.stdDev.toFixed(2)}%  最大: ${fmtPct(preStats.max)}  最小: ${fmtPct(preStats.min)}`);
      if (preEarningsRelTopixArr.length > 0) {
        console.log(`    TOPIX相対 平均: ${fmtPct(preRelTopixStats.mean)}  中央値: ${fmtPct(preRelTopixStats.median)}  勝率: ${preRelTopixStats.winRate.toFixed(1)}%`);
      }
      if (preEarningsRelN225Arr.length > 0) {
        console.log(`    N225相対  平均: ${fmtPct(preRelN225Stats.mean)}  中央値: ${fmtPct(preRelN225Stats.median)}  勝率: ${preRelN225Stats.winRate.toFixed(1)}%`);
      }
    }

    if (earningsReturns.length > 0) {
      console.log();
      console.log(`  【決算前後リターン】(${earningsReturns.length}銘柄, ${earningsWindow}営業日後)`);
      console.log(`    平均: ${fmtPct(earningsStats.mean)}  中央値: ${fmtPct(earningsStats.median)}  勝率: ${earningsStats.winRate.toFixed(1)}%`);
      if (earningsRelReturns.length > 0) {
        console.log(`    TOPIX相対 平均: ${fmtPct(earningsRelStats.mean)}  勝率: ${earningsRelStats.winRate.toFixed(1)}%`);
      }
    }
    console.log();
  }

  // Top/Worst銘柄
  const sortedByReturn = [...validResults].sort(
    (a, b) => (b.absoluteReturn ?? 0) - (a.absoluteReturn ?? 0),
  );

  const topN = Math.min(10, sortedByReturn.length);
  if (topN > 0) {
    console.log("  ── Top 10 銘柄 ──────────────────────────────");
    for (let i = 0; i < topN; i++) {
      const r = sortedByReturn[i];
      console.log(
        `    ${(i + 1).toString().padStart(2)}. ${r.code.padEnd(6)} ${r.companyName.slice(0, 12).padEnd(14)} ` +
        `${r.evalCategory.padEnd(6)} ${fmtPct(r.absoluteReturn).padStart(9)} ` +
        `(TOPIX相対: ${fmtPct(r.relReturnTopix)})`,
      );
    }
    console.log();

    console.log("  ── Worst 10 銘柄 ────────────────────────────");
    for (let i = sortedByReturn.length - 1; i >= Math.max(0, sortedByReturn.length - topN); i--) {
      const r = sortedByReturn[i];
      const rank = sortedByReturn.length - i;
      console.log(
        `    ${rank.toString().padStart(2)}. ${r.code.padEnd(6)} ${r.companyName.slice(0, 12).padEnd(14)} ` +
        `${r.evalCategory.padEnd(6)} ${fmtPct(r.absoluteReturn).padStart(9)} ` +
        `(TOPIX相対: ${fmtPct(r.relReturnTopix)})`,
      );
    }
    console.log();
  }

  // エラー銘柄一覧
  const errorResults = results.filter((r) => r.error);
  if (errorResults.length > 0) {
    console.log(`  ── エラー銘柄 (${errorResults.length}件) ──────────────────────`);
    for (const r of errorResults) {
      console.log(`    ${r.code.padEnd(6)} ${r.companyName.slice(0, 12).padEnd(14)} ${r.error}`);
    }
    console.log();
  }

  console.log("=".repeat(62));

  // CSV出力
  if (csv) {
    if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

    const csvPath = join(OUTPUT_DIR, `shikiho_performance_${today}.csv`);
    const header = [
      "コード", "銘柄名", "四季報評価",
      "基準日終値", "終了日終値",
      "絶対リターン(%)", "TOPIX相対リターン(%)", "N225相対リターン(%)",
      "決算日", "決算前日", "決算前日終値", "決算後日", "決算後日終値",
      "決算前後リターン(%)", "決算前後TOPIX相対(%)",
      "決算前日までリターン(%)", "決算前日までTOPIX相対(%)", "決算前日までN225相対(%)",
      "エラー",
    ].join(",");

    const rows = results.map((r) => [
      r.code,
      `"${r.companyName}"`,
      r.evalCategory,
      r.basePrice?.toFixed(0) ?? "",
      r.endPrice?.toFixed(0) ?? "",
      r.absoluteReturn?.toFixed(2) ?? "",
      r.relReturnTopix?.toFixed(2) ?? "",
      r.relReturnN225?.toFixed(2) ?? "",
      r.earningsDate ?? "",
      r.earningsPreDate ?? "",
      r.earningsPreClose?.toFixed(0) ?? "",
      r.earningsPostDate ?? "",
      r.earningsPostClose?.toFixed(0) ?? "",
      r.earningsReturn?.toFixed(2) ?? "",
      r.earningsRelTopix?.toFixed(2) ?? "",
      r.preEarningsReturn?.toFixed(2) ?? "",
      r.preEarningsRelTopix?.toFixed(2) ?? "",
      r.preEarningsRelN225?.toFixed(2) ?? "",
      r.error ? `"${r.error}"` : "",
    ].join(","));

    // BOM付きUTF-8 for Excel
    const bom = "\ufeff";
    writeFileSync(csvPath, bom + header + "\n" + rows.join("\n") + "\n", "utf-8");
    console.log(`  CSV出力: ${csvPath}`);
  }
}

main().catch((e) => {
  console.error("[FATAL]", e);
  process.exit(1);
});

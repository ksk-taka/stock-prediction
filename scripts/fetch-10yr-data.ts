#!/usr/bin/env npx tsx
// ============================================================
// 10年分の日足データを取得してローカルキャッシュに保存
//
// 使い方:
//   npx tsx scripts/fetch-10yr-data.ts              # お気に入りのみ
//   npx tsx scripts/fetch-10yr-data.ts --all         # 全銘柄
//   npx tsx scripts/fetch-10yr-data.ts --segment プライム
//   npx tsx scripts/fetch-10yr-data.ts --all --force  # キャッシュ破棄して再取得
// ============================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { getArgs, parseFlag, hasFlag } from "@/lib/utils/cli";
import YahooFinance from "yahoo-finance2";
import { yfQueue } from "@/lib/utils/requestQueue";
import type { PriceData } from "@/types";

const yf = new YahooFinance();

// ── 設定 ──

const CACHE_DIR = join(process.cwd(), ".cache", "backtest-10yr");
const EXCLUDE_SYMBOLS = new Set(["7817.T"]);
const BATCH_SIZE = 50;
const YEARS = 10;

// ── キャッシュ ──

interface CacheEntry {
  data: PriceData[];
  cachedAt: number;
  period1: string;
  period2: string;
}

function ensureCacheDir() {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function cacheFile(symbol: string): string {
  return join(CACHE_DIR, `${symbol.replace(".", "_")}.json`);
}

export function loadCached10yr(symbol: string): PriceData[] | null {
  try {
    const file = cacheFile(symbol);
    if (!existsSync(file)) return null;
    const entry: CacheEntry = JSON.parse(readFileSync(file, "utf-8"));
    return entry.data;
  } catch {
    return null;
  }
}

// ── CLI引数 ──

function parseCliArgs() {
  const args = getArgs();
  const allStocks = hasFlag(args, "--all");
  const favoritesOnly = !allStocks && !hasFlag(args, "--segment");
  const segment = parseFlag(args, "--segment") ?? "プライム";
  const limitStr = parseFlag(args, "--limit");
  const limit = limitStr ? parseInt(limitStr, 10) : undefined;
  const force = hasFlag(args, "--force");
  return { allStocks, favoritesOnly, segment, limit, force };
}

// ── 銘柄読み込み ──

interface WatchlistStock {
  symbol: string;
  name: string;
  market: string;
  marketSegment?: string;
  favorite?: boolean;
}

function loadStocks(opts: ReturnType<typeof parseCliArgs>): WatchlistStock[] {
  const raw = readFileSync(join(process.cwd(), "data", "watchlist.json"), "utf-8");
  const watchlist = JSON.parse(raw) as { stocks: WatchlistStock[] };
  return watchlist.stocks.filter((s) => {
    if (EXCLUDE_SYMBOLS.has(s.symbol)) return false;
    if (s.market !== "JP") return false;
    if (opts.favoritesOnly) return s.favorite === true;
    if (opts.allStocks) return true;
    return s.marketSegment === opts.segment;
  });
}

// ── データ取得 ──

async function fetchAndCache(symbol: string, force: boolean): Promise<{ data: PriceData[] | null; fromCache: boolean }> {
  // キャッシュ確認
  if (!force) {
    const cached = loadCached10yr(symbol);
    if (cached) return { data: cached, fromCache: true };
  }

  // Yahoo Financeから10年分取得
  const period2 = new Date();
  const period1 = new Date();
  period1.setFullYear(period1.getFullYear() - YEARS);

  try {
    const result = await yfQueue.add(() =>
      yf.chart(symbol, {
        period1,
        period2,
        interval: "1d",
      })
    );

    const data: PriceData[] = result.quotes
      .filter((row) => (row.open ?? 0) > 0 && (row.close ?? 0) > 0)
      .map((row) => ({
        date: row.date instanceof Date
          ? row.date.toISOString().split("T")[0]
          : String(row.date),
        open: row.open ?? 0,
        high: row.high ?? 0,
        low: row.low ?? 0,
        close: row.close ?? 0,
        volume: row.volume ?? 0,
      }));

    // キャッシュに保存
    const entry: CacheEntry = {
      data,
      cachedAt: Date.now(),
      period1: period1.toISOString().split("T")[0],
      period2: period2.toISOString().split("T")[0],
    };
    writeFileSync(cacheFile(symbol), JSON.stringify(entry), "utf-8");

    return { data, fromCache: false };
  } catch {
    return { data: null, fromCache: false };
  }
}

// ── メイン ──

async function main() {
  const opts = parseCliArgs();
  let stocks = loadStocks(opts);
  if (opts.limit) stocks = stocks.slice(0, opts.limit);

  const label = opts.favoritesOnly ? "お気に入り" : opts.allStocks ? "全上場企業" : opts.segment;
  console.log("=".repeat(60));
  console.log("10年データ取得＆キャッシュ");
  console.log(`  対象: ${label} (${stocks.length}銘柄)`);
  console.log(`  期間: ${YEARS}年`);
  console.log(`  キャッシュ: ${CACHE_DIR}`);
  console.log(`  強制再取得: ${opts.force ? "ON" : "OFF"}`);
  console.log("=".repeat(60));

  ensureCacheDir();

  const startTime = Date.now();
  let fetched = 0;
  let fromCache = 0;
  let errors = 0;
  let totalRows = 0;

  for (let i = 0; i < stocks.length; i += BATCH_SIZE) {
    const batch = stocks.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map((stock) => fetchAndCache(stock.symbol, opts.force)),
    );

    for (const result of results) {
      if (result.status === "fulfilled" && result.value.data) {
        if (result.value.fromCache) {
          fromCache++;
        } else {
          fetched++;
        }
        totalRows += result.value.data.length;
      } else {
        errors++;
      }
    }

    const completed = Math.min(i + BATCH_SIZE, stocks.length);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const pct = ((completed / stocks.length) * 100).toFixed(1);
    process.stdout.write(
      `\r[${completed}/${stocks.length}] ${pct}% (${elapsed}秒, 取得${fetched}, キャッシュ${fromCache}, エラー${errors})`,
    );
  }

  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("\n\n" + "=".repeat(60));
  console.log(`完了 (${totalElapsed}秒)`);
  console.log(`  新規取得: ${fetched}銘柄`);
  console.log(`  キャッシュ: ${fromCache}銘柄`);
  console.log(`  エラー: ${errors}銘柄`);
  console.log(`  合計データ行: ${totalRows.toLocaleString()}行`);
  console.log(`  平均: ${totalRows > 0 ? Math.round(totalRows / (fetched + fromCache)) : 0}行/銘柄`);
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

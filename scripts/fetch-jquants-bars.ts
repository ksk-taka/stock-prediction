#!/usr/bin/env npx tsx
// ============================================================
// J-Quants 株価四本値取得 & キャッシュ
//
// Freeプラン: 12週間前 ～ 2年12週間前のデータが利用可能
//
// 使い方:
//   npx tsx scripts/fetch-jquants-bars.ts              # お気に入りのみ
//   npx tsx scripts/fetch-jquants-bars.ts --all         # 全JP銘柄
//   npx tsx scripts/fetch-jquants-bars.ts --segment プライム
//   npx tsx scripts/fetch-jquants-bars.ts --force       # キャッシュ破棄
//   npx tsx scripts/fetch-jquants-bars.ts --code 7203.T # 特定銘柄
//   npx tsx scripts/fetch-jquants-bars.ts --csv         # CSV出力あり
// ============================================================

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getArgs, parseFlag, hasFlag } from "@/lib/utils/cli";
import { getHistoricalPricesJQ } from "@/lib/api/jquants";
import { getCachedBars, setCachedBars } from "@/lib/cache/jquantsCache";
import type { PriceData } from "@/types";

// ── 設定 ──

const BATCH_SIZE = 20;
const EXCLUDE_SYMBOLS = new Set(["7817.T"]);

/** Freeプランのデータウィンドウを計算 */
function getDataWindow(): { from: Date; to: Date } {
  const now = new Date();
  // 最新データ: 12週前
  const to = new Date(now);
  to.setDate(to.getDate() - 12 * 7);
  // 最古データ: 2年12週前
  const from = new Date(to);
  from.setFullYear(from.getFullYear() - 2);
  return { from, to };
}

// ── CLI引数 ──

function parseCliArgs() {
  const args = getArgs();
  const code = parseFlag(args, "--code");
  const limitStr = parseFlag(args, "--limit");
  return {
    allStocks: hasFlag(args, "--all"),
    favoritesOnly: !hasFlag(args, "--all") && !hasFlag(args, "--segment") && !code,
    segment: parseFlag(args, "--segment") ?? "プライム",
    limit: limitStr ? parseInt(limitStr, 10) : undefined,
    force: hasFlag(args, "--force"),
    code,
    csv: hasFlag(args, "--csv"),
  };
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
  if (opts.code) {
    return [{ symbol: opts.code, name: opts.code, market: "JP" }];
  }
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

async function fetchAndCache(
  symbol: string,
  from: Date,
  to: Date,
  force: boolean
): Promise<{ data: PriceData[] | null; fromCache: boolean }> {
  // キャッシュ確認
  if (!force) {
    const cached = getCachedBars(symbol);
    if (cached) return { data: cached, fromCache: true };
  }

  try {
    const data = await getHistoricalPricesJQ(symbol, from, to);
    if (data.length > 0) {
      setCachedBars(symbol, data);
    }
    return { data, fromCache: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("404")) {
      console.error(`\n  [ERROR] ${symbol}: ${msg}`);
    }
    return { data: null, fromCache: false };
  }
}

// ── CSV出力 ──

function exportCSV(results: { symbol: string; name: string; data: PriceData[] }[]) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filePath = join(process.cwd(), "data", `jquants-bars-${timestamp}.csv`);

  const headers = "Symbol,Name,Date,Open,High,Low,Close,Volume";
  const rows: string[] = [];
  for (const { symbol, name, data } of results) {
    for (const d of data) {
      rows.push(`${symbol},"${name}",${d.date},${d.open},${d.high},${d.low},${d.close},${d.volume}`);
    }
  }

  writeFileSync(filePath, [headers, ...rows].join("\n"), "utf-8");
  console.log(`\nCSV出力: ${filePath}`);
}

// ── メイン ──

async function main() {
  const opts = parseCliArgs();
  let stocks = loadStocks(opts);
  if (opts.limit) stocks = stocks.slice(0, opts.limit);

  const { from, to } = getDataWindow();
  const label = opts.code
    ? opts.code
    : opts.favoritesOnly
      ? "お気に入り"
      : opts.allStocks
        ? "全上場企業"
        : opts.segment;

  console.log("=".repeat(60));
  console.log("J-Quants 株価四本値取得");
  console.log(`  対象: ${label} (${stocks.length}銘柄)`);
  console.log(`  データ期間: ${from.toISOString().split("T")[0]} ～ ${to.toISOString().split("T")[0]}`);
  console.log(`  キャッシュ強制更新: ${opts.force ? "ON" : "OFF"}`);
  console.log("=".repeat(60));

  const startTime = Date.now();
  let fetched = 0;
  let fromCache = 0;
  let errors = 0;
  let totalRows = 0;
  const csvResults: { symbol: string; name: string; data: PriceData[] }[] = [];

  for (let i = 0; i < stocks.length; i += BATCH_SIZE) {
    const batch = stocks.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map((stock) => fetchAndCache(stock.symbol, from, to, opts.force))
    );

    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      const stock = batch[j];
      if (result.status === "fulfilled" && result.value.data) {
        if (result.value.fromCache) {
          fromCache++;
        } else {
          fetched++;
        }
        totalRows += result.value.data.length;
        if (opts.csv) {
          csvResults.push({
            symbol: stock.symbol,
            name: stock.name,
            data: result.value.data,
          });
        }
      } else {
        errors++;
      }
    }

    const completed = Math.min(i + BATCH_SIZE, stocks.length);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const pct = ((completed / stocks.length) * 100).toFixed(1);
    process.stdout.write(
      `\r[${completed}/${stocks.length}] ${pct}% (${elapsed}秒, 取得${fetched}, キャッシュ${fromCache}, エラー${errors})`
    );
  }

  // 特定銘柄の場合、データプレビュー表示
  if (opts.code && csvResults.length > 0) {
    const data = csvResults[0].data;
    console.log(`\n\n--- ${opts.code} 株価データ (${data.length}行) ---`);
    console.log("Date         Open      High      Low       Close     Volume");
    const preview = data.slice(-10);
    for (const d of preview) {
      console.log(
        `${d.date}  ${String(d.open).padStart(8)}  ${String(d.high).padStart(8)}  ${String(d.low).padStart(8)}  ${String(d.close).padStart(8)}  ${String(d.volume).padStart(10)}`
      );
    }
    if (data.length > 10) {
      console.log(`  ... (先頭 ${data.length - 10} 行省略)`);
    }
  }

  if (opts.csv && csvResults.length > 0) {
    exportCSV(csvResults);
  }

  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("\n\n" + "=".repeat(60));
  console.log(`完了 (${totalElapsed}秒)`);
  console.log(`  新規取得: ${fetched}銘柄`);
  console.log(`  キャッシュ: ${fromCache}銘柄`);
  console.log(`  エラー: ${errors}銘柄`);
  console.log(`  合計データ行: ${totalRows.toLocaleString()}行`);
  if (fetched + fromCache > 0) {
    console.log(`  平均: ${Math.round(totalRows / (fetched + fromCache))}行/銘柄`);
  }
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

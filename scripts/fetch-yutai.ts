#!/usr/bin/env npx tsx
// ============================================================
// 株主優待データ事前取得スクリプト
//
// Kabutan優待ページをスクレイピングしてファイルキャッシュに保存
// stock-table APIはキャッシュからのみ読み取り（ライブスクレイピングしない）
//
// 使い方:
//   npx tsx scripts/fetch-yutai.ts                  # ウォッチリスト全銘柄
//   npx tsx scripts/fetch-yutai.ts --all            # 全登録銘柄
//   npx tsx scripts/fetch-yutai.ts --symbol 7203.T  # 特定銘柄のみ
//   npx tsx scripts/fetch-yutai.ts --dry-run        # 取得せず対象銘柄を表示
//   npx tsx scripts/fetch-yutai.ts --force          # キャッシュ無視で再取得
// ============================================================

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { readFileSync } from "fs";
import { join } from "path";
import type { Stock } from "@/types";
import { fetchYutaiBatch } from "@/lib/api/kabutan";
import { getCachedYutai, setCachedYutai } from "@/lib/cache/yutaiCache";

const WL_PATH = join(process.cwd(), "data", "watchlist.json");

// ── Args ──────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const force = args.includes("--force");
const allStocks = args.includes("--all");
const symbolIdx = args.indexOf("--symbol");
const singleSymbol = symbolIdx >= 0 ? args[symbolIdx + 1] : null;

// ── Load stocks ───────────────────────────────────────────

function loadStocks(): Stock[] {
  const raw = readFileSync(WL_PATH, "utf-8");
  const data = JSON.parse(raw);
  return (data.stocks ?? data) as Stock[];
}

// ── Main ──────────────────────────────────────────────────

async function main() {
  const stocks = loadStocks();

  let targets: string[];

  if (singleSymbol) {
    targets = [singleSymbol];
  } else if (allStocks) {
    targets = stocks.map((s) => s.symbol);
  } else {
    // お気に入り（グループに属するか isFavorite）のみ
    targets = stocks
      .filter((s) => s.favorite || (s.groups && s.groups.length > 0))
      .map((s) => s.symbol);
  }

  // キャッシュ済みを除外（--force でない場合）
  let toFetch: string[];
  if (force) {
    toFetch = targets;
  } else {
    toFetch = targets.filter((sym) => !getCachedYutai(sym));
  }

  console.log(`対象銘柄: ${targets.length}件`);
  console.log(`キャッシュ済み: ${targets.length - toFetch.length}件`);
  console.log(`取得対象: ${toFetch.length}件`);

  if (dryRun) {
    console.log("\n[dry-run] 取得対象銘柄:");
    toFetch.forEach((sym) => {
      const stock = stocks.find((s) => s.symbol === sym);
      console.log(`  ${sym} ${stock?.name || ""}`);
    });
    return;
  }

  if (toFetch.length === 0) {
    console.log("\n全銘柄キャッシュ済みです。--force で再取得できます。");
    return;
  }

  console.log(`\nKabutan優待ページを取得中... (3並列, 800ms遅延)`);
  const startTime = Date.now();

  const results = await fetchYutaiBatch(toFetch, (done, total) => {
    if (done % 10 === 0 || done === total) {
      process.stdout.write(`\r  ${done}/${total} (${Math.round((done / total) * 100)}%)`);
    }
  });

  console.log(""); // newline after progress

  // キャッシュに保存
  let yutaiCount = 0;
  let noYutaiCount = 0;
  for (const [symbol, info] of results) {
    setCachedYutai(symbol, info);
    if (info.hasYutai) {
      yutaiCount++;
    } else {
      noYutaiCount++;
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n完了 (${elapsed}秒)`);
  console.log(`  優待あり: ${yutaiCount}件`);
  console.log(`  優待なし: ${noYutaiCount}件`);

  // 優待あり銘柄を表示
  if (yutaiCount > 0) {
    console.log("\n優待あり銘柄:");
    for (const [symbol, info] of results) {
      if (!info.hasYutai) continue;
      const stock = stocks.find((s) => s.symbol === symbol);
      const name = stock?.name || "";
      const content = info.content ? ` | ${info.content.slice(0, 40)}` : "";
      const month = info.recordMonth ? ` [${info.recordMonth}]` : "";
      const recordDate = info.recordDate ? ` 権利付最終日: ${info.recordDate}` : "";
      console.log(`  ${symbol} ${name}${month}${content}${recordDate}`);
    }
  }
}

main().catch(console.error);

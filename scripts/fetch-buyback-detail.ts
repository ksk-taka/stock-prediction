#!/usr/bin/env npx tsx
/**
 * 自社株買い詳細データ取得スクリプト
 *
 * EDINET 自己株券買付状況報告書の XBRL を解析し、
 * 取得上限・累計・進捗率等の詳細情報を抽出・キャッシュする。
 *
 * Usage:
 *   npx tsx scripts/fetch-buyback-detail.ts                   # buyback銘柄(キャッシュなし)
 *   npx tsx scripts/fetch-buyback-detail.ts --symbol 7203.T   # 特定銘柄
 *   npx tsx scripts/fetch-buyback-detail.ts --favorites        # お気に入り
 *   npx tsx scripts/fetch-buyback-detail.ts --force            # キャッシュ無視
 *   npx tsx scripts/fetch-buyback-detail.ts --dry-run          # 対象銘柄表示
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { fetchBuybackDetailBatch, fetchBuybackDetail } from "../src/lib/api/edinetBuybackDetail";
import {
  getCachedBuybackDetail,
  setCachedBuybackDetail,
  setBuybackDetailToSupabase,
} from "../src/lib/cache/buybackDetailCache";
import { getCachedBuybackCodes, getBuybackCodesWithFallback } from "../src/lib/cache/buybackCache";
import type { BuybackDetail } from "../src/types/buyback";

// ── 引数パース ──

const args = process.argv.slice(2);
const symbolArg = args.includes("--symbol") ? args[args.indexOf("--symbol") + 1] : null;
const favoritesOnly = args.includes("--favorites");
const forceRefresh = args.includes("--force");
const dryRun = args.includes("--dry-run");

// ── メイン ──

async function loadTargetSymbols(): Promise<string[]> {
  if (symbolArg) return [symbolArg];

  if (favoritesOnly) {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const wl = JSON.parse(readFileSync(join(process.cwd(), "data", "watchlist.json"), "utf-8"));
    const favorites = (wl.favorites ?? []) as string[];
    return favorites;
  }

  // デフォルト: buybackキャッシュから対象銘柄リストを取得
  let codes = getCachedBuybackCodes();
  if (!codes) {
    codes = await getBuybackCodesWithFallback();
  }
  if (!codes || codes.size === 0) {
    console.log("buyback銘柄リストがありません。先に npm run scan:buyback を実行してください。");
    process.exit(1);
  }
  return [...codes].map((c) => `${c}.T`);
}

async function main() {
  console.log("=== 自社株買い詳細データ取得 ===\n");

  const symbols = await loadTargetSymbols();

  // キャッシュ済みをスキップ
  let targets = symbols;
  if (!forceRefresh) {
    targets = symbols.filter((s) => {
      const code = s.replace(".T", "");
      return !getCachedBuybackDetail(code);
    });
    if (targets.length < symbols.length) {
      console.log(`キャッシュ済み: ${symbols.length - targets.length} 銘柄 (スキップ)`);
    }
  }

  console.log(`対象: ${targets.length} 銘柄\n`);

  if (dryRun) {
    for (const s of targets) console.log(`  ${s}`);
    return;
  }

  if (targets.length === 0) {
    console.log("取得対象なし。--force で再取得できます。");
    return;
  }

  const start = Date.now();
  const results = new Map<string, BuybackDetail>();

  if (targets.length === 1) {
    // 単一銘柄
    const detail = await fetchBuybackDetail(targets[0]);
    if (detail) {
      results.set(detail.stockCode, detail);
      setCachedBuybackDetail(detail.stockCode, detail);
    }
  } else {
    // バッチ取得
    const batchResults = await fetchBuybackDetailBatch(targets, {
      onProgress: (done, total, symbol) => {
        process.stdout.write(`\r[${done}/${total}] ${symbol}    `);
      },
    });
    for (const [code, detail] of batchResults) {
      results.set(code, detail);
      setCachedBuybackDetail(code, detail);
    }
    console.log(""); // 改行
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  // Supabase保存
  if (results.size > 0 && process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    await setBuybackDetailToSupabase(results);
    console.log(`Supabase保存完了`);
  }

  // サマリーテーブル出力
  console.log(`\n=== 結果: ${results.size} 銘柄 (${elapsed}秒) ===\n`);

  if (results.size > 0) {
    console.log(
      "コード".padEnd(6) + " " +
      "企業名".padEnd(20) + " " +
      "上限金額".padStart(12) + " " +
      "累計金額".padStart(12) + " " +
      "金額進捗".padStart(8) + " " +
      "上限株数".padStart(12) + " " +
      "累計株数".padStart(12) + " " +
      "株数進捗".padStart(8) + " " +
      "期限".padStart(12) + " " +
      "状態"
    );
    console.log("-".repeat(120));

    const sorted = [...results.values()].sort((a, b) => {
      const pa = a.progressAmount ?? -1;
      const pb = b.progressAmount ?? -1;
      return pb - pa;
    });

    for (const d of sorted) {
      const r = d.latestReport;
      const fmtAmount = (v: number | null) =>
        v != null ? `${(v / 1e8).toFixed(0)}億`.padStart(12) : "－".padStart(12);
      const fmtShares = (v: number | null) =>
        v != null ? `${(v / 10000).toFixed(0)}万`.padStart(12) : "－".padStart(12);
      const fmtPct = (v: number | null) =>
        v != null ? `${v.toFixed(1)}%`.padStart(8) : "－".padStart(8);

      console.log(
        d.stockCode.padEnd(6) + " " +
        d.filerName.slice(0, 16).padEnd(20) + " " +
        fmtAmount(r?.maxAmount ?? null) + " " +
        fmtAmount(r?.cumulativeAmount ?? null) + " " +
        fmtPct(d.progressAmount) + " " +
        fmtShares(r?.maxShares ?? null) + " " +
        fmtShares(r?.cumulativeShares ?? null) + " " +
        fmtPct(d.progressShares) + " " +
        (r?.acquisitionPeriodTo ?? "－").padStart(12) + " " +
        (d.isActive ? "実施中" : "完了")
      );
    }
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});

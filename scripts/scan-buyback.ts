#!/usr/bin/env npx tsx
// ============================================================
// EDINET 自社株買い銘柄スキャナー
//
// 直近90日間で自社株買いを実施・発表した企業の銘柄コードを抽出し、
// ファイルキャッシュ + Supabase に保存する。
//
// 使い方:
//   npx tsx scripts/scan-buyback.ts
//   npm run scan:buyback
// ============================================================

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { fetchBuybackStockCodes } from "../src/lib/api/edinetBuyback";
import { setCachedBuybackCodes, setBuybackCodesToSupabase } from "../src/lib/cache/buybackCache";

async function main() {
  console.log("=== EDINET 自社株買い銘柄スキャン ===\n");
  console.log("直近90日間の提出書類を検索します...\n");

  const start = Date.now();
  const codes = await fetchBuybackStockCodes();
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  // ファイルキャッシュに保存
  setCachedBuybackCodes(codes);
  console.log(`ファイルキャッシュ保存完了`);

  // Supabaseに保存（設定されていれば）
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    await setBuybackCodesToSupabase(codes);
    console.log(`Supabase保存完了`);
  }

  console.log(`\n完了: ${codes.length} 銘柄 (${elapsed}秒)\n`);
  console.log(JSON.stringify(codes));
}

main().catch((err) => {
  console.error("エラー:", err);
  process.exit(1);
});

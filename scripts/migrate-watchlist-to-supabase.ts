/**
 * watchlist.json → Supabase 移行スクリプト
 *
 * 使い方:
 *   1. Google ログインして Supabase Dashboard > Authentication > Users から user_id をコピー
 *   2. .env.local に SUPABASE_TARGET_USER_ID=xxxx を追加
 *   3. npx tsx scripts/migrate-watchlist-to-supabase.ts
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { readFileSync } from "fs";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";
import type { WatchList } from "../src/types";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const TARGET_USER_ID = process.env.SUPABASE_TARGET_USER_ID;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("❌ NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY が必要です");
  process.exit(1);
}

if (!TARGET_USER_ID) {
  console.error("❌ SUPABASE_TARGET_USER_ID が必要です");
  console.error("   1. アプリにGoogleログインしてください");
  console.error("   2. Supabase Dashboard > Authentication > Users から user_id をコピー");
  console.error("   3. .env.local に SUPABASE_TARGET_USER_ID=xxxx を追加");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const BATCH_SIZE = 500;

async function main() {
  const raw = readFileSync(join(process.cwd(), "data", "watchlist.json"), "utf-8");
  const watchlist: WatchList = JSON.parse(raw);

  console.log(`📊 ${watchlist.stocks.length} 銘柄を移行します...`);

  // 1. stocks テーブルに挿入
  for (let i = 0; i < watchlist.stocks.length; i += BATCH_SIZE) {
    const batch = watchlist.stocks.slice(i, i + BATCH_SIZE).map((s) => ({
      user_id: TARGET_USER_ID,
      symbol: s.symbol,
      name: s.name,
      market: s.market,
      market_segment: s.marketSegment ?? null,
      sectors: s.sectors ?? [],
      favorite: s.favorite ?? false,
    }));

    const { error } = await supabase
      .from("stocks")
      .upsert(batch, { onConflict: "user_id,symbol" });

    if (error) {
      console.error(`❌ stocks バッチ ${i} エラー:`, error.message);
    } else {
      console.log(`  ✅ stocks ${i + 1}-${Math.min(i + BATCH_SIZE, watchlist.stocks.length)}`);
    }
  }

  // 2. fundamental_judgments テーブルに挿入
  const withFundamental = watchlist.stocks.filter((s) => s.fundamental);
  if (withFundamental.length > 0) {
    console.log(`\n📋 ${withFundamental.length} 件のファンダメンタル判定を移行...`);
    for (let i = 0; i < withFundamental.length; i += BATCH_SIZE) {
      const batch = withFundamental.slice(i, i + BATCH_SIZE).map((s) => ({
        user_id: TARGET_USER_ID,
        symbol: s.symbol,
        judgment: s.fundamental!.judgment,
        memo: s.fundamental!.memo,
        analyzed_at: s.fundamental!.analyzedAt,
      }));

      const { error } = await supabase
        .from("fundamental_judgments")
        .upsert(batch, { onConflict: "user_id,symbol" });

      if (error) {
        console.error(`❌ judgments バッチ ${i} エラー:`, error.message);
      } else {
        console.log(`  ✅ judgments ${i + 1}-${Math.min(i + BATCH_SIZE, withFundamental.length)}`);
      }
    }
  }

  // 3. watchlist_meta を更新
  await supabase
    .from("watchlist_meta")
    .upsert({ user_id: TARGET_USER_ID, updated_at: watchlist.updatedAt });

  console.log("\n🎉 移行完了！");
}

main().catch(console.error);

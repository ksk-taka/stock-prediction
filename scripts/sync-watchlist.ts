/**
 * Supabase ↔ watchlist.json 同期スクリプト
 *
 * 使い方:
 *   npm run sync:pull   -- Supabase → watchlist.json
 *   npm run sync:push   -- watchlist.json → Supabase
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";
import type { Stock, WatchList } from "../src/types";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const TARGET_USER_ID = process.env.SUPABASE_TARGET_USER_ID!;
const WATCHLIST_PATH = join(process.cwd(), "data", "watchlist.json");

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !TARGET_USER_ID) {
  console.error("❌ NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_TARGET_USER_ID が必要です");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const BATCH_SIZE = 500;

async function pull() {
  console.log("⬇️  Supabase → watchlist.json");

  const { data: stocks, error } = await supabase
    .from("stocks")
    .select("*")
    .eq("user_id", TARGET_USER_ID)
    .order("created_at", { ascending: true });

  if (error) throw error;

  const { data: judgments } = await supabase
    .from("fundamental_judgments")
    .select("*")
    .eq("user_id", TARGET_USER_ID);

  const judgmentMap = new Map(
    (judgments ?? []).map((j: { symbol: string; judgment: string; memo: string; analyzed_at: string }) => [j.symbol, j])
  );

  const mappedStocks: Stock[] = (stocks ?? []).map((s: { symbol: string; name: string; market: string; market_segment: string | null; sectors: string[] | null; favorite: boolean | null }) => ({
    symbol: s.symbol,
    name: s.name,
    market: s.market as "JP" | "US",
    marketSegment: (s.market_segment as Stock["marketSegment"]) ?? undefined,
    sectors: s.sectors ?? [],
    favorite: s.favorite ?? false,
    fundamental: judgmentMap.has(s.symbol)
      ? {
          judgment: judgmentMap.get(s.symbol)!.judgment as "bullish" | "neutral" | "bearish",
          memo: judgmentMap.get(s.symbol)!.memo,
          analyzedAt: judgmentMap.get(s.symbol)!.analyzed_at,
        }
      : undefined,
  }));

  const watchlist: WatchList = {
    stocks: mappedStocks,
    groups: [],
    updatedAt: new Date().toISOString(),
  };

  writeFileSync(WATCHLIST_PATH, JSON.stringify(watchlist, null, 2), "utf-8");
  console.log(`✅ ${mappedStocks.length} 銘柄を watchlist.json に書き出しました`);
}

async function push() {
  console.log("⬆️  watchlist.json → Supabase");

  const raw = readFileSync(WATCHLIST_PATH, "utf-8");
  const watchlist: WatchList = JSON.parse(raw);

  console.log(`  ${watchlist.stocks.length} 銘柄をアップロード...`);

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

    if (error) console.error(`❌ バッチ ${i} エラー:`, error.message);
  }

  // ファンダメンタル判定
  const withFundamental = watchlist.stocks.filter((s) => s.fundamental);
  if (withFundamental.length > 0) {
    for (let i = 0; i < withFundamental.length; i += BATCH_SIZE) {
      const batch = withFundamental.slice(i, i + BATCH_SIZE).map((s) => ({
        user_id: TARGET_USER_ID,
        symbol: s.symbol,
        judgment: s.fundamental!.judgment,
        memo: s.fundamental!.memo,
        analyzed_at: s.fundamental!.analyzedAt,
      }));

      await supabase
        .from("fundamental_judgments")
        .upsert(batch, { onConflict: "user_id,symbol" });
    }
  }

  console.log("✅ アップロード完了");
}

const mode = process.argv[2];
if (mode === "--pull") {
  pull().catch(console.error);
} else if (mode === "--push") {
  push().catch(console.error);
} else {
  console.log("使い方: npx tsx scripts/sync-watchlist.ts --pull|--push");
}

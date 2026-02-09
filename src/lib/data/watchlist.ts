import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Stock, WatchList } from "@/types";

/**
 * ウォッチリストを読み込む (Supabase)
 */
export async function getWatchList(userId: string): Promise<WatchList> {
  const supabase = await createServerSupabaseClient();

  const [{ data: stocks, error }, { data: judgments }] = await Promise.all([
    supabase
      .from("stocks")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: true }),
    supabase
      .from("fundamental_judgments")
      .select("*")
      .eq("user_id", userId),
  ]);

  if (error) throw error;

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

  const { data: meta } = await supabase
    .from("watchlist_meta")
    .select("updated_at")
    .eq("user_id", userId)
    .single();

  return {
    stocks: mappedStocks,
    updatedAt: meta?.updated_at ?? new Date().toISOString(),
  };
}

async function touchMeta(userId: string) {
  const supabase = await createServerSupabaseClient();
  await supabase
    .from("watchlist_meta")
    .upsert({ user_id: userId, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
}

/**
 * ウォッチリストに銘柄を追加
 */
export async function addStock(userId: string, stock: Stock): Promise<WatchList> {
  const supabase = await createServerSupabaseClient();

  await supabase.from("stocks").upsert(
    {
      user_id: userId,
      symbol: stock.symbol,
      name: stock.name,
      market: stock.market,
      market_segment: stock.marketSegment ?? null,
      sectors: stock.sectors ?? [],
      favorite: stock.favorite ?? false,
    },
    { onConflict: "user_id,symbol" }
  );

  await touchMeta(userId);
  return getWatchList(userId);
}

/**
 * ウォッチリストの銘柄にファンダメンタルズ判定を保存
 */
export async function updateStockFundamental(
  userId: string,
  symbol: string,
  fundamental: { judgment: "bullish" | "neutral" | "bearish"; memo: string; analyzedAt: string }
): Promise<WatchList> {
  const supabase = await createServerSupabaseClient();

  await supabase.from("fundamental_judgments").upsert(
    {
      user_id: userId,
      symbol,
      judgment: fundamental.judgment,
      memo: fundamental.memo,
      analyzed_at: fundamental.analyzedAt,
    },
    { onConflict: "user_id,symbol" }
  );

  await touchMeta(userId);
  return getWatchList(userId);
}

/**
 * お気に入りトグル
 */
export async function toggleFavorite(userId: string, symbol: string): Promise<WatchList> {
  const supabase = await createServerSupabaseClient();

  // 現在の値を取得して反転
  const { data: current } = await supabase
    .from("stocks")
    .select("favorite")
    .eq("user_id", userId)
    .eq("symbol", symbol)
    .single();

  if (current) {
    await supabase
      .from("stocks")
      .update({ favorite: !current.favorite, updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("symbol", symbol);
  }

  await touchMeta(userId);
  return getWatchList(userId);
}

/**
 * ウォッチリストから銘柄を削除
 */
export async function removeStock(userId: string, symbol: string): Promise<WatchList> {
  const supabase = await createServerSupabaseClient();

  await supabase.from("stocks").delete().eq("user_id", userId).eq("symbol", symbol);
  await supabase.from("fundamental_judgments").delete().eq("user_id", userId).eq("symbol", symbol);

  await touchMeta(userId);
  return getWatchList(userId);
}

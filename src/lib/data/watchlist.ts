import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Stock, WatchList } from "@/types";

const PAGE_SIZE = 1000;

/**
 * ウォッチリストを読み込む (Supabase)
 * Supabase デフォルト 1000行制限を回避するためページネーションで全件取得
 */
export async function getWatchList(userId: string): Promise<WatchList> {
  const supabase = await createServerSupabaseClient();

  // stocks: ページネーションで全件取得
  type StockRow = { symbol: string; name: string; market: string; market_segment: string | null; sectors: string[] | null; favorite: boolean | null };
  const allStocks: StockRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("stocks")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as StockRow[];
    allStocks.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }

  // fundamental_judgments: ページネーションで全件取得
  type JudgmentRow = { symbol: string; judgment: string; memo: string; analyzed_at: string };
  const allJudgments: JudgmentRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("fundamental_judgments")
      .select("*")
      .eq("user_id", userId)
      .range(from, from + PAGE_SIZE);
    if (error) throw error;
    const rows = (data ?? []) as JudgmentRow[];
    allJudgments.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }

  const judgmentMap = new Map(
    allJudgments.map((j) => [j.symbol, j])
  );

  const mappedStocks: Stock[] = allStocks.map((s) => ({
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

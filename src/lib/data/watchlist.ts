import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Stock, WatchList, WatchlistGroup } from "@/types";

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
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as JudgmentRow[];
    allJudgments.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }

  // watchlist_groups: 全グループ取得
  const groups = await getGroups(userId);

  // stock_group_memberships: ページネーションで全件取得
  type MembershipRow = { symbol: string; group_id: number };
  const allMemberships: MembershipRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("stock_group_memberships")
      .select("symbol, group_id")
      .eq("user_id", userId)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as MembershipRow[];
    allMemberships.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }

  // グループIDからWatchlistGroupへのマップ
  const groupMap = new Map(groups.map((g) => [g.id, g]));

  // シンボルごとの所属グループマップ
  const symbolGroupsMap = new Map<string, WatchlistGroup[]>();
  for (const m of allMemberships) {
    const g = groupMap.get(m.group_id);
    if (!g) continue;
    const arr = symbolGroupsMap.get(m.symbol) ?? [];
    arr.push(g);
    symbolGroupsMap.set(m.symbol, arr);
  }

  const judgmentMap = new Map(
    allJudgments.map((j) => [j.symbol, j])
  );

  const mappedStocks: Stock[] = allStocks.map((s) => {
    const stockGroups = symbolGroupsMap.get(s.symbol) ?? [];
    return {
      symbol: s.symbol,
      name: s.name,
      market: s.market as "JP" | "US",
      marketSegment: (s.market_segment as Stock["marketSegment"]) ?? undefined,
      sectors: s.sectors ?? [],
      favorite: stockGroups.length > 0,
      groups: stockGroups,
      fundamental: judgmentMap.has(s.symbol)
        ? {
            judgment: judgmentMap.get(s.symbol)!.judgment as "bullish" | "neutral" | "bearish",
            memo: judgmentMap.get(s.symbol)!.memo,
            analyzedAt: judgmentMap.get(s.symbol)!.analyzed_at,
          }
        : undefined,
    };
  });

  const { data: meta } = await supabase
    .from("watchlist_meta")
    .select("updated_at")
    .eq("user_id", userId)
    .single();

  return {
    stocks: mappedStocks,
    groups,
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
 * 銘柄のグループ所属を設定（アトミック置換）
 */
export async function setStockGroups(
  userId: string,
  symbol: string,
  groupIds: number[]
): Promise<{ groups: WatchlistGroup[] }> {
  const supabase = await createServerSupabaseClient();

  // 既存メンバーシップ全削除
  await supabase
    .from("stock_group_memberships")
    .delete()
    .eq("user_id", userId)
    .eq("symbol", symbol);

  // 新規メンバーシップ挿入
  if (groupIds.length > 0) {
    await supabase.from("stock_group_memberships").insert(
      groupIds.map((gid) => ({ user_id: userId, symbol, group_id: gid }))
    );
  }

  // stocks.favorite を同期更新（スクリプト後方互換）
  await supabase
    .from("stocks")
    .update({ favorite: groupIds.length > 0, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("symbol", symbol);

  await touchMeta(userId);

  // 更新後のグループ情報を返す
  const allGroups = await getGroups(userId);
  const groupMap = new Map(allGroups.map((g) => [g.id, g]));
  return {
    groups: groupIds.map((id) => groupMap.get(id)).filter((g): g is WatchlistGroup => g != null),
  };
}

/**
 * グループ一覧取得
 */
export async function getGroups(userId: string): Promise<WatchlistGroup[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("watchlist_groups")
    .select("*")
    .eq("user_id", userId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;

  return (data ?? []).map((g: { id: number; name: string; color: string; sort_order: number }) => ({
    id: g.id,
    name: g.name,
    color: g.color,
    sortOrder: g.sort_order,
  }));
}

/**
 * グループ作成
 */
export async function createGroup(
  userId: string,
  name: string,
  color?: string
): Promise<WatchlistGroup> {
  const supabase = await createServerSupabaseClient();

  // sort_order: 既存グループの最大値+1
  const { data: maxRow } = await supabase
    .from("watchlist_groups")
    .select("sort_order")
    .eq("user_id", userId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .single();

  const sortOrder = (maxRow?.sort_order ?? -1) + 1;

  const { data, error } = await supabase
    .from("watchlist_groups")
    .insert({ user_id: userId, name, color: color ?? "#fbbf24", sort_order: sortOrder })
    .select("*")
    .single();
  if (error) throw error;

  return {
    id: data.id,
    name: data.name,
    color: data.color,
    sortOrder: data.sort_order,
  };
}

/**
 * グループ更新
 */
export async function updateGroup(
  userId: string,
  groupId: number,
  updates: { name?: string; color?: string; sortOrder?: number }
): Promise<WatchlistGroup> {
  const supabase = await createServerSupabaseClient();

  const updateData: Record<string, unknown> = {};
  if (updates.name !== undefined) updateData.name = updates.name;
  if (updates.color !== undefined) updateData.color = updates.color;
  if (updates.sortOrder !== undefined) updateData.sort_order = updates.sortOrder;

  const { data, error } = await supabase
    .from("watchlist_groups")
    .update(updateData)
    .eq("id", groupId)
    .eq("user_id", userId)
    .select("*")
    .single();
  if (error) throw error;

  return {
    id: data.id,
    name: data.name,
    color: data.color,
    sortOrder: data.sort_order,
  };
}

/**
 * グループ削除（メンバーシップもCASCADE削除）
 */
export async function deleteGroup(userId: string, groupId: number): Promise<void> {
  const supabase = await createServerSupabaseClient();

  // グループ削除前に、このグループのみに所属している銘柄のfavoriteを更新
  const { data: memberships } = await supabase
    .from("stock_group_memberships")
    .select("symbol")
    .eq("user_id", userId)
    .eq("group_id", groupId);

  await supabase
    .from("watchlist_groups")
    .delete()
    .eq("id", groupId)
    .eq("user_id", userId);

  // 削除後、どのグループにも属さなくなった銘柄のfavoriteをfalseに
  if (memberships && memberships.length > 0) {
    for (const m of memberships) {
      const { count } = await supabase
        .from("stock_group_memberships")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("symbol", m.symbol);
      if (count === 0) {
        await supabase
          .from("stocks")
          .update({ favorite: false, updated_at: new Date().toISOString() })
          .eq("user_id", userId)
          .eq("symbol", m.symbol);
      }
    }
  }
}

/**
 * ウォッチリストから銘柄を削除
 */
export async function removeStock(userId: string, symbol: string): Promise<WatchList> {
  const supabase = await createServerSupabaseClient();

  await supabase.from("stock_group_memberships").delete().eq("user_id", userId).eq("symbol", symbol);
  await supabase.from("stocks").delete().eq("user_id", userId).eq("symbol", symbol);
  await supabase.from("fundamental_judgments").delete().eq("user_id", userId).eq("symbol", symbol);

  await touchMeta(userId);
  return getWatchList(userId);
}

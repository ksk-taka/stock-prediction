/**
 * 自社株買い詳細キャッシュ（ファイルベース + Supabaseフォールバック、7日TTL）
 * yutaiCache.ts と同パターン
 */

import fs from "fs";
import path from "path";
import { ensureCacheDir, TTL } from "./cacheUtils";
import { createServiceClient } from "@/lib/supabase/service";
import type { BuybackDetail } from "@/types/buyback";

const CACHE_SUBDIR = "buyback-detail";
const BUYBACK_DETAIL_TTL = TTL.DAYS_7;

interface BuybackDetailCacheEntry {
  data: BuybackDetail;
  cachedAt: number;
}

function cacheFile(symbol: string): string {
  const dir = ensureCacheDir(CACHE_SUBDIR);
  return path.join(dir, `${symbol.replace(".", "_")}.json`);
}

export function getCachedBuybackDetail(symbol: string): BuybackDetail | null {
  try {
    const file = cacheFile(symbol);
    if (!fs.existsSync(file)) return null;
    const entry: BuybackDetailCacheEntry = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (Date.now() - entry.cachedAt > BUYBACK_DETAIL_TTL) return null;
    return entry.data;
  } catch {
    return null;
  }
}

export function setCachedBuybackDetail(symbol: string, data: BuybackDetail): void {
  try {
    const file = cacheFile(symbol);
    const entry: BuybackDetailCacheEntry = { data, cachedAt: Date.now() };
    fs.writeFileSync(file, JSON.stringify(entry), "utf-8");
  } catch {
    // ignore
  }
}

export function getCachedBuybackDetailBatch(symbols: string[]): Map<string, BuybackDetail> {
  const result = new Map<string, BuybackDetail>();
  for (const sym of symbols) {
    const cached = getCachedBuybackDetail(sym);
    if (cached) result.set(sym, cached);
  }
  return result;
}

// ── Supabase ──

export async function getBuybackDetailFromSupabase(
  symbols: string[],
): Promise<Map<string, BuybackDetail>> {
  const result = new Map<string, BuybackDetail>();
  if (symbols.length === 0) return result;

  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("buyback_detail_cache")
      .select("symbol, data, cached_at")
      .in("symbol", symbols);

    if (error || !data) return result;

    const now = Date.now();
    for (const row of data) {
      const cachedAt = new Date(row.cached_at).getTime();
      if (now - cachedAt <= BUYBACK_DETAIL_TTL) {
        result.set(row.symbol, row.data as BuybackDetail);
      }
    }
  } catch {
    // ignore
  }

  return result;
}

export async function setBuybackDetailToSupabase(
  entries: Map<string, BuybackDetail>,
): Promise<void> {
  if (entries.size === 0) return;

  try {
    const supabase = createServiceClient();
    const rows = Array.from(entries).map(([symbol, data]) => ({
      symbol,
      data,
      cached_at: new Date().toISOString(),
    }));

    for (let i = 0; i < rows.length; i += 50) {
      const batch = rows.slice(i, i + 50);
      const { error } = await supabase
        .from("buyback_detail_cache")
        .upsert(batch, { onConflict: "symbol" });
      if (error) {
        console.error("[buybackDetail] Supabase upsert error:", error.message);
      }
    }
  } catch (err) {
    console.error("[buybackDetail] Supabase write error:", err);
  }
}

/**
 * ファイルキャッシュ → Supabase のフォールバック付きバッチ取得
 */
export async function getBuybackDetailBatchWithFallback(
  symbols: string[],
): Promise<Map<string, BuybackDetail>> {
  const result = getCachedBuybackDetailBatch(symbols);

  const missing = symbols.filter((s) => !result.has(s));
  if (missing.length > 0) {
    const sbData = await getBuybackDetailFromSupabase(missing);
    for (const [sym, data] of sbData) {
      result.set(sym, data);
      // ファイルキャッシュにも書き戻し
      setCachedBuybackDetail(sym, data);
    }
  }

  return result;
}

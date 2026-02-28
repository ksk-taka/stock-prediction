/**
 * 自社株買いキャッシュ（ファイル + Supabaseフォールバック）
 *
 * fetchBuybackStockCodes() の結果（4桁コード配列）を単一ファイルでキャッシュ。
 * 各テーブルで hasBuyback = buybackSet.has(code) として参照する。
 */

import { readCache, writeCache, TTL } from "./cacheUtils";
import { createServiceClient } from "@/lib/supabase/service";

const CACHE_SUBDIR = "buyback";
const CACHE_KEY = "all";
const BUYBACK_TTL = TTL.DAYS_7;

interface BuybackCacheData {
  codes: string[];
}

/**
 * ファイルキャッシュから自社株買いコードSetを取得
 */
export function getCachedBuybackCodes(): Set<string> | null {
  const entry = readCache<BuybackCacheData>(CACHE_SUBDIR, CACHE_KEY, "", BUYBACK_TTL);
  if (!entry) return null;
  return new Set(entry.data.codes);
}

/**
 * ファイルキャッシュに自社株買いコードを保存
 */
export function setCachedBuybackCodes(codes: string[]): void {
  writeCache<BuybackCacheData>(CACHE_SUBDIR, CACHE_KEY, { codes });
}

/**
 * Supabaseから自社株買いコードSetを取得（Vercelフォールバック用）
 */
export async function getBuybackCodesFromSupabase(): Promise<Set<string> | null> {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("buyback_cache")
      .select("codes, scanned_at")
      .eq("id", 1)
      .single();

    if (error || !data) return null;

    // TTLチェック
    const scannedAt = new Date(data.scanned_at).getTime();
    if (Date.now() - scannedAt > BUYBACK_TTL) return null;

    const codes: string[] = typeof data.codes === "string"
      ? JSON.parse(data.codes)
      : data.codes;
    return new Set(codes);
  } catch {
    return null;
  }
}

/**
 * Supabaseに自社株買いコードを保存（upsert）
 */
export async function setBuybackCodesToSupabase(codes: string[]): Promise<void> {
  try {
    const supabase = createServiceClient();
    const { error } = await supabase
      .from("buyback_cache")
      .upsert({
        id: 1,
        codes,
        scanned_at: new Date().toISOString(),
      }, { onConflict: "id" });

    if (error) {
      console.error("[buyback] Supabase upsert error:", error.message);
    }
  } catch (err) {
    console.error("[buyback] Supabase write error:", err);
  }
}

/**
 * ファイルキャッシュ → Supabaseフォールバックで自社株買いSetを取得
 * どちらもなければ null
 */
export async function getBuybackCodesWithFallback(): Promise<Set<string> | null> {
  // 1. ファイルキャッシュ (高速)
  const cached = getCachedBuybackCodes();
  if (cached) return cached;

  // 2. Supabaseフォールバック (Vercel用)
  return getBuybackCodesFromSupabase();
}

/**
 * 株主優待キャッシュ（ファイルベース + Supabaseフォールバック、180日TTL）
 * statsCacheと同パターン
 */

import fs from "fs";
import path from "path";
import { getCacheBaseDir } from "./cacheDir";
import { createServiceClient } from "@/lib/supabase/service";
import type { YutaiInfo } from "@/types/yutai";

const CACHE_DIR = path.join(getCacheBaseDir(), "yutai");
const YUTAI_TTL = 180 * 24 * 60 * 60 * 1000; // 180日

interface YutaiCacheEntry {
  data: YutaiInfo;
  cachedAt: number;
}

function ensureDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function cacheFile(symbol: string): string {
  return path.join(CACHE_DIR, `${symbol.replace(".", "_")}.json`);
}

/**
 * キャッシュから優待情報を取得
 * null = キャッシュなしまたは期限切れ
 */
export function getCachedYutai(symbol: string): YutaiInfo | null {
  try {
    ensureDir();
    const file = cacheFile(symbol);
    if (!fs.existsSync(file)) return null;

    const entry: YutaiCacheEntry = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (Date.now() - entry.cachedAt > YUTAI_TTL) return null;
    return entry.data;
  } catch {
    return null;
  }
}

/**
 * 優待情報をキャッシュに保存
 */
export function setCachedYutai(symbol: string, data: YutaiInfo): void {
  try {
    ensureDir();
    const file = cacheFile(symbol);
    const entry: YutaiCacheEntry = { data, cachedAt: Date.now() };
    fs.writeFileSync(file, JSON.stringify(entry), "utf-8");
  } catch {
    // ignore write errors
  }
}

/**
 * バッチでキャッシュから優待情報を取得
 * キャッシュヒットしたもののみ返す
 */
export function getCachedYutaiBatch(symbols: string[]): Map<string, YutaiInfo> {
  const result = new Map<string, YutaiInfo>();
  for (const sym of symbols) {
    const cached = getCachedYutai(sym);
    if (cached) {
      result.set(sym, cached);
    }
  }
  return result;
}

// ── Supabase 読み書き ─────────────────────────────────────

/**
 * Supabaseからバッチで優待情報を取得（ファイルキャッシュのフォールバック）
 */
export async function getYutaiFromSupabase(
  symbols: string[]
): Promise<Map<string, YutaiInfo>> {
  const result = new Map<string, YutaiInfo>();
  if (symbols.length === 0) return result;

  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("yutai_cache")
      .select("symbol, data, cached_at")
      .in("symbol", symbols);

    if (error || !data) return result;

    const now = Date.now();
    for (const row of data) {
      const cachedAt = new Date(row.cached_at).getTime();
      if (now - cachedAt <= YUTAI_TTL) {
        result.set(row.symbol, row.data as YutaiInfo);
      }
    }
  } catch {
    // Supabaseエラーは無視
  }

  return result;
}

/**
 * Supabaseに優待情報をバッチ保存（upsert）
 */
export async function setYutaiToSupabase(
  entries: Map<string, YutaiInfo>
): Promise<void> {
  if (entries.size === 0) return;

  try {
    const supabase = createServiceClient();
    const rows = Array.from(entries).map(([symbol, data]) => ({
      symbol,
      data,
      cached_at: new Date().toISOString(),
    }));

    // 50件ずつバッチupsert
    for (let i = 0; i < rows.length; i += 50) {
      const batch = rows.slice(i, i + 50);
      const { error } = await supabase
        .from("yutai_cache")
        .upsert(batch, { onConflict: "symbol" });
      if (error) {
        console.error("[yutai] Supabase upsert error:", error.message);
      }
    }
  } catch (err) {
    console.error("[yutai] Supabase write error:", err);
  }
}

/**
 * EDINET XBRL 財務データキャッシュ
 *
 * 有報は年1回の提出なので長めの TTL (90日)。
 * ファイルキャッシュのみ（Supabase不要 — ローカルバッチ実行がメイン用途）。
 */

import fs from "fs";
import path from "path";
import { ensureCacheDir, TTL as CacheTTL } from "./cacheUtils";
import type { EdinetFinancialData } from "@/lib/api/edinetFinancials";

const CACHE_SUBDIR = "edinet";
const TTL = CacheTTL.DAYS_90; // 90日

interface CacheEntry {
  data: EdinetFinancialData;
  cachedAt: number;
}

function cacheFile(symbol: string): string {
  const dir = ensureCacheDir(CACHE_SUBDIR);
  return path.join(dir, `${symbol.replace(".", "_")}.json`);
}

/**
 * キャッシュが有効かどうかチェック
 */
export function isEdinetCacheValid(symbol: string): boolean {
  try {
    const file = cacheFile(symbol);
    if (!fs.existsSync(file)) return false;

    const raw = fs.readFileSync(file, "utf-8");
    const entry = JSON.parse(raw) as CacheEntry;
    return Date.now() - entry.cachedAt < TTL;
  } catch {
    return false;
  }
}

/**
 * キャッシュから財務データを取得
 * @returns データまたは null (キャッシュなし/期限切れ)
 */
export function getCachedEdinetFinancials(symbol: string): EdinetFinancialData | null {
  try {
    const file = cacheFile(symbol);
    if (!fs.existsSync(file)) return null;

    const raw = fs.readFileSync(file, "utf-8");
    const entry = JSON.parse(raw) as CacheEntry;

    if (Date.now() - entry.cachedAt >= TTL) return null;
    return entry.data;
  } catch {
    return null;
  }
}

/**
 * 財務データをキャッシュに保存
 */
export function setCachedEdinetFinancials(symbol: string, data: EdinetFinancialData): void {
  try {
    const file = cacheFile(symbol);
    const entry: CacheEntry = {
      data,
      cachedAt: Date.now(),
    };
    fs.writeFileSync(file, JSON.stringify(entry, null, 2), "utf-8");
  } catch (e) {
    console.error(`[edinetCache] Write error for ${symbol}:`, e);
  }
}

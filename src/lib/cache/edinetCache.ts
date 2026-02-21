/**
 * EDINET XBRL 財務データキャッシュ
 *
 * 有報は年1回の提出なので長めの TTL (90日)。
 * ファイルキャッシュのみ（Supabase不要 — ローカルバッチ実行がメイン用途）。
 */

import fs from "fs";
import path from "path";
import { getCacheBaseDir } from "./cacheDir";
import type { EdinetFinancialData } from "@/lib/api/edinetFinancials";

const CACHE_DIR = path.join(getCacheBaseDir(), "edinet");
const TTL = 90 * 24 * 60 * 60 * 1000; // 90日

interface CacheEntry {
  data: EdinetFinancialData;
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
 * キャッシュが有効かどうかチェック
 */
export function isEdinetCacheValid(symbol: string): boolean {
  try {
    ensureDir();
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
    ensureDir();
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
    ensureDir();
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

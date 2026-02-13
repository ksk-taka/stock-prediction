/**
 * 株主優待キャッシュ（ファイルベース、30日TTL）
 * statsCacheと同パターン
 */

import fs from "fs";
import path from "path";
import { getCacheBaseDir } from "./cacheDir";
import type { YutaiInfo } from "@/types/yutai";

const CACHE_DIR = path.join(getCacheBaseDir(), "yutai");
const YUTAI_TTL = 30 * 24 * 60 * 60 * 1000; // 30日

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

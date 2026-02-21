import fs from "fs";
import path from "path";
import { ensureCacheDir, TTL as CacheTTL } from "./cacheUtils";

const CACHE_SUBDIR = "divergence";
const TTL = CacheTTL.HOURS_24; // 24時間

/**
 * ダイバージェンスデータのキャッシュエントリ
 */
export interface DivergenceData {
  symbol: string;
  type: "bullish" | "bearish";
  indicator: "RSI" | "MACD" | "OBV";
  priceHigh?: number;
  priceLow?: number;
  indicatorHigh?: number;
  indicatorLow?: number;
  startDate: string;
  endDate: string;
  strength: number; // 0-100
}

interface CacheEntry {
  data: DivergenceData[];
  cachedAt: number;
}

function cacheFile(symbol: string): string {
  const dir = ensureCacheDir(CACHE_SUBDIR);
  return path.join(dir, `${symbol.replace(".", "_")}.json`);
}

/**
 * ダイバージェンスキャッシュを取得
 * @param symbol 銘柄シンボル
 * @returns キャッシュデータ（期限切れ/未キャッシュの場合はnull）
 */
export function getCachedDivergence(symbol: string): DivergenceData[] | null {
  try {
    const file = cacheFile(symbol);
    if (!fs.existsSync(file)) return null;

    const entry: CacheEntry = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (Date.now() - entry.cachedAt > TTL) return null;

    return entry.data;
  } catch {
    return null;
  }
}

/**
 * ダイバージェンスキャッシュを設定
 * @param symbol 銘柄シンボル
 * @param data ダイバージェンスデータ配列
 */
export function setCachedDivergence(symbol: string, data: DivergenceData[]): void {
  try {
    const file = cacheFile(symbol);
    const entry: CacheEntry = { data, cachedAt: Date.now() };
    fs.writeFileSync(file, JSON.stringify(entry), "utf-8");
  } catch {
    // ignore write errors
  }
}

/**
 * 特定銘柄のダイバージェンスキャッシュを削除
 * @param symbol 銘柄シンボル
 * @returns 削除成功時true
 */
export function invalidateDivergenceCache(symbol: string): boolean {
  try {
    const file = cacheFile(symbol);
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

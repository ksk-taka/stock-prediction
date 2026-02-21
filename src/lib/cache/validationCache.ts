import fs from "fs";
import path from "path";
import { ensureCacheDir, TTL as CacheTTL } from "./cacheUtils";

const CACHE_SUBDIR = "validation";
const TTL = CacheTTL.HOURS_24; // 24時間

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  validatedAt: string;
}

interface ValidationCacheEntry {
  result: ValidationResult;
  cachedAt: number;
}

function cacheFile(key: string): string {
  const dir = ensureCacheDir(CACHE_SUBDIR);
  return path.join(dir, `${key.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
}

/**
 * バリデーション結果をキャッシュから取得
 * @param key キャッシュキー（シンボルやリソースID）
 * @returns キャッシュされたバリデーション結果、期限切れ/未キャッシュの場合はnull
 */
export function getCachedValidation(key: string): ValidationResult | null {
  try {
    const file = cacheFile(key);
    if (!fs.existsSync(file)) return null;

    const entry: ValidationCacheEntry = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (Date.now() - entry.cachedAt > TTL) return null;

    return entry.result;
  } catch {
    return null;
  }
}

/**
 * バリデーション結果をキャッシュに保存
 * @param key キャッシュキー
 * @param result バリデーション結果
 */
export function setCachedValidation(key: string, result: ValidationResult): void {
  try {
    const file = cacheFile(key);
    const entry: ValidationCacheEntry = {
      result,
      cachedAt: Date.now(),
    };
    fs.writeFileSync(file, JSON.stringify(entry), "utf-8");
  } catch {
    // ignore write errors
  }
}

/**
 * 特定キーのバリデーションキャッシュを削除
 * @param key キャッシュキー
 * @returns 削除成功時はtrue
 */
export function invalidateValidationCache(key: string): boolean {
  try {
    const file = cacheFile(key);
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * キャッシュユーティリティ - 共通キャッシュ操作
 *
 * 各キャッシュファイルで重複していた ensureDir / cacheFile パターンを統合。
 * ディレクトリ存在チェックは初回のみ行い、以降はスキップしてパフォーマンス向上。
 */

import fs from "fs";
import path from "path";
import { getCacheBaseDir } from "./cacheDir";

// ディレクトリ作成済みフラグ（プロセス内でキャッシュ）
let ensuredDirs = new Set<string>();

/**
 * テスト用: キャッシュ状態をリセット
 */
export function _resetCacheState(): void {
  ensuredDirs = new Set<string>();
}

/**
 * キャッシュディレクトリを確保（初回のみfs操作）
 */
export function ensureCacheDir(subdir: string): string {
  const dir = path.join(getCacheBaseDir(), subdir);

  if (!ensuredDirs.has(dir)) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    ensuredDirs.add(dir);
  }

  return dir;
}

/**
 * キャッシュファイルパスを生成
 * @param subdir キャッシュサブディレクトリ名 (e.g., "prices", "stats")
 * @param key キャッシュキー (e.g., "7203.T" -> "7203_T")
 * @param suffix ファイル名サフィックス (e.g., "_daily", "_analysis")
 */
export function getCacheFilePath(subdir: string, key: string, suffix: string = ""): string {
  const dir = ensureCacheDir(subdir);
  const safeKey = key.replace(/\./g, "_");
  return path.join(dir, `${safeKey}${suffix}.json`);
}

/**
 * キャッシュデータを読み込み
 * @returns パース済みデータ、または null（キャッシュなし/期限切れ/エラー）
 */
export function readCache<T>(
  subdir: string,
  key: string,
  suffix: string = "",
  ttlMs?: number
): { data: T; cachedAt: number } | null {
  try {
    const filePath = getCacheFilePath(subdir, key, suffix);
    if (!fs.existsSync(filePath)) return null;

    const raw = fs.readFileSync(filePath, "utf-8");
    const entry = JSON.parse(raw) as { data: T; cachedAt: number };

    // TTL チェック
    if (ttlMs !== undefined) {
      if (Date.now() - entry.cachedAt > ttlMs) {
        return null; // 期限切れ
      }
    }

    return entry;
  } catch {
    return null;
  }
}

/**
 * キャッシュデータを書き込み
 */
export function writeCache<T>(
  subdir: string,
  key: string,
  data: T,
  suffix: string = "",
  pretty: boolean = false
): void {
  try {
    const filePath = getCacheFilePath(subdir, key, suffix);
    const entry = { data, cachedAt: Date.now() };
    const json = pretty ? JSON.stringify(entry, null, 2) : JSON.stringify(entry);
    fs.writeFileSync(filePath, json, "utf-8");
  } catch {
    // サイレントに失敗
  }
}

/**
 * キャッシュを無効化（削除）
 */
export function invalidateCache(subdir: string, key: string, suffix: string = ""): boolean {
  try {
    const filePath = getCacheFilePath(subdir, key, suffix);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * バッチ読み込み - 複数キーのキャッシュを一括取得
 */
export function readCacheBatch<T>(
  subdir: string,
  keys: string[],
  suffix: string = "",
  ttlMs?: number
): Map<string, T> {
  const result = new Map<string, T>();

  for (const key of keys) {
    const entry = readCache<T>(subdir, key, suffix, ttlMs);
    if (entry) {
      result.set(key, entry.data);
    }
  }

  return result;
}

// TTL定数（よく使う値を集約）
export const TTL = {
  MINUTES_5: 5 * 60 * 1000,
  HOUR_1: 60 * 60 * 1000,
  HOURS_6: 6 * 60 * 60 * 1000,
  HOURS_12: 12 * 60 * 60 * 1000,
  HOURS_24: 24 * 60 * 60 * 1000,
  DAYS_7: 7 * 24 * 60 * 60 * 1000,
  DAYS_30: 30 * 24 * 60 * 60 * 1000,
  DAYS_90: 90 * 24 * 60 * 60 * 1000,
  DAYS_180: 180 * 24 * 60 * 60 * 1000,
} as const;

import fs from "fs";
import path from "path";
import { getCacheBaseDir } from "./cacheDir";

const CACHE_DIR = path.join(getCacheBaseDir(), "stats");
const TTL = 24 * 60 * 60 * 1000; // 24時間（1日1回更新）
const NC_TTL = 7 * 24 * 60 * 60 * 1000; // 7日間（四半期データなので長め）

interface StatsCacheEntry {
  per: number | null;
  forwardPer: number | null;
  pbr: number | null;
  eps: number | null;
  roe: number | null;
  dividendYield: number | null;
  simpleNcRatio?: number | null;
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

export function getCachedStats(symbol: string): Omit<StatsCacheEntry, "cachedAt"> | null {
  try {
    ensureDir();
    const file = cacheFile(symbol);
    if (!fs.existsSync(file)) return null;

    const entry: StatsCacheEntry = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (Date.now() - entry.cachedAt > TTL) return null;

    const { cachedAt: _, ...data } = entry;
    return data;
  } catch {
    return null;
  }
}

/**
 * NC率だけを長期キャッシュから取得（7日TTL）
 * 主キャッシュ(24h)が切れてもNC率は有効な場合に使い、API呼出しをスキップする
 * undefined = キャッシュなし/期限切れ, null = データなし（計算不能）
 */
export function getCachedNcRatio(symbol: string): number | null | undefined {
  try {
    ensureDir();
    const file = cacheFile(symbol);
    if (!fs.existsSync(file)) return undefined;

    const entry: StatsCacheEntry = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (Date.now() - entry.cachedAt > NC_TTL) return undefined;
    return entry.simpleNcRatio ?? null;
  } catch {
    return undefined;
  }
}

export function setCachedStats(
  symbol: string,
  data: Omit<StatsCacheEntry, "cachedAt">
): void {
  try {
    ensureDir();
    const file = cacheFile(symbol);
    const entry: StatsCacheEntry = { ...data, cachedAt: Date.now() };
    fs.writeFileSync(file, JSON.stringify(entry), "utf-8");
  } catch {
    // ignore write errors
  }
}

/**
 * NC率のみをキャッシュに書き込む（既存エントリがあれば更新、なければ新規作成）
 * stock-table APIなどでNC率だけ取得した場合に使う
 */
export function setCachedNcOnly(symbol: string, ncRatio: number | null): void {
  try {
    ensureDir();
    const file = cacheFile(symbol);
    let entry: StatsCacheEntry;
    try {
      const existing: StatsCacheEntry = JSON.parse(fs.readFileSync(file, "utf-8"));
      existing.simpleNcRatio = ncRatio;
      entry = existing; // cachedAtは元のまま（他フィールドのTTLを壊さない）
    } catch {
      entry = {
        per: null, forwardPer: null, pbr: null, eps: null,
        roe: null, dividendYield: null,
        simpleNcRatio: ncRatio,
        cachedAt: Date.now(),
      };
    }
    fs.writeFileSync(file, JSON.stringify(entry), "utf-8");
  } catch {
    // ignore write errors
  }
}

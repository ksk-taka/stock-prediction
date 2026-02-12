import fs from "fs";
import path from "path";
import { getCacheBaseDir } from "./cacheDir";
import type { DividendSummary } from "@/types";

const CACHE_DIR = path.join(getCacheBaseDir(), "stats");
const TTL = 24 * 60 * 60 * 1000; // 24時間（1日1回更新）
const NC_TTL = 7 * 24 * 60 * 60 * 1000; // 7日間（四半期データなので長め）
const DIVIDEND_TTL = 7 * 24 * 60 * 60 * 1000; // 7日間（配当は年2回程度）
const ROE_TTL = 30 * 24 * 60 * 60 * 1000; // 30日間（四半期決算ごとに更新）

interface StatsCacheEntry {
  per: number | null;
  forwardPer: number | null;
  pbr: number | null;
  eps: number | null;
  roe: number | null;
  dividendYield: number | null;
  simpleNcRatio?: number | null;
  marketCap?: number | null;
  sharpe1y?: number | null;
  sharpe3y?: number | null;
  dividendSummary?: DividendSummary | null;
  cachedAt: number;
  ncCachedAt?: number; // NC率専用タイムスタンプ（cachedAtとは独立）
  dividendCachedAt?: number; // 配当専用タイムスタンプ
  roeCachedAt?: number; // ROE専用タイムスタンプ（30日TTL）
}

function ensureDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function cacheFile(symbol: string): string {
  return path.join(CACHE_DIR, `${symbol.replace(".", "_")}.json`);
}

export function getCachedStats(symbol: string): Omit<StatsCacheEntry, "cachedAt" | "ncCachedAt"> | null {
  try {
    ensureDir();
    const file = cacheFile(symbol);
    if (!fs.existsSync(file)) return null;

    const entry: StatsCacheEntry = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (Date.now() - entry.cachedAt > TTL) return null;

    const { cachedAt: _, ncCachedAt: _nc, ...data } = entry;
    return data;
  } catch {
    return null;
  }
}

/**
 * NC率だけを長期キャッシュから取得（7日TTL）
 * ncCachedAtがあればそれを使い、なければcachedAtにフォールバック
 * undefined = キャッシュなし/期限切れ, null = データなし（計算不能）
 */
export function getCachedNcRatio(symbol: string): number | null | undefined {
  try {
    ensureDir();
    const file = cacheFile(symbol);
    if (!fs.existsSync(file)) return undefined;

    const entry: StatsCacheEntry = JSON.parse(fs.readFileSync(file, "utf-8"));
    const ncTs = entry.ncCachedAt ?? entry.cachedAt;
    if (Date.now() - ncTs > NC_TTL) return undefined;
    if (entry.simpleNcRatio === undefined) return undefined;
    return entry.simpleNcRatio ?? null;
  } catch {
    return undefined;
  }
}

export function setCachedStats(
  symbol: string,
  data: Omit<StatsCacheEntry, "cachedAt" | "ncCachedAt" | "dividendCachedAt">
): void {
  try {
    ensureDir();
    const file = cacheFile(symbol);
    const now = Date.now();
    const entry: StatsCacheEntry = { ...data, cachedAt: now, ncCachedAt: now, dividendCachedAt: now };
    fs.writeFileSync(file, JSON.stringify(entry), "utf-8");
  } catch {
    // ignore write errors
  }
}

/**
 * NC率のみをキャッシュに書き込む（既存エントリがあれば更新、なければ新規作成）
 * ncCachedAtを更新してNC率のTTLを独立管理（他フィールドのcachedAtは壊さない）
 */
export function setCachedNcOnly(symbol: string, ncRatio: number | null): void {
  try {
    ensureDir();
    const file = cacheFile(symbol);
    let entry: StatsCacheEntry;
    try {
      const existing: StatsCacheEntry = JSON.parse(fs.readFileSync(file, "utf-8"));
      existing.simpleNcRatio = ncRatio;
      existing.ncCachedAt = Date.now();
      entry = existing; // cachedAtは元のまま（他フィールドのTTLを壊さない）
    } catch {
      entry = {
        per: null, forwardPer: null, pbr: null, eps: null,
        roe: null, dividendYield: null,
        simpleNcRatio: ncRatio,
        cachedAt: Date.now(),
        ncCachedAt: Date.now(),
      };
    }
    fs.writeFileSync(file, JSON.stringify(entry), "utf-8");
  } catch {
    // ignore write errors
  }
}

/**
 * 配当サマリーをキャッシュから取得（7日TTL）
 * undefined = キャッシュなし/期限切れ, null = 無配銘柄
 */
export function getCachedDividendSummary(symbol: string): DividendSummary | null | undefined {
  try {
    ensureDir();
    const file = cacheFile(symbol);
    if (!fs.existsSync(file)) return undefined;

    const entry: StatsCacheEntry = JSON.parse(fs.readFileSync(file, "utf-8"));
    const divTs = entry.dividendCachedAt ?? entry.cachedAt;
    if (Date.now() - divTs > DIVIDEND_TTL) return undefined;
    if (entry.dividendSummary === undefined) return undefined;
    return entry.dividendSummary ?? null;
  } catch {
    return undefined;
  }
}

/**
 * 配当サマリーのみをキャッシュに書き込む（既存エントリがあれば更新）
 */
export function setCachedDividendOnly(symbol: string, summary: DividendSummary | null): void {
  try {
    ensureDir();
    const file = cacheFile(symbol);
    let entry: StatsCacheEntry;
    try {
      const existing: StatsCacheEntry = JSON.parse(fs.readFileSync(file, "utf-8"));
      existing.dividendSummary = summary;
      existing.dividendCachedAt = Date.now();
      entry = existing;
    } catch {
      entry = {
        per: null, forwardPer: null, pbr: null, eps: null,
        roe: null, dividendYield: null,
        dividendSummary: summary,
        cachedAt: Date.now(),
        dividendCachedAt: Date.now(),
      };
    }
    fs.writeFileSync(file, JSON.stringify(entry), "utf-8");
  } catch {
    // ignore write errors
  }
}

/**
 * ROEをキャッシュから取得（30日TTL）
 * undefined = キャッシュなし/期限切れ, null = データなし
 */
export function getCachedRoe(symbol: string): number | null | undefined {
  try {
    ensureDir();
    const file = cacheFile(symbol);
    if (!fs.existsSync(file)) return undefined;

    const entry: StatsCacheEntry = JSON.parse(fs.readFileSync(file, "utf-8"));
    const roeTs = entry.roeCachedAt ?? entry.cachedAt;
    if (Date.now() - roeTs > ROE_TTL) return undefined;
    if (entry.roe === undefined) return undefined;
    return entry.roe ?? null;
  } catch {
    return undefined;
  }
}

/**
 * ROEのみをキャッシュに書き込む（既存エントリがあれば更新）
 */
export function setCachedRoeOnly(symbol: string, roe: number | null): void {
  try {
    ensureDir();
    const file = cacheFile(symbol);
    let entry: StatsCacheEntry;
    try {
      const existing: StatsCacheEntry = JSON.parse(fs.readFileSync(file, "utf-8"));
      existing.roe = roe;
      existing.roeCachedAt = Date.now();
      entry = existing;
    } catch {
      entry = {
        per: null, forwardPer: null, pbr: null, eps: null,
        roe, dividendYield: null,
        cachedAt: Date.now(),
        roeCachedAt: Date.now(),
      };
    }
    fs.writeFileSync(file, JSON.stringify(entry), "utf-8");
  } catch {
    // ignore write errors
  }
}

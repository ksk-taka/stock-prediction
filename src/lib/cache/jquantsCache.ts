import fs from "fs";
import path from "path";
import type { PriceData } from "@/types";
import type { JQuantsMasterItem } from "@/types/jquants";
import { ensureCacheDir, TTL } from "./cacheUtils";

// ============================================================
// マスタデータキャッシュ (7日TTL)
// ============================================================

const MASTER_CACHE_SUBDIR = "jquants-master";
const MASTER_TTL = TTL.DAYS_7;

interface MasterCacheEntry {
  data: JQuantsMasterItem[];
  cachedAt: number;
}

function masterFile(key: string): string {
  const dir = ensureCacheDir(MASTER_CACHE_SUBDIR);
  return path.join(dir, `${key}.json`);
}

export function getCachedMaster(key: string): JQuantsMasterItem[] | null {
  try {
    const file = masterFile(key);
    if (!fs.existsSync(file)) return null;
    const entry: MasterCacheEntry = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (Date.now() - entry.cachedAt > MASTER_TTL) return null;
    return entry.data;
  } catch {
    return null;
  }
}

export function setCachedMaster(key: string, data: JQuantsMasterItem[]): void {
  try {
    const file = masterFile(key);
    fs.writeFileSync(file, JSON.stringify({ data, cachedAt: Date.now() }), "utf-8");
  } catch {
    // ignore write errors (e.g. Vercel read-only FS)
  }
}

// ============================================================
// 株価データキャッシュ (30日TTL — 12週遅延データのため実質不変)
// ============================================================

const BARS_CACHE_SUBDIR = "jquants-bars";
const BARS_TTL = TTL.DAYS_30;

interface BarsCacheEntry {
  data: PriceData[];
  cachedAt: number;
}

function barsFile(symbol: string): string {
  const dir = ensureCacheDir(BARS_CACHE_SUBDIR);
  return path.join(dir, `${symbol.replace(".", "_")}.json`);
}

export function getCachedBars(symbol: string): PriceData[] | null {
  try {
    const file = barsFile(symbol);
    if (!fs.existsSync(file)) return null;
    const entry: BarsCacheEntry = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (Date.now() - entry.cachedAt > BARS_TTL) return null;
    return entry.data;
  } catch {
    return null;
  }
}

export function setCachedBars(symbol: string, data: PriceData[]): void {
  try {
    const file = barsFile(symbol);
    fs.writeFileSync(file, JSON.stringify({ data, cachedAt: Date.now() }), "utf-8");
  } catch {
    // ignore
  }
}

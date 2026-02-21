import fs from "fs";
import path from "path";
import { ensureCacheDir, TTL as CacheTTL } from "./cacheUtils";

const CACHE_SUBDIR = "per-history";
const TTL = CacheTTL.HOURS_24; // 24時間

interface PerHistoryCacheEntry {
  perSeries: { date: string; per: number | null }[];
  epsSeries: { quarter: string; epsActual: number | null; epsEstimate: number | null }[];
  ttmEps: number | null;
  cachedAt: number;
}

function cacheFile(symbol: string): string {
  const dir = ensureCacheDir(CACHE_SUBDIR);
  return path.join(dir, `${symbol.replace(".", "_")}.json`);
}

export function getCachedPerHistory(symbol: string): Omit<PerHistoryCacheEntry, "cachedAt"> | null {
  try {
    const file = cacheFile(symbol);
    if (!fs.existsSync(file)) return null;

    const entry: PerHistoryCacheEntry = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (Date.now() - entry.cachedAt > TTL) return null;

    const { cachedAt: _, ...data } = entry;
    return data;
  } catch {
    return null;
  }
}

export function setCachedPerHistory(
  symbol: string,
  data: Omit<PerHistoryCacheEntry, "cachedAt">
): void {
  try {
    const file = cacheFile(symbol);
    const entry: PerHistoryCacheEntry = { ...data, cachedAt: Date.now() };
    fs.writeFileSync(file, JSON.stringify(entry), "utf-8");
  } catch {
    // ignore write errors
  }
}

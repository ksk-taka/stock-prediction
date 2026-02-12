import fs from "fs";
import path from "path";
import { getCacheBaseDir } from "./cacheDir";

const CACHE_DIR = path.join(getCacheBaseDir(), "per-history");
const TTL = 24 * 60 * 60 * 1000; // 24時間

interface PerHistoryCacheEntry {
  perSeries: { date: string; per: number | null }[];
  epsSeries: { quarter: string; epsActual: number | null; epsEstimate: number | null }[];
  ttmEps: number | null;
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

export function getCachedPerHistory(symbol: string): Omit<PerHistoryCacheEntry, "cachedAt"> | null {
  try {
    ensureDir();
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
    ensureDir();
    const file = cacheFile(symbol);
    const entry: PerHistoryCacheEntry = { ...data, cachedAt: Date.now() };
    fs.writeFileSync(file, JSON.stringify(entry), "utf-8");
  } catch {
    // ignore write errors
  }
}

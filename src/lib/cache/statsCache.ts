import fs from "fs";
import path from "path";
import { getCacheBaseDir } from "./cacheDir";

const CACHE_DIR = path.join(getCacheBaseDir(), "stats");
const TTL = 6 * 60 * 60 * 1000; // 6時間

interface StatsCacheEntry {
  per: number | null;
  forwardPer: number | null;
  pbr: number | null;
  eps: number | null;
  roe: number | null;
  dividendYield: number | null;
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

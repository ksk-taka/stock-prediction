import fs from "fs";
import path from "path";
import type { MarketIntelligence } from "@/lib/api/webResearch";
import { ensureCacheDir, TTL as CacheTTL } from "./cacheUtils";

const CACHE_SUBDIR = "market-intelligence";
const TTL = CacheTTL.HOURS_6; // 6時間

function getCacheFile(): string {
  const dir = ensureCacheDir(CACHE_SUBDIR);
  return path.join(dir, "latest.json");
}

interface CacheEntry {
  data: MarketIntelligence;
  cachedAt: number;
}

export function getCachedMarketIntelligence(): MarketIntelligence | null {
  const file = getCacheFile();
  if (!fs.existsSync(file)) return null;

  try {
    const entry: CacheEntry = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (Date.now() - entry.cachedAt > TTL) return null;
    return entry.data;
  } catch {
    return null;
  }
}

export function setCachedMarketIntelligence(data: MarketIntelligence): void {
  try {
    const file = getCacheFile();
    const entry: CacheEntry = { data, cachedAt: Date.now() };
    fs.writeFileSync(file, JSON.stringify(entry), "utf-8");
  } catch {
    // ignore write errors
  }
}

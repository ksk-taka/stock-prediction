import fs from "fs";
import path from "path";
import type { PriceData } from "@/types";
import { isMarketOpen } from "@/lib/utils/date";
import { ensureCacheDir, TTL } from "./cacheUtils";

const CACHE_SUBDIR = "prices";

function cacheFile(symbol: string, period: string): string {
  const dir = ensureCacheDir(CACHE_SUBDIR);
  return path.join(dir, `${symbol.replace(".", "_")}_${period}.json`);
}

function getTTL(market: "JP" | "US"): number {
  return isMarketOpen(market) ? TTL.MINUTES_5 : TTL.HOURS_24;
}

interface CacheEntry {
  data: PriceData[];
  cachedAt: number;
}

export function getCachedPrices(
  symbol: string,
  period: string,
  market: "JP" | "US"
): PriceData[] | null {
  try {
    const file = cacheFile(symbol, period);
    if (!fs.existsSync(file)) return null;

    const entry: CacheEntry = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (Date.now() - entry.cachedAt > getTTL(market)) return null;

    return entry.data;
  } catch {
    return null;
  }
}

export function setCachedPrices(
  symbol: string,
  period: string,
  data: PriceData[]
): void {
  try {
    const file = cacheFile(symbol, period);
    const entry: CacheEntry = { data, cachedAt: Date.now() };
    fs.writeFileSync(file, JSON.stringify(entry), "utf-8");
  } catch {
    // ignore write errors
  }
}

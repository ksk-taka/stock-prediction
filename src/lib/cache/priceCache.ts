import fs from "fs";
import path from "path";
import type { PriceData } from "@/types";
import { isMarketOpen } from "@/lib/utils/date";

const CACHE_DIR = path.join(process.cwd(), ".cache", "prices");

function ensureDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function cacheFile(symbol: string, period: string): string {
  return path.join(CACHE_DIR, `${symbol.replace(".", "_")}_${period}.json`);
}

function getTTL(market: "JP" | "US"): number {
  return isMarketOpen(market) ? 5 * 60 * 1000 : 24 * 60 * 60 * 1000;
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
  ensureDir();
  const file = cacheFile(symbol, period);
  if (!fs.existsSync(file)) return null;

  const entry: CacheEntry = JSON.parse(fs.readFileSync(file, "utf-8"));
  if (Date.now() - entry.cachedAt > getTTL(market)) return null;

  return entry.data;
}

export function setCachedPrices(
  symbol: string,
  period: string,
  data: PriceData[]
): void {
  ensureDir();
  const file = cacheFile(symbol, period);
  const entry: CacheEntry = { data, cachedAt: Date.now() };
  fs.writeFileSync(file, JSON.stringify(entry), "utf-8");
}

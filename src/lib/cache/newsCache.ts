import fs from "fs";
import path from "path";
import type { NewsItem } from "@/types";
import { ensureCacheDir, TTL } from "./cacheUtils";

const CACHE_SUBDIR = "news";
const NEWS_CACHE_TTL = TTL.HOURS_6; // 6時間

function cacheFile(symbol: string): string {
  const dir = ensureCacheDir(CACHE_SUBDIR);
  return path.join(dir, `${symbol.replace(".", "_")}.json`);
}

interface NewsCacheEntry {
  news: NewsItem[];
  snsOverview: string;
  analystRating: string;
  cachedAt: number;
}

export function getCachedNews(symbol: string): NewsCacheEntry | null {
  try {
      const file = cacheFile(symbol);
    if (!fs.existsSync(file)) return null;

    const entry: NewsCacheEntry = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (Date.now() - entry.cachedAt > NEWS_CACHE_TTL) return null;

    return entry;
  } catch {
    return null;
  }
}

export function setCachedNews(
  symbol: string,
  news: NewsItem[],
  snsOverview: string,
  analystRating: string
): void {
  try {
      const file = cacheFile(symbol);
    const entry: NewsCacheEntry = {
      news,
      snsOverview,
      analystRating,
      cachedAt: Date.now(),
    };
    fs.writeFileSync(file, JSON.stringify(entry), "utf-8");
  } catch {
    // ignore write errors
  }
}

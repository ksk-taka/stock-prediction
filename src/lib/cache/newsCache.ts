import fs from "fs";
import path from "path";
import type { NewsItem } from "@/types";

const CACHE_DIR = path.join(process.cwd(), ".cache", "news");
const NEWS_CACHE_TTL = 6 * 60 * 60 * 1000; // 6時間

function ensureDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function cacheFile(symbol: string): string {
  return path.join(CACHE_DIR, `${symbol.replace(".", "_")}.json`);
}

interface NewsCacheEntry {
  news: NewsItem[];
  snsOverview: string;
  analystRating: string;
  cachedAt: number;
}

export function getCachedNews(symbol: string): NewsCacheEntry | null {
  ensureDir();
  const file = cacheFile(symbol);
  if (!fs.existsSync(file)) return null;

  const entry: NewsCacheEntry = JSON.parse(fs.readFileSync(file, "utf-8"));
  if (Date.now() - entry.cachedAt > NEWS_CACHE_TTL) return null;

  return entry;
}

export function setCachedNews(
  symbol: string,
  news: NewsItem[],
  snsOverview: string,
  analystRating: string
): void {
  ensureDir();
  const file = cacheFile(symbol);
  const entry: NewsCacheEntry = {
    news,
    snsOverview,
    analystRating,
    cachedAt: Date.now(),
  };
  fs.writeFileSync(file, JSON.stringify(entry), "utf-8");
}

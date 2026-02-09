import fs from "fs";
import path from "path";
import type { MarketIntelligence } from "@/lib/api/webResearch";
import { getCacheBaseDir } from "./cacheDir";

const CACHE_DIR = path.join(getCacheBaseDir(), "market-intelligence");
const TTL = 6 * 60 * 60 * 1000; // 6時間

function ensureDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

const CACHE_FILE = path.join(CACHE_DIR, "latest.json");

interface CacheEntry {
  data: MarketIntelligence;
  cachedAt: number;
}

export function getCachedMarketIntelligence(): MarketIntelligence | null {
  ensureDir();
  if (!fs.existsSync(CACHE_FILE)) return null;

  try {
    const entry: CacheEntry = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
    if (Date.now() - entry.cachedAt > TTL) return null;
    return entry.data;
  } catch {
    return null;
  }
}

export function setCachedMarketIntelligence(data: MarketIntelligence): void {
  try {
    ensureDir();
    const entry: CacheEntry = { data, cachedAt: Date.now() };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(entry), "utf-8");
  } catch {
    // ignore write errors
  }
}

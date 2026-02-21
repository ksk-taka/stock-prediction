import fs from "fs";
import path from "path";
import { ensureCacheDir, TTL as CacheTTL } from "./cacheUtils";

const CACHE_SUBDIR = "signals";
const TTL = CacheTTL.HOUR_1; // 1時間

interface SignalsCacheEntry {
  data: unknown; // signals API のレスポンス全体
  cachedAt: number;
}

function cacheFile(symbol: string): string {
  const dir = ensureCacheDir(CACHE_SUBDIR);
  return path.join(dir, `${symbol.replace(".", "_")}.json`);
}

export function getCachedSignals(symbol: string): unknown | null {
  try {
    const file = cacheFile(symbol);
    if (!fs.existsSync(file)) return null;

    const entry: SignalsCacheEntry = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (Date.now() - entry.cachedAt > TTL) return null;

    return entry.data;
  } catch {
    return null;
  }
}

export function setCachedSignals(symbol: string, data: unknown): void {
  try {
    const file = cacheFile(symbol);
    const entry: SignalsCacheEntry = { data, cachedAt: Date.now() };
    fs.writeFileSync(file, JSON.stringify(entry), "utf-8");
  } catch {
    // ignore write errors
  }
}

import fs from "fs";
import path from "path";
import { getCacheBaseDir } from "./cacheDir";

const CACHE_DIR = path.join(getCacheBaseDir(), "signals");
const TTL = 1 * 60 * 60 * 1000; // 1時間

interface SignalsCacheEntry {
  data: unknown; // signals API のレスポンス全体
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

export function getCachedSignals(symbol: string): unknown | null {
  try {
    ensureDir();
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
    ensureDir();
    const file = cacheFile(symbol);
    const entry: SignalsCacheEntry = { data, cachedAt: Date.now() };
    fs.writeFileSync(file, JSON.stringify(entry), "utf-8");
  } catch {
    // ignore write errors
  }
}

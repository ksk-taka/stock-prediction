import fs from "fs";
import path from "path";
import type { PriceData } from "@/types";
import type { JQuantsMasterItem } from "@/types/jquants";
import { getCacheBaseDir } from "./cacheDir";

// ============================================================
// マスタデータキャッシュ (7日TTL)
// ============================================================

const MASTER_CACHE_DIR = path.join(getCacheBaseDir(), "jquants-master");
const MASTER_TTL = 7 * 24 * 60 * 60 * 1000;

interface MasterCacheEntry {
  data: JQuantsMasterItem[];
  cachedAt: number;
}

function ensureMasterDir() {
  if (!fs.existsSync(MASTER_CACHE_DIR))
    fs.mkdirSync(MASTER_CACHE_DIR, { recursive: true });
}

export function getCachedMaster(key: string): JQuantsMasterItem[] | null {
  try {
    ensureMasterDir();
    const file = path.join(MASTER_CACHE_DIR, `${key}.json`);
    if (!fs.existsSync(file)) return null;
    const entry: MasterCacheEntry = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (Date.now() - entry.cachedAt > MASTER_TTL) return null;
    return entry.data;
  } catch {
    return null;
  }
}

export function setCachedMaster(key: string, data: JQuantsMasterItem[]): void {
  try {
    ensureMasterDir();
    const file = path.join(MASTER_CACHE_DIR, `${key}.json`);
    fs.writeFileSync(file, JSON.stringify({ data, cachedAt: Date.now() }), "utf-8");
  } catch {
    // ignore write errors (e.g. Vercel read-only FS)
  }
}

// ============================================================
// 株価データキャッシュ (30日TTL — 12週遅延データのため実質不変)
// ============================================================

const BARS_CACHE_DIR = path.join(getCacheBaseDir(), "jquants-bars");
const BARS_TTL = 30 * 24 * 60 * 60 * 1000;

interface BarsCacheEntry {
  data: PriceData[];
  cachedAt: number;
}

function ensureBarsDir() {
  if (!fs.existsSync(BARS_CACHE_DIR))
    fs.mkdirSync(BARS_CACHE_DIR, { recursive: true });
}

function barsFile(symbol: string): string {
  return path.join(BARS_CACHE_DIR, `${symbol.replace(".", "_")}.json`);
}

export function getCachedBars(symbol: string): PriceData[] | null {
  try {
    ensureBarsDir();
    const file = barsFile(symbol);
    if (!fs.existsSync(file)) return null;
    const entry: BarsCacheEntry = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (Date.now() - entry.cachedAt > BARS_TTL) return null;
    return entry.data;
  } catch {
    return null;
  }
}

export function setCachedBars(symbol: string, data: PriceData[]): void {
  try {
    ensureBarsDir();
    const file = barsFile(symbol);
    fs.writeFileSync(file, JSON.stringify({ data, cachedAt: Date.now() }), "utf-8");
  } catch {
    // ignore
  }
}

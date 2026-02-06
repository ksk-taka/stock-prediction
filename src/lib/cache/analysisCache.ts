import fs from "fs";
import path from "path";
import type { LLMAnalysis, SentimentData } from "@/types";
import { getCacheBaseDir } from "./cacheDir";

const CACHE_DIR = path.join(getCacheBaseDir(), "analysis");
const ANALYSIS_CACHE_TTL = 24 * 60 * 60 * 1000; // 1日

function ensureDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function cacheFile(symbol: string): string {
  return path.join(CACHE_DIR, `${symbol.replace(".", "_")}.json`);
}

interface AnalysisCacheEntry {
  analysis: LLMAnalysis;
  sentiment: SentimentData;
  cachedAt: number;
}

export function getCachedAnalysis(symbol: string): AnalysisCacheEntry | null {
  try {
    ensureDir();
    const file = cacheFile(symbol);
    if (!fs.existsSync(file)) return null;

    const entry: AnalysisCacheEntry = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (Date.now() - entry.cachedAt > ANALYSIS_CACHE_TTL) return null;

    return entry;
  } catch {
    return null;
  }
}

export function setCachedAnalysis(
  symbol: string,
  analysis: LLMAnalysis,
  sentiment: SentimentData
): void {
  try {
    ensureDir();
    const file = cacheFile(symbol);
    const entry: AnalysisCacheEntry = {
      analysis,
      sentiment,
      cachedAt: Date.now(),
    };
    fs.writeFileSync(file, JSON.stringify(entry), "utf-8");
  } catch {
    // ignore write errors
  }
}

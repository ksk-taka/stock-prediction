import fs from "fs";
import path from "path";
import type { LLMAnalysis, SentimentData } from "@/types";
import { ensureCacheDir, TTL } from "./cacheUtils";

const CACHE_SUBDIR = "analysis";
const ANALYSIS_CACHE_TTL = TTL.HOURS_24; // 1日

function cacheFile(symbol: string): string {
  const dir = ensureCacheDir(CACHE_SUBDIR);
  return path.join(dir, `${symbol.replace(".", "_")}.json`);
}

interface AnalysisCacheEntry {
  analysis: LLMAnalysis;
  sentiment: SentimentData;
  cachedAt: number;
}

export function getCachedAnalysis(symbol: string): AnalysisCacheEntry | null {
  try {
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

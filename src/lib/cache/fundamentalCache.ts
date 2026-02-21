import fs from "fs";
import path from "path";
import type { FundamentalResearchData, FundamentalAnalysis, SignalValidation } from "@/types";
import { ensureCacheDir, TTL } from "./cacheUtils";

const CACHE_SUBDIR = "fundamental";
const RESEARCH_TTL = TTL.HOURS_12; // 12時間
const ANALYSIS_TTL = TTL.HOURS_24; // 24時間
const VALIDATION_TTL = TTL.DAYS_7; // 7日間

function cacheFile(symbol: string, type: "research" | "analysis"): string {
  const dir = ensureCacheDir(CACHE_SUBDIR);
  return path.join(dir, `${symbol.replace(".", "_")}_${type}.json`);
}

// --- Perplexity Research Cache ---

interface ResearchCacheEntry {
  data: FundamentalResearchData;
  cachedAt: number;
}

export function getCachedResearch(symbol: string): FundamentalResearchData | null {
  const file = cacheFile(symbol, "research");
  if (!fs.existsSync(file)) return null;

  try {
    const entry: ResearchCacheEntry = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (Date.now() - entry.cachedAt > RESEARCH_TTL) return null;
    return entry.data;
  } catch {
    return null;
  }
}

export function setCachedResearch(symbol: string, data: FundamentalResearchData): void {
  try {
      const file = cacheFile(symbol, "research");
    const entry: ResearchCacheEntry = { data, cachedAt: Date.now() };
    fs.writeFileSync(file, JSON.stringify(entry), "utf-8");
  } catch {
    // ignore write errors
  }
}

// --- Ollama Analysis Cache ---

interface AnalysisCacheEntry {
  data: FundamentalAnalysis;
  cachedAt: number;
}

export function getCachedFundamentalAnalysis(symbol: string): FundamentalAnalysis | null {
  const file = cacheFile(symbol, "analysis");
  if (!fs.existsSync(file)) return null;

  try {
    const entry: AnalysisCacheEntry = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (Date.now() - entry.cachedAt > ANALYSIS_TTL) return null;
    return entry.data;
  } catch {
    return null;
  }
}

export function setCachedFundamentalAnalysis(symbol: string, data: FundamentalAnalysis): void {
  try {
      const file = cacheFile(symbol, "analysis");
    const entry: AnalysisCacheEntry = { data, cachedAt: Date.now() };
    fs.writeFileSync(file, JSON.stringify(entry), "utf-8");
    // 履歴にも追記
    appendFundamentalHistory(symbol, data);
  } catch {
    // ignore write errors
  }
}

// --- Fundamental Analysis History (蓄積型) ---

export interface FundamentalHistoryEntry {
  judgment: "bullish" | "neutral" | "bearish";
  summary: string;
  analyzedAt: string;
}

function historyFile(symbol: string): string {
  const dir = ensureCacheDir(CACHE_SUBDIR);
  return path.join(dir, `${symbol.replace(".", "_")}_history.json`);
}

export function getFundamentalHistory(symbol: string): FundamentalHistoryEntry[] {
  const file = historyFile(symbol);
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return [];
  }
}

function appendFundamentalHistory(symbol: string, data: FundamentalAnalysis): void {
  const history = getFundamentalHistory(symbol);
  // 同じ日の重複エントリは上書き
  const date = data.analyzedAt.slice(0, 10);
  const idx = history.findIndex((h) => h.analyzedAt.slice(0, 10) === date);
  const entry: FundamentalHistoryEntry = {
    judgment: data.judgment,
    summary: data.summary,
    analyzedAt: data.analyzedAt,
  };
  if (idx >= 0) {
    history[idx] = entry;
  } else {
    history.push(entry);
  }
  // 最大100件に制限
  const trimmed = history.slice(-100);
  fs.writeFileSync(historyFile(symbol), JSON.stringify(trimmed, null, 2), "utf-8");
}

// --- Signal Validation Cache (Go/No Go) ---

interface ValidationCacheEntry {
  data: SignalValidation;
  cachedAt: number;
}

function validationFile(symbol: string, strategyId: string): string {
  const dir = ensureCacheDir(CACHE_SUBDIR);
  return path.join(dir, `${symbol.replace(".", "_")}_validation_${strategyId}.json`);
}

export function getCachedValidation(symbol: string, strategyId: string): SignalValidation | null {
  const file = validationFile(symbol, strategyId);
  if (!fs.existsSync(file)) return null;
  try {
    const entry: ValidationCacheEntry = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (Date.now() - entry.cachedAt > VALIDATION_TTL) return null;
    return entry.data;
  } catch {
    return null;
  }
}

export function setCachedValidation(symbol: string, strategyId: string, data: SignalValidation): void {
  try {
      const file = validationFile(symbol, strategyId);
    const entry: ValidationCacheEntry = { data, cachedAt: Date.now() };
    fs.writeFileSync(file, JSON.stringify(entry), "utf-8");
  } catch {
    // ignore write errors
  }
}

export function getAllCachedValidations(symbol: string): Record<string, SignalValidation> {
  const prefix = `${symbol.replace(".", "_")}_validation_`;
  const result: Record<string, SignalValidation> = {};
  try {
    const dir = ensureCacheDir(CACHE_SUBDIR);
    const files = fs.readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith(".json"));
    for (const f of files) {
      const strategyId = f.replace(prefix, "").replace(".json", "");
      const entry: ValidationCacheEntry = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
      if (Date.now() - entry.cachedAt <= VALIDATION_TTL) {
        result[strategyId] = entry.data;
      }
    }
  } catch {
    // ignore
  }
  return result;
}

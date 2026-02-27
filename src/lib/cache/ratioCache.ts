/**
 * レシオ指標 (シャープレシオ) の IndexedDB キャッシュ
 * tableCache.ts と同じパターン (idb-keyval)
 */
import { get, set, del } from "idb-keyval";
import type { ReturnType } from "@/lib/utils/indicators";

const CACHE_KEY = "ratio-check-v1";
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24時間

export interface RatioCacheEntry {
  symbol: string;
  name: string;
  price: number | null;
  sharpe: Record<ReturnType, { m3: number | null; m6: number | null; y1: number | null }> | null;
  error: string | null;
}

interface CacheEnvelope {
  version: number;
  timestamp: number;
  data: RatioCacheEntry[];
}

/** キャッシュ読み出し (TTL チェック付き) */
export async function getRatioCache(): Promise<RatioCacheEntry[] | null> {
  try {
    const envelope = await get<CacheEnvelope>(CACHE_KEY);
    if (!envelope) return null;
    if (envelope.version !== 1) return null;
    if (Date.now() - envelope.timestamp >= CACHE_TTL) return null;
    return envelope.data;
  } catch {
    return null;
  }
}

/** キャッシュ保存 */
export async function setRatioCache(data: RatioCacheEntry[]): Promise<void> {
  if (data.length === 0) return;
  const envelope: CacheEnvelope = {
    version: 1,
    timestamp: Date.now(),
    data,
  };
  try {
    await set(CACHE_KEY, envelope);
  } catch { /* ignore */ }
}

/** キャッシュクリア */
export async function clearRatioCache(): Promise<void> {
  try {
    await del(CACHE_KEY);
  } catch { /* ignore */ }
}

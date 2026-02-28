/**
 * buyback-detail ページデータの IndexedDB キャッシュ (クライアント側)
 * データは月次更新のため TTL = 24時間
 */
import { get, set, del } from "idb-keyval";

const CACHE_KEY = "buyback-detail-v1";
const CACHE_VERSION = 1;
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24時間

interface CacheEnvelope {
  version: number;
  timestamp: number;
  stocks: unknown[];
  totalBuybackCodes: number;
}

export async function getBuybackDetailClientCache(): Promise<{
  stocks: unknown[];
  totalBuybackCodes: number;
} | null> {
  try {
    const envelope = await get<CacheEnvelope>(CACHE_KEY);
    if (!envelope) return null;
    if (envelope.version !== CACHE_VERSION) return null;
    if (Date.now() - envelope.timestamp >= CACHE_TTL) return null;
    return { stocks: envelope.stocks, totalBuybackCodes: envelope.totalBuybackCodes };
  } catch {
    return null;
  }
}

export async function setBuybackDetailClientCache(
  stocks: unknown[],
  totalBuybackCodes: number,
): Promise<void> {
  if (stocks.length === 0) return;
  const envelope: CacheEnvelope = {
    version: CACHE_VERSION,
    timestamp: Date.now(),
    stocks,
    totalBuybackCodes,
  };
  try {
    await set(CACHE_KEY, envelope);
  } catch { /* ignore */ }
}

export async function clearBuybackDetailClientCache(): Promise<void> {
  try {
    await del(CACHE_KEY);
  } catch { /* ignore */ }
}

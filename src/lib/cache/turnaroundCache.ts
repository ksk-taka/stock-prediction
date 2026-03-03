/**
 * ターンアラウンド候補探索 データの IndexedDB キャッシュ (24時間TTL)
 */
import { get, set, del } from "idb-keyval";
import type { TurnaroundScreenRow } from "@/app/api/turnaround-screen/route";

const CACHE_KEY = "turnaround-v1";
const CACHE_VERSION = 1;
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24時間

interface CacheEnvelope {
  version: number;
  timestamp: number;
  data: Record<string, TurnaroundScreenRow>;
}

export async function getTurnaroundCache(): Promise<Map<string, TurnaroundScreenRow> | null> {
  try {
    const envelope = await get<CacheEnvelope>(CACHE_KEY);
    if (!envelope) return null;
    if (envelope.version !== CACHE_VERSION) return null;
    if (Date.now() - envelope.timestamp >= CACHE_TTL) return null;
    return new Map(Object.entries(envelope.data));
  } catch {
    return null;
  }
}

export async function setTurnaroundCache(data: Map<string, TurnaroundScreenRow>): Promise<void> {
  if (data.size === 0) return;
  const obj: Record<string, TurnaroundScreenRow> = {};
  data.forEach((v, k) => { obj[k] = v; });
  const envelope: CacheEnvelope = {
    version: CACHE_VERSION,
    timestamp: Date.now(),
    data: obj,
  };
  try {
    await set(CACHE_KEY, envelope);
  } catch { /* ignore */ }
}

export async function clearTurnaroundCache(): Promise<void> {
  try {
    await del(CACHE_KEY);
  } catch { /* ignore */ }
}

/**
 * テンバガー候補探索 データの IndexedDB キャッシュ (24時間TTL)
 */
import { get, set, del } from "idb-keyval";

const CACHE_KEY = "ten-bagger-v1";
const CACHE_VERSION = 1;
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24時間

export interface TenBaggerRow {
  symbol: string;
  name: string;
  marketSegment: string;
  price: number;
  changePercent: number;
  // スクリーニング主要指標
  revenueGrowth: number | null;     // 売上成長率 (%)
  operatingMargins: number | null;  // 営業利益率 (%)
  firstTradeDate: string | null;    // 上場日
  yearsListed: number | null;       // 上場からの年数
  marketCap: number | null;         // 時価総額 (円)
  // バリュエーション
  per: number | null;
  pbr: number | null;
  cnPer: number | null;
  simpleNcRatio: number | null;
  roe: number | null;
  // リスク指標
  sharpe3m: number | null;
  sharpe6m: number | null;
  sharpe1y: number | null;
  // 追加
  volume: number;
  profitGrowthRate: number | null;
}

interface CacheEnvelope {
  version: number;
  timestamp: number;
  data: Record<string, TenBaggerRow>;
}

export async function getTenBaggerCache(): Promise<Map<string, TenBaggerRow> | null> {
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

export async function setTenBaggerCache(data: Map<string, TenBaggerRow>): Promise<void> {
  if (data.size === 0) return;
  const obj: Record<string, TenBaggerRow> = {};
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

export async function clearTenBaggerCache(): Promise<void> {
  try {
    await del(CACHE_KEY);
  } catch { /* ignore */ }
}

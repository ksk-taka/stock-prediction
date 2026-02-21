/**
 * stock-table データの IndexedDB キャッシュ
 * localStorage (5MB制限) では 3,776銘柄のデータが収まらないため IndexedDB を使用
 */
import { get, set, del } from "idb-keyval";

const CACHE_KEY = "stock-table-v2";
const CACHE_VERSION = 1;
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6時間

// page.tsx 側と同じ型 (re-export用にここでも定義)
export interface StockTableRow {
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
  volume: number;
  per: number | null;
  eps: number | null;
  pbr: number | null;
  simpleNcRatio: number | null;
  cnPer: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  weekHigh: number | null;
  weekLow: number | null;
  monthHigh: number | null;
  monthLow: number | null;
  yearHigh: number | null;
  yearLow: number | null;
  lastYearHigh: number | null;
  lastYearLow: number | null;
  earningsDate: string | null;
  fiscalYearEnd: string | null;
  marketCap: number | null;
  sharpe1y: number | null;
  roe: number | null;
  latestDividend: number | null;
  previousDividend: number | null;
  latestIncrease: number | null;
  hasYutai: boolean | null;
  yutaiContent: string | null;
  recordDate: string | null;
  sellRecommendDate: string | null;
  daysUntilSell: number | null;
  dividendYield: number | null;
  roeHistory: { year: number; roe: number }[] | null;
  fcfHistory: { year: number; fcf: number; ocf: number; capex: number }[] | null;
  currentRatio: number | null;
  psr: number | null;
  pegRatio: number | null;
  equityRatio: number | null;
  totalDebt: number | null;
  profitGrowthRate: number | null;
  topixScale: string | null;
  isNikkei225: boolean;
  firstTradeDate: string | null;
  sharesOutstanding: number | null;
  floatingRatio: number | null;
  floatingMarketCap: number | null;
}

interface CacheEnvelope {
  version: number;
  timestamp: number;
  data: Record<string, StockTableRow>;
}

/** IndexedDB からテーブルキャッシュを読み出し (TTL/version チェック付き) */
export async function getTableCache(): Promise<Map<string, StockTableRow> | null> {
  try {
    // 旧 localStorage からの移行 (一度だけ)
    const legacy = localStorage.getItem("stock-table-v1");
    if (legacy) {
      try {
        const parsed = JSON.parse(legacy);
        if (parsed.version === 2 && parsed.data && Date.now() - parsed.timestamp < CACHE_TTL) {
          const envelope: CacheEnvelope = {
            version: CACHE_VERSION,
            timestamp: parsed.timestamp,
            data: parsed.data,
          };
          await set(CACHE_KEY, envelope);
          localStorage.removeItem("stock-table-v1");
          return new Map(Object.entries(envelope.data));
        }
      } catch { /* ignore */ }
      localStorage.removeItem("stock-table-v1");
    }

    const envelope = await get<CacheEnvelope>(CACHE_KEY);
    if (!envelope) return null;
    if (envelope.version !== CACHE_VERSION) return null;
    if (Date.now() - envelope.timestamp >= CACHE_TTL) return null;
    return new Map(Object.entries(envelope.data));
  } catch {
    return null;
  }
}

/** IndexedDB にテーブルキャッシュを保存 */
export async function setTableCache(data: Map<string, StockTableRow>): Promise<void> {
  if (data.size === 0) return;
  const obj: Record<string, StockTableRow> = {};
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

/** キャッシュクリア */
export async function clearTableCache(): Promise<void> {
  try {
    await del(CACHE_KEY);
  } catch { /* ignore */ }
}

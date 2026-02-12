import type { SignalValidation } from "./index";

export interface StockQuote {
  symbol: string;
  price: number;
  changePercent: number;
}

export interface StockStats {
  per: number | null;
  pbr: number | null;
  roe: number | null;
  eps: number | null;
  simpleNcRatio?: number | null;
  marketCap?: number | null;
  sharpe1y?: number | null;
  latestDividend?: number | null;
  latestIncrease?: number | null;
}

export interface ActiveSignalInfo {
  strategyId: string;
  strategyName: string;
  buyDate: string;
  buyPrice: number;
  currentPrice: number;
  pnlPct: number;
  takeProfitPrice?: number;
  takeProfitLabel?: string;
  stopLossPrice?: number;
  stopLossLabel?: string;
}

export interface RecentSignalInfo {
  strategyId: string;
  strategyName: string;
  date: string;
  price: number;
}

export interface SignalSummary {
  activeSignals?: {
    daily: ActiveSignalInfo[];
    weekly: ActiveSignalInfo[];
  };
  recentSignals?: {
    daily: RecentSignalInfo[];
    weekly: RecentSignalInfo[];
  };
  validations?: Record<string, SignalValidation>;
}

export interface NewHighInfo {
  isTrue52wBreakout: boolean;
  consolidationDays: number;
  consolidationRangePct: number;
  pctAbove52wHigh: number;
}

export interface FilterPreset {
  name: string;
  sectors: string[];
  strategies: string[];
  segments: string[];
  capSizes?: string[];
  groupIds?: number[];
  signalFilterMode?: "or" | "and";
  signalPeriodFilter?: string;
  decision: string | null;
  judgment: string | null;
  // 数値範囲フィルタ
  ncRatioMin?: string;
  ncRatioMax?: string;
  sharpeMin?: string;
  increaseMin?: string;
  roeMin?: string;
  roeMax?: string;
  priceMin?: string;
  priceMax?: string;
}

// ウォッチリストで非表示にする戦略（個別銘柄ページでは引き続き表示）
export const WL_EXCLUDE_STRATEGIES = new Set([
  "choruko_bb",
  "choruko_shitabanare",
  "cwh_trail",
  "dip_kairi",
  "dip_rsi_volume",
  "dip_bb3sigma",
]);

export const PAGE_SIZE = 50;
export const PRESETS_KEY = "watchlist-filter-presets";

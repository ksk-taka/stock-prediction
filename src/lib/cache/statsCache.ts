import fs from "fs";
import path from "path";
import { ensureCacheDir, TTL as CacheTTL } from "./cacheUtils";
import { createServiceClient } from "@/lib/supabase/service";
import type { DividendSummary } from "@/types";

const CACHE_SUBDIR = "stats";
const TTL = CacheTTL.HOURS_24; // 24時間（1日1回更新）
const NC_TTL = CacheTTL.DAYS_7; // 7日間（四半期データなので長め）
const DIVIDEND_TTL = CacheTTL.DAYS_30; // 30日間（配当は年2回程度なので長めに）
const ROE_TTL = CacheTTL.DAYS_30; // 30日間（四半期決算ごとに更新）
const EARNINGS_INVALIDATION_DAYS = 3; // 決算発表日前後N日以内はキャッシュ無効化

// Supabase stats_cache テーブルの行型
interface SupabaseStatsCacheRow {
  symbol: string;
  nc_ratio: number | null;
  nc_cached_at: string | null;
  roe: number | null;
  roe_cached_at: string | null;
  dividend_summary: DividendSummary | null;
  dividend_cached_at: string | null;
  sharpe_1y: number | null;
  sharpe_cached_at: string | null;
  week_high: number | null;
  week_low: number | null;
  month_high: number | null;
  month_low: number | null;
  range_cached_at: string | null;
  floating_ratio: number | null;
  floating_ratio_cached_at: string | null;
  current_ratio: number | null;
  peg_ratio: number | null;
  equity_ratio: number | null;
  total_debt: number | null;
  profit_growth_rate: number | null;
  extra_metrics_cached_at: string | null;
  topix_scale: string | null;
  updated_at: string;
}

/**
 * 1回の読み取りで全項目を返す（各項目ごとにTTL判定）
 * undefined = キャッシュなし/期限切れ, null = データなし
 */
export interface CachedStatsAllResult {
  nc: number | null | undefined;
  dividend: DividendSummary | null | undefined;
  roe: number | null | undefined;
  fiscalYearEnd: string | null | undefined;
  roeHistory: { year: number; roe: number }[] | null | undefined;
  fcfHistory: { year: number; fcf: number; ocf: number; capex: number }[] | null | undefined;
  currentRatio: number | null | undefined;
  pegRatio: number | null | undefined;
  equityRatio: number | null | undefined;
  totalDebt: number | null | undefined;
  profitGrowthRate: number | null | undefined;
  prevProfitGrowthRate: number | null | undefined;
  psr: number | null | undefined;
  pbr: number | null | undefined;
  floatingRatio: number | null | undefined;
  topixScale: string | null | undefined;
}

interface StatsCacheEntry {
  per: number | null;
  forwardPer: number | null;
  pbr: number | null;
  eps: number | null;
  roe: number | null;
  dividendYield: number | null;
  simpleNcRatio?: number | null;
  marketCap?: number | null;
  sharpe1y?: number | null;
  sharpe3y?: number | null;
  dividendSummary?: DividendSummary | null;
  fiscalYearEnd?: string | null;
  roeHistory?: { year: number; roe: number }[] | null;
  fcfHistory?: { year: number; fcf: number; ocf: number; capex: number }[] | null;
  currentRatio?: number | null;
  pegRatio?: number | null;
  equityRatio?: number | null;
  totalDebt?: number | null;
  profitGrowthRate?: number | null;
  prevProfitGrowthRate?: number | null;
  psr?: number | null;
  floatingRatio?: number | null;
  cachedAt: number;
  ncCachedAt?: number; // NC率専用タイムスタンプ（cachedAtとは独立）
  dividendCachedAt?: number; // 配当専用タイムスタンプ
  roeCachedAt?: number; // ROE専用タイムスタンプ（30日TTL）
  roeHistoryCachedAt?: number; // ROE推移専用タイムスタンプ（30日TTL）
  fcfHistoryCachedAt?: number; // FCF推移専用タイムスタンプ（30日TTL）
  currentRatioCachedAt?: number; // 流動比率専用タイムスタンプ（30日TTL）
  extraMetricsCachedAt?: number; // PSR/PEG/自己資本比率/有利子負債/増益率 タイムスタンプ（30日TTL）
  floatingRatioCachedAt?: number; // 浮動株比率タイムスタンプ（30日TTL）
}

function cacheFile(symbol: string): string {
  const dir = ensureCacheDir(CACHE_SUBDIR);
  return path.join(dir, `${symbol.replace(".", "_")}.json`);
}

/**
 * 決算発表日が直近かどうかをチェック
 * @param earningsDate 決算発表日（Date, string, number, null）
 * @returns 決算発表日が前後N日以内ならtrue
 */
export function isNearEarningsDate(earningsDate: Date | string | number | null | undefined): boolean {
  if (!earningsDate) return false;

  const earnings = new Date(earningsDate);
  if (isNaN(earnings.getTime())) return false;

  const now = new Date();
  const diffDays = Math.abs(now.getTime() - earnings.getTime()) / (24 * 60 * 60 * 1000);

  return diffDays <= EARNINGS_INVALIDATION_DAYS;
}

/**
 * 特定銘柄のstatsキャッシュを削除
 */
export function invalidateStatsCache(symbol: string): boolean {
  try {
    const file = cacheFile(symbol);
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function getCachedStats(symbol: string): Omit<StatsCacheEntry, "cachedAt" | "ncCachedAt"> | null {
  try {
    const file = cacheFile(symbol);
    if (!fs.existsSync(file)) return null;

    const entry: StatsCacheEntry = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (Date.now() - entry.cachedAt > TTL) return null;

    const { cachedAt: _, ncCachedAt: _nc, ...data } = entry;
    return data;
  } catch {
    return null;
  }
}

/**
 * NC率だけを長期キャッシュから取得（7日TTL）
 * ncCachedAtがあればそれを使い、なければcachedAtにフォールバック
 * undefined = キャッシュなし/期限切れ, null = データなし（計算不能）
 */
export function getCachedNcRatio(symbol: string): number | null | undefined {
  try {
    const file = cacheFile(symbol);
    if (!fs.existsSync(file)) return undefined;

    const entry: StatsCacheEntry = JSON.parse(fs.readFileSync(file, "utf-8"));
    const ncTs = entry.ncCachedAt ?? entry.cachedAt;
    if (Date.now() - ncTs > NC_TTL) return undefined;
    if (entry.simpleNcRatio === undefined) return undefined;
    return entry.simpleNcRatio ?? null;
  } catch {
    return undefined;
  }
}

export function setCachedStats(
  symbol: string,
  data: Omit<StatsCacheEntry, "cachedAt" | "ncCachedAt" | "dividendCachedAt">
): void {
  try {
    const file = cacheFile(symbol);
    const now = Date.now();
    const entry: StatsCacheEntry = { ...data, cachedAt: now, ncCachedAt: now, dividendCachedAt: now };
    fs.writeFileSync(file, JSON.stringify(entry), "utf-8");
  } catch {
    // ignore write errors
  }
}

/**
 * NC率のみをキャッシュに書き込む（既存エントリがあれば更新、なければ新規作成）
 * ncCachedAtを更新してNC率のTTLを独立管理（他フィールドのcachedAtは壊さない）
 */
export function setCachedNcOnly(symbol: string, ncRatio: number | null): void {
  try {
    const file = cacheFile(symbol);
    let entry: StatsCacheEntry;
    try {
      const existing: StatsCacheEntry = JSON.parse(fs.readFileSync(file, "utf-8"));
      existing.simpleNcRatio = ncRatio;
      existing.ncCachedAt = Date.now();
      entry = existing; // cachedAtは元のまま（他フィールドのTTLを壊さない）
    } catch {
      entry = {
        per: null, forwardPer: null, pbr: null, eps: null,
        roe: null, dividendYield: null,
        simpleNcRatio: ncRatio,
        cachedAt: Date.now(),
        ncCachedAt: Date.now(),
      };
    }
    fs.writeFileSync(file, JSON.stringify(entry), "utf-8");
  } catch {
    // ignore write errors
  }
}

/**
 * 配当サマリーをキャッシュから取得（7日TTL）
 * undefined = キャッシュなし/期限切れ, null = 無配銘柄
 */
export function getCachedDividendSummary(symbol: string): DividendSummary | null | undefined {
  try {
    const file = cacheFile(symbol);
    if (!fs.existsSync(file)) return undefined;

    const entry: StatsCacheEntry = JSON.parse(fs.readFileSync(file, "utf-8"));
    const divTs = entry.dividendCachedAt ?? entry.cachedAt;
    if (Date.now() - divTs > DIVIDEND_TTL) return undefined;
    if (entry.dividendSummary === undefined) return undefined;
    return entry.dividendSummary ?? null;
  } catch {
    return undefined;
  }
}

/**
 * 配当サマリーのみをキャッシュに書き込む（既存エントリがあれば更新）
 */
export function setCachedDividendOnly(symbol: string, summary: DividendSummary | null): void {
  try {
    const file = cacheFile(symbol);
    let entry: StatsCacheEntry;
    try {
      const existing: StatsCacheEntry = JSON.parse(fs.readFileSync(file, "utf-8"));
      existing.dividendSummary = summary;
      existing.dividendCachedAt = Date.now();
      entry = existing;
    } catch {
      entry = {
        per: null, forwardPer: null, pbr: null, eps: null,
        roe: null, dividendYield: null,
        dividendSummary: summary,
        cachedAt: Date.now(),
        dividendCachedAt: Date.now(),
      };
    }
    fs.writeFileSync(file, JSON.stringify(entry), "utf-8");
  } catch {
    // ignore write errors
  }
}

/**
 * ROEをキャッシュから取得（30日TTL）
 * undefined = キャッシュなし/期限切れ, null = データなし
 */
export function getCachedRoe(symbol: string): number | null | undefined {
  try {
    const file = cacheFile(symbol);
    if (!fs.existsSync(file)) return undefined;

    const entry: StatsCacheEntry = JSON.parse(fs.readFileSync(file, "utf-8"));
    const roeTs = entry.roeCachedAt ?? entry.cachedAt;
    if (Date.now() - roeTs > ROE_TTL) return undefined;
    if (entry.roe === undefined) return undefined;
    return entry.roe ?? null;
  } catch {
    return undefined;
  }
}

/**
 * ROEのみをキャッシュに書き込む（既存エントリがあれば更新）
 */
export function setCachedRoeOnly(symbol: string, roe: number | null): void {
  try {
    const file = cacheFile(symbol);
    let entry: StatsCacheEntry;
    try {
      const existing: StatsCacheEntry = JSON.parse(fs.readFileSync(file, "utf-8"));
      existing.roe = roe;
      existing.roeCachedAt = Date.now();
      entry = existing;
    } catch {
      entry = {
        per: null, forwardPer: null, pbr: null, eps: null,
        roe, dividendYield: null,
        cachedAt: Date.now(),
        roeCachedAt: Date.now(),
      };
    }
    fs.writeFileSync(file, JSON.stringify(entry), "utf-8");
  } catch {
    // ignore write errors
  }
}

/**
 * 複数フィールドを一度に更新（1回のファイル読み書きで完了）
 * 部分更新の重複読み書きを避けるための最適化関数
 */
export interface StatsPartialUpdate {
  nc?: number | null;
  dividend?: DividendSummary | null;
  roe?: number | null;
  fiscalYearEnd?: string | null;
  roeHistory?: { year: number; roe: number }[] | null;
  fcfHistory?: { year: number; fcf: number; ocf: number; capex: number }[] | null;
  currentRatio?: number | null;
  pegRatio?: number | null;
  equityRatio?: number | null;
  totalDebt?: number | null;
  profitGrowthRate?: number | null;
  prevProfitGrowthRate?: number | null;
  psr?: number | null;
  pbr?: number | null;
  floatingRatio?: number | null;
  topixScale?: string | null;
}

export function setCachedStatsPartial(symbol: string, updates: StatsPartialUpdate): void {
  try {
    const file = cacheFile(symbol);
    const now = Date.now();

    let entry: StatsCacheEntry;
    try {
      entry = JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch {
      // ファイルが存在しない場合は新規作成
      entry = {
        per: null, forwardPer: null, pbr: null, eps: null,
        roe: null, dividendYield: null,
        cachedAt: now,
      };
    }

    // 各フィールドを更新（undefinedでない場合のみ）
    if (updates.nc !== undefined) {
      entry.simpleNcRatio = updates.nc;
      entry.ncCachedAt = now;
    }
    if (updates.dividend !== undefined) {
      entry.dividendSummary = updates.dividend;
      entry.dividendCachedAt = now;
    }
    if (updates.roe !== undefined) {
      entry.roe = updates.roe;
      entry.roeCachedAt = now;
    }
    if (updates.fiscalYearEnd !== undefined) {
      entry.fiscalYearEnd = updates.fiscalYearEnd;
    }
    if (updates.roeHistory !== undefined) {
      entry.roeHistory = updates.roeHistory;
      entry.roeHistoryCachedAt = now;
    }
    if (updates.fcfHistory !== undefined) {
      entry.fcfHistory = updates.fcfHistory;
      entry.fcfHistoryCachedAt = now;
    }
    if (updates.currentRatio !== undefined) {
      entry.currentRatio = updates.currentRatio;
      entry.currentRatioCachedAt = now;
    }
    if (updates.pegRatio !== undefined || updates.equityRatio !== undefined ||
        updates.totalDebt !== undefined || updates.profitGrowthRate !== undefined ||
        updates.prevProfitGrowthRate !== undefined || updates.psr !== undefined) {
      if (updates.pegRatio !== undefined) entry.pegRatio = updates.pegRatio;
      if (updates.equityRatio !== undefined) entry.equityRatio = updates.equityRatio;
      if (updates.totalDebt !== undefined) entry.totalDebt = updates.totalDebt;
      if (updates.profitGrowthRate !== undefined) entry.profitGrowthRate = updates.profitGrowthRate;
      if (updates.prevProfitGrowthRate !== undefined) entry.prevProfitGrowthRate = updates.prevProfitGrowthRate;
      if (updates.psr !== undefined) entry.psr = updates.psr;
      entry.extraMetricsCachedAt = now;
    }
    if (updates.pbr !== undefined) {
      entry.pbr = updates.pbr;
    }

    // 浮動株比率
    if (updates.floatingRatio !== undefined) {
      entry.floatingRatio = updates.floatingRatio;
      entry.floatingRatioCachedAt = now;
    }

    fs.writeFileSync(file, JSON.stringify(entry), "utf-8");

    // Supabaseにもバックグラウンドで保存（失敗しても無視）
    setStatsCacheToSupabase(symbol, updates).catch(() => {});
  } catch {
    // ignore write errors
  }
}

/**
 * 1回のファイル読み取りで全項目を取得（各項目ごとにTTL判定）
 * 重複読み取りを避けるための最適化関数
 * @param earningsDate 決算発表日（直近ならROEキャッシュを無効化）
 */
/**
 * バッチ用: キャッシュから全指標を読み取り (NC/ROE/Sharpe/配当/PER/PBR/時価総額)
 * TTL期限切れ項目はundefined
 */
export function getCachedStatsFull(symbol: string): {
  per?: number | null;
  pbr?: number | null;
  roe?: number | null;
  simpleNcRatio?: number | null;
  marketCap?: number | null;
  sharpe1y?: number | null;
  latestDividend?: number | null;
  latestIncrease?: number | null;
  roeHistory?: { year: number; roe: number }[] | null;
  fcfHistory?: { year: number; fcf: number; ocf: number; capex: number }[] | null;
} | null {
  try {
    const file = cacheFile(symbol);
    if (!fs.existsSync(file)) return null;

    const entry: StatsCacheEntry = JSON.parse(fs.readFileSync(file, "utf-8"));
    const now = Date.now();

    // メインTTL (24h) でPER/PBR/marketCap/Sharpeを判定
    const mainValid = now - entry.cachedAt <= TTL;

    // NC率 (7日TTL)
    const ncTs = entry.ncCachedAt ?? entry.cachedAt;
    const nc = now - ncTs <= NC_TTL && entry.simpleNcRatio !== undefined
      ? entry.simpleNcRatio : undefined;

    // ROE (30日TTL)
    const roeTs = entry.roeCachedAt ?? entry.cachedAt;
    const roe = now - roeTs <= ROE_TTL && entry.roe !== undefined
      ? entry.roe : undefined;

    // 配当 (30日TTL)
    const divTs = entry.dividendCachedAt ?? entry.cachedAt;
    const div = now - divTs <= DIVIDEND_TTL && entry.dividendSummary !== undefined
      ? entry.dividendSummary : undefined;

    // ROE推移 (30日TTL)
    const roeHistTs = entry.roeHistoryCachedAt ?? entry.cachedAt;
    const roeHistory = now - roeHistTs <= ROE_TTL && entry.roeHistory !== undefined
      ? entry.roeHistory : undefined;

    // FCF推移 (30日TTL)
    const fcfHistTs = entry.fcfHistoryCachedAt ?? entry.cachedAt;
    const fcfHistory = now - fcfHistTs <= ROE_TTL && entry.fcfHistory !== undefined
      ? entry.fcfHistory : undefined;

    return {
      per: mainValid ? (entry.per ?? null) : undefined,
      pbr: mainValid ? (entry.pbr ?? null) : undefined,
      roe,
      simpleNcRatio: nc,
      marketCap: mainValid ? (entry.marketCap ?? null) : undefined,
      sharpe1y: mainValid ? (entry.sharpe1y ?? null) : undefined,
      latestDividend: div !== undefined ? (div?.latestAmount ?? null) : undefined,
      latestIncrease: div !== undefined ? (div?.latestIncrease ?? null) : undefined,
      roeHistory,
      fcfHistory,
    };
  } catch {
    return null;
  }
}

export function getCachedStatsAll(
  symbol: string,
  earningsDate?: Date | string | number | null
): CachedStatsAllResult {
  const result: CachedStatsAllResult = {
    nc: undefined,
    dividend: undefined,
    roe: undefined,
    fiscalYearEnd: undefined,
    roeHistory: undefined,
    fcfHistory: undefined,
    currentRatio: undefined,
    pegRatio: undefined,
    equityRatio: undefined,
    totalDebt: undefined,
    profitGrowthRate: undefined,
    prevProfitGrowthRate: undefined,
    psr: undefined,
    pbr: undefined,
    floatingRatio: undefined,
    topixScale: undefined,
  };

  // 決算日が直近の場合、ROEは常に再取得（PER/EPS/ROEが更新される可能性）
  const nearEarnings = isNearEarningsDate(earningsDate);

  try {
    const file = cacheFile(symbol);
    if (!fs.existsSync(file)) return result;

    const entry: StatsCacheEntry = JSON.parse(fs.readFileSync(file, "utf-8"));
    const now = Date.now();

    // NC率（7日TTL）
    const ncTs = entry.ncCachedAt ?? entry.cachedAt;
    if (now - ncTs <= NC_TTL && entry.simpleNcRatio !== undefined) {
      result.nc = entry.simpleNcRatio;
    }

    // 配当（30日TTL）
    const divTs = entry.dividendCachedAt ?? entry.cachedAt;
    if (now - divTs <= DIVIDEND_TTL && entry.dividendSummary !== undefined) {
      result.dividend = entry.dividendSummary;
    }

    // ROE（30日TTL）- 決算日が近い場合は無効化
    if (!nearEarnings) {
      const roeTs = entry.roeCachedAt ?? entry.cachedAt;
      if (now - roeTs <= ROE_TTL && entry.roe !== undefined) {
        result.roe = entry.roe;
      }
    }

    // 決算日（fiscalYearEnd）- キャッシュにあればそのまま返す
    if (entry.fiscalYearEnd !== undefined) {
      result.fiscalYearEnd = entry.fiscalYearEnd;
    }

    // ROE推移（30日TTL）
    if (!nearEarnings) {
      const roeHistTs = entry.roeHistoryCachedAt ?? entry.cachedAt;
      if (now - roeHistTs <= ROE_TTL && entry.roeHistory !== undefined) {
        result.roeHistory = entry.roeHistory;
      }
    }

    // FCF推移（30日TTL）
    if (!nearEarnings) {
      const fcfHistTs = entry.fcfHistoryCachedAt ?? entry.cachedAt;
      if (now - fcfHistTs <= ROE_TTL && entry.fcfHistory !== undefined) {
        result.fcfHistory = entry.fcfHistory;
      }
    }

    // 流動比率（30日TTL - 四半期決算ごとに更新）
    const crTs = entry.currentRatioCachedAt ?? entry.cachedAt;
    if (now - crTs <= ROE_TTL && entry.currentRatio !== undefined) {
      result.currentRatio = entry.currentRatio;
    }

    // 追加指標（30日TTL - 決算日近辺で無効化）
    if (!nearEarnings) {
      const extraTs = entry.extraMetricsCachedAt ?? entry.cachedAt;
      if (now - extraTs <= ROE_TTL) {
        if (entry.pegRatio !== undefined) result.pegRatio = entry.pegRatio;
        if (entry.equityRatio !== undefined) result.equityRatio = entry.equityRatio;
        if (entry.totalDebt !== undefined) result.totalDebt = entry.totalDebt;
        if (entry.profitGrowthRate !== undefined) result.profitGrowthRate = entry.profitGrowthRate;
        if (entry.prevProfitGrowthRate !== undefined) result.prevProfitGrowthRate = entry.prevProfitGrowthRate;
        if (entry.psr !== undefined) result.psr = entry.psr;
      }
    }

    // PBR（バランスシート自前計算値, 30日TTL - extraMetricsと同じタイミング）
    if (!nearEarnings) {
      const extraTs = entry.extraMetricsCachedAt ?? entry.cachedAt;
      if (now - extraTs <= ROE_TTL && entry.pbr !== undefined) {
        result.pbr = entry.pbr;
      }
    }

    // 浮動株比率（30日TTL）
    const frTs = entry.floatingRatioCachedAt ?? entry.cachedAt;
    if (now - frTs <= ROE_TTL && entry.floatingRatio !== undefined) {
      result.floatingRatio = entry.floatingRatio;
    }

    return result;
  } catch {
    return result;
  }
}

// ====================================
// Supabase フォールバック関連
// ====================================

/**
 * Supabaseからキャッシュを取得（ファイルキャッシュのフォールバック）
 * ファイルキャッシュがない場合にのみ呼び出される
 */
export async function getStatsCacheFromSupabase(symbol: string): Promise<CachedStatsAllResult> {
  const result: CachedStatsAllResult = { nc: undefined, dividend: undefined, roe: undefined, fiscalYearEnd: undefined, roeHistory: undefined, fcfHistory: undefined, currentRatio: undefined, pegRatio: undefined, equityRatio: undefined, totalDebt: undefined, profitGrowthRate: undefined, prevProfitGrowthRate: undefined, psr: undefined, pbr: undefined, floatingRatio: undefined, topixScale: undefined };

  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("stats_cache")
      .select("*")
      .eq("symbol", symbol)
      .single();

    if (error || !data) return result;

    const row = data as SupabaseStatsCacheRow;
    const now = Date.now();

    // NC率（7日TTL）
    if (row.nc_cached_at && row.nc_ratio !== null) {
      const ncTs = new Date(row.nc_cached_at).getTime();
      if (now - ncTs <= NC_TTL) {
        result.nc = row.nc_ratio;
      }
    }

    // 配当（30日TTL）
    if (row.dividend_cached_at && row.dividend_summary !== null) {
      const divTs = new Date(row.dividend_cached_at).getTime();
      if (now - divTs <= DIVIDEND_TTL) {
        result.dividend = row.dividend_summary;
      }
    }

    // ROE（30日TTL）
    if (row.roe_cached_at && row.roe !== null) {
      const roeTs = new Date(row.roe_cached_at).getTime();
      if (now - roeTs <= ROE_TTL) {
        result.roe = row.roe;
      }
    }

    // 浮動株比率（30日TTL）
    if (row.floating_ratio_cached_at && row.floating_ratio !== null) {
      const frTs = new Date(row.floating_ratio_cached_at).getTime();
      if (now - frTs <= ROE_TTL) {
        result.floatingRatio = row.floating_ratio;
      }
    }

    // 追加指標（30日TTL）
    if (row.extra_metrics_cached_at) {
      const emTs = new Date(row.extra_metrics_cached_at).getTime();
      if (now - emTs <= ROE_TTL) {
        if (row.current_ratio !== null) result.currentRatio = row.current_ratio;
        if (row.peg_ratio !== null) result.pegRatio = row.peg_ratio;
        if (row.equity_ratio !== null) result.equityRatio = row.equity_ratio;
        if (row.total_debt !== null) result.totalDebt = row.total_debt;
        if (row.profit_growth_rate !== null) result.profitGrowthRate = row.profit_growth_rate;
      }
    }

    // TOPIX規模区分（TTLなし - マスタデータは安定）
    if (row.topix_scale) {
      result.topixScale = row.topix_scale;
    }

    return result;
  } catch {
    return result;
  }
}

/**
 * Supabaseにキャッシュを保存（ファイルキャッシュと同時に呼び出す）
 * バックグラウンドで実行、失敗しても無視
 */
export async function setStatsCacheToSupabase(symbol: string, updates: StatsPartialUpdate): Promise<void> {
  try {
    const supabase = createServiceClient();
    const now = new Date().toISOString();

    const upsertData: Partial<SupabaseStatsCacheRow> & { symbol: string } = { symbol };

    if (updates.nc !== undefined) {
      upsertData.nc_ratio = updates.nc;
      upsertData.nc_cached_at = now;
    }
    if (updates.dividend !== undefined) {
      upsertData.dividend_summary = updates.dividend;
      upsertData.dividend_cached_at = now;
    }
    if (updates.roe !== undefined) {
      upsertData.roe = updates.roe;
      upsertData.roe_cached_at = now;
    }
    if (updates.floatingRatio !== undefined) {
      upsertData.floating_ratio = updates.floatingRatio;
      upsertData.floating_ratio_cached_at = now;
    }
    // 追加指標（流動比率/PEG/自己資本比率/有利子負債/増益率）
    if (updates.currentRatio !== undefined || updates.pegRatio !== undefined ||
        updates.equityRatio !== undefined || updates.totalDebt !== undefined ||
        updates.profitGrowthRate !== undefined || updates.prevProfitGrowthRate !== undefined) {
      if (updates.currentRatio !== undefined) upsertData.current_ratio = updates.currentRatio;
      if (updates.pegRatio !== undefined) upsertData.peg_ratio = updates.pegRatio;
      if (updates.equityRatio !== undefined) upsertData.equity_ratio = updates.equityRatio;
      if (updates.totalDebt !== undefined) upsertData.total_debt = updates.totalDebt;
      if (updates.profitGrowthRate !== undefined) upsertData.profit_growth_rate = updates.profitGrowthRate;
      // prevProfitGrowthRate はファイルキャッシュのみ (Supabaseカラム未追加)
      upsertData.extra_metrics_cached_at = now;
    }
    if (updates.topixScale !== undefined) {
      upsertData.topix_scale = updates.topixScale;
    }

    await supabase
      .from("stats_cache")
      .upsert(upsertData, { onConflict: "symbol" });
  } catch {
    // ignore errors - Supabase cache is best-effort
  }
}

/**
 * バッチでSupabaseからキャッシュを取得
 * デプロイ後のコールドスタート時に使用
 */
export async function getStatsCacheBatchFromSupabase(
  symbols: string[]
): Promise<Map<string, CachedStatsAllResult>> {
  const resultMap = new Map<string, CachedStatsAllResult>();

  if (symbols.length === 0) return resultMap;

  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("stats_cache")
      .select("*")
      .in("symbol", symbols);

    if (error || !data) return resultMap;

    const now = Date.now();

    for (const row of data as SupabaseStatsCacheRow[]) {
      const result: CachedStatsAllResult = { nc: undefined, dividend: undefined, roe: undefined, fiscalYearEnd: undefined, roeHistory: undefined, fcfHistory: undefined, currentRatio: undefined, pegRatio: undefined, equityRatio: undefined, totalDebt: undefined, profitGrowthRate: undefined, prevProfitGrowthRate: undefined, psr: undefined, pbr: undefined, floatingRatio: undefined, topixScale: undefined };

      // NC率（7日TTL）
      if (row.nc_cached_at && row.nc_ratio !== null) {
        const ncTs = new Date(row.nc_cached_at).getTime();
        if (now - ncTs <= NC_TTL) {
          result.nc = row.nc_ratio;
        }
      }

      // 配当（30日TTL）
      if (row.dividend_cached_at && row.dividend_summary !== null) {
        const divTs = new Date(row.dividend_cached_at).getTime();
        if (now - divTs <= DIVIDEND_TTL) {
          result.dividend = row.dividend_summary;
        }
      }

      // ROE（30日TTL）
      if (row.roe_cached_at && row.roe !== null) {
        const roeTs = new Date(row.roe_cached_at).getTime();
        if (now - roeTs <= ROE_TTL) {
          result.roe = row.roe;
        }
      }

      // 浮動株比率（30日TTL）
      if (row.floating_ratio_cached_at && row.floating_ratio !== null) {
        const frTs = new Date(row.floating_ratio_cached_at).getTime();
        if (now - frTs <= ROE_TTL) {
          result.floatingRatio = row.floating_ratio;
        }
      }

      // 追加指標（30日TTL）
      if (row.extra_metrics_cached_at) {
        const emTs = new Date(row.extra_metrics_cached_at).getTime();
        if (now - emTs <= ROE_TTL) {
          if (row.current_ratio !== null) result.currentRatio = row.current_ratio;
          if (row.peg_ratio !== null) result.pegRatio = row.peg_ratio;
          if (row.equity_ratio !== null) result.equityRatio = row.equity_ratio;
          if (row.total_debt !== null) result.totalDebt = row.total_debt;
          if (row.profit_growth_rate !== null) result.profitGrowthRate = row.profit_growth_rate;
        }
      }

      // TOPIX規模区分（TTLなし）
      if (row.topix_scale) {
        result.topixScale = row.topix_scale;
      }

      resultMap.set(row.symbol, result);
    }

    return resultMap;
  } catch {
    return resultMap;
  }
}

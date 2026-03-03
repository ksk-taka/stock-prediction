/**
 * ターンアラウンド（営業赤字→黒字転換）検出モジュール
 *
 * ピーター・リンチの投資手法に基づき、営業利益の符号反転を検出する。
 * Pattern A: 前期の営業利益 < 0 かつ 今期の営業利益 > 0（確定実績ベース）
 *
 * データソース:
 *   1. Yahoo Finance fundamentalsTimeSeries (annual, ~6年分) - primary
 *   2. Yahoo Finance quoteSummary incomeStatementHistory (~4年分) - fallback
 *   3. EDINET XBRL cache - supplementary
 */

import YahooFinance from "yahoo-finance2";
import { yfQueue } from "@/lib/utils/requestQueue";
import {
  readCache,
  writeCache,
  TTL,
} from "@/lib/cache/cacheUtils";

const yf = new YahooFinance();

const CACHE_SUBDIR = "turnaround";
const CACHE_SUFFIX = "_income";

// ── 型定義 ──

export interface IncomeStatementYear {
  endDate: string;           // "2024-03-31"
  fiscalYear: number;        // 決算期末の年
  operatingIncome: number;   // 営業利益（負値あり）
  totalRevenue: number;      // 売上高
  netIncome: number;         // 当期純利益
}

export interface TurnaroundDetection {
  turnaroundFiscalYear: number;
  consecutiveLossYears: number;
  priorLossAmount: number;        // 最終赤字期のOP
  turnaroundProfitAmount: number; // 黒転期のOP
  revenueGrowthPct: number | null;
  turnaroundDate: string;         // 決算期末日
}

export interface TurnaroundResult extends TurnaroundDetection {
  symbol: string;
  name: string;
  pattern: "A" | "B-1" | "B-2";
  marketSegment: string | null;
  sectors: string[];
  marketCap: number | null;       // 億円
  currentPrice: number | null;
  per: number | null;
  pbr: number | null;
  incomeHistory: IncomeStatementYear[];
}

export interface TurnaroundScreenerOptions {
  minConsecutiveLoss: number;           // default: 2
  maxConsecutiveLoss: number;           // default: Infinity
  requireRevenueGrowth: boolean;        // default: false
  maxMarketCapBillionYen: number | null; // default: null (no filter)
  maxPriceYen: number | null;           // default: null (no filter)
}

export const DEFAULT_OPTIONS: TurnaroundScreenerOptions = {
  minConsecutiveLoss: 2,
  maxConsecutiveLoss: Infinity,
  requireRevenueGrowth: false,
  maxMarketCapBillionYen: null,
  maxPriceYen: null,
};

// ── 営業利益履歴の取得 ──

/**
 * fundamentalsTimeSeries (annual, financials) から営業利益・売上・純利益を取得
 * roeHistory.ts のパターンを踏襲
 */
async function fetchFromFundamentalsTimeSeries(
  symbol: string
): Promise<IncomeStatementYear[]> {
  const period1 = new Date();
  period1.setFullYear(period1.getFullYear() - 8); // 余裕をもって8年分

  const financials = await yfQueue.add(() =>
    yf.fundamentalsTimeSeries(symbol, {
      period1,
      type: "annual" as const,
      module: "financials" as const,
    })
  ).catch(() => []);

  if (!financials?.length) return [];

  const results: IncomeStatementYear[] = [];
  for (const row of financials) {
    const rec = row as Record<string, unknown>;
    const dateField = rec.date ?? rec.asOfDate;
    if (!dateField) continue;

    const endDate = new Date(dateField as string | number);
    const fiscalYear = endDate.getFullYear();

    const operatingIncome =
      (rec.annualOperatingIncome as number) ??
      (rec.operatingIncome as number) ??
      (rec.annualEbit as number) ??
      (rec.ebit as number) ??
      null;

    const totalRevenue =
      (rec.annualTotalRevenue as number) ??
      (rec.totalRevenue as number) ??
      0;

    const netIncome =
      (rec.annualNetIncome as number) ??
      (rec.netIncome as number) ??
      0;

    if (operatingIncome != null) {
      results.push({
        endDate: endDate.toISOString().split("T")[0],
        fiscalYear,
        operatingIncome,
        totalRevenue,
        netIncome,
      });
    }
  }

  return results;
}

/**
 * quoteSummary incomeStatementHistory (annual) からフォールバック取得
 * yahooFinance.ts:416 のパターンを踏襲
 */
async function fetchFromIncomeStatementHistory(
  symbol: string
): Promise<IncomeStatementYear[]> {
  const isResult = await yfQueue.add(() =>
    yf.quoteSummary(symbol, { modules: ["incomeStatementHistory"] })
  ).catch(() => null);

  const statements = isResult?.incomeStatementHistory?.incomeStatementHistory;
  if (!statements?.length) return [];

  const results: IncomeStatementYear[] = [];
  for (const stmt of statements) {
    const rec = stmt as unknown as Record<string, unknown>;
    const endDateRaw = rec.endDate;
    if (!endDateRaw) continue;

    const endDate = endDateRaw instanceof Date
      ? endDateRaw
      : new Date(endDateRaw as string | number);
    const fiscalYear = endDate.getFullYear();

    const operatingIncome =
      (rec.operatingIncome as number) ??
      (rec.ebit as number) ??
      null;

    const totalRevenue = (rec.totalRevenue as number) ?? 0;
    const netIncome = (rec.netIncome as number) ?? 0;

    if (operatingIncome != null) {
      results.push({
        endDate: endDate.toISOString().split("T")[0],
        fiscalYear,
        operatingIncome,
        totalRevenue,
        netIncome,
      });
    }
  }

  return results;
}

/**
 * 年次営業利益履歴を取得（キャッシュ付き）
 * 1. fundamentalsTimeSeries (primary, ~6年分)
 * 2. incomeStatementHistory (fallback, ~4年分)
 * 3. EDINET XBRL cache (supplementary)
 */
export async function fetchIncomeHistory(
  symbol: string
): Promise<IncomeStatementYear[]> {
  // キャッシュチェック
  const cached = readCache<IncomeStatementYear[]>(
    CACHE_SUBDIR,
    symbol,
    CACHE_SUFFIX,
    TTL.DAYS_30
  );
  if (cached) return cached.data;

  // Primary: fundamentalsTimeSeries
  let history = await fetchFromFundamentalsTimeSeries(symbol);

  // Fallback: incomeStatementHistory
  if (history.length < 2) {
    const fallback = await fetchFromIncomeStatementHistory(symbol);
    if (fallback.length > history.length) {
      history = fallback;
    }
  }

  // EDINET XBRL cache 補完
  try {
    const { getCachedEdinetFinancials } = await import("@/lib/cache/edinetCache");
    const edinet = getCachedEdinetFinancials(symbol);
    if (
      edinet?.operatingIncome != null &&
      edinet?.netSales != null &&
      edinet?.fiscalYearEnd
    ) {
      const edinetYear = new Date(edinet.fiscalYearEnd).getFullYear();
      const hasYear = history.some((h) => h.fiscalYear === edinetYear);
      if (!hasYear) {
        history.push({
          endDate: edinet.fiscalYearEnd,
          fiscalYear: edinetYear,
          operatingIncome: edinet.operatingIncome,
          totalRevenue: edinet.netSales ?? 0,
          netIncome: edinet.netIncome ?? 0,
        });
      }
    }
  } catch {
    /* EDINET cache not available */
  }

  // 古い順にソート
  history.sort((a, b) => a.fiscalYear - b.fiscalYear);

  // 同一年の重複排除（fundamentalsTimeSeries 優先）
  const seen = new Set<number>();
  history = history.filter((h) => {
    if (seen.has(h.fiscalYear)) return false;
    seen.add(h.fiscalYear);
    return true;
  });

  // キャッシュ保存
  if (history.length > 0) {
    writeCache(CACHE_SUBDIR, symbol, history, CACHE_SUFFIX);
  }

  return history;
}

// ── ターンアラウンド検出 ──

/**
 * 営業利益履歴からターンアラウンドを検出（純粋関数、I/Oなし）
 *
 * 古い順にソートされた履歴を走査し、直近の赤字→黒字転換を見つける。
 * 最も新しい転換を返す（複数転換がある場合）。
 */
export function detectTurnaround(
  history: IncomeStatementYear[],
  options: TurnaroundScreenerOptions = DEFAULT_OPTIONS
): TurnaroundDetection | null {
  if (history.length < 2) return null;

  // 古い順にソート済みを前提（呼び出し側で保証）
  // 最新の転換を見つけるため、新しい方から走査
  for (let i = history.length - 1; i >= 1; i--) {
    const current = history[i];
    const prior = history[i - 1];

    // 黒字転換: 前年赤字 → 今年黒字
    if (prior.operatingIncome < 0 && current.operatingIncome > 0) {
      // 連続赤字年数をカウント
      let consecutiveLossYears = 1;
      for (let j = i - 2; j >= 0; j--) {
        if (history[j].operatingIncome < 0) {
          consecutiveLossYears++;
        } else {
          break;
        }
      }

      // フィルタ: 連続赤字年数
      if (
        consecutiveLossYears < options.minConsecutiveLoss ||
        consecutiveLossYears > options.maxConsecutiveLoss
      ) {
        continue; // この転換は条件外、次を探す
      }

      // 売上成長率
      let revenueGrowthPct: number | null = null;
      if (prior.totalRevenue > 0) {
        revenueGrowthPct =
          Math.round(
            ((current.totalRevenue - prior.totalRevenue) / prior.totalRevenue) * 1000
          ) / 10;
      }

      // フィルタ: 増収黒字転換
      if (
        options.requireRevenueGrowth &&
        (revenueGrowthPct == null || revenueGrowthPct <= 0)
      ) {
        continue;
      }

      return {
        turnaroundFiscalYear: current.fiscalYear,
        consecutiveLossYears,
        priorLossAmount: prior.operatingIncome,
        turnaroundProfitAmount: current.operatingIncome,
        revenueGrowthPct,
        turnaroundDate: current.endDate,
      };
    }
  }

  return null;
}

// ── フルスクリーニングパイプライン ──

/**
 * 単一銘柄のターンアラウンドスクリーニング
 * 取得 → 検出 → quote enrichment
 */
export async function screenTurnaround(
  symbol: string,
  name: string,
  marketSegment: string | null,
  sectors: string[],
  options: TurnaroundScreenerOptions = DEFAULT_OPTIONS
): Promise<TurnaroundResult | null> {
  try {
    const history = await fetchIncomeHistory(symbol);
    const detection = detectTurnaround(history, options);
    if (!detection) return null;

    // quote データ取得（時価総額、株価、PER、PBR）
    let marketCap: number | null = null;
    let currentPrice: number | null = null;
    let per: number | null = null;
    let pbr: number | null = null;

    try {
      const quote = await yfQueue.add(() => yf.quote(symbol));
      const q = quote as Record<string, unknown>;
      currentPrice = (q.regularMarketPrice as number) ?? null;
      marketCap = (q.marketCap as number) ?? null;
      per = (q.trailingPE as number) ?? null;
      pbr = (q.priceToBook as number) ?? null;
    } catch {
      /* quote取得失敗はnullのまま */
    }

    // フィルタ: 時価総額
    if (
      options.maxMarketCapBillionYen != null &&
      marketCap != null
    ) {
      const mcapBillion = marketCap / 1e8;
      if (mcapBillion > options.maxMarketCapBillionYen) return null;
    }

    // フィルタ: 株価
    if (
      options.maxPriceYen != null &&
      currentPrice != null &&
      currentPrice > options.maxPriceYen
    ) {
      return null;
    }

    return {
      symbol,
      name,
      pattern: "A",
      marketSegment,
      sectors,
      marketCap: marketCap != null ? Math.round(marketCap / 1e8) : null,
      currentPrice,
      per: per != null ? Math.round(per * 10) / 10 : null,
      pbr: pbr != null ? Math.round(pbr * 100) / 100 : null,
      incomeHistory: history,
      ...detection,
    };
  } catch {
    return null;
  }
}

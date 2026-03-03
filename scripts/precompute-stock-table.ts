#!/usr/bin/env npx tsx
// ============================================================
// 株式テーブルデータ事前計算
// 全上場銘柄の StockTableRow を構築 → Supabase 保存
// クライアントは /api/stock-table/precomputed から一括取得可能
//
// 使い方:
//   npx tsx scripts/precompute-stock-table.ts                  # ローカル実行 (DB保存なし)
//   npx tsx scripts/precompute-stock-table.ts --supabase       # Supabase保存 (GHA用)
//   npx tsx scripts/precompute-stock-table.ts --favorites-only # お気に入りのみ
//   npx tsx scripts/precompute-stock-table.ts --dry-run        # DB書込みなし
// ============================================================

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getQuoteBatch, getFinancialMetrics, getDividendHistory, computeDividendSummary } from "@/lib/api/yahooFinance";
import { getCachedStatsAll, setCachedStatsPartial, getStatsCacheBatchFromSupabase, type StatsPartialUpdate } from "@/lib/cache/statsCache";
import { getCachedYutaiBatch, getYutaiFromSupabase } from "@/lib/cache/yutaiCache";
import { getRoeHistory } from "@/lib/api/roeHistory";
import { getFcfHistory } from "@/lib/api/fcfHistory";
import { calcMultiPeriodSharpe } from "@/lib/utils/indicators";
import { getCachedMaster } from "@/lib/cache/jquantsCache";
import { NIKKEI225_CODES } from "@/data/nikkei225";
import { getCachedEdinetFinancials } from "@/lib/cache/edinetCache";
import { getBuybackCodesWithFallback } from "@/lib/cache/buybackCache";
import { getBuybackDetailBatchWithFallback } from "@/lib/cache/buybackDetailCache";
import type { StockTableRow } from "@/lib/cache/tableCache";
import type { DividendSummary, PriceData } from "@/types";
import type { BuybackDetail } from "@/types/buyback";
import { getArgs, hasFlag } from "@/lib/utils/cli";

// ── 設定 ──

const BATCH_SIZE = 50; // API route.ts と同じ
const UPSERT_BATCH_SIZE = 100;

// ── CLI引数 ──

interface CLIArgs {
  supabase: boolean;
  favoritesOnly: boolean;
  dryRun: boolean;
}

function parseCliArgs(): CLIArgs {
  const args = getArgs();
  return {
    supabase: hasFlag(args, "--supabase"),
    favoritesOnly: hasFlag(args, "--favorites-only"),
    dryRun: hasFlag(args, "--dry-run"),
  };
}

// ── ユーティリティ ──

function createServiceClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

interface PriceBar {
  date: string;
  high: number;
  low: number;
}

function computeRanges(prices: PriceBar[]) {
  if (!prices || prices.length === 0) {
    return {
      weekHigh: null, weekLow: null,
      monthHigh: null, monthLow: null,
      lastYearHigh: null, lastYearLow: null,
    };
  }
  const now = new Date();
  const currentYear = now.getFullYear();
  const lastWeek = prices.slice(-5);
  const lastMonth = prices.slice(-22);
  const lastYearBars = prices.filter((p) => new Date(p.date).getFullYear() === currentYear - 1);
  const highLow = (bars: PriceBar[]) =>
    bars.length > 0
      ? { high: Math.max(...bars.map((b) => b.high)), low: Math.min(...bars.map((b) => b.low)) }
      : { high: null as number | null, low: null as number | null };
  const week = highLow(lastWeek);
  const month = highLow(lastMonth);
  const lastYear = highLow(lastYearBars);
  return {
    weekHigh: week.high, weekLow: week.low,
    monthHigh: month.high, monthLow: month.low,
    lastYearHigh: lastYear.high, lastYearLow: lastYear.low,
  };
}

function businessDaysBefore(dateStr: string, n: number): string | null {
  const normalized = dateStr.replace(/\//g, "-");
  const d = new Date(normalized);
  if (isNaN(d.getTime())) return null;
  let remaining = n;
  while (remaining > 0) {
    d.setDate(d.getDate() - 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) remaining--;
  }
  return d.toISOString().slice(0, 10);
}

function daysUntil(dateStr: string): number {
  const normalized = dateStr.replace(/\//g, "-");
  const target = new Date(normalized);
  if (isNaN(target.getTime())) return -9999;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
}

// ── Supabase から全銘柄取得 ──

interface StockInfo {
  symbol: string;
  name: string;
}

async function getAllStocks(supabase: SupabaseClient, favoritesOnly: boolean): Promise<StockInfo[]> {
  const PAGE_SIZE = 1000;
  const allStocks: StockInfo[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase
      .from("stocks")
      .select("symbol, name")
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (favoritesOnly) {
      query = query.eq("favorite", true);
    }

    const { data, error } = await query;
    if (error) throw error;
    const rows = (data ?? []) as Array<{ symbol: string; name: string }>;
    for (const r of rows) {
      allStocks.push({ symbol: r.symbol, name: r.name });
    }
    if (rows.length < PAGE_SIZE) break;
  }
  return allStocks;
}

// ── バッチで StockTableRow を構築 ──

async function buildRowsForBatch(
  symbols: string[],
  supabase: SupabaseClient,
  topixMap: Map<string, string>,
  buybackSet: Set<string> | null,
): Promise<StockTableRow[]> {
  // 1. Yahoo Finance バッチquote
  let quotes: Awaited<ReturnType<typeof getQuoteBatch>> = [];
  try {
    quotes = await getQuoteBatch(symbols);
  } catch (e: unknown) {
    const code = (e as { code?: number }).code;
    if (code === 429) {
      console.warn(`  [YF 429] rate limit, continuing with cached data`);
    } else {
      throw e;
    }
  }
  const quoteMap = new Map(quotes.map((q) => [q.symbol, q]));

  // 2. Supabase price_history → レンジ + シャープレシオ
  const rangeMap = new Map<string, ReturnType<typeof computeRanges>>();
  const sharpe3mMap = new Map<string, number | null>();
  const sharpe6mMap = new Map<string, number | null>();
  const sharpe1yMap = new Map<string, number | null>();
  try {
    const { data: priceRows } = await supabase
      .from("price_history")
      .select("symbol, prices")
      .eq("timeframe", "daily")
      .in("symbol", symbols);
    if (priceRows) {
      for (const row of priceRows) {
        const prices: PriceData[] = typeof row.prices === "string" ? JSON.parse(row.prices) : row.prices;
        rangeMap.set(row.symbol, computeRanges(prices));
        const sr = calcMultiPeriodSharpe(prices);
        sharpe3mMap.set(row.symbol, sr.sharpe3m);
        sharpe6mMap.set(row.symbol, sr.sharpe6m);
        sharpe1yMap.set(row.symbol, sr.sharpe1y);
      }
    }
  } catch { /* skip */ }

  // 3. statsCache (ファイル → Supabaseフォールバック)
  const ncMap = new Map<string, number | null>();
  const divMap = new Map<string, DividendSummary | null>();
  const roeMap = new Map<string, number | null>();
  const fyeMap = new Map<string, string | null>();
  const currentRatioMap = new Map<string, number | null>();
  const pegRatioMap = new Map<string, number | null>();
  const equityRatioMap = new Map<string, number | null>();
  const totalDebtMap = new Map<string, number | null>();
  const profitGrowthMap = new Map<string, number | null>();
  const prevProfitGrowthMap = new Map<string, number | null>();
  const revenueGrowthMap = new Map<string, number | null>();
  const operatingMarginsMap = new Map<string, number | null>();
  const psrMap = new Map<string, number | null>();
  const pbrMap = new Map<string, number | null>();
  const floatingRatioMap = new Map<string, number | null>();
  const metricsMissing: { sym: string; marketCap: number }[] = [];
  const divMissing: string[] = [];
  const supabaseFallbackNeeded: string[] = [];

  for (const sym of symbols) {
    const quote = quoteMap.get(sym);
    const cached = getCachedStatsAll(sym, quote?.earningsDate);

    const ncHit = cached.nc !== undefined;
    const roeHit = cached.roe !== undefined;
    const divHit = cached.dividend !== undefined;
    const fyeHit = cached.fiscalYearEnd !== undefined;
    const crHit = cached.currentRatio !== undefined;
    const pegHit = cached.pegRatio !== undefined;
    const eqHit = cached.equityRatio !== undefined;
    const tdHit = cached.totalDebt !== undefined;
    const pgHit = cached.profitGrowthRate !== undefined;

    if (ncHit) ncMap.set(sym, cached.nc ?? null);
    if (roeHit) roeMap.set(sym, cached.roe ?? null);
    if (divHit) divMap.set(sym, cached.dividend ?? null);
    if (fyeHit) fyeMap.set(sym, cached.fiscalYearEnd ?? null);
    if (crHit) currentRatioMap.set(sym, cached.currentRatio ?? null);
    if (pegHit) pegRatioMap.set(sym, cached.pegRatio ?? null);
    if (eqHit) equityRatioMap.set(sym, cached.equityRatio ?? null);
    if (tdHit) totalDebtMap.set(sym, cached.totalDebt ?? null);
    if (pgHit) profitGrowthMap.set(sym, cached.profitGrowthRate ?? null);
    if (cached.prevProfitGrowthRate !== undefined) prevProfitGrowthMap.set(sym, cached.prevProfitGrowthRate ?? null);
    if (cached.revenueGrowth !== undefined) revenueGrowthMap.set(sym, cached.revenueGrowth ?? null);
    if (cached.operatingMargins !== undefined) operatingMarginsMap.set(sym, cached.operatingMargins ?? null);
    if (cached.psr !== undefined) psrMap.set(sym, cached.psr ?? null);
    if (cached.pbr !== undefined) pbrMap.set(sym, cached.pbr ?? null);
    if (cached.floatingRatio !== undefined) floatingRatioMap.set(sym, cached.floatingRatio ?? null);

    if (!ncHit || !roeHit || !divHit || !floatingRatioMap.has(sym) || !pgHit || !crHit || !pegHit || !eqHit || !tdHit) {
      supabaseFallbackNeeded.push(sym);
    }
  }

  // Supabaseフォールバック
  if (supabaseFallbackNeeded.length > 0) {
    const supabaseCache = await getStatsCacheBatchFromSupabase(supabaseFallbackNeeded);
    for (const sym of supabaseFallbackNeeded) {
      const sbCache = supabaseCache.get(sym);
      if (sbCache) {
        if (!ncMap.has(sym) && sbCache.nc !== undefined) ncMap.set(sym, sbCache.nc ?? null);
        if (!roeMap.has(sym) && sbCache.roe !== undefined) roeMap.set(sym, sbCache.roe ?? null);
        if (!divMap.has(sym) && sbCache.dividend !== undefined) divMap.set(sym, sbCache.dividend);
        if (!floatingRatioMap.has(sym) && sbCache.floatingRatio !== undefined) floatingRatioMap.set(sym, sbCache.floatingRatio ?? null);
        if (!currentRatioMap.has(sym) && sbCache.currentRatio !== undefined) currentRatioMap.set(sym, sbCache.currentRatio ?? null);
        if (!pegRatioMap.has(sym) && sbCache.pegRatio !== undefined) pegRatioMap.set(sym, sbCache.pegRatio ?? null);
        if (!equityRatioMap.has(sym) && sbCache.equityRatio !== undefined) equityRatioMap.set(sym, sbCache.equityRatio ?? null);
        if (!totalDebtMap.has(sym) && sbCache.totalDebt !== undefined) totalDebtMap.set(sym, sbCache.totalDebt ?? null);
        if (!profitGrowthMap.has(sym) && sbCache.profitGrowthRate !== undefined) profitGrowthMap.set(sym, sbCache.profitGrowthRate ?? null);
        if (!prevProfitGrowthMap.has(sym) && sbCache.prevProfitGrowthRate !== undefined) prevProfitGrowthMap.set(sym, sbCache.prevProfitGrowthRate ?? null);
        if (!revenueGrowthMap.has(sym) && sbCache.revenueGrowth !== undefined) revenueGrowthMap.set(sym, sbCache.revenueGrowth ?? null);
        if (!operatingMarginsMap.has(sym) && sbCache.operatingMargins !== undefined) operatingMarginsMap.set(sym, sbCache.operatingMargins ?? null);
        if (!topixMap.has(sym) && sbCache.topixScale) topixMap.set(sym, sbCache.topixScale);
      }
    }
  }

  // API取得対象の判定
  for (const sym of symbols) {
    const quote = quoteMap.get(sym);
    const ncHit = ncMap.has(sym);
    const roeHit = roeMap.has(sym);
    const pegHit2 = pegRatioMap.has(sym);
    const eqHit2 = equityRatioMap.has(sym);
    const tdHit2 = totalDebtMap.has(sym);
    const pgHit2 = profitGrowthMap.has(sym);

    if (!ncHit || !roeHit || !pegHit2 || !eqHit2 || !tdHit2 || !pgHit2) {
      const mc = quote?.marketCap ?? 0;
      if (mc > 0) {
        metricsMissing.push({ sym, marketCap: mc });
      } else {
        if (!ncHit) ncMap.set(sym, null);
        if (!roeHit) roeMap.set(sym, null);
        if (!pegHit2) pegRatioMap.set(sym, null);
        if (!eqHit2) equityRatioMap.set(sym, null);
        if (!tdHit2) totalDebtMap.set(sym, null);
        if (!pgHit2) profitGrowthMap.set(sym, null);
      }
    }
    if (!divMap.has(sym)) divMissing.push(sym);
  }

  // 4. キャッシュミス分をYFから並列取得
  const cacheUpdates = new Map<string, StatsPartialUpdate>();
  const [metricsResults, divResults] = await Promise.all([
    metricsMissing.length > 0
      ? Promise.allSettled(metricsMissing.map(async ({ sym, marketCap }) => {
          const metrics = await getFinancialMetrics(sym, marketCap);
          return { sym, ...metrics };
        }))
      : [],
    divMissing.length > 0
      ? Promise.allSettled(divMissing.map(async (sym) => {
          const hist = await getDividendHistory(sym);
          const summary = hist.length > 0 ? computeDividendSummary(hist) : null;
          return { sym, summary };
        }))
      : [],
  ]);

  for (const r of metricsResults) {
    if (r.status === "fulfilled") {
      const { sym, ncRatio, roe, fiscalYearEnd, currentRatio, pegRatio, equityRatio, totalDebt, profitGrowthRate, prevProfitGrowthRate, psr: metricsPsr, pbr: metricsPbr, revenueGrowth, operatingMargins } = r.value;
      ncMap.set(sym, ncRatio);
      roeMap.set(sym, roe);
      fyeMap.set(sym, fiscalYearEnd);
      currentRatioMap.set(sym, currentRatio);
      pegRatioMap.set(sym, pegRatio);
      equityRatioMap.set(sym, equityRatio);
      totalDebtMap.set(sym, totalDebt);
      profitGrowthMap.set(sym, profitGrowthRate);
      prevProfitGrowthMap.set(sym, prevProfitGrowthRate);
      psrMap.set(sym, metricsPsr);
      pbrMap.set(sym, metricsPbr);
      revenueGrowthMap.set(sym, revenueGrowth);
      operatingMarginsMap.set(sym, operatingMargins);
      const update = cacheUpdates.get(sym) ?? {};
      update.nc = ncRatio; update.roe = roe; update.fiscalYearEnd = fiscalYearEnd;
      update.currentRatio = currentRatio; update.pegRatio = pegRatio;
      update.equityRatio = equityRatio; update.totalDebt = totalDebt;
      update.profitGrowthRate = profitGrowthRate; update.prevProfitGrowthRate = prevProfitGrowthRate;
      update.psr = metricsPsr; update.pbr = metricsPbr;
      update.revenueGrowth = revenueGrowth; update.operatingMargins = operatingMargins;
      cacheUpdates.set(sym, update);
    }
  }
  for (const r of divResults) {
    if (r.status === "fulfilled") {
      divMap.set(r.value.sym, r.value.summary);
      const update = cacheUpdates.get(r.value.sym) ?? {};
      update.dividend = r.value.summary;
      cacheUpdates.set(r.value.sym, update);
    }
  }

  // キャッシュ書き込み
  for (const [sym, update] of cacheUpdates) {
    setCachedStatsPartial(sym, update);
  }

  // 5. 優待
  const yutaiMap = getCachedYutaiBatch(symbols);
  const yutaiMissing = symbols.filter((s) => !yutaiMap.has(s));
  if (yutaiMissing.length > 0) {
    const sbYutai = await getYutaiFromSupabase(yutaiMissing);
    for (const [sym, info] of sbYutai) {
      yutaiMap.set(sym, info);
    }
  }

  // 6. ROE推移 + FCF推移
  const roeHistoryMap = new Map<string, { year: number; roe: number }[] | null>();
  const fcfHistoryMap = new Map<string, { year: number; fcf: number; ocf: number; capex: number }[] | null>();
  const roeHistMissing: string[] = [];
  const fcfHistMissing: string[] = [];

  for (const sym of symbols) {
    const quote = quoteMap.get(sym);
    const cached = getCachedStatsAll(sym, quote?.earningsDate);
    if (cached.roeHistory !== undefined) {
      roeHistoryMap.set(sym, cached.roeHistory);
    } else {
      roeHistMissing.push(sym);
    }
    if (cached.fcfHistory !== undefined) {
      fcfHistoryMap.set(sym, cached.fcfHistory);
    } else {
      fcfHistMissing.push(sym);
    }
  }

  const [roeHistSettled, fcfHistSettled] = await Promise.all([
    roeHistMissing.length > 0
      ? Promise.allSettled(roeHistMissing.map(async (sym) => {
          const history = await getRoeHistory(sym);
          return { sym, history: history.length > 0 ? history : null };
        }))
      : [],
    fcfHistMissing.length > 0
      ? Promise.allSettled(fcfHistMissing.map(async (sym) => {
          const history = await getFcfHistory(sym);
          return { sym, history: history.length > 0 ? history : null };
        }))
      : [],
  ]);

  for (const r of roeHistSettled) {
    if (r.status === "fulfilled") {
      roeHistoryMap.set(r.value.sym, r.value.history);
      setCachedStatsPartial(r.value.sym, { roeHistory: r.value.history });
    }
  }
  for (const r of fcfHistSettled) {
    if (r.status === "fulfilled") {
      fcfHistoryMap.set(r.value.sym, r.value.history);
      setCachedStatsPartial(r.value.sym, { fcfHistory: r.value.history });
    }
  }

  // 7. 自社株買い詳細
  const buybackDetailMap = new Map<string, BuybackDetail>();
  try {
    const codes = symbols.map((s) => s.replace(".T", ""));
    const detailBatch = await getBuybackDetailBatchWithFallback(codes);
    for (const [code, detail] of detailBatch) {
      buybackDetailMap.set(code, detail);
    }
  } catch { /* ignore */ }

  // 8. 行組み立て
  return symbols.map((sym) => {
    const q = quoteMap.get(sym);
    const r = rangeMap.get(sym);
    const yutai = yutaiMap.get(sym);
    const code = sym.replace(".T", "");

    let sellRecommendDate: string | null = null;
    let daysUntilSellVal: number | null = null;
    if (yutai?.recordDate) {
      sellRecommendDate = businessDaysBefore(yutai.recordDate, 2);
      if (sellRecommendDate) daysUntilSellVal = daysUntil(sellRecommendDate);
    }

    return {
      symbol: sym,
      name: q?.name ?? sym,
      price: q?.price ?? 0,
      changePercent: q?.changePercent ?? 0,
      volume: q?.volume ?? 0,
      per: q?.per ?? null,
      eps: q?.eps ?? null,
      pbr: pbrMap.get(sym) ?? q?.pbr ?? null,
      simpleNcRatio: ncMap.get(sym) ?? null,
      cnPer: null, // クライアント側で計算
      marketCap: q?.marketCap ?? null,
      dayHigh: q?.dayHigh ?? null,
      dayLow: q?.dayLow ?? null,
      weekHigh: r?.weekHigh ?? null,
      weekLow: r?.weekLow ?? null,
      monthHigh: r?.monthHigh ?? null,
      monthLow: r?.monthLow ?? null,
      yearHigh: q?.yearHigh ?? null,
      yearLow: q?.yearLow ?? null,
      lastYearHigh: r?.lastYearHigh ?? null,
      lastYearLow: r?.lastYearLow ?? null,
      earningsDate: q?.earningsDate ?? null,
      fiscalYearEnd: fyeMap.get(sym) ?? null,
      sharpe3m: sharpe3mMap.get(sym) ?? null,
      sharpe6m: sharpe6mMap.get(sym) ?? null,
      sharpe1y: sharpe1yMap.get(sym) ?? null,
      roe: roeMap.get(sym) ?? null,
      latestDividend: divMap.get(sym)?.latestAmount ?? null,
      previousDividend: divMap.get(sym)?.previousAmount ?? null,
      latestIncrease: divMap.get(sym)?.latestIncrease ?? null,
      hasYutai: yutai?.hasYutai ?? null,
      yutaiContent: yutai?.content ?? null,
      recordDate: yutai?.recordDate ?? null,
      sellRecommendDate,
      daysUntilSell: daysUntilSellVal,
      dividendYield: q?.dividendYield ?? null,
      roeHistory: roeHistoryMap.get(sym) ?? null,
      fcfHistory: fcfHistoryMap.get(sym) ?? null,
      currentRatio: currentRatioMap.get(sym) ?? null,
      psr: q?.psr ?? psrMap.get(sym) ?? (() => {
        if (q?.marketCap && q.marketCap > 0) {
          try {
            const edinet = getCachedEdinetFinancials(sym);
            if (edinet?.netSales && edinet.netSales > 0) {
              return Math.round((q.marketCap / edinet.netSales) * 100) / 100;
            }
          } catch { /* ignore */ }
        }
        return null;
      })(),
      pegRatio: pegRatioMap.get(sym) ?? (() => {
        const per = q?.per;
        const growth = profitGrowthMap.get(sym);
        if (per != null && per > 0 && growth != null && growth > 0) {
          const peg = per / growth;
          if (peg > 0 && peg < 100) return Math.round(peg * 100) / 100;
        }
        return null;
      })(),
      equityRatio: equityRatioMap.get(sym) ?? null,
      totalDebt: totalDebtMap.get(sym) ?? null,
      profitGrowthRate: profitGrowthMap.get(sym) ?? null,
      prevProfitGrowthRate: prevProfitGrowthMap.get(sym) ?? null,
      revenueGrowth: revenueGrowthMap.get(sym) ?? null,
      operatingMargins: operatingMarginsMap.get(sym) ?? null,
      topixScale: topixMap.get(sym) ?? null,
      isNikkei225: NIKKEI225_CODES.has(code),
      firstTradeDate: q?.firstTradeDate ?? null,
      sharesOutstanding: q?.sharesOutstanding ?? null,
      floatingRatio: floatingRatioMap.get(sym) ?? null,
      floatingMarketCap: (() => {
        const fr = floatingRatioMap.get(sym);
        const so = q?.sharesOutstanding;
        const price = q?.price;
        if (fr != null && so && price) return price * so * fr;
        return null;
      })(),
      hasBuyback: buybackSet ? buybackSet.has(code) : null,
      ...(() => {
        const bd = buybackDetailMap.get(code);
        if (!bd) return {
          buybackProgressAmount: null, buybackProgressShares: null,
          buybackImpactDays: null, buybackMaxAmount: null,
          buybackCumulativeAmount: null, buybackRemainingShares: null,
          buybackPeriodTo: null, buybackIsActive: null,
        };
        const maxS = bd.latestReport?.maxShares ?? null;
        const cumS = bd.latestReport?.cumulativeShares ?? null;
        const remaining = maxS != null && cumS != null ? maxS - cumS : null;
        const avgVol = q?.averageDailyVolume3Month ?? null;
        let impact: number | null = null;
        if (remaining != null && remaining > 0 && avgVol != null && avgVol > 0) {
          impact = Math.ceil(remaining / (avgVol * 0.25));
        }
        return {
          buybackProgressAmount: bd.progressAmount,
          buybackProgressShares: bd.progressShares,
          buybackImpactDays: impact,
          buybackMaxAmount: bd.latestReport?.maxAmount ?? null,
          buybackCumulativeAmount: bd.latestReport?.cumulativeAmount ?? null,
          buybackRemainingShares: remaining,
          buybackPeriodTo: bd.latestReport?.acquisitionPeriodTo ?? null,
          buybackIsActive: bd.isActive,
        };
      })(),
    } as StockTableRow;
  });
}

// ── メイン ──

async function main() {
  const cli = parseCliArgs();
  const startTime = Date.now();

  console.log("=== Stock Table Pre-compute ===");
  console.log(`  supabase: ${cli.supabase}`);
  console.log(`  favorites-only: ${cli.favoritesOnly}`);
  console.log(`  dry-run: ${cli.dryRun}`);

  const supabase = createServiceClient();

  // 全銘柄取得
  const stocks = await getAllStocks(supabase, cli.favoritesOnly);
  console.log(`\n  ${stocks.length} stocks loaded`);

  // TOPIX マップ構築
  const topixMap = new Map<string, string>();
  const masterData = getCachedMaster("all");
  if (masterData) {
    for (const item of masterData) {
      const code = item.Code.slice(0, 4);
      const sym = `${code}.T`;
      if (item.ScaleCat && item.ScaleCat !== "-") topixMap.set(sym, item.ScaleCat);
    }
    console.log(`  TOPIX master: ${topixMap.size} symbols`);
  } else {
    // GHA環境: Supabase stats_cacheからTOPIXデータ取得
    console.log("  TOPIX master: file cache not available, will use Supabase fallback");
  }

  // 自社株買いコード一括取得
  const buybackSet = await getBuybackCodesWithFallback();
  console.log(`  Buyback codes: ${buybackSet?.size ?? 0}`);

  // バッチ処理
  const allSymbols = stocks.map((s) => s.symbol);
  const totalBatches = Math.ceil(allSymbols.length / BATCH_SIZE);
  let processedCount = 0;
  const allRows: StockTableRow[] = [];

  for (let i = 0; i < allSymbols.length; i += BATCH_SIZE) {
    const batch = allSymbols.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;

    try {
      const rows = await buildRowsForBatch(batch, supabase, topixMap, buybackSet);
      allRows.push(...rows);
      processedCount += batch.length;

      const pct = ((processedCount / allSymbols.length) * 100).toFixed(1);
      const priceHits = rows.filter((r) => r.price > 0).length;
      console.log(`  [${batchNum}/${totalBatches}] ${processedCount}/${allSymbols.length} (${pct}%) - ${priceHits}/${batch.length} prices`);
    } catch (err) {
      console.error(`  [${batchNum}/${totalBatches}] ERROR:`, err);
      processedCount += batch.length;
    }
  }

  // Supabase upsert
  if (cli.supabase && !cli.dryRun && allRows.length > 0) {
    console.log(`\n  Upserting ${allRows.length} rows to Supabase...`);
    const now = new Date().toISOString();

    for (let i = 0; i < allRows.length; i += UPSERT_BATCH_SIZE) {
      const batch = allRows.slice(i, i + UPSERT_BATCH_SIZE);
      const upsertData = batch.map((row) => ({
        symbol: row.symbol,
        row_data: row,
        computed_at: now,
      }));

      const { error } = await supabase
        .from("stock_table_precomputed")
        .upsert(upsertData, { onConflict: "symbol" });

      if (error) {
        console.error(`  Upsert error (batch ${Math.floor(i / UPSERT_BATCH_SIZE) + 1}):`, error.message);
      }
    }
    console.log("  Upsert complete");
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const withPrice = allRows.filter((r) => r.price > 0).length;
  console.log(`\n=== Done: ${allRows.length} rows (${withPrice} with prices) in ${elapsed}s ===`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getQuoteBatch, getFinancialMetrics, getDividendHistory, computeDividendSummary } from "@/lib/api/yahooFinance";
import { getCachedStatsAll, setCachedStatsPartial, getStatsCacheBatchFromSupabase, type StatsPartialUpdate } from "@/lib/cache/statsCache";
import { getCachedYutaiBatch, getYutaiFromSupabase } from "@/lib/cache/yutaiCache";
import { getRoeHistory } from "@/lib/api/roeHistory";
import type { DividendSummary } from "@/types";
import { calcSharpeRatioFromPrices } from "@/lib/utils/indicators";
import type { PriceData } from "@/types";
import { isMarketOpen } from "@/lib/utils/date";

interface PriceBar {
  date: string;
  high: number;
  low: number;
}

function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
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
  const lastYearBars = prices.filter((p) => {
    const y = new Date(p.date).getFullYear();
    return y === currentYear - 1;
  });

  const highLow = (bars: PriceBar[]) =>
    bars.length > 0
      ? {
          high: Math.max(...bars.map((b) => b.high)),
          low: Math.min(...bars.map((b) => b.low)),
        }
      : { high: null as number | null, low: null as number | null };

  const week = highLow(lastWeek);
  const month = highLow(lastMonth);
  const lastYear = highLow(lastYearBars);

  return {
    weekHigh: week.high,
    weekLow: week.low,
    monthHigh: month.high,
    monthLow: month.low,
    lastYearHigh: lastYear.high,
    lastYearLow: lastYear.low,
  };
}

/**
 * 権利付最終日からN営業日前の日付を計算（売り推奨日）
 * 土日のみ除外（簡易版）
 */
function businessDaysBefore(dateStr: string, n: number): string | null {
  // "2026/03/27" or "2026-03-27" 形式を受け付ける
  const normalized = dateStr.replace(/\//g, "-");
  const d = new Date(normalized);
  if (isNaN(d.getTime())) return null;

  let remaining = n;
  while (remaining > 0) {
    d.setDate(d.getDate() - 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) { // 土日スキップ
      remaining--;
    }
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

/**
 * GET /api/stock-table?symbols=7203.T,9984.T,...
 * バッチで株価 + レンジデータを返す (最大50銘柄)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const symbolsParam = searchParams.get("symbols");

  if (!symbolsParam) {
    return NextResponse.json(
      { error: "symbols parameter is required" },
      { status: 400 },
    );
  }

  const symbols = symbolsParam.split(",").slice(0, 50);

  try {
    // 1. Yahoo Finance バッチquote
    const quotes = await getQuoteBatch(symbols);
    const quoteMap = new Map(quotes.map((q) => [q.symbol, q]));

    // 2. Supabase price_history からレンジ計算 + シャープレシオ算出
    let rangeMap = new Map<string, ReturnType<typeof computeRanges>>();
    const sharpeMap = new Map<string, number | null>();
    try {
      const supabase = createServiceClient();
      const { data: priceRows } = await supabase
        .from("price_history")
        .select("symbol, prices")
        .eq("timeframe", "daily")
        .in("symbol", symbols);

      if (priceRows) {
        for (const row of priceRows) {
          const prices: PriceData[] =
            typeof row.prices === "string"
              ? JSON.parse(row.prices)
              : row.prices;
          rangeMap.set(row.symbol, computeRanges(prices));
          sharpeMap.set(row.symbol, calcSharpeRatioFromPrices(prices));
        }
      }
    } catch {
      // price_history が無い場合はスキップ
    }

    // 3. キャッシュ一括読み取り（ファイルキャッシュ → Supabaseフォールバック）
    const ncMap = new Map<string, number | null>();
    const divMap = new Map<string, DividendSummary | null>();
    const roeMap = new Map<string, number | null>();
    const fyeMap = new Map<string, string | null>();
    const currentRatioMap = new Map<string, number | null>();
    const metricsMissing: { sym: string; marketCap: number }[] = []; // NC率またはROEがミス
    const divMissing: string[] = [];
    const supabaseFallbackNeeded: string[] = []; // ファイルキャッシュミスのシンボル

    // まずファイルキャッシュを確認
    for (const sym of symbols) {
      const quote = quoteMap.get(sym);
      const cached = getCachedStatsAll(sym, quote?.earningsDate);

      const ncHit = cached.nc !== undefined;
      const roeHit = cached.roe !== undefined;
      const divHit = cached.dividend !== undefined;

      const fyeHit = cached.fiscalYearEnd !== undefined;

      const crHit = cached.currentRatio !== undefined;

      if (ncHit) ncMap.set(sym, cached.nc ?? null);
      if (roeHit) roeMap.set(sym, cached.roe ?? null);
      if (divHit) divMap.set(sym, cached.dividend ?? null);
      if (fyeHit) fyeMap.set(sym, cached.fiscalYearEnd ?? null);
      if (crHit) currentRatioMap.set(sym, cached.currentRatio ?? null);

      // いずれかがファイルキャッシュミスならSupabaseフォールバック対象
      if (!ncHit || !roeHit || !divHit) {
        supabaseFallbackNeeded.push(sym);
      }
    }

    // Supabaseフォールバック（ファイルキャッシュミス分のみ）
    if (supabaseFallbackNeeded.length > 0) {
      const supabaseCache = await getStatsCacheBatchFromSupabase(supabaseFallbackNeeded);

      for (const sym of supabaseFallbackNeeded) {
        const sbCache = supabaseCache.get(sym);
        if (sbCache) {
          if (!ncMap.has(sym) && sbCache.nc !== undefined) ncMap.set(sym, sbCache.nc ?? null);
          if (!roeMap.has(sym) && sbCache.roe !== undefined) roeMap.set(sym, sbCache.roe ?? null);
          if (!divMap.has(sym) && sbCache.dividend !== undefined) divMap.set(sym, sbCache.dividend);
        }
      }
    }

    // まだキャッシュがない銘柄をAPI取得対象に追加
    for (const sym of symbols) {
      const quote = quoteMap.get(sym);
      const ncHit = ncMap.has(sym);
      const roeHit = roeMap.has(sym);
      const divHit = divMap.has(sym);

      // NC率・ROE（どちらかがミスなら両方再取得）
      if (!ncHit || !roeHit) {
        const mc = quote?.marketCap ?? 0;
        if (mc > 0) {
          metricsMissing.push({ sym, marketCap: mc });
        } else {
          if (!ncHit) ncMap.set(sym, null);
          if (!roeHit) roeMap.set(sym, null);
        }
      }

      // 配当
      if (!divHit) {
        divMissing.push(sym);
      }
    }

    // 4. キャッシュミスの銘柄はYFから並列取得（NC率+ROEを一括取得）
    const [metricsResults, divResults] = await Promise.all([
      // NC率 + ROE 一括取得
      metricsMissing.length > 0
        ? Promise.allSettled(
            metricsMissing.map(async ({ sym, marketCap }) => {
              const metrics = await getFinancialMetrics(sym, marketCap);
              return { sym, ncRatio: metrics.ncRatio, roe: metrics.roe, fiscalYearEnd: metrics.fiscalYearEnd, currentRatio: metrics.currentRatio };
            })
          )
        : [],
      // 配当取得
      divMissing.length > 0
        ? Promise.allSettled(
            divMissing.map(async (sym) => {
              const hist = await getDividendHistory(sym);
              const summary = hist.length > 0 ? computeDividendSummary(hist) : null;
              return { sym, summary };
            })
          )
        : [],
    ]);

    // 5. 結果をMapに追加 + キャッシュ更新をシンボルごとにまとめる
    const cacheUpdates = new Map<string, StatsPartialUpdate>();

    for (const r of metricsResults) {
      if (r.status === "fulfilled") {
        const { sym, ncRatio, roe, fiscalYearEnd, currentRatio } = r.value;
        ncMap.set(sym, ncRatio);
        roeMap.set(sym, roe);
        fyeMap.set(sym, fiscalYearEnd);
        currentRatioMap.set(sym, currentRatio);
        const update = cacheUpdates.get(sym) ?? {};
        update.nc = ncRatio;
        update.roe = roe;
        update.fiscalYearEnd = fiscalYearEnd;
        update.currentRatio = currentRatio;
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

    // キャッシュをまとめて書き込み（1シンボル1回の読み書き）
    for (const [sym, update] of cacheUpdates) {
      setCachedStatsPartial(sym, update);
    }

    // 5b. 優待キャッシュ一括読み取り（ファイル → Supabaseフォールバック）
    const yutaiMap = getCachedYutaiBatch(symbols);
    const yutaiMissing = symbols.filter((s) => !yutaiMap.has(s));
    if (yutaiMissing.length > 0) {
      const sbYutai = await getYutaiFromSupabase(yutaiMissing);
      for (const [sym, info] of sbYutai) {
        yutaiMap.set(sym, info);
      }
    }

    // 5c. ROE推移: キャッシュチェック → ミスならYFから取得
    const roeHistoryMap = new Map<string, { year: number; roe: number }[] | null>();
    const roeHistMissing: string[] = [];

    for (const sym of symbols) {
      const quote = quoteMap.get(sym);
      const cached = getCachedStatsAll(sym, quote?.earningsDate);
      if (cached.roeHistory !== undefined) {
        roeHistoryMap.set(sym, cached.roeHistory);
      } else {
        roeHistMissing.push(sym);
      }
    }

    // ROE推移のキャッシュミス分をYFから並列取得
    if (roeHistMissing.length > 0) {
      const roeHistResults = await Promise.allSettled(
        roeHistMissing.map(async (sym) => {
          const history = await getRoeHistory(sym);
          return { sym, history: history.length > 0 ? history : null };
        })
      );
      for (const r of roeHistResults) {
        if (r.status === "fulfilled") {
          const { sym, history } = r.value;
          roeHistoryMap.set(sym, history);
          // キャッシュに書き込み
          const update = cacheUpdates.get(sym) ?? {};
          update.roeHistory = history;
          cacheUpdates.set(sym, update);
          setCachedStatsPartial(sym, { roeHistory: history });
        }
      }
    }

    // 6. 結合
    const rows = symbols.map((sym) => {
      const q = quoteMap.get(sym);
      const r = rangeMap.get(sym);
      const yutai = yutaiMap.get(sym);

      // 売り推奨日の計算（権利付最終日の2営業日前）
      let sellRecommendDate: string | null = null;
      let daysUntilSellVal: number | null = null;
      if (yutai?.recordDate) {
        sellRecommendDate = businessDaysBefore(yutai.recordDate, 2);
        if (sellRecommendDate) {
          daysUntilSellVal = daysUntil(sellRecommendDate);
        }
      }

      return {
        symbol: sym,
        name: q?.name ?? sym,
        price: q?.price ?? 0,
        changePercent: q?.changePercent ?? 0,
        volume: q?.volume ?? 0,
        per: q?.per ?? null,
        eps: q?.eps ?? null,
        pbr: q?.pbr ?? null,
        simpleNcRatio: ncMap.get(sym) ?? null,
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
        sharpe1y: sharpeMap.get(sym) ?? null,
        roe: roeMap.get(sym) ?? null,
        latestDividend: divMap.get(sym)?.latestAmount ?? null,
        previousDividend: divMap.get(sym)?.previousAmount ?? null,
        latestIncrease: divMap.get(sym)?.latestIncrease ?? null,
        // 株主優待
        hasYutai: yutai?.hasYutai ?? null,
        yutaiContent: yutai?.content ?? null,
        recordDate: yutai?.recordDate ?? null,
        sellRecommendDate,
        daysUntilSell: daysUntilSellVal,
        // ROE推移
        roeHistory: roeHistoryMap.get(sym) ?? null,
        // 流動比率
        currentRatio: currentRatioMap.get(sym) ?? null,
      };
    });

    const response = NextResponse.json({ rows });
    const isOpen = isMarketOpen("JP");
    response.headers.set(
      "Cache-Control",
      isOpen
        ? "public, s-maxage=60, stale-while-revalidate=300"   // 場中: 1分+5分SWR
        : "public, s-maxage=3600, stale-while-revalidate=7200" // 場外: 1時間+2時間SWR
    );
    return response;
  } catch (error) {
    console.error("stock-table API error:", error);
    return NextResponse.json(
      { error: "データ取得に失敗しました" },
      { status: 500 },
    );
  }
}

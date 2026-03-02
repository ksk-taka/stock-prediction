import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getQuoteBatch, getFinancialMetrics } from "@/lib/api/yahooFinance";
import { getCachedStatsAll, setCachedStatsPartial, getStatsCacheBatchFromSupabase, type StatsPartialUpdate } from "@/lib/cache/statsCache";
import { calcSharpeRatioFromPrices } from "@/lib/utils/indicators";
import type { PriceData } from "@/types";
import { isMarketOpen } from "@/lib/utils/date";

function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/**
 * GET /api/ten-bagger-screen?symbols=7203.T,9984.T,...
 * テンバガー候補探索用のバッチデータ取得 (最大50銘柄)
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
    let quotes: Awaited<ReturnType<typeof getQuoteBatch>> = [];
    try {
      quotes = await getQuoteBatch(symbols);
    } catch (e: unknown) {
      const code = (e as { code?: number }).code;
      if (code === 429) {
        console.warn("[ten-bagger] Yahoo Finance 429 rate limit, continuing with cached data");
      } else {
        throw e;
      }
    }
    const quoteMap = new Map(quotes.map((q) => [q.symbol, q]));

    // 2. Supabase price_history からシャープレシオ算出 (1y/6m/3m)
    const sharpe1yMap = new Map<string, number | null>();
    const sharpe6mMap = new Map<string, number | null>();
    const sharpe3mMap = new Map<string, number | null>();
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
          // 1年
          sharpe1yMap.set(row.symbol, calcSharpeRatioFromPrices(prices));
          // 6ヶ月 (約126営業日)
          const prices6m = prices.slice(-126);
          sharpe6mMap.set(row.symbol, prices6m.length >= 20 ? calcSharpeRatioFromPrices(prices6m) : null);
          // 3ヶ月 (約63営業日)
          const prices3m = prices.slice(-63);
          sharpe3mMap.set(row.symbol, prices3m.length >= 20 ? calcSharpeRatioFromPrices(prices3m) : null);
        }
      }
    } catch {
      // price_history が無い場合はスキップ
    }

    // 3. キャッシュ一括読み取り
    const ncMap = new Map<string, number | null>();
    const roeMap = new Map<string, number | null>();
    const profitGrowthMap = new Map<string, number | null>();
    const revenueGrowthMap = new Map<string, number | null>();
    const operatingMarginsMap = new Map<string, number | null>();
    const pbrMap = new Map<string, number | null>();
    const metricsMissing: { sym: string; marketCap: number }[] = [];
    const supabaseFallbackNeeded: string[] = [];

    for (const sym of symbols) {
      const quote = quoteMap.get(sym);
      const cached = getCachedStatsAll(sym, quote?.earningsDate);

      const ncHit = cached.nc !== undefined;
      const roeHit = cached.roe !== undefined;
      const pgHit = cached.profitGrowthRate !== undefined;
      const rgHit = cached.revenueGrowth !== undefined;
      const omHit = cached.operatingMargins !== undefined;

      if (ncHit) ncMap.set(sym, cached.nc ?? null);
      if (roeHit) roeMap.set(sym, cached.roe ?? null);
      if (pgHit) profitGrowthMap.set(sym, cached.profitGrowthRate ?? null);
      if (rgHit) revenueGrowthMap.set(sym, cached.revenueGrowth ?? null);
      if (omHit) operatingMarginsMap.set(sym, cached.operatingMargins ?? null);
      if (cached.pbr !== undefined) pbrMap.set(sym, cached.pbr ?? null);

      if (!ncHit || !roeHit || !pgHit || !rgHit || !omHit) {
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
          if (!profitGrowthMap.has(sym) && sbCache.profitGrowthRate !== undefined) profitGrowthMap.set(sym, sbCache.profitGrowthRate ?? null);
          if (!revenueGrowthMap.has(sym) && sbCache.revenueGrowth !== undefined) revenueGrowthMap.set(sym, sbCache.revenueGrowth ?? null);
          if (!operatingMarginsMap.has(sym) && sbCache.operatingMargins !== undefined) operatingMarginsMap.set(sym, sbCache.operatingMargins ?? null);
        }
      }
    }

    // まだキャッシュがない銘柄をAPI取得対象に追加
    for (const sym of symbols) {
      const quote = quoteMap.get(sym);
      if (!ncMap.has(sym) || !roeMap.has(sym) || !profitGrowthMap.has(sym) || !revenueGrowthMap.has(sym) || !operatingMarginsMap.has(sym)) {
        const mc = quote?.marketCap ?? 0;
        if (mc > 0) {
          metricsMissing.push({ sym, marketCap: mc });
        } else {
          if (!ncMap.has(sym)) ncMap.set(sym, null);
          if (!roeMap.has(sym)) roeMap.set(sym, null);
          if (!profitGrowthMap.has(sym)) profitGrowthMap.set(sym, null);
          if (!revenueGrowthMap.has(sym)) revenueGrowthMap.set(sym, null);
          if (!operatingMarginsMap.has(sym)) operatingMarginsMap.set(sym, null);
        }
      }
    }

    // 4. キャッシュミスの銘柄はYFから並列取得
    if (metricsMissing.length > 0) {
      const metricsResults = await Promise.allSettled(
        metricsMissing.map(async ({ sym, marketCap }) => {
          const metrics = await getFinancialMetrics(sym, marketCap);
          return { sym, ...metrics };
        })
      );

      for (const r of metricsResults) {
        if (r.status === "fulfilled") {
          const { sym, ncRatio, roe, profitGrowthRate, prevProfitGrowthRate, revenueGrowth, operatingMargins, pbr: metricsPbr, fiscalYearEnd, currentRatio, pegRatio, equityRatio, totalDebt, psr } = r.value;
          ncMap.set(sym, ncRatio);
          roeMap.set(sym, roe);
          profitGrowthMap.set(sym, profitGrowthRate);
          revenueGrowthMap.set(sym, revenueGrowth);
          operatingMarginsMap.set(sym, operatingMargins);
          if (metricsPbr != null) pbrMap.set(sym, metricsPbr);

          const update: StatsPartialUpdate = {
            nc: ncRatio, roe, profitGrowthRate, prevProfitGrowthRate,
            revenueGrowth, operatingMargins,
            pbr: metricsPbr, fiscalYearEnd, currentRatio, pegRatio,
            equityRatio, totalDebt, psr,
          };
          setCachedStatsPartial(sym, update);
        }
      }
    }

    // 5. 結合
    const rows = symbols.map((sym) => {
      const q = quoteMap.get(sym);
      const ncRatio = ncMap.get(sym) ?? null;
      const per = q?.per ?? null;
      const pbr = pbrMap.get(sym) ?? q?.pbr ?? null;
      const cnPer = (per != null && ncRatio != null)
        ? Math.round(per * (1 - ncRatio / 100) * 100) / 100
        : null;

      // 上場年数の計算
      const ftd = q?.firstTradeDate ?? null;
      let yearsListed: number | null = null;
      if (ftd) {
        const ftdDate = new Date(ftd);
        if (!isNaN(ftdDate.getTime())) {
          yearsListed = Math.round((Date.now() - ftdDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000) * 10) / 10;
        }
      }

      return {
        symbol: sym,
        name: q?.name ?? sym,
        marketSegment: "",  // フロントエンド側でwatchlistから補完
        price: q?.price ?? 0,
        changePercent: q?.changePercent ?? 0,
        revenueGrowth: revenueGrowthMap.get(sym) ?? null,
        operatingMargins: operatingMarginsMap.get(sym) ?? null,
        firstTradeDate: ftd,
        yearsListed,
        marketCap: q?.marketCap ?? null,
        per,
        pbr,
        cnPer,
        simpleNcRatio: ncRatio,
        roe: roeMap.get(sym) ?? null,
        sharpe3m: sharpe3mMap.get(sym) ?? null,
        sharpe6m: sharpe6mMap.get(sym) ?? null,
        sharpe1y: sharpe1yMap.get(sym) ?? null,
        volume: q?.volume ?? 0,
        profitGrowthRate: profitGrowthMap.get(sym) ?? null,
      };
    });

    const response = NextResponse.json({ rows });
    const isOpen = isMarketOpen("JP");
    response.headers.set(
      "Cache-Control",
      isOpen ? "public, s-maxage=300, stale-while-revalidate=60" : "public, s-maxage=3600, stale-while-revalidate=300"
    );
    return response;
  } catch (error) {
    console.error("[ten-bagger-screen] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch screening data" },
      { status: 500 },
    );
  }
}

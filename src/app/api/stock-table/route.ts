import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getQuoteBatch, getSimpleNetCashRatio, getDividendHistory, computeDividendSummary, getFinancialData } from "@/lib/api/yahooFinance";
import { getCachedStats, getCachedNcRatio, setCachedNcOnly, getCachedDividendSummary, setCachedDividendOnly, getCachedRoe, setCachedRoeOnly } from "@/lib/cache/statsCache";
import type { DividendSummary } from "@/types";
import { calcSharpeRatioFromPrices } from "@/lib/utils/indicators";
import type { PriceData } from "@/types";

export const dynamic = "force-dynamic";

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

    // 3. NC率取得: キャッシュ(24h) → 長期キャッシュ(7d) → YFから取得
    const ncMap = new Map<string, number | null>();
    const ncMissing: { sym: string; marketCap: number }[] = [];

    for (const sym of symbols) {
      const cached = getCachedStats(sym);
      if (cached?.simpleNcRatio !== undefined && cached.simpleNcRatio !== null) {
        ncMap.set(sym, cached.simpleNcRatio);
        continue;
      }
      const cachedNc = getCachedNcRatio(sym);
      if (cachedNc !== undefined) {
        ncMap.set(sym, cachedNc);
        continue;
      }
      const mc = quoteMap.get(sym)?.marketCap ?? 0;
      if (mc > 0) {
        ncMissing.push({ sym, marketCap: mc });
      } else {
        ncMap.set(sym, null);
      }
    }

    // キャッシュにない銘柄はYFから並列取得（yfQueue内で10並列制限）
    if (ncMissing.length > 0) {
      const results = await Promise.allSettled(
        ncMissing.map(async ({ sym, marketCap }) => {
          const nc = await getSimpleNetCashRatio(sym, marketCap);
          setCachedNcOnly(sym, nc);
          return { sym, nc };
        })
      );
      for (const r of results) {
        if (r.status === "fulfilled") {
          ncMap.set(r.value.sym, r.value.nc);
        } else {
          // エラー時はnull
        }
      }
    }

    // 4. 配当サマリー取得: キャッシュ(7d) → YFから取得
    const divMap = new Map<string, DividendSummary | null>();
    const divMissing: string[] = [];

    for (const sym of symbols) {
      const cached = getCachedDividendSummary(sym);
      if (cached !== undefined) {
        divMap.set(sym, cached);
      } else {
        divMissing.push(sym);
      }
    }

    if (divMissing.length > 0) {
      const divResults = await Promise.allSettled(
        divMissing.map(async (sym) => {
          const hist = await getDividendHistory(sym);
          const summary = hist.length > 0 ? computeDividendSummary(hist) : null;
          setCachedDividendOnly(sym, summary);
          return { sym, summary };
        })
      );
      for (const r of divResults) {
        if (r.status === "fulfilled") {
          divMap.set(r.value.sym, r.value.summary);
        }
      }
    }

    // 5. ROE取得: キャッシュ(30d) → YF quoteSummaryから取得
    const roeMap = new Map<string, number | null>();
    const roeMissing: string[] = [];

    for (const sym of symbols) {
      const cached = getCachedStats(sym);
      if (cached?.roe !== undefined && cached.roe !== null) {
        roeMap.set(sym, cached.roe);
        continue;
      }
      const cachedRoe = getCachedRoe(sym);
      if (cachedRoe !== undefined) {
        roeMap.set(sym, cachedRoe);
        continue;
      }
      roeMissing.push(sym);
    }

    if (roeMissing.length > 0) {
      const roeResults = await Promise.allSettled(
        roeMissing.map(async (sym) => {
          const fd = await getFinancialData(sym);
          setCachedRoeOnly(sym, fd.roe);
          return { sym, roe: fd.roe };
        })
      );
      for (const r of roeResults) {
        if (r.status === "fulfilled") {
          roeMap.set(r.value.sym, r.value.roe);
        }
      }
    }

    // 6. 結合
    const rows = symbols.map((sym) => {
      const q = quoteMap.get(sym);
      const r = rangeMap.get(sym);
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
        sharpe1y: sharpeMap.get(sym) ?? null,
        roe: roeMap.get(sym) ?? null,
        latestDividend: divMap.get(sym)?.latestAmount ?? null,
        previousDividend: divMap.get(sym)?.previousAmount ?? null,
        latestIncrease: divMap.get(sym)?.latestIncrease ?? null,
      };
    });

    return NextResponse.json({ rows });
  } catch (error) {
    console.error("stock-table API error:", error);
    return NextResponse.json(
      { error: "データ取得に失敗しました" },
      { status: 500 },
    );
  }
}

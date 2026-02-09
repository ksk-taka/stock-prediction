import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getQuoteBatch } from "@/lib/api/yahooFinance";

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

    // 2. Supabase price_history からレンジ計算
    let rangeMap = new Map<string, ReturnType<typeof computeRanges>>();
    try {
      const supabase = createServiceClient();
      const { data: priceRows } = await supabase
        .from("price_history")
        .select("symbol, prices")
        .eq("timeframe", "daily")
        .in("symbol", symbols);

      if (priceRows) {
        for (const row of priceRows) {
          const prices: PriceBar[] =
            typeof row.prices === "string"
              ? JSON.parse(row.prices)
              : row.prices;
          rangeMap.set(row.symbol, computeRanges(prices));
        }
      }
    } catch {
      // price_history が無い場合はスキップ
    }

    // 3. 結合
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

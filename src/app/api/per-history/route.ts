import { NextRequest, NextResponse } from "next/server";
import { getQuote, getEarningsHistory, getHistoricalPrices } from "@/lib/api/yahooFinance";
import { getCachedPerHistory, setCachedPerHistory } from "@/lib/cache/perHistoryCache";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const symbol = searchParams.get("symbol");

  if (!symbol) {
    return NextResponse.json(
      { error: "symbol parameter is required" },
      { status: 400 }
    );
  }

  // キャッシュチェック（24時間TTL）
  const cached = getCachedPerHistory(symbol);
  if (cached) {
    return NextResponse.json({ symbol, ...cached });
  }

  try {
    // 並列取得: quote(TTM EPS) + earningsHistory(四半期EPS) + dailyPrices
    const [quote, earnings, prices] = await Promise.all([
      getQuote(symbol),
      getEarningsHistory(symbol),
      getHistoricalPrices(symbol, "daily"),
    ]);

    const ttmEps = quote.eps; // epsTrailingTwelveMonths

    // 日次PER計算: close / TTM EPS
    const perSeries = prices.map((p) => ({
      date: p.date,
      per: ttmEps && ttmEps > 0 ? Math.round((p.close / ttmEps) * 100) / 100 : null,
    }));

    const epsSeries = earnings.map((e) => ({
      quarter: e.quarter,
      epsActual: e.epsActual,
      epsEstimate: e.epsEstimate,
    }));

    const result = { perSeries, epsSeries, ttmEps };

    // キャッシュ保存
    setCachedPerHistory(symbol, result);

    return NextResponse.json({ symbol, ...result });
  } catch (error) {
    console.error("PER history API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch PER history" },
      { status: 500 }
    );
  }
}

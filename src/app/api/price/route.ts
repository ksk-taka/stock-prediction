import { NextRequest, NextResponse } from "next/server";
import { getHistoricalPrices, getQuote } from "@/lib/api/yahooFinance";
import { getCachedPrices, setCachedPrices } from "@/lib/cache/priceCache";
import type { Period } from "@/lib/utils/date";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const symbol = searchParams.get("symbol");
  const period = (searchParams.get("period") ?? "daily") as Period;

  if (!symbol) {
    return NextResponse.json(
      { error: "symbol parameter is required" },
      { status: 400 }
    );
  }

  const market = symbol.endsWith(".T") ? "JP" : "US";

  try {
    // キャッシュ確認
    const cached = getCachedPrices(symbol, period, market as "JP" | "US");
    if (cached) {
      // キャッシュヒットでも現在値は常に取得
      const quote = await getQuote(symbol).catch(() => null);
      return NextResponse.json({ prices: cached, quote, cached: true });
    }

    // 株価データと現在値を並列取得
    const [prices, quote] = await Promise.all([
      getHistoricalPrices(symbol, period),
      getQuote(symbol),
    ]);

    // キャッシュ保存
    setCachedPrices(symbol, period, prices);

    return NextResponse.json({ prices, quote, cached: false });
  } catch (error) {
    console.error("Price API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch price data" },
      { status: 500 }
    );
  }
}

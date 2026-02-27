import { NextRequest, NextResponse } from "next/server";
import { getHistoricalPrices } from "@/lib/api/yahooFinance";
import { getCachedPrices, setCachedPrices } from "@/lib/cache/priceCache";
import { calcAllReturnTypeSharpe } from "@/lib/utils/indicators";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const symbolsParam = searchParams.get("symbols");

  if (!symbolsParam) {
    return NextResponse.json(
      { error: "symbols parameter is required (comma-separated)" },
      { status: 400 },
    );
  }

  const symbols = symbolsParam.split(",").filter(Boolean);
  if (symbols.length === 0) {
    return NextResponse.json({ results: [] });
  }

  try {
    const results = await Promise.all(
      symbols.map(async (symbol) => {
        try {
          // キャッシュ確認 → 取得
          let prices = getCachedPrices(symbol, "daily", "JP");
          if (!prices) {
            prices = await getHistoricalPrices(symbol, "daily");
            setCachedPrices(symbol, "daily", prices);
          }

          const sharpe = calcAllReturnTypeSharpe(prices);
          const lastPrice = prices.length > 0 ? prices[prices.length - 1].close : null;
          return { symbol, sharpe, price: lastPrice, error: null };
        } catch (err) {
          return { symbol, sharpe: null, price: null, error: String(err) };
        }
      }),
    );

    return NextResponse.json({ results });
  } catch (error) {
    console.error("ratio-check API error:", error);
    return NextResponse.json(
      { error: "Failed to compute ratio data" },
      { status: 500 },
    );
  }
}

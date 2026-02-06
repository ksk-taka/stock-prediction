import { NextRequest, NextResponse } from "next/server";
import { getQuote, getFinancialData } from "@/lib/api/yahooFinance";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const symbol = searchParams.get("symbol");

  if (!symbol) {
    return NextResponse.json(
      { error: "symbol parameter is required" },
      { status: 400 }
    );
  }

  try {
    const [quote, financial] = await Promise.all([
      getQuote(symbol),
      getFinancialData(symbol),
    ]);

    return NextResponse.json({
      symbol: quote.symbol,
      per: quote.per,
      forwardPer: quote.forwardPer,
      pbr: quote.pbr,
      eps: quote.eps,
      roe: financial.roe,
      dividendYield: quote.dividendYield,
    });
  } catch (error) {
    console.error("Stats API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch stats" },
      { status: 500 }
    );
  }
}

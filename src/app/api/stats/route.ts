import { NextRequest, NextResponse } from "next/server";
import { getQuote, getFinancialData } from "@/lib/api/yahooFinance";
import { getCachedStats, setCachedStats } from "@/lib/cache/statsCache";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const symbol = searchParams.get("symbol");

  if (!symbol) {
    return NextResponse.json(
      { error: "symbol parameter is required" },
      { status: 400 }
    );
  }

  // キャッシュチェック（6時間TTL）
  const cached = getCachedStats(symbol);
  if (cached) {
    return NextResponse.json({ symbol, ...cached });
  }

  try {
    const [quote, financial] = await Promise.all([
      getQuote(symbol),
      getFinancialData(symbol),
    ]);

    const result = {
      per: quote.per,
      forwardPer: quote.forwardPer,
      pbr: quote.pbr,
      eps: quote.eps,
      roe: financial.roe,
      dividendYield: quote.dividendYield,
    };

    // キャッシュ保存
    setCachedStats(symbol, result);

    return NextResponse.json({ symbol, ...result });
  } catch (error) {
    console.error("Stats API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch stats" },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getQuote, getFinancialData, getSimpleNetCashRatio } from "@/lib/api/yahooFinance";
import { getCachedStats, setCachedStats, getCachedNcRatio } from "@/lib/cache/statsCache";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const symbol = searchParams.get("symbol");

  if (!symbol) {
    return NextResponse.json(
      { error: "symbol parameter is required" },
      { status: 400 }
    );
  }

  // キャッシュチェック（24時間TTL）— NC率・時価総額が揃っている場合のみ返す
  const cached = getCachedStats(symbol);
  if (cached && cached.simpleNcRatio !== undefined && cached.marketCap !== undefined) {
    return NextResponse.json({ symbol, ...cached });
  }

  try {
    const [quote, financial] = await Promise.all([
      getQuote(symbol),
      getFinancialData(symbol),
    ]);

    // NC率は7日キャッシュ（四半期データ）→ 有効ならAPI呼出しスキップ
    const cachedNc = getCachedNcRatio(symbol);
    const simpleNcRatio = cachedNc !== undefined
      ? cachedNc
      : await getSimpleNetCashRatio(symbol, quote.marketCap);

    const result = {
      per: quote.per,
      forwardPer: quote.forwardPer,
      pbr: quote.pbr,
      eps: quote.eps,
      roe: financial.roe,
      dividendYield: quote.dividendYield,
      simpleNcRatio,
      marketCap: quote.marketCap || null,
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

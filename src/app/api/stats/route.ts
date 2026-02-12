import { NextRequest, NextResponse } from "next/server";
import { getQuote, getFinancialData, getSimpleNetCashRatio, getHistoricalPrices } from "@/lib/api/yahooFinance";
import { getCachedStats, setCachedStats, getCachedNcRatio } from "@/lib/cache/statsCache";
import { calcSharpeRatioFromPrices } from "@/lib/utils/indicators";
import { yfQueue } from "@/lib/utils/requestQueue";
import YahooFinance from "yahoo-finance2";
import { subYears } from "date-fns";

const yf = new YahooFinance();

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

    // シャープレシオ算出（1年 + 3年）
    let sharpe1y: number | null = null;
    let sharpe3y: number | null = null;
    try {
      const daily1y = await getHistoricalPrices(symbol, "daily");
      sharpe1y = calcSharpeRatioFromPrices(daily1y);
    } catch { /* skip */ }
    try {
      const now = new Date();
      const raw3y = await yfQueue.add(() =>
        yf.historical(symbol, {
          period1: subYears(now, 3),
          period2: now,
          interval: "1d" as const,
        })
      );
      const daily3y = raw3y.map((row) => ({
        date: row.date instanceof Date ? row.date.toISOString().split("T")[0] : String(row.date),
        open: row.open ?? 0,
        high: row.high ?? 0,
        low: row.low ?? 0,
        close: row.close ?? 0,
        volume: row.volume ?? 0,
      }));
      sharpe3y = calcSharpeRatioFromPrices(daily3y);
    } catch { /* skip */ }

    const result = {
      per: quote.per,
      forwardPer: quote.forwardPer,
      pbr: quote.pbr,
      eps: quote.eps,
      roe: financial.roe,
      dividendYield: quote.dividendYield,
      simpleNcRatio,
      marketCap: quote.marketCap || null,
      sharpe1y,
      sharpe3y,
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

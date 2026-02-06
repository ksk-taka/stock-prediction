import { NextRequest, NextResponse } from "next/server";
import { runAnalysis, analyzeSentiment } from "@/lib/api/llm";
import { getHistoricalPrices, getQuote } from "@/lib/api/yahooFinance";
import { getCachedNews } from "@/lib/cache/newsCache";
import { getCachedAnalysis, setCachedAnalysis } from "@/lib/cache/analysisCache";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const symbol = searchParams.get("symbol");
  const name = searchParams.get("name") ?? symbol ?? "";
  const refresh = searchParams.get("refresh") === "true";

  if (!symbol) {
    return NextResponse.json(
      { error: "symbol parameter is required" },
      { status: 400 }
    );
  }

  try {
    // キャッシュ確認
    if (!refresh) {
      const cached = getCachedAnalysis(symbol);
      if (cached) {
        return NextResponse.json({
          analysis: cached.analysis,
          sentiment: cached.sentiment,
          cached: true,
        });
      }
    }

    // 必要データを並列取得
    const [prices, quote, newsData] = await Promise.all([
      getHistoricalPrices(symbol, "daily"),
      getQuote(symbol),
      Promise.resolve(getCachedNews(symbol)),
    ]);

    const news = newsData?.news ?? [];
    const snsOverview = newsData?.snsOverview ?? "";
    const analystRating = newsData?.analystRating ?? "";

    // センチメント分析 + LLM分析を並列実行
    const [sentiment, analysis] = await Promise.all([
      analyzeSentiment(news, snsOverview, analystRating),
      runAnalysis(
        symbol,
        name,
        quote.price,
        quote.changePercent,
        prices,
        news,
        snsOverview,
        analystRating
      ),
    ]);

    // キャッシュ保存
    setCachedAnalysis(symbol, analysis, sentiment);

    return NextResponse.json({ analysis, sentiment, cached: false });
  } catch (error) {
    console.error("Analyze API error:", error);
    return NextResponse.json(
      { error: "Failed to run analysis" },
      { status: 500 }
    );
  }
}

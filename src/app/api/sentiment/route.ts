import { NextRequest, NextResponse } from "next/server";
import { analyzeSentiment } from "@/lib/api/ollama";
import { getCachedNews } from "@/lib/cache/newsCache";
import { getCachedAnalysis, setCachedAnalysis } from "@/lib/cache/analysisCache";

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
    // 分析キャッシュ確認
    const cachedAnalysis = getCachedAnalysis(symbol);
    if (cachedAnalysis) {
      return NextResponse.json({
        sentiment: cachedAnalysis.sentiment,
        cached: true,
      });
    }

    // ニュースキャッシュからデータ取得
    const newsData = getCachedNews(symbol);
    if (!newsData) {
      return NextResponse.json(
        { error: "No news data available. Fetch news first." },
        { status: 404 }
      );
    }

    // センチメント分析実行
    const sentiment = await analyzeSentiment(
      newsData.news,
      newsData.snsOverview,
      newsData.analystRating
    );

    return NextResponse.json({ sentiment, cached: false });
  } catch (error) {
    console.error("Sentiment API error:", error);
    return NextResponse.json(
      { error: "Failed to analyze sentiment" },
      { status: 500 }
    );
  }
}

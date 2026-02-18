import { NextRequest, NextResponse } from "next/server";
import { fetchNewsAndSentiment } from "@/lib/api/webResearch";
import { getCachedNews, setCachedNews } from "@/lib/cache/newsCache";
import { requireAllowedUser } from "@/lib/supabase/auth";

export async function GET(request: NextRequest) {
  try {
    await requireAllowedUser();
  } catch {
    return NextResponse.json(
      { error: "この機能は許可されたユーザーのみ使用できます" },
      { status: 403 },
    );
  }

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
    // キャッシュ確認（refresh指定時はスキップ）
    if (!refresh) {
      const cached = getCachedNews(symbol);
      if (cached) {
        return NextResponse.json({
          news: cached.news,
          snsOverview: cached.snsOverview,
          analystRating: cached.analystRating,
          cached: true,
        });
      }
    }

    // Perplexityでニュース取得
    const result = await fetchNewsAndSentiment(symbol, name);

    // キャッシュ保存
    setCachedNews(symbol, result.news, result.snsOverview, result.analystRating);

    return NextResponse.json({
      news: result.news,
      snsOverview: result.snsOverview,
      analystRating: result.analystRating,
      cached: false,
    });
  } catch (error) {
    console.error("News API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch news data" },
      { status: 500 }
    );
  }
}

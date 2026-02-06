import { NextRequest, NextResponse } from "next/server";
import { getHistoricalPrices } from "@/lib/api/yahooFinance";
import { detectMarketSentiment } from "@/lib/utils/signals";
import { fetchMarketIntelligence } from "@/lib/api/perplexity";
import { getCachedMarketIntelligence, setCachedMarketIntelligence } from "@/lib/cache/marketIntelligenceCache";

export async function GET(request: NextRequest) {
  const refresh = request.nextUrl.searchParams.get("refresh") === "true";

  try {
    const data = await getHistoricalPrices("^N225", "daily");
    const result = detectMarketSentiment(data);

    if (!result) {
      return NextResponse.json(
        { error: "Insufficient data for analysis" },
        { status: 500 }
      );
    }

    // Perplexity市場インテリジェンス（キャッシュ優先）
    let intelligence = !refresh ? getCachedMarketIntelligence() : null;
    let intelligenceCached = !!intelligence;

    if (!intelligence) {
      try {
        intelligence = await fetchMarketIntelligence();
        setCachedMarketIntelligence(intelligence);
        intelligenceCached = false;
      } catch (err) {
        console.error("Market intelligence fetch error:", err);
      }
    }

    return NextResponse.json({
      index: "^N225",
      name: "日経平均株価",
      ...result,
      intelligence: intelligence ?? null,
      intelligenceCached,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Market sentiment API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch market sentiment" },
      { status: 500 }
    );
  }
}

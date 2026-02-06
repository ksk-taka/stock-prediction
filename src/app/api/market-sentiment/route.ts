import { NextResponse } from "next/server";
import { getHistoricalPrices } from "@/lib/api/yahooFinance";
import { detectMarketSentiment } from "@/lib/utils/signals";

export async function GET() {
  try {
    const data = await getHistoricalPrices("^N225", "daily");
    const result = detectMarketSentiment(data);

    if (!result) {
      return NextResponse.json(
        { error: "Insufficient data for analysis" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      index: "^N225",
      name: "日経平均株価",
      ...result,
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

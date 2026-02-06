import { NextRequest, NextResponse } from "next/server";
import { getHistoricalPrices } from "@/lib/api/yahooFinance";
import { detectBuySignals, detectCupWithHandle } from "@/lib/utils/signals";

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
    // 日足(1年分)と週足(3年分)を並列取得
    const [dailyData, weeklyData] = await Promise.all([
      getHistoricalPrices(symbol, "daily"),
      getHistoricalPrices(symbol, "weekly"),
    ]);

    // フィルタ期間
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    // 全データで検出 → 対象期間のみ抽出
    const dailyChoruko = detectBuySignals(dailyData).filter(
      (s) => new Date(s.date) >= threeMonthsAgo
    );
    const weeklyChoruko = detectBuySignals(weeklyData).filter(
      (s) => new Date(s.date) >= oneYearAgo
    );
    const dailyCWH = detectCupWithHandle(dailyData).filter(
      (s) => new Date(s.date) >= threeMonthsAgo
    );
    const weeklyCWH = detectCupWithHandle(weeklyData).filter(
      (s) => new Date(s.date) >= oneYearAgo
    );

    const summarize = (signals: { date: string }[]) => ({
      count: signals.length,
      latest: signals.length > 0 ? signals[signals.length - 1].date : null,
    });

    return NextResponse.json({
      daily: {
        choruko: summarize(dailyChoruko),
        cwh: summarize(dailyCWH),
      },
      weekly: {
        choruko: summarize(weeklyChoruko),
        cwh: summarize(weeklyCWH),
      },
    });
  } catch (error) {
    console.error("Signals API error:", error);
    return NextResponse.json(
      { error: "Failed to detect signals" },
      { status: 500 }
    );
  }
}

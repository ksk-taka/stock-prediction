import { NextRequest, NextResponse } from "next/server";
import { yfQueue } from "@/lib/utils/requestQueue";
import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance();

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol");
  if (!symbol) {
    return NextResponse.json({ error: "symbol is required" }, { status: 400 });
  }

  try {
    // 10年分の週足データを取得（~520本, 日足より大幅に軽量）
    const tenYearsAgo = new Date();
    tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);

    const rows = await yfQueue.add(() =>
      yf.historical(symbol, {
        period1: tenYearsAgo,
        period2: new Date(),
        interval: "1wk",
      })
    );

    let tenYearHigh: number | null = null;
    for (const row of rows) {
      const h = row.high ?? 0;
      if (h > 0 && (tenYearHigh === null || h > tenYearHigh)) {
        tenYearHigh = h;
      }
    }

    return NextResponse.json({ tenYearHigh });
  } catch (error) {
    console.error("price-highs API error:", error);
    return NextResponse.json({ error: "Failed to fetch" }, { status: 500 });
  }
}

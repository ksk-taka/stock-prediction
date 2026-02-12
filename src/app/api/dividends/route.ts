import { NextRequest, NextResponse } from "next/server";
import { getDividendHistory } from "@/lib/api/yahooFinance";
import type { DividendHistoryEntry } from "@/types";

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol");
  if (!symbol) {
    return NextResponse.json({ error: "symbol required" }, { status: 400 });
  }

  try {
    const history = await getDividendHistory(symbol, 10);

    // 前回比の増減を計算（historyは日付降順）
    const dividends: DividendHistoryEntry[] = history.map((h, i) => {
      const prev = history[i + 1];
      return {
        date: h.date,
        amount: h.amount,
        change: prev ? Math.round((h.amount - prev.amount) * 100) / 100 : null,
        changePct:
          prev && prev.amount > 0
            ? Math.round(((h.amount - prev.amount) / prev.amount) * 1000) / 10
            : null,
      };
    });

    return NextResponse.json({ symbol, dividends });
  } catch (error) {
    console.error("Dividends API error:", error);
    return NextResponse.json({ error: "Failed to fetch dividends" }, { status: 500 });
  }
}

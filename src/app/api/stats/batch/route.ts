import { NextRequest, NextResponse } from "next/server";
import { getCachedStatsFull } from "@/lib/cache/statsCache";

/**
 * バッチstats API - キャッシュから一括読み取り (YF APIコールなし)
 * GET /api/stats/batch?symbols=7203.T,9984.T,...
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const symbolsParam = searchParams.get("symbols");

  if (!symbolsParam) {
    return NextResponse.json(
      { error: "symbols parameter is required" },
      { status: 400 }
    );
  }

  const symbols = symbolsParam.split(",").filter(Boolean);
  if (symbols.length === 0) {
    return NextResponse.json({ stats: {} });
  }

  const stats: Record<string, {
    per?: number | null;
    pbr?: number | null;
    roe?: number | null;
    simpleNcRatio?: number | null;
    marketCap?: number | null;
    sharpe1y?: number | null;
    latestDividend?: number | null;
    latestIncrease?: number | null;
  }> = {};

  for (const symbol of symbols) {
    const cached = getCachedStatsFull(symbol);
    if (cached) {
      stats[symbol] = cached;
    }
  }

  return NextResponse.json({ stats });
}

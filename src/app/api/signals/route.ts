import { NextRequest, NextResponse } from "next/server";
import { getCachedSignals } from "@/lib/cache/signalsCache";
import { computeAndCacheSignals } from "@/lib/signals/computeSignals";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const symbol = searchParams.get("symbol");

  if (!symbol) {
    return NextResponse.json(
      { error: "symbol parameter is required" },
      { status: 400 }
    );
  }

  // キャッシュチェック（1時間TTL）
  const cached = getCachedSignals(symbol);
  if (cached) {
    return NextResponse.json(cached);
  }

  try {
    const result = await computeAndCacheSignals(symbol);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Signals API error:", error);
    return NextResponse.json(
      { error: "Failed to detect signals" },
      { status: 500 }
    );
  }
}

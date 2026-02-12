import { NextRequest, NextResponse } from "next/server";
import { addStocksToGroup } from "@/lib/data/watchlist";
import { getAuthUserId } from "@/lib/supabase/auth";

export async function POST(request: NextRequest) {
  try {
    const userId = await getAuthUserId();
    const { symbols, groupId } = await request.json();
    if (!Array.isArray(symbols) || symbols.length === 0 || typeof groupId !== "number") {
      return NextResponse.json(
        { error: "symbols[] and groupId are required" },
        { status: 400 }
      );
    }
    const result = await addStocksToGroup(userId, symbols, groupId);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Batch group add error:", error);
    return NextResponse.json(
      { error: "Failed to batch add to group" },
      { status: 500 }
    );
  }
}

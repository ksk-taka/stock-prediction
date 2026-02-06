import { NextRequest, NextResponse } from "next/server";
import { getWatchList, addStock, removeStock } from "@/lib/data/watchlist";
import type { Stock } from "@/types";

export async function GET() {
  try {
    const list = getWatchList();
    return NextResponse.json(list);
  } catch (error) {
    console.error("Watchlist GET error:", error);
    return NextResponse.json(
      { error: "Failed to read watchlist" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const stock: Stock = await request.json();
    if (!stock.symbol || !stock.name || !stock.market) {
      return NextResponse.json(
        { error: "symbol, name, and market are required" },
        { status: 400 }
      );
    }
    const list = addStock(stock);
    return NextResponse.json(list);
  } catch (error) {
    console.error("Watchlist POST error:", error);
    return NextResponse.json(
      { error: "Failed to add stock" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { symbol } = await request.json();
    if (!symbol) {
      return NextResponse.json(
        { error: "symbol is required" },
        { status: 400 }
      );
    }
    const list = removeStock(symbol);
    return NextResponse.json(list);
  } catch (error) {
    console.error("Watchlist DELETE error:", error);
    return NextResponse.json(
      { error: "Failed to remove stock" },
      { status: 500 }
    );
  }
}

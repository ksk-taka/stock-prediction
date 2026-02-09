import { NextRequest, NextResponse } from "next/server";
import {
  getWatchList,
  addStock,
  removeStock,
  updateStockFundamental,
  toggleFavorite,
} from "@/lib/data/watchlist";
import { getAuthUserId } from "@/lib/supabase/auth";
import type { Stock } from "@/types";

export async function GET() {
  try {
    const userId = await getAuthUserId();
    const list = await getWatchList(userId);
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
    const userId = await getAuthUserId();
    const stock: Stock = await request.json();
    if (!stock.symbol || !stock.name || !stock.market) {
      return NextResponse.json(
        { error: "symbol, name, and market are required" },
        { status: 400 }
      );
    }
    const list = await addStock(userId, stock);
    return NextResponse.json(list);
  } catch (error) {
    console.error("Watchlist POST error:", error);
    return NextResponse.json(
      { error: "Failed to add stock" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const userId = await getAuthUserId();
    const { symbol } = await request.json();
    if (!symbol) {
      return NextResponse.json(
        { error: "symbol is required" },
        { status: 400 }
      );
    }
    const list = await toggleFavorite(userId, symbol);
    const stock = list.stocks.find((s) => s.symbol === symbol);
    return NextResponse.json({ favorite: stock?.favorite ?? false });
  } catch (error) {
    console.error("Watchlist PUT error:", error);
    return NextResponse.json(
      { error: "Failed to toggle favorite" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const userId = await getAuthUserId();
    const { symbol, fundamental } = await request.json();
    if (!symbol || !fundamental) {
      return NextResponse.json(
        { error: "symbol and fundamental are required" },
        { status: 400 }
      );
    }
    const list = await updateStockFundamental(userId, symbol, fundamental);
    return NextResponse.json(list);
  } catch (error) {
    console.error("Watchlist PATCH error:", error);
    return NextResponse.json(
      { error: "Failed to update fundamental" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const userId = await getAuthUserId();
    const { symbol } = await request.json();
    if (!symbol) {
      return NextResponse.json(
        { error: "symbol is required" },
        { status: 400 }
      );
    }
    const list = await removeStock(userId, symbol);
    return NextResponse.json(list);
  } catch (error) {
    console.error("Watchlist DELETE error:", error);
    return NextResponse.json(
      { error: "Failed to remove stock" },
      { status: 500 }
    );
  }
}

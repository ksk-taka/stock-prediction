import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getBuybackCodesWithFallback } from "@/lib/cache/buybackCache";

export const dynamic = "force-dynamic";

const isVercel = !!process.env.VERCEL;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function enrichWithBuyback(stocks: any[], buybackSet: Set<string> | null) {
  return stocks.map((s) => ({
    ...s,
    hasBuyback: buybackSet ? buybackSet.has(s.symbol?.replace(".T", "") ?? "") : false,
  }));
}

export async function GET() {
  try {
    // Supabase が設定されていれば Supabase から取得
    if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const result = await getFromSupabase();
      if (result) return result;
    }

    // Vercel 上で Supabase にデータなし
    if (isVercel) {
      return NextResponse.json({
        stocks: [],
        scannedAt: null,
        error: "スキャンデータがありません。スキャンを実行してください。",
      });
    }

    // ローカル: JSON フォールバック
    return await getFromJson();
  } catch (err) {
    return NextResponse.json(
      { stocks: [], error: String(err) },
      { status: 500 },
    );
  }
}

async function getFromSupabase(): Promise<NextResponse | null> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data, error } = await supabase
    .from("cwh_forming_scans")
    .select("*")
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return null;

  const rawStocks = typeof data.stocks === "string"
    ? JSON.parse(data.stocks)
    : data.stocks;

  const buybackSet = await getBuybackCodesWithFallback();
  const stocks = enrichWithBuyback(rawStocks, buybackSet);

  return NextResponse.json({
    stocks,
    scannedAt: data.completed_at,
    scanId: data.id,
    stockCount: data.stock_count,
    readyCount: data.ready_count,
  });
}

async function getFromJson(): Promise<NextResponse> {
  const { existsSync, readFileSync } = await import("fs");
  const { join } = await import("path");

  const jsonPath = join(process.cwd(), "data", "cwh-forming.json");
  if (!existsSync(jsonPath)) {
    return NextResponse.json({
      stocks: [],
      scannedAt: null,
      error: "スキャンデータがありません。npm run scan:cwh:all を実行してください。",
    });
  }

  const raw = JSON.parse(readFileSync(jsonPath, "utf-8"));
  const buybackSet = await getBuybackCodesWithFallback();
  const stocks = enrichWithBuyback(raw.stocks ?? [], buybackSet);

  return NextResponse.json({ ...raw, stocks });
}

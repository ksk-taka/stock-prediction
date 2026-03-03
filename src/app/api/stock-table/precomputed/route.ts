import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/**
 * GET /api/stock-table/precomputed
 * GHA事前計算済みの全 StockTableRow を返す
 */
export async function GET() {
  try {
    const supabase = createServiceClient();

    // ページネーションで全行取得 (PostgRESTデフォルト1000行制限)
    const PAGE_SIZE = 1000;
    const allRows: unknown[] = [];
    let latestComputedAt: string | null = null;

    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabase
        .from("stock_table_precomputed")
        .select("row_data, computed_at")
        .order("symbol")
        .range(from, from + PAGE_SIZE - 1);

      if (error) throw error;
      if (!data || data.length === 0) break;

      for (const row of data) {
        allRows.push(row.row_data);
        if (!latestComputedAt || row.computed_at > latestComputedAt) {
          latestComputedAt = row.computed_at;
        }
      }

      if (data.length < PAGE_SIZE) break;
    }

    const response = NextResponse.json({
      rows: allRows,
      computedAt: latestComputedAt,
    });

    // 事前計算データは1日1回更新 → 長めのキャッシュ
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=3600, stale-while-revalidate=7200",
    );

    return response;
  } catch (error) {
    console.error("precomputed stock-table API error:", error);
    return NextResponse.json(
      { error: "事前計算データの取得に失敗しました" },
      { status: 500 },
    );
  }
}

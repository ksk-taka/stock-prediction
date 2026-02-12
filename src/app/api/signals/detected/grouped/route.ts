import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/**
 * GET /api/signals/detected/grouped
 * シグナルを銘柄ごとに集約して返す
 *
 * 改善版: Supabase RPC関数で1クエリ + キャッシュ
 * Before: 57回のページネーションクエリ (6-12秒)
 * After: 1回のRPC呼び出し (キャッシュHIT時 0.1-0.2秒、ミス時 1-2秒)
 */
export async function GET(request: NextRequest) {
  const supabase = createServiceClient();
  const { searchParams } = request.nextUrl;
  const scanIdParam = searchParams.get("scanId");

  try {
    // RPC関数を呼び出し（キャッシュ込み）
    const { data, error } = await supabase.rpc("get_signals_grouped", {
      p_scan_id: scanIdParam ? parseInt(scanIdParam, 10) : null,
    });

    if (error) {
      console.error("RPC error:", error);
      // フォールバック: 従来のページネーション方式
      return await legacyFetch(supabase, scanIdParam);
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error("Unexpected error:", err);
    return NextResponse.json(
      { error: "シグナル取得エラー" },
      { status: 500 },
    );
  }
}

/**
 * フォールバック: RPC関数が存在しない場合の従来方式
 * マイグレーション適用前の互換性のため
 */
async function legacyFetch(
  supabase: ReturnType<typeof createServiceClient>,
  scanIdParam: string | null,
) {
  interface SignalRow {
    symbol: string;
    strategy_id: string;
    strategy_name: string;
    timeframe: string;
    signal_date: string;
    buy_price: number;
    current_price: number;
  }

  // 対象スキャンID取得
  let targetScanId: number | undefined;

  if (scanIdParam) {
    targetScanId = parseInt(scanIdParam, 10);
  } else {
    const { data: latestScan } = await supabase
      .from("signal_scans")
      .select("id")
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(1)
      .single();

    if (!latestScan) {
      return NextResponse.json({ signals: {}, scan: null });
    }
    targetScanId = latestScan.id;
  }

  // ページネーションで全シグナル取得
  const allSignals: SignalRow[] = [];
  const PAGE_SIZE = 1000;

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("detected_signals")
      .select("symbol, strategy_id, strategy_name, timeframe, signal_date, buy_price, current_price")
      .eq("scan_id", targetScanId)
      .order("signal_date", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      return NextResponse.json(
        { error: `シグナル取得エラー: ${error.message}` },
        { status: 500 },
      );
    }

    allSignals.push(...(data as SignalRow[]));
    if (!data || data.length < PAGE_SIZE) break;
  }

  // 集約処理
  const grouped: Record<string, Array<{ s: string; t: string; d: string; bp: number; cp: number }>> = {};
  const seen = new Set<string>();
  const strategyNames: Record<string, string> = {};

  for (const sig of allSignals) {
    const key = `${sig.symbol}:${sig.strategy_id}:${sig.timeframe}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (!grouped[sig.symbol]) {
      grouped[sig.symbol] = [];
    }

    grouped[sig.symbol].push({
      s: sig.strategy_id,
      t: sig.timeframe === "daily" ? "d" : "w",
      d: sig.signal_date,
      bp: sig.buy_price,
      cp: sig.current_price,
    });

    if (!strategyNames[sig.strategy_id]) {
      strategyNames[sig.strategy_id] = sig.strategy_name;
    }
  }

  // スキャン情報
  let scan = null;
  if (targetScanId) {
    const { data: scanData } = await supabase
      .from("signal_scans")
      .select("id, status, total_stocks, processed_stocks, new_signals_count, scan_date, started_at, completed_at")
      .eq("id", targetScanId)
      .single();
    scan = scanData;
  }

  return NextResponse.json({
    signals: grouped,
    strategyNames,
    totalRaw: allSignals.length,
    totalDeduped: seen.size,
    totalStocks: Object.keys(grouped).length,
    scan,
  });
}

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

interface SignalRow {
  symbol: string;
  strategy_id: string;
  strategy_name: string;
  timeframe: string;
  signal_date: string;
  buy_price: number;
  current_price: number;
}

/**
 * GET /api/signals/detected/grouped
 * シグナルを銘柄ごとに集約して返す（ペイロード軽量化）
 *
 * 生データ57K行(~11MB) → 銘柄×戦略×TF重複排除 → ~2-3MB
 *
 * レスポンス形式:
 * {
 *   signals: {
 *     "7203.T": [
 *       { s: "choruko_bb", t: "d", d: "2026-01-15", bp: 1234.5, cp: 1256.0 },
 *       ...
 *     ]
 *   },
 *   scan: { ... }
 * }
 */
export async function GET(request: NextRequest) {
  const supabase = createServiceClient();
  const { searchParams } = request.nextUrl;
  const scanIdParam = searchParams.get("scanId");

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

  // Supabaseからページネーションで全シグナル取得（必要カラムのみ）
  const allSignals: SignalRow[] = [];
  const PAGE_SIZE = 5000;

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

  // 銘柄×戦略×タイムフレームで重複排除（最新のみ保持）
  // allSignals は signal_date DESC でソート済み → 最初に見つかったものが最新
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

    // 戦略名マップ構築（1回だけ）
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

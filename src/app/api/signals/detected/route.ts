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
 * GET /api/signals/detected
 *   ?date=YYYY-MM-DD  → その日のシグナル
 *   ?scanId=N         → 特定スキャンのシグナル
 *   (なし)            → 最新スキャンのシグナル
 */
export async function GET(request: NextRequest) {
  const supabase = createServiceClient();
  const { searchParams } = request.nextUrl;
  const date = searchParams.get("date");
  const scanId = searchParams.get("scanId");

  let query = supabase
    .from("detected_signals")
    .select("*")
    .order("signal_date", { ascending: false })
    .order("symbol", { ascending: true });

  if (scanId) {
    query = query.eq("scan_id", parseInt(scanId, 10));
  } else if (date) {
    query = query.eq("signal_date", date);
  } else {
    // 最新スキャンのシグナル
    const { data: latestScan } = await supabase
      .from("signal_scans")
      .select("id")
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(1)
      .single();

    if (latestScan) {
      query = query.eq("scan_id", latestScan.id);
    } else {
      return NextResponse.json({ signals: [], scan: null });
    }
  }

  const { data: signals, error } = await query;

  if (error) {
    return NextResponse.json(
      { error: `シグナル取得エラー: ${error.message}` },
      { status: 500 },
    );
  }

  // スキャン情報も返す
  const targetScanId = scanId
    ? parseInt(scanId, 10)
    : signals?.[0]?.scan_id;

  let scan = null;
  if (targetScanId) {
    const { data: scanData } = await supabase
      .from("signal_scans")
      .select("id, status, total_stocks, processed_stocks, new_signals_count, scan_date, started_at, completed_at")
      .eq("id", targetScanId)
      .single();
    scan = scanData;
  }

  return NextResponse.json({ signals: signals ?? [], scan });
}

/**
 * PATCH /api/signals/detected
 * 分析結果やSlack通知フラグの更新
 * body: { id, analysis?, slack_notified? }
 */
export async function PATCH(request: NextRequest) {
  const supabase = createServiceClient();
  const body = await request.json();
  const { id, analysis, slack_notified } = body;

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (analysis !== undefined) {
    updates.analysis = analysis;
    updates.analyzed_at = new Date().toISOString();
  }
  if (slack_notified !== undefined) {
    updates.slack_notified = slack_notified;
  }

  const { error } = await supabase
    .from("detected_signals")
    .update(updates)
    .eq("id", id);

  if (error) {
    return NextResponse.json(
      { error: `更新エラー: ${error.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}

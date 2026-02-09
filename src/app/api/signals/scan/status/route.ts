import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const scanId = request.nextUrl.searchParams.get("scanId");
  if (!scanId) {
    return NextResponse.json({ error: "scanId required" }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data, error } = await supabase
    .from("signal_scans")
    .select(
      "id, status, total_stocks, processed_stocks, new_signals_count, scan_date, error_message, started_at, completed_at, progress",
    )
    .eq("id", parseInt(scanId, 10))
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Scan not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}

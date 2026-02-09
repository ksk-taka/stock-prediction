import { NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/supabase/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * GET /api/fundamental/validations-index
 *
 * Supabase から Go/No Go 検証データを一括返却。
 * WatchList の起動時一括読み込み用。
 */

const VALIDATION_TTL = 7 * 24 * 60 * 60 * 1000; // 7日間

export async function GET() {
  try {
    const userId = await getAuthUserId();
    const supabase = await createServerSupabaseClient();

    const since = new Date(Date.now() - VALIDATION_TTL).toISOString();

    const { data, error } = await supabase
      .from("signal_validations")
      .select("symbol, strategy_id, decision, summary")
      .eq("user_id", userId)
      .gte("validated_at", since);

    if (error) throw error;

    // Record<symbol, Record<strategyId, { decision, summary }>>
    const validations: Record<
      string,
      Record<string, { decision: string; summary?: string }>
    > = {};

    for (const row of data ?? []) {
      if (!validations[row.symbol]) validations[row.symbol] = {};
      validations[row.symbol][row.strategy_id] = {
        decision: row.decision,
        summary: row.summary,
      };
    }

    return NextResponse.json({ validations });
  } catch (error) {
    console.error("Validations index error:", error);
    return NextResponse.json({ validations: {} });
  }
}

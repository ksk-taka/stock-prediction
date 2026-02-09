import { NextResponse } from "next/server";

const BUILD_VERSION = "2026-02-09-v4";

export async function GET() {
  return NextResponse.json({
    version: BUILD_VERSION,
    hasSupabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    hasAnonKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    hasServiceKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    timestamp: new Date().toISOString(),
  });
}

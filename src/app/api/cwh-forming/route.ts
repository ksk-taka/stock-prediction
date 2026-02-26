import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
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

    const data = JSON.parse(readFileSync(jsonPath, "utf-8"));
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { stocks: [], error: String(err) },
      { status: 500 },
    );
  }
}

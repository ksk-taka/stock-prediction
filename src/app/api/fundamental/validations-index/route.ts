import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getCacheBaseDir } from "@/lib/cache/cacheDir";

/**
 * GET /api/fundamental/validations-index
 *
 * キャッシュ済みの全銘柄Go/No Go検証データを一括返却。
 * ファイルI/Oのみなので高速。WatchListの起動時一括読み込み用。
 */

const VALIDATION_TTL = 24 * 60 * 60 * 1000; // 24時間

export async function GET() {
  const cacheDir = path.join(getCacheBaseDir(), "fundamental");

  if (!fs.existsSync(cacheDir)) {
    return NextResponse.json({ validations: {} });
  }

  const files = fs.readdirSync(cacheDir).filter((f) => f.includes("_validation_") && f.endsWith(".json"));
  const now = Date.now();
  // Record<symbol, Record<strategyId, { decision, summary }>>
  const validations: Record<string, Record<string, { decision: string; summary?: string }>> = {};

  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(cacheDir, file), "utf-8");
      const entry = JSON.parse(raw);

      if (now - entry.cachedAt > VALIDATION_TTL) continue;

      // ファイル名: "7011_T_validation_macd_trail12_daily_2025-12-05.json"
      // → symbol="7011.T", strategyId="macd_trail12_daily_2025-12-05"
      const baseName = file.replace(".json", "");
      const validationIdx = baseName.indexOf("_validation_");
      if (validationIdx < 0) continue;

      const symbolPart = baseName.slice(0, validationIdx); // "7011_T"
      const strategyId = baseName.slice(validationIdx + "_validation_".length); // "macd_trail12_daily_2025-12-05"
      const symbol = symbolPart.replace(/_/g, "."); // "7011.T"

      if (!validations[symbol]) validations[symbol] = {};
      validations[symbol][strategyId] = {
        decision: entry.data?.decision ?? "unknown",
        summary: entry.data?.summary,
      };
    } catch {
      // skip corrupted files
    }
  }

  return NextResponse.json({ validations });
}

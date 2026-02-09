import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getCacheBaseDir } from "@/lib/cache/cacheDir";

/**
 * GET /api/signals/index
 *
 * キャッシュ済みの全銘柄シグナルデータを一括返却。
 * Yahoo Finance APIは一切呼ばず、ファイルI/Oのみなので高速。
 * シグナルフィルタを全銘柄に適用するために使用。
 *
 * TTLは24時間（通常の1時間より長い）。
 * シグナル検出結果は急激に変わらないため、古いキャッシュも有用。
 */

const INDEX_TTL = 24 * 60 * 60 * 1000; // 24時間（インデックス用に緩和）

export async function GET() {
  const cacheDir = path.join(getCacheBaseDir(), "signals");

  if (!fs.existsSync(cacheDir)) {
    return NextResponse.json({ signals: {}, scannedCount: 0 });
  }

  const files = fs.readdirSync(cacheDir).filter((f) => f.endsWith(".json"));
  const now = Date.now();
  const signals: Record<string, unknown> = {};
  let scannedCount = 0;
  let latestCachedAt = 0;

  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(cacheDir, file), "utf-8");
      const entry = JSON.parse(raw);

      // 24時間以上古いエントリはスキップ
      if (now - entry.cachedAt > INDEX_TTL) continue;

      // ファイル名からシンボルを復元 (例: "1301_T.json" → "1301.T")
      const symbol = file.replace(".json", "").replace(/_/g, ".");

      // activeSignals + recentSignals を抽出
      const data = entry.data;
      signals[symbol] = {
        activeSignals: data?.activeSignals ?? { daily: [], weekly: [] },
        recentSignals: data?.recentSignals ?? { daily: [], weekly: [] },
      };
      scannedCount++;
      if (entry.cachedAt > latestCachedAt) latestCachedAt = entry.cachedAt;
    } catch {
      // skip corrupted files
    }
  }

  return NextResponse.json({
    signals,
    scannedCount,
    lastScannedAt: latestCachedAt > 0 ? new Date(latestCachedAt).toISOString() : null,
  });
}

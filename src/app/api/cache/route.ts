import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getCacheBaseDir } from "@/lib/cache/cacheDir";
import { cleanupOldNotifications } from "@/lib/cache/signalNotificationCache";

export const dynamic = "force-dynamic";

const CACHE_TYPES = ["prices", "stats", "news", "signals", "fundamental", "analysis", "per-history", "market-intelligence"] as const;
type CacheType = typeof CACHE_TYPES[number];

/**
 * GET /api/cache
 * キャッシュ統計情報を取得
 */
export async function GET() {
  const baseDir = getCacheBaseDir();
  const stats: Record<string, { files: number; sizeKB: number }> = {};

  for (const type of CACHE_TYPES) {
    const dir = path.join(baseDir, type);
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
      let totalSize = 0;
      for (const file of files) {
        try {
          const stat = fs.statSync(path.join(dir, file));
          totalSize += stat.size;
        } catch {
          // skip
        }
      }
      stats[type] = { files: files.length, sizeKB: Math.round(totalSize / 1024) };
    } else {
      stats[type] = { files: 0, sizeKB: 0 };
    }
  }

  return NextResponse.json({ stats });
}

/**
 * DELETE /api/cache
 * キャッシュを削除
 *
 * クエリパラメータ:
 * - symbol: 特定銘柄のキャッシュを削除（例: 7203.T）
 * - type: 特定タイプのキャッシュを削除（例: stats, prices）
 * - all: 全キャッシュを削除
 * - cleanup: 古い通知履歴をクリーンアップ
 */
export async function DELETE(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const symbol = searchParams.get("symbol");
  const type = searchParams.get("type") as CacheType | null;
  const all = searchParams.get("all") === "true";
  const cleanup = searchParams.get("cleanup") === "true";

  const baseDir = getCacheBaseDir();
  let deletedFiles = 0;
  const results: string[] = [];

  try {
    // 通知履歴のクリーンアップ
    if (cleanup) {
      const removed = cleanupOldNotifications();
      results.push(`Cleaned up ${removed} old notifications`);
    }

    // 全キャッシュ削除
    if (all) {
      for (const cacheType of CACHE_TYPES) {
        const dir = path.join(baseDir, cacheType);
        if (fs.existsSync(dir)) {
          const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
          for (const file of files) {
            fs.unlinkSync(path.join(dir, file));
            deletedFiles++;
          }
        }
      }
      results.push(`Deleted all cache files: ${deletedFiles} files`);
      return NextResponse.json({ success: true, deletedFiles, results });
    }

    // 特定タイプのキャッシュ削除
    if (type && CACHE_TYPES.includes(type)) {
      const dir = path.join(baseDir, type);
      if (fs.existsSync(dir)) {
        const symbolKey = symbol ? symbol.replace(".", "_") : null;
        const files = fs.readdirSync(dir).filter((f) => {
          if (!f.endsWith(".json")) return false;
          if (symbolKey) return f.startsWith(symbolKey);
          return true;
        });
        for (const file of files) {
          fs.unlinkSync(path.join(dir, file));
          deletedFiles++;
        }
        results.push(`Deleted ${deletedFiles} files from ${type}`);
      }
      return NextResponse.json({ success: true, deletedFiles, results });
    }

    // 特定銘柄のキャッシュを全タイプから削除
    if (symbol) {
      const symbolKey = symbol.replace(".", "_");
      for (const cacheType of CACHE_TYPES) {
        const dir = path.join(baseDir, cacheType);
        if (fs.existsSync(dir)) {
          const files = fs.readdirSync(dir).filter(
            (f) => f.endsWith(".json") && f.startsWith(symbolKey)
          );
          for (const file of files) {
            fs.unlinkSync(path.join(dir, file));
            deletedFiles++;
          }
        }
      }
      results.push(`Deleted ${deletedFiles} cache files for ${symbol}`);
      return NextResponse.json({ success: true, deletedFiles, results });
    }

    // パラメータなしの場合
    return NextResponse.json(
      { error: "Specify symbol, type, all=true, or cleanup=true" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Cache deletion error:", error);
    return NextResponse.json(
      { error: "Failed to delete cache" },
      { status: 500 }
    );
  }
}

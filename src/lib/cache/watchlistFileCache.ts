/**
 * watchlist.json のメモリキャッシュ
 *
 * ファイル読み込みを最小化し、API応答速度を向上させる。
 * TTL: 1時間（変更頻度が低いため）
 */

import { readFileSync } from "fs";
import { join } from "path";

interface WatchlistStock {
  symbol: string;
  name: string;
  market: string;
  marketSegment?: string;
  sectors?: string[];
  favorite?: boolean;
}

interface WatchlistData {
  stocks: WatchlistStock[];
}

// メモリキャッシュ
let cachedData: WatchlistData | null = null;
let cachedAt = 0;
const TTL_MS = 60 * 60 * 1000; // 1時間

/**
 * watchlist.json をメモリキャッシュ付きで読み込み
 */
export function getWatchlistFromFile(): WatchlistStock[] {
  const now = Date.now();

  // キャッシュが有効ならそのまま返す
  if (cachedData && now - cachedAt < TTL_MS) {
    return cachedData.stocks;
  }

  // ファイル読み込み
  try {
    const raw = readFileSync(
      join(process.cwd(), "data", "watchlist.json"),
      "utf-8"
    );
    const parsed = JSON.parse(raw);
    // stocks配列がある場合とない場合に対応
    const stocks = (parsed.stocks ?? parsed) as WatchlistStock[];
    cachedData = { stocks };
    cachedAt = now;
    return stocks;
  } catch {
    // 読み込み失敗時は空配列
    return [];
  }
}

/**
 * 指定シンボルの情報を取得
 */
export function getStockFromFile(symbol: string): WatchlistStock | undefined {
  const stocks = getWatchlistFromFile();
  return stocks.find((s) => s.symbol === symbol);
}

/**
 * キャッシュをクリア（テスト用）
 */
export function _clearWatchlistCache(): void {
  cachedData = null;
  cachedAt = 0;
}

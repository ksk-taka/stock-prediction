import fs from "fs";
import path from "path";
import type { Stock, WatchList } from "@/types";

const WATCHLIST_PATH = path.join(process.cwd(), "data", "watchlist.json");

/**
 * ウォッチリストを読み込む
 */
export function getWatchList(): WatchList {
  const raw = fs.readFileSync(WATCHLIST_PATH, "utf-8");
  return JSON.parse(raw) as WatchList;
}

/**
 * ウォッチリストに銘柄を追加
 */
export function addStock(stock: Stock): WatchList {
  const list = getWatchList();
  if (list.stocks.some((s) => s.symbol === stock.symbol)) {
    return list; // 既に存在
  }
  list.stocks.push(stock);
  list.updatedAt = new Date().toISOString();
  fs.writeFileSync(WATCHLIST_PATH, JSON.stringify(list, null, 2), "utf-8");
  return list;
}

/**
 * ウォッチリストから銘柄を削除
 */
export function removeStock(symbol: string): WatchList {
  const list = getWatchList();
  list.stocks = list.stocks.filter((s) => s.symbol !== symbol);
  list.updatedAt = new Date().toISOString();
  fs.writeFileSync(WATCHLIST_PATH, JSON.stringify(list, null, 2), "utf-8");
  return list;
}

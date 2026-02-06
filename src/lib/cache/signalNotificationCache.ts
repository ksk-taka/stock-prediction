// ============================================================
// シグナル通知履歴キャッシュ（重複通知防止）
// ============================================================

import fs from "fs";
import path from "path";

export interface NotifiedSignal {
  key: string;             // 重複判定キー
  symbol: string;
  strategyId: string;
  timeframe: "daily" | "weekly";
  signalDate: string;
  signalType: "buy" | "sell";
  notifiedAt: string;      // ISO8601
}

interface NotificationStore {
  signals: NotifiedSignal[];
}

const STORE_FILE = path.join(process.cwd(), "data", "notified-signals.json");
const RETENTION_DAYS = 90;

function makeKey(symbol: string, strategyId: string, timeframe: string, signalDate: string): string {
  return `${symbol}:${strategyId}:${timeframe}:${signalDate}`;
}

function loadStore(): NotificationStore {
  try {
    if (fs.existsSync(STORE_FILE)) {
      return JSON.parse(fs.readFileSync(STORE_FILE, "utf-8"));
    }
  } catch {
    // corrupted file, start fresh
  }
  return { signals: [] };
}

function saveStore(store: NotificationStore): void {
  const dir = path.dirname(STORE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), "utf-8");
}

/** 既に通知済みかチェック */
export function hasBeenNotified(
  symbol: string,
  strategyId: string,
  timeframe: "daily" | "weekly",
  signalDate: string,
): boolean {
  const store = loadStore();
  const key = makeKey(symbol, strategyId, timeframe, signalDate);
  return store.signals.some((s) => s.key === key);
}

/** 通知済みとして記録 */
export function markAsNotified(
  symbol: string,
  strategyId: string,
  timeframe: "daily" | "weekly",
  signalDate: string,
  signalType: "buy" | "sell",
): void {
  const store = loadStore();
  const key = makeKey(symbol, strategyId, timeframe, signalDate);

  // 既に存在する場合はスキップ
  if (store.signals.some((s) => s.key === key)) return;

  store.signals.push({
    key,
    symbol,
    strategyId,
    timeframe,
    signalDate,
    signalType,
    notifiedAt: new Date().toISOString(),
  });

  saveStore(store);
}

/** 古い通知履歴をクリーンアップ */
export function cleanupOldNotifications(): number {
  const store = loadStore();
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const before = store.signals.length;

  store.signals = store.signals.filter(
    (s) => new Date(s.notifiedAt).getTime() > cutoff,
  );

  const removed = before - store.signals.length;
  if (removed > 0) saveStore(store);
  return removed;
}

/** 通知済みシグナル一覧を取得 */
export function getNotifiedSignals(): NotifiedSignal[] {
  return loadStore().signals;
}

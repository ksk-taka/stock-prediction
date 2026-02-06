// ============================================================
// シグナル通知設定
// data/notification-config.json で上書き可能
// ============================================================

import fs from "fs";
import path from "path";

export interface StrategyNotificationSetting {
  strategyId: string;
  enabled: boolean;
  timeframes: ("daily" | "weekly")[];
}

export interface PositionSizingConfig {
  defaultAmount: number;   // デフォルト投資金額（円）
  lotSize: number;         // 売買単位（通常100株）
  maxPositionPct: number;  // ポートフォリオに対する最大比率(%)
}

export interface NotificationConfig {
  enabled: boolean;
  strategies: StrategyNotificationSetting[];
  positionSizing: PositionSizingConfig;
  lookbackDays: number;    // シグナル検出対象の直近日数
  sendSummary: boolean;    // 実行サマリーを送信するか
}

const DEFAULT_CONFIG: NotificationConfig = {
  enabled: true,
  strategies: [
    { strategyId: "choruko_bb", enabled: true, timeframes: ["daily", "weekly"] },
    { strategyId: "choruko_shitabanare", enabled: true, timeframes: ["daily", "weekly"] },
    { strategyId: "tabata_cwh", enabled: true, timeframes: ["daily", "weekly"] },
    { strategyId: "rsi_reversal", enabled: true, timeframes: ["daily"] },
    { strategyId: "ma_cross", enabled: false, timeframes: ["daily"] },
    { strategyId: "macd_signal", enabled: false, timeframes: ["daily"] },
    { strategyId: "dip_buy", enabled: false, timeframes: ["daily"] },
  ],
  positionSizing: {
    defaultAmount: 100_000,  // 10万円
    lotSize: 100,            // 100株単位
    maxPositionPct: 10,
  },
  lookbackDays: 3,
  sendSummary: true,
};

const CONFIG_FILE = path.join(process.cwd(), "data", "notification-config.json");

/** 設定を読み込む（JSONファイルがあればマージ） */
export function getNotificationConfig(): NotificationConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
      const override = JSON.parse(raw);
      return { ...DEFAULT_CONFIG, ...override };
    }
  } catch (error) {
    console.warn("[Config] notification-config.json の読み込みに失敗。デフォルト設定を使用:", error);
  }
  return DEFAULT_CONFIG;
}

/** 設定をJSONファイルに保存 */
export function saveNotificationConfig(config: NotificationConfig): void {
  const dir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}

/** 指定戦略が有効かチェック */
export function isStrategyEnabled(
  config: NotificationConfig,
  strategyId: string,
  timeframe: "daily" | "weekly",
): boolean {
  if (!config.enabled) return false;
  const s = config.strategies.find((st) => st.strategyId === strategyId);
  if (!s) return false;
  return s.enabled && s.timeframes.includes(timeframe);
}

/** 推奨ポジションサイズを算出（100株単位に丸め） */
export function calculatePositionSize(
  config: NotificationConfig,
  currentPrice: number,
): { qty: number; amount: number } {
  const { defaultAmount, lotSize } = config.positionSizing;

  if (currentPrice <= 0) return { qty: 0, amount: 0 };

  // 1ロットの金額
  const lotAmount = currentPrice * lotSize;

  // 投資金額内で買えるロット数
  const lots = Math.floor(defaultAmount / lotAmount);

  // 最低1ロット
  const qty = Math.max(lots, 1) * lotSize;
  const amount = Math.round(qty * currentPrice);

  return { qty, amount };
}

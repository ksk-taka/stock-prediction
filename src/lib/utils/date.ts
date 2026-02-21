import { format, subDays, subYears, parseISO } from "date-fns";
import { ja } from "date-fns/locale";

/**
 * 足（ローソク足の時間単位）
 * 1min/5min/15min = 分足, daily = 日足, weekly = 週足, monthly = 月足
 */
export type Period = "1min" | "5min" | "15min" | "daily" | "weekly" | "monthly";

/**
 * 足の種類に応じた取得開始日を返す
 * 分足 → 直近1営業日, 日足 → 1年, 週足 → 3年, 月足 → 10年
 */
export function getStartDate(period: Period): Date {
  const now = new Date();
  switch (period) {
    case "1min":
    case "5min":
    case "15min":
      return subDays(now, 1);
    case "daily":
      return subYears(now, 1);
    case "weekly":
      return subYears(now, 3);
    case "monthly":
      return subYears(now, 10);
  }
}

/**
 * 日付を YYYY-MM-DD 形式にフォーマット
 */
export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? parseISO(date) : date;
  return format(d, "yyyy-MM-dd");
}

/**
 * 日付を日本語表示用にフォーマット
 */
export function formatDateJa(date: Date | string): string {
  const d = typeof date === "string" ? parseISO(date) : date;
  return format(d, "M月d日", { locale: ja });
}

/**
 * 日時を日本語表示用にフォーマット
 */
export function formatDateTimeJa(date: Date | string): string {
  const d = typeof date === "string" ? parseISO(date) : date;
  return format(d, "yyyy年M月d日 HH:mm", { locale: ja });
}

/**
 * 日本市場の取引時間中かどうか（JST 9:00-15:00）
 */
export function isJPMarketOpen(): boolean {
  const now = new Date();
  const jstHour =
    now.getUTCHours() + 9 >= 24
      ? now.getUTCHours() + 9 - 24
      : now.getUTCHours() + 9;
  const day = now.getUTCDay();
  // 土日は休場
  if (day === 0 || day === 6) return false;
  return jstHour >= 9 && jstHour < 15;
}

/**
 * 米国市場の取引時間中かどうか（EST 9:30-16:00）
 */
export function isUSMarketOpen(): boolean {
  const now = new Date();
  const estHour = now.getUTCHours() - 5;
  const estMinute = now.getUTCMinutes();
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return false;
  const minutesSinceMidnight = estHour * 60 + estMinute;
  return minutesSinceMidnight >= 570 && minutesSinceMidnight < 960; // 9:30 - 16:00
}

/**
 * 市場が開いているかどうか
 */
export function isMarketOpen(market: "JP" | "US"): boolean {
  return market === "JP" ? isJPMarketOpen() : isUSMarketOpen();
}

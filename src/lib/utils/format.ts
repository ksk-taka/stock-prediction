/**
 * 数値を通貨形式にフォーマット（日本円）
 */
export function formatJPY(value: number): string {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * 数値を通貨形式にフォーマット（米ドル）
 */
export function formatUSD(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * 市場に応じた通貨フォーマット
 */
export function formatPrice(value: number, market: "JP" | "US"): string {
  return market === "JP" ? formatJPY(value) : formatUSD(value);
}

/**
 * 変動率をフォーマット（+/-付き）
 */
export function formatChange(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

/**
 * 大きな数値を短縮表示（例: 1.2M, 3.5B）
 */
export function formatVolume(value: number): string {
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(1)}B`;
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return value.toString();
}

/**
 * センチメントスコアをラベルに変換
 */
export function sentimentLabel(
  score: number
): "very_negative" | "negative" | "neutral" | "positive" | "very_positive" {
  if (score <= -0.6) return "very_negative";
  if (score <= -0.2) return "negative";
  if (score <= 0.2) return "neutral";
  if (score <= 0.6) return "positive";
  return "very_positive";
}

/**
 * センチメントラベルを日本語に変換
 */
export function sentimentLabelJa(
  label: "very_negative" | "negative" | "neutral" | "positive" | "very_positive"
): string {
  const map = {
    very_negative: "非常にネガティブ",
    negative: "ネガティブ",
    neutral: "中立",
    positive: "ポジティブ",
    very_positive: "非常にポジティブ",
  };
  return map[label];
}

/**
 * 時価総額を億円/兆円単位でフォーマット
 */
export function formatMarketCap(value: number | null | undefined): string {
  if (value == null || value <= 0) return "－";
  const oku = value / 100_000_000;
  if (oku >= 10_000) {
    return `${(oku / 10_000).toFixed(1)}兆円`;
  }
  if (oku >= 100) {
    return `${Math.round(oku).toLocaleString("ja-JP")}億円`;
  }
  return `${oku.toFixed(1)}億円`;
}

/**
 * 時価総額から規模を分類
 * 小型: <500億円, 中型: 500億~3000億円, 大型: >=3000億円
 */
export type CapSize = "small" | "mid" | "large";

export function getCapSize(marketCap: number | null | undefined): CapSize | null {
  if (marketCap == null || marketCap <= 0) return null;
  const oku = marketCap / 100_000_000;
  if (oku < 500) return "small";
  if (oku < 3000) return "mid";
  return "large";
}

export const CAP_SIZE_LABELS: Record<CapSize, string> = {
  small: "小型株",
  mid: "中型株",
  large: "大型株",
};

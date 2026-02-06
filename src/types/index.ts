// 銘柄情報
export interface Stock {
  symbol: string;           // 銘柄コード（例: "7203.T", "AAPL"）
  name: string;             // 銘柄名
  market: "JP" | "US";      // 市場
  sector?: string;          // セクター
}

// 株価データ
export interface PriceData {
  date: string;             // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  adjustedClose?: number;
}

// 日次分析データ
export interface DailyAnalysis {
  date: string;
  symbol: string;
  price: PriceData;
  sentiment: SentimentData;
  news: NewsItem[];
  analysis: LLMAnalysis;
  cachedAt: string;
}

// センチメントデータ
export interface SentimentData {
  score: number;            // -1.0 〜 +1.0
  label: "very_negative" | "negative" | "neutral" | "positive" | "very_positive";
  confidence: number;       // 0.0 〜 1.0
  sources: {
    news: number;           // ニュースからのスコア
    sns: number;            // SNSからのスコア
    analyst: number;        // アナリスト評価からのスコア
  };
}

// ニュース項目
export interface NewsItem {
  title: string;
  source: string;
  url: string;
  publishedAt: string;
  summary?: string;
  sentiment?: "positive" | "negative" | "neutral";
}

// LLM分析結果
export interface LLMAnalysis {
  summary: string;          // 総合的な分析サマリー（200字程度）
  outlook: "bullish" | "neutral" | "bearish";  // 見通し
  keyPoints: string[];      // 重要ポイント（3-5個）
  risks: string[];          // リスク要因
  opportunities: string[];  // 好材料
  priceTarget?: {
    short: number;          // 短期目標
    medium: number;         // 中期目標
  };
  confidence: "high" | "medium" | "low";
  analyzedAt: string;
}

// ウォッチリスト
export interface WatchList {
  stocks: Stock[];
  updatedAt: string;
}

// 銘柄情報
export interface Stock {
  symbol: string;           // 銘柄コード（例: "7203.T", "AAPL"）
  name: string;             // 銘柄名
  market: "JP" | "US";      // 市場
  marketSegment?: "プライム" | "スタンダード" | "グロース";  // 市場区分
  sectors?: string[];        // セクター（複数可）
  fundamental?: {
    judgment: "bullish" | "neutral" | "bearish";
    memo: string;            // 一言メモ（summaryから抽出）
    analyzedAt: string;
  };
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

// Perplexity ファンダメンタルズ調査結果
export interface FundamentalResearchData {
  valuationReason: string;     // 割安/割高の理由
  capitalPolicy: string;       // 資本政策・是正アクション
  earningsTrend: string;       // 直近の業績トレンド
  catalystAndRisk: string;     // カタリスト・リスク
  rawText: string;             // Perplexity原文（全文）
}

// Ollama ファンダメンタルズ分析結果
export interface FundamentalAnalysis {
  judgment: "bullish" | "neutral" | "bearish";
  analysisLogic: {
    valuationReason: string;   // なぜ今安いのか、解消されるか
    roeCapitalPolicy: string;  // 経営陣の本気度と具体的アクション
    growthDriver: string;      // 本業の伸びしろ
  };
  riskScenario: string;        // 投資前提が崩れる最悪のケース
  summary: string;             // 200字程度の総合判定
  analyzedAt: string;
}

// Ollama シグナル検証結果（Go/No Go判定）
export interface SignalValidation {
  decision: "entry" | "wait" | "avoid";
  signalEvaluation: string;    // テクニカルシグナルをファンダが支持しているか
  riskFactor: string;          // シグナルを打ち消す悪材料
  catalyst: string;            // 上昇を加速させる材料
  summary: string;             // 100字程度の結論
  validatedAt: string;
}

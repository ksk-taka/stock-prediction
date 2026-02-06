import type { LLMAnalysis, SentimentData, NewsItem, PriceData } from "@/types";
import { sentimentLabel } from "@/lib/utils/format";

const OLLAMA_BASE_URL =
  process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const MODEL = "qwen2.5:14b";

/**
 * Ollamaにリクエストを送信
 */
async function ollamaGenerate(prompt: string, system?: string): Promise<string> {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      system,
      stream: false,
      options: { temperature: 0.3 },
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama error: ${response.status}`);
  }

  const data = await response.json();
  return data.response ?? "";
}

/**
 * ニューステキストからセンチメントスコアを算出
 */
export async function analyzeSentiment(
  newsItems: NewsItem[],
  snsOverview: string,
  analystRating: string
): Promise<SentimentData> {
  const prompt = `以下の株式関連情報のセンチメント（感情）を分析してください。

## ニュース
${newsItems.map((n) => `- ${n.title}: ${n.summary ?? ""}`).join("\n")}

## SNS評判
${snsOverview}

## アナリスト評価
${analystRating}

以下のJSON形式のみで出力してください。他のテキストは不要です。
{
  "news_score": -1.0〜1.0の数値,
  "sns_score": -1.0〜1.0の数値,
  "analyst_score": -1.0〜1.0の数値,
  "confidence": 0.0〜1.0の数値
}`;

  try {
    const response = await ollamaGenerate(prompt);
    const jsonMatch = response.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) throw new Error("No JSON in response");

    const parsed = JSON.parse(jsonMatch[0]);
    const newsScore = clampScore(parsed.news_score ?? 0);
    const snsScore = clampScore(parsed.sns_score ?? 0);
    const analystScore = clampScore(parsed.analyst_score ?? 0);
    const overallScore = (newsScore * 0.4 + snsScore * 0.3 + analystScore * 0.3);

    return {
      score: Math.round(overallScore * 100) / 100,
      label: sentimentLabel(overallScore),
      confidence: clamp01(parsed.confidence ?? 0.5),
      sources: {
        news: newsScore,
        sns: snsScore,
        analyst: analystScore,
      },
    };
  } catch {
    // Ollama未起動時のフォールバック
    return {
      score: 0,
      label: "neutral",
      confidence: 0,
      sources: { news: 0, sns: 0, analyst: 0 },
    };
  }
}

/**
 * 全データを統合してLLM分析を実行
 */
export async function runAnalysis(
  symbol: string,
  name: string,
  currentPrice: number,
  change: number,
  priceData: PriceData[],
  newsItems: NewsItem[],
  snsOverview: string,
  analystRating: string
): Promise<LLMAnalysis> {
  const priceSummary = priceData
    .slice(-20)
    .map(
      (p) =>
        `${p.date}: 始${p.open} 高${p.high} 安${p.low} 終${p.close} 出来高${p.volume}`
    )
    .join("\n");

  const newsSummary = newsItems
    .map(
      (n) =>
        `[${n.sentiment ?? "neutral"}] ${n.title} (${n.source}, ${n.publishedAt})\n  ${n.summary ?? ""}`
    )
    .join("\n");

  const prompt = `あなたは経験豊富な株式アナリストです。
以下の情報を元に、この銘柄の投資判断を分析してください。

## 分析対象
銘柄: ${symbol} ${name}
現在株価: ${currentPrice}円
前日比: ${change}%

## 株価データ（直近20日）
${priceSummary}

## ニュース・SNS情報
${newsSummary}

## SNS評判
${snsOverview}

## アナリスト評価
${analystRating}

## 出力形式（JSON）
以下のJSON形式のみで出力してください。他のテキストは不要です。
{
  "summary": "200字程度の総合分析",
  "outlook": "bullish" | "neutral" | "bearish",
  "keyPoints": ["重要ポイント1", "重要ポイント2", "重要ポイント3"],
  "risks": ["リスク1", "リスク2"],
  "opportunities": ["好材料1", "好材料2"],
  "priceTarget": {
    "short": 短期目標株価（数値）,
    "medium": 中期目標株価（数値）
  },
  "confidence": "high" | "medium" | "low"
}`;

  try {
    const response = await ollamaGenerate(prompt);
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      summary: parsed.summary ?? "分析結果を取得できませんでした",
      outlook: parsed.outlook ?? "neutral",
      keyPoints: parsed.keyPoints ?? [],
      risks: parsed.risks ?? [],
      opportunities: parsed.opportunities ?? [],
      priceTarget: parsed.priceTarget,
      confidence: parsed.confidence ?? "low",
      analyzedAt: new Date().toISOString(),
    };
  } catch {
    return {
      summary:
        "Ollamaに接続できませんでした。Ollamaが起動しているか確認してください。",
      outlook: "neutral",
      keyPoints: [],
      risks: [],
      opportunities: [],
      confidence: "low",
      analyzedAt: new Date().toISOString(),
    };
  }
}

function clampScore(v: number): number {
  return Math.max(-1, Math.min(1, v));
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

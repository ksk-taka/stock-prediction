import type { NewsItem } from "@/types";

const PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions";

const PERPLEXITY_SYSTEM_PROMPT = `あなたは株式市場の情報収集を専門とするリサーチャーです。

## タスク
指定された銘柄について、最新のニュース・SNS評判・アナリスト評価を調査してください。

## 参照すべき情報源
- 経済ニュース: 日経新聞、ロイター、Bloomberg、Yahoo!ファイナンス
- SNS: Twitter/X、株式掲示板（Yahoo!掲示板、株探など）
- IR情報: 企業公式サイト、決算短信、プレスリリース
- アナリストレポート: 証券会社のレーティング情報

## 出力形式
必ず以下のJSON形式で出力してください。JSON以外のテキストは含めないでください。
{
  "news": [
    {
      "title": "ニュースタイトル",
      "source": "情報源名",
      "url": "URL（不明な場合は空文字）",
      "publishedAt": "YYYY-MM-DD",
      "summary": "要約（100字程度）",
      "sentiment": "positive" | "negative" | "neutral"
    }
  ],
  "snsOverview": "SNSでの評判の概要（200字程度）",
  "analystRating": "アナリスト評価の概要（200字程度）"
}`;

function buildQuery(name: string, symbol: string): string {
  return `${name}（${symbol}）について、以下の情報を調査してください：

1. **最新ニュース**（過去1週間）
   - 業績関連、事業戦略、M&A、提携など重要ニュース

2. **SNS/掲示板の評判**
   - 個人投資家の反応、話題になっているポイント

3. **アナリスト評価**
   - 証券会社のレーティング、目標株価

4. **IR情報**
   - 直近の決算、業績修正、配当情報

※各情報について、情報源と日付を明記してください。`;
}

interface PerplexityResponse {
  news: NewsItem[];
  snsOverview: string;
  analystRating: string;
}

/**
 * Perplexity APIでニュース・SNS情報を収集
 */
export async function fetchNewsAndSentiment(
  symbol: string,
  name: string
): Promise<PerplexityResponse> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey || apiKey === "pplx-xxxx") {
    // APIキー未設定時はダミーデータを返す
    return {
      news: [
        {
          title: `${name}の最新動向（サンプル）`,
          source: "サンプルデータ",
          url: "",
          publishedAt: new Date().toISOString().split("T")[0],
          summary:
            "Perplexity APIキーが未設定のため、サンプルデータを表示しています。.env.localにPERPLEXITY_API_KEYを設定してください。",
          sentiment: "neutral" as const,
        },
      ],
      snsOverview: "APIキー未設定のためデータなし",
      analystRating: "APIキー未設定のためデータなし",
    };
  }

  const response = await fetch(PERPLEXITY_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "sonar",
      messages: [
        { role: "system", content: PERPLEXITY_SYSTEM_PROMPT },
        { role: "user", content: buildQuery(name, symbol) },
      ],
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    throw new Error(`Perplexity API error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content ?? "";

  // JSONを抽出
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { news: [], snsOverview: content, analystRating: "" };
  }

  try {
    return JSON.parse(jsonMatch[0]) as PerplexityResponse;
  } catch {
    return { news: [], snsOverview: content, analystRating: "" };
  }
}

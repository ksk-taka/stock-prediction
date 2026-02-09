import type { NewsItem, FundamentalResearchData } from "@/types";

// ============================================================
// Gemini + Grounding with Google Search（Perplexity代替）
// ============================================================

const GEMINI_GROUNDING_MODEL = "gemini-2.5-flash-lite";

function getGeminiGroundingUrl(): string {
  const apiKey = process.env.GEMINI_API_KEY;
  return `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_GROUNDING_MODEL}:generateContent?key=${apiKey}`;
}

async function callGeminiWithGrounding(
  query: string,
  systemPrompt: string,
  timeoutMs = 120000,
  maxRetries = 3
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: query }] }],
    systemInstruction: { parts: [{ text: systemPrompt }] },
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
  };

  const deadline = Date.now() + timeoutMs;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("Gemini Grounding API: タイムアウト");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    try {
      const res = await fetch(getGeminiGroundingUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (res.status === 429 && attempt < maxRetries) {
        clearTimeout(timer);
        // retryDelay をレスポンスから抽出、なければ指数バックオフ
        const errorBody = await res.text().catch(() => "");
        const delayMatch = errorBody.match(/"retryDelay":\s*"(\d+)s?"/);
        const waitSec = delayMatch ? parseInt(delayMatch[1], 10) : Math.min(30 * (attempt + 1), 90);
        console.log(`[Gemini] 429 rate limited, retrying in ${waitSec}s (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise((r) => setTimeout(r, waitSec * 1000));
        continue;
      }

      if (!res.ok) {
        const errorText = await res.text().catch(() => "");
        throw new Error(`Gemini Grounding API error: ${res.status} ${errorText}`);
      }
      const data = await res.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error("Gemini Grounding API: max retries exceeded (429)");
}

// ============================================================
// ニュース・SNS情報収集
// ============================================================

const NEWS_SYSTEM_PROMPT = `あなたは株式市場の情報収集を専門とするリサーチャーです。

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

function buildNewsQuery(name: string, symbol: string): string {
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

interface NewsResponse {
  news: NewsItem[];
  snsOverview: string;
  analystRating: string;
}

/**
 * Gemini Grounding でニュース・SNS情報を収集
 */
export async function fetchNewsAndSentiment(
  symbol: string,
  name: string
): Promise<NewsResponse> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      news: [
        {
          title: `${name}の最新動向（サンプル）`,
          source: "サンプルデータ",
          url: "",
          publishedAt: new Date().toISOString().split("T")[0],
          summary:
            "GEMINI_API_KEYが未設定のため、サンプルデータを表示しています。.env.localにGEMINI_API_KEYを設定してください。",
          sentiment: "neutral" as const,
        },
      ],
      snsOverview: "APIキー未設定のためデータなし",
      analystRating: "APIキー未設定のためデータなし",
    };
  }

  const content = await callGeminiWithGrounding(
    buildNewsQuery(name, symbol),
    NEWS_SYSTEM_PROMPT
  );

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { news: [], snsOverview: content, analystRating: "" };
  }

  try {
    return JSON.parse(jsonMatch[0]) as NewsResponse;
  } catch {
    return { news: [], snsOverview: content, analystRating: "" };
  }
}

// ============================================================
// ファンダメンタルズ調査
// ============================================================

const FUNDAMENTAL_SYSTEM_PROMPT = `あなたは日本株式市場のファンダメンタルズ分析を専門とするリサーチャーです。
指定された銘柄について、投資判断に必要な事実情報を収集してください。
出力は日本語の箇条書きで、事実と数値を重視してください。`;

function buildFundamentalQuery(
  name: string,
  ticker: string,
  pbr: number,
  per: number
): string {
  return `日本株の「${name} (証券コード: ${ticker})」について、投資判断に必要な事実情報を収集してください。
**現在、PBRは${pbr}倍、PERは${per}倍で推移しています。**

この「現在の評価」を前提に、以下の観点で直近1年以内のニュースや開示情報をレポートしてください。

1. **【割安/割高の理由】（最重要）**:
   - 現在のPBR ${pbr}倍 という評価は、何らかの悪材料（訴訟、減損、市場縮小懸念）によるものか？
   - それとも業績は堅調だが、単に放置されているだけか？

2. **【資本政策・是正アクション】**:
   - 経営陣は「PBR1倍割れ」や「株価低迷」に対して具体的なコメントや対策（自社株買い・増配）を発表しているか？
   - 中期経営計画でのROE目標値とその進捗。

3. **【直近の業績トレンド】**:
   - 直近決算はコンセンサス予想に対してどうだったか？
   - 一過性の特益（資産売却益など）を除いた「本業」は伸びているか？

4. **【カタリスト・リスク】**:
   - アクティビストの保有や、M&A、事業再編の動き。
   - 今後の業績を下押しする具体的なリスク要因。

出力は日本語の箇条書きで、事実と数値を重視してください。`;
}

/**
 * Gemini Grounding でファンダメンタルズ情報を収集
 */
export async function fetchFundamentalResearch(
  symbol: string,
  name: string,
  ticker: string,
  stats: { pbr: number; per: number }
): Promise<FundamentalResearchData> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      valuationReason: "APIキー未設定のためデータなし",
      capitalPolicy: "APIキー未設定のためデータなし",
      earningsTrend: "APIキー未設定のためデータなし",
      catalystAndRisk: "APIキー未設定のためデータなし",
      rawText: "GEMINI_API_KEYが未設定のため、サンプルデータを表示しています。",
    };
  }

  const content = await callGeminiWithGrounding(
    buildFundamentalQuery(name, ticker, stats.pbr, stats.per),
    FUNDAMENTAL_SYSTEM_PROMPT
  );

  return parseFundamentalResponse(content);
}

/**
 * テキスト応答を【】ヘッダーでセクション分割
 */
function parseFundamentalResponse(text: string): FundamentalResearchData {
  const sections: Record<string, string> = {};
  let currentKey = "";
  const lines = text.split("\n");

  for (const line of lines) {
    const headerMatch = line.match(/【(.+?)】/);
    if (headerMatch) {
      currentKey = headerMatch[1];
      sections[currentKey] = "";
    } else if (currentKey) {
      sections[currentKey] += line + "\n";
    }
  }

  const find = (keywords: string[]): string => {
    for (const key of Object.keys(sections)) {
      if (keywords.some((kw) => key.includes(kw))) {
        return sections[key].trim();
      }
    }
    return "";
  };

  return {
    valuationReason: find(["割安", "割高", "理由"]),
    capitalPolicy: find(["資本政策", "是正", "アクション"]),
    earningsTrend: find(["業績", "トレンド"]),
    catalystAndRisk: find(["カタリスト", "リスク"]),
    rawText: text,
  };
}

// ============================================================
// 市場インテリジェンス
// ============================================================

export interface MarketIntelligence {
  summary: string;
  sectorHighlights: string;
  macroFactors: string;
  risks: string;
  opportunities: string;
  rawText: string;
}

/**
 * Gemini Grounding で市場全体の市況情報を収集
 */
export async function fetchMarketIntelligence(): Promise<MarketIntelligence> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      summary: "APIキー未設定のためデータなし",
      sectorHighlights: "",
      macroFactors: "",
      risks: "",
      opportunities: "",
      rawText: "GEMINI_API_KEYが未設定のため、サンプルデータを表示しています。",
    };
  }

  const query = `日本株式市場の最新市況について、以下の観点でレポートしてください。

1. **【市場概況】**
   - 日経平均・TOPIXの直近トレンドとテクニカル水準（サポート/レジスタンス）
   - 売買代金、外国人投資家の動向

2. **【注目セクター】**
   - 直近1週間で特に強い/弱いセクター
   - 高市政権「重点投資対象17分野」に関連する動き
     （AI・半導体、量子、核融合、航空・宇宙、防衛、サイバーセキュリティ、
      バイオ、創薬・医療、フードテック、マテリアル、エネルギー・GX、
      造船、港湾ロジスティクス、海洋、防災・国土強靭化、情報通信、コンテンツ）

3. **【マクロ要因】**
   - 金利（日銀・FRB）、為替、GDP等の投資判断に影響する要因

4. **【リスク要因】**
   - 現在の市場リスク

5. **【投資機会】**
   - 注目すべきテーマや動き

出力は日本語の箇条書きで、事実と数値を重視してください。`;

  const systemPrompt = "あなたは日本株式市場の専門エコノミストです。市場全体の動向を分析してください。出力は日本語の箇条書きで、事実と数値を重視してください。";

  const content = await callGeminiWithGrounding(query, systemPrompt);

  return parseMarketIntelligence(content);
}

function parseMarketIntelligence(text: string): MarketIntelligence {
  const sections: Record<string, string> = {};
  let currentKey = "";
  const lines = text.split("\n");

  for (const line of lines) {
    const headerMatch = line.match(/【(.+?)】/);
    if (headerMatch) {
      currentKey = headerMatch[1];
      sections[currentKey] = "";
    } else if (currentKey) {
      sections[currentKey] += line + "\n";
    }
  }

  const find = (keywords: string[]): string => {
    for (const key of Object.keys(sections)) {
      if (keywords.some((kw) => key.includes(kw))) {
        return sections[key].trim();
      }
    }
    return "";
  };

  return {
    summary: find(["市場", "概況"]),
    sectorHighlights: find(["セクター", "注目"]),
    macroFactors: find(["マクロ", "要因"]),
    risks: find(["リスク"]),
    opportunities: find(["投資", "機会"]),
    rawText: text,
  };
}

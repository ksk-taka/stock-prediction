import type { LLMAnalysis, SentimentData, NewsItem, PriceData, FundamentalAnalysis, SignalValidation } from "@/types";
import { sentimentLabel } from "@/lib/utils/format";

// ============================================================
// Provider configuration
// ============================================================

type ProviderName = "gemini" | "groq" | "ollama";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";

class ProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderError";
  }
}

function resolveProviderChain(): ProviderName[] {
  const forced = process.env.LLM_PROVIDER as ProviderName | undefined;
  if (forced && ["gemini", "groq", "ollama"].includes(forced)) {
    return [forced];
  }
  const chain: ProviderName[] = [];
  if (process.env.GEMINI_API_KEY) chain.push("gemini");
  if (process.env.GROQ_API_KEY) chain.push("groq");
  chain.push("ollama");
  return chain;
}

// ============================================================
// Provider implementations
// ============================================================

async function callGemini(prompt: string, system: string | undefined, timeoutMs: number): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY!;
  const model = process.env.GEMINI_MODEL ?? "gemma-3-27b-it";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 8192 },
  };
  if (system) {
    body.systemInstruction = { parts: [{ text: system }] };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new ProviderError(`Gemini ${res.status}`);
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  } finally {
    clearTimeout(timer);
  }
}

async function callGroq(prompt: string, system: string | undefined, timeoutMs: number): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY!;
  const messages: Array<{ role: string; content: string }> = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: prompt });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages,
        temperature: 0.3,
        max_tokens: 8192,
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new ProviderError(`Groq ${res.status}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? "";
  } finally {
    clearTimeout(timer);
  }
}

async function callOllama(prompt: string, system: string | undefined, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen2.5:14b",
        prompt,
        system,
        stream: false,
        options: { temperature: 0.3, num_ctx: 8192 },
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new ProviderError(`Ollama ${res.status}`);
    const data = await res.json();
    return data.response ?? "";
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================
// Fallback orchestrator
// ============================================================

const providerFns: Record<ProviderName, (p: string, s: string | undefined, t: number) => Promise<string>> = {
  gemini: callGemini,
  groq: callGroq,
  ollama: callOllama,
};

async function llmGenerate(prompt: string, system?: string, timeoutMs = 120000): Promise<string> {
  const chain = resolveProviderChain();
  let lastError: Error | null = null;

  for (const provider of chain) {
    try {
      const result = await providerFns[provider](prompt, system, timeoutMs);
      console.log(`[LLM] provider: ${provider}`);
      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[LLM] ${provider} failed: ${lastError.message}, trying next...`);
    }
  }
  throw lastError ?? new Error("No LLM providers available");
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
    const response = await llmGenerate(prompt);
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
    // LLM未接続時のフォールバック
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
    const response = await llmGenerate(prompt);
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
        "LLMに接続できませんでした。APIキーまたはOllamaの起動を確認してください。",
      outlook: "neutral",
      keyPoints: [],
      risks: [],
      opportunities: [],
      confidence: "low",
      analyzedAt: new Date().toISOString(),
    };
  }
}

/**
 * ファンダメンタルズ分析（PBR=PER×ROE分解）
 */
export async function runFundamentalAnalysis(
  symbol: string,
  name: string,
  stats: {
    per: number | null;
    pbr: number | null;
    roe: number | null;
    dividendYield: number | null;
    equityRatio: number | null;
  },
  perplexitySummary: string,
  newsSummary?: string
): Promise<FundamentalAnalysis> {
  const fmt = (v: number | null, suffix: string) =>
    v != null ? `${v}${suffix}` : "N/A";

  const prompt = `以下の銘柄について、ファンダメンタルズの観点から「投資価値」を分析せよ。

### 対象銘柄
${name} (${symbol})

### 1. 定量データ（現在の通信簿）
* PER: ${fmt(stats.per, "倍")}
* PBR: ${fmt(stats.pbr, "倍")}
* ROE: ${stats.roe != null ? fmt(Math.round(stats.roe * 1000) / 10, "%") : "N/A"}
* 配当利回り: ${stats.dividendYield != null ? fmt(Math.round(stats.dividendYield * 1000) / 10, "%") : "N/A"}
* 自己資本比率: ${fmt(stats.equityRatio, "%")}

### 2. 定性情報（Perplexity調査結果）
${perplexitySummary}
${newsSummary ? `\n### 2.5 直近ニュース・市場の反応\n${newsSummary}\n` : ""}
### 3. 分析タスク（思考プロセス）

**Step 1: PBR = PER × ROE の分解**
* 現在のPBR（${fmt(stats.pbr, "倍")}）は、ROE（${stats.roe != null ? fmt(Math.round(stats.roe * 1000) / 10, "%") : "N/A"}）の実力に見合っているか？
* 「PBRが低い理由」は、市場の誤解か、それとも妥当な評価（低収益・成長性なし）か？定性情報から推測せよ。

**Step 2: ROE向上のシナリオ検証**
* 分子（利益）を増やす具体的な「成長エンジン」はあるか？
* 分母（資本）を減らす「還元アクション（自社株買い・増配）」はあるか？
* ※注意: 「検討中」は評価せず、「決定/実行」のみを評価せよ。

**Step 3: バリュートラップ（安かろう悪かろう）の排除**
* 数字は割安だが、将来的に事業が縮小するリスク（特需剥落、構造不況など）はないか？

### 4. 出力フォーマット
余計な前置きは省略し、以下のJSON形式のみで出力してください。
{
  "judgment": "bullish" | "neutral" | "bearish",
  "analysisLogic": {
    "valuationReason": "なぜ今安いのか、その理由は解消されるか",
    "roeCapitalPolicy": "経営陣の本気度と具体的なアクション",
    "growthDriver": "本業の伸びしろ"
  },
  "riskScenario": "投資前提が崩れる最悪のケース",
  "summary": "200字程度の総合判定"
}`;

  try {
    const response = await llmGenerate(prompt);
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      judgment: parsed.judgment ?? "neutral",
      analysisLogic: {
        valuationReason: parsed.analysisLogic?.valuationReason ?? "",
        roeCapitalPolicy: parsed.analysisLogic?.roeCapitalPolicy ?? "",
        growthDriver: parsed.analysisLogic?.growthDriver ?? "",
      },
      riskScenario: parsed.riskScenario ?? "",
      summary: parsed.summary ?? "分析結果を取得できませんでした",
      analyzedAt: new Date().toISOString(),
    };
  } catch {
    return {
      judgment: "neutral",
      analysisLogic: {
        valuationReason: "",
        roeCapitalPolicy: "",
        growthDriver: "",
      },
      riskScenario: "",
      summary: "LLMに接続できませんでした。APIキーまたはOllamaの起動を確認してください。",
      analyzedAt: new Date().toISOString(),
    };
  }
}

/**
 * シグナル検証（Go/No Go判定）
 */
export async function validateSignal(
  symbol: string,
  name: string,
  signal: { description: string; strategyName: string; confidence?: string },
  stats: {
    per: number | null;
    pbr: number | null;
    roe: number | null;
    dividendYield: number | null;
  },
  perplexitySummary: string
): Promise<SignalValidation> {
  const fmt = (v: number | null, suffix: string) =>
    v != null ? `${v}${suffix}` : "N/A";

  const prompt = `あなたは「テクニカルとファンダメンタルズを統合して判断する」ポートフォリオマネージャーです。
私の開発したアルゴリズムが**「買いシグナル」**を出しましたが、それが「本物」か「ダマシ（罠）」かを判定してください。

### 対象銘柄
${name} (${symbol})

### 1. 入力されたシグナル（俺のシステム）
* **判定結果**: ${signal.description}
* **戦略**: ${signal.strategyName}
${signal.confidence ? `* **信頼度**: ${signal.confidence}` : ""}

### 2. 定量データ（現在のバリュエーション）
* PER: ${fmt(stats.per, "倍")}
* PBR: ${fmt(stats.pbr, "倍")}
* ROE: ${stats.roe != null ? fmt(Math.round(stats.roe * 1000) / 10, "%") : "N/A"}
* 配当利回り: ${stats.dividendYield != null ? fmt(Math.round(stats.dividendYield * 1000) / 10, "%") : "N/A"}

### 3. 定性情報（Perplexity調査結果）
${perplexitySummary}

### 4. 最終判定タスク
以下のロジックで「Go / No Go」を判定せよ。

**Step 1: 「落ちるナイフ」チェック**
* テクニカルは「買い」と言っているが、Perplexityの情報に「決算ミス」「不祥事」「減配」などの**明確な悪材料**はないか？
* 悪材料がある場合、シグナルは「一時的なリバウンド（ダマシ）」の可能性が高い。

**Step 2: 「田端メソッド」適合チェック**
* PBR × PER × ROE の観点で、株価が上昇する余地（割安是正や成長）があるか？
* 特に「PBR1倍割れ」かつ「改善策あり」の場合、テクニカルの買いシグナルは**特大のチャンス**となる。

**Step 3: 結論**
* テクニカルのシグナルに乗るべきか、見送るべきか。

### 5. 出力フォーマット
余計な前置きは省略し、以下のJSON形式のみで出力してください。
{
  "decision": "entry" | "wait" | "avoid",
  "signalEvaluation": "テクニカルのシグナルを、ファンダメンタルズが支持しているか？",
  "riskFactor": "シグナルを打ち消すほどの悪材料があるか？",
  "catalyst": "上昇を加速させる材料",
  "summary": "100字程度の結論"
}`;

  try {
    const response = await llmGenerate(prompt);
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      decision: parsed.decision ?? "wait",
      signalEvaluation: parsed.signalEvaluation ?? "",
      riskFactor: parsed.riskFactor ?? "",
      catalyst: parsed.catalyst ?? "",
      summary: parsed.summary ?? "判定結果を取得できませんでした",
      validatedAt: new Date().toISOString(),
    };
  } catch {
    return {
      decision: "wait",
      signalEvaluation: "",
      riskFactor: "",
      catalyst: "",
      summary: "LLMに接続できませんでした。APIキーまたはOllamaの起動を確認してください。",
      validatedAt: new Date().toISOString(),
    };
  }
}

function clampScore(v: number): number {
  return Math.max(-1, Math.min(1, v));
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

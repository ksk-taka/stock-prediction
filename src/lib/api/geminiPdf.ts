/**
 * Gemini API PDFネイティブ入力クライアント
 *
 * 決算資料PDFをbase64エンコードしてGemini APIに直接送信。
 * unpdfテキスト抽出と異なり、表・グラフ・図表も画像として理解できる。
 *
 * 対応モデル:
 *   - gemini-2.5-flash (無料250RPD)
 *   - gemini-2.5-pro   (無料100RPD)
 */

// ---------- 型定義 ----------

export interface GeminiPdfInput {
  textPrompt: string;
  systemInstruction?: string;
  pdfs: { filename: string; data: Buffer }[];
}

export interface GeminiPdfOptions {
  model?: "flash" | "pro";
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface GeminiPdfResponse {
  text: string;
  model: string;
  usage?: { prompt: number; completion: number; total: number };
}

// ---------- モデルマッピング ----------

const MODEL_MAP: Record<string, string> = {
  flash: "gemini-2.5-flash",
  pro: "gemini-2.5-pro",
};

// ---------- メイン関数 ----------

export async function callGeminiWithPdf(
  input: GeminiPdfInput,
  options?: GeminiPdfOptions,
): Promise<GeminiPdfResponse> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const modelKey = options?.model ?? "flash";
  const modelId = MODEL_MAP[modelKey] ?? MODEL_MAP.flash;
  const temperature = options?.temperature ?? 0.1;
  const maxOutputTokens = options?.maxOutputTokens ?? 65536;
  const timeoutMs = options?.timeoutMs ?? 300_000; // 5分
  const maxRetries = options?.maxRetries ?? 5;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;

  // リクエストボディ構築
  const parts: Array<Record<string, unknown>> = [
    { text: input.textPrompt },
  ];

  let totalPdfBytes = 0;
  for (const pdf of input.pdfs) {
    totalPdfBytes += pdf.data.length;
    parts.push({
      inlineData: {
        mimeType: "application/pdf",
        data: pdf.data.toString("base64"),
      },
    });
  }

  console.log(
    `[GeminiPdf] モデル: ${modelId}, PDF: ${input.pdfs.length}件 (${(totalPdfBytes / 1024 / 1024).toFixed(1)}MB), プロンプト: ${input.textPrompt.length.toLocaleString()}文字`,
  );

  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts }],
    generationConfig: { temperature, maxOutputTokens },
  };

  if (input.systemInstruction) {
    body.systemInstruction = {
      parts: [{ text: input.systemInstruction }],
    };
  }

  // リトライ付きリクエスト
  const deadline = Date.now() + timeoutMs;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("[GeminiPdf] タイムアウト");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      // 429 レート制限 → リトライ
      if (res.status === 429 && attempt < maxRetries) {
        clearTimeout(timer);
        const errorBody = await res.text().catch(() => "");
        const delayMatch = errorBody.match(/"retryDelay":\s*"(\d+)s?"/);
        const parsedDelay = delayMatch ? parseInt(delayMatch[1], 10) : 0;
        const fallbackDelay = Math.min(30 * (attempt + 1), 90);
        // retryDelay: "0s" のケースがあるため、最低30秒は待機
        const waitSec = Math.max(parsedDelay, fallbackDelay);
        console.log(
          `[GeminiPdf] 429 rate limited, ${waitSec}秒後にリトライ (${attempt + 1}/${maxRetries})`,
        );
        await new Promise((r) => setTimeout(r, waitSec * 1000));
        continue;
      }

      // 503 サーバーエラー → リトライ
      if (res.status === 503 && attempt < maxRetries) {
        clearTimeout(timer);
        const waitSec = Math.min(30 * (attempt + 1), 90);
        console.log(
          `[GeminiPdf] 503 server error, ${waitSec}秒後にリトライ (${attempt + 1}/${maxRetries})`,
        );
        await new Promise((r) => setTimeout(r, waitSec * 1000));
        continue;
      }

      if (!res.ok) {
        const errorText = await res.text().catch(() => "");
        throw new Error(
          `[GeminiPdf] API error: ${res.status} ${errorText.slice(0, 500)}`,
        );
      }

      const data = await res.json();

      // レスポンス解析
      const text =
        data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      const usageMeta = data.usageMetadata;
      const usage = usageMeta
        ? {
            prompt: usageMeta.promptTokenCount ?? 0,
            completion: usageMeta.candidatesTokenCount ?? 0,
            total: usageMeta.totalTokenCount ?? 0,
          }
        : undefined;

      if (usage) {
        console.log(
          `[GeminiPdf] トークン消費: 入力=${usage.prompt.toLocaleString()}, 出力=${usage.completion.toLocaleString()}, 合計=${usage.total.toLocaleString()}`,
        );
      }

      return { text, model: modelId, usage };
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error("[GeminiPdf] max retries exceeded (429)");
}

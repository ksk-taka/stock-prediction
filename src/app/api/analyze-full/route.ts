/**
 * 統合分析 API Route
 *
 * 1銘柄を受け取り、プロンプト生成 → 決算PDF読み込み → Gemini API → Notion 登録 を実行する。
 * フロントエンドは銘柄リストを逐次ループしてこの API を呼ぶ。
 */

import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

import { callGeminiWithPdf } from "@/lib/api/geminiPdf";
import { loadEarningsPdfs } from "@/lib/analysis/earningsPdfLoader";
import { generateAnalysisPrompt } from "@/lib/analysis/promptGenerator";
import { setCachedValidation } from "@/lib/cache/fundamentalCache";
import {
  isNotionConfigured,
  createAnalysisPage,
  hasAnalysisToday,
} from "@/lib/api/notion";
import type { NotionAnalysisEntry } from "@/lib/api/notion";
import type { SignalValidation } from "@/types";
import { requireAllowedUser } from "@/lib/supabase/auth";

// Next.js Route Segment Config: 5 分タイムアウト
export const maxDuration = 300;

// ---------- 定数 ----------

const ANALYSIS_DIR = join(process.cwd(), "data", "analysis");

const SYSTEM_INSTRUCTION = `あなたは日本株の投資アナリストです。
ユーザーから銘柄の定量データ（テキスト）と決算資料PDF（添付）が提供されます。
両方を統合して、詳細な投資分析レポートを日本語Markdown形式で作成してください。

## 出力セクション

### 1. 業績の現状と見通し
決算資料から具体的な数字を引用し、売上・利益のトレンドと成長ドライバーを分析してください。
前年比・前期比の変化率にも言及してください。

### 2. バリュエーション評価
PER/PBR/CNPERを総合的に評価してください。
- CNPER（Cash Neutral PER = PER ×（1 - NC比率））は現金を除いた実質的な割安度を示します
- NC比率が正ならキャッシュリッチ、負なら実質借金体質
- CNPER < 10 は割安シグナル

### 3. 株主還元・配当政策
増配傾向、配当性向、自社株買いの実績と今後の見通しを分析してください。

### 4. 競争優位性（シャープエッジ）
同業他社と比較した明確な強みを特定してください。
参入障壁の有無、市場シェア、技術的優位性、ブランド力など。

### 5. リスク要因
業績下振れリスク、マクロリスク、業界固有のリスクを列挙してください。

### 6. チャート・テクニカル分析
OHLCVデータと移動平均線から読み取れるトレンドと需給を分析してください。

### 7. 総合判定
上記すべてを踏まえた結論を述べた後、以下のJSONブロックを**必ず**出力してください。

判定は3つの投資期間で別々に評価してください：
- **短期（数日〜2週間）**: テクニカル・需給重視。チャートパターン、出来高、移動平均線からの乖離を重視
- **中期（2週間〜2ヶ月）**: 決算カタリスト・バリュエーション重視。直近決算と次回決算までのイベントを考慮
- **長期（2ヶ月以上）**: ファンダメンタルズ・成長性重視。事業の競争優位性、成長ドライバー、割安度を重視

また、推奨売買価格を提示してください：
- **buyPrice**: 現在の株価やチャートから判断した推奨買い値（指値）。直近サポートラインや出来高の厚い価格帯を参考に
- **takeProfitPrice**: 利確目標価格。直近レジスタンスラインや目標バリュエーションから算出
- **stopLossPrice**: 損切ライン。原則として買値の約-8%を基準に、サポートライン割れ等を考慮して設定

\`\`\`json
{
  "shortTerm": "entry または wait または avoid",
  "midTerm": "entry または wait または avoid",
  "longTerm": "entry または wait または avoid",
  "confidence": "high または medium または low",
  "summary": "100字程度の結論",
  "buyPrice": 推奨買値（数値）,
  "takeProfitPrice": 利確目標（数値）,
  "stopLossPrice": 損切ライン（数値）,
  "signalEvaluation": "テクニカルとファンダメンタルズの整合性",
  "catalyst": "上昇カタリスト",
  "riskFactor": "主要リスク"
}
\`\`\`
`;

// ---------- 型定義 ----------

interface PeriodPrices {
  decision?: string;
  buyPrice?: number;
  takeProfitPrice?: number;
  stopLossPrice?: number;
}

interface AnalysisResult extends SignalValidation {
  confidence?: string;
  shortTerm?: PeriodPrices;
  midTerm?: PeriodPrices;
  longTerm?: PeriodPrices;
}

// ---------- ユーティリティ ----------

function extractQuantFromPrompt(prompt: string) {
  const p = (pattern: RegExp) => prompt.match(pattern);
  const n = (m: RegExpMatchArray | null) =>
    m ? parseFloat(m[1].replace(/,/g, "")) : undefined;

  const nameMatch = p(/銘柄:\s*(.+?)\s*\(/);
  const price = n(p(/現在株価:\s*([\d,]+)/));
  const per = n(p(/PER \(実績\):\s*([\d.]+)/));
  const pbr = n(p(/PBR:\s*([\d.]+)/));
  const cnper = n(p(/CNPER[^:]*:\s*([\d.]+)/));
  const eps = n(p(/EPS:\s*([\d.]+)/));
  const dividendYield = n(p(/配当利回り:\s*([\d.]+)/));
  const roe = n(p(/ROE:\s*([\d.]+)%/));
  const w52High = n(p(/52週高値:\s*([\d,.]+)/));
  const fcfMatch = p(/フリーキャッシュフロー:\s*(-?[\d,]+)億円/);
  const fcf = fcfMatch
    ? parseFloat(fcfMatch[1].replace(/,/g, ""))
    : undefined;
  const marketCapMatch = p(/時価総額:\s*約([\d,.]+)(兆|億)円/);
  const marketCap = marketCapMatch
    ? parseFloat(marketCapMatch[1].replace(/,/g, "")) *
      (marketCapMatch[2] === "兆" ? 10000 : 1)
    : undefined;
  const sharpeMatch = p(/シャープレシオ:\s*6ヶ月\s*([\d.\-]+)/);
  const sharpeRatio = sharpeMatch ? parseFloat(sharpeMatch[1]) : undefined;
  const volumeMatch = p(/出来高:\s*([\d,]+)株/);
  const volume = n(volumeMatch);
  const avgVolMatch = p(/3ヶ月平均:\s*([\d,]+)株/);
  const avgVolume5d = n(avgVolMatch);
  const volRatioMatch = p(/→\s*([\d.]+)倍\)/);
  const volumeRatio = volRatioMatch
    ? parseFloat(volRatioMatch[1])
    : undefined;
  const deMatch = p(/D\/Eレシオ:\s*([\d.]+)/);
  const equityRatio = deMatch
    ? Math.round((1 / (1 + parseFloat(deMatch[1]) / 100)) * 1000) / 10
    : undefined;
  const earningsDateMatch = p(/決算発表:\s*(\d{4}-\d{2}-\d{2})/);
  const earningsDate = earningsDateMatch?.[1];

  const ohlcvLines = prompt.match(/\| \d{2}-\d{2} .+/g) ?? [];
  let consolidationDays: number | undefined;
  if (ohlcvLines.length >= 5) {
    const closes = ohlcvLines
      .map((l) => {
        const cols = l.split("|").map((c) => c.trim());
        return parseFloat(cols[4]?.replace(/,/g, "") ?? "0");
      })
      .filter((c) => c > 0);
    if (closes.length >= 5) {
      const lastClose = closes[closes.length - 1];
      let count = 0;
      for (let i = closes.length - 2; i >= 0; i--) {
        if (Math.abs(closes[i] - lastClose) / lastClose <= 0.03) {
          count++;
        } else {
          break;
        }
      }
      consolidationDays = count;
    }
  }

  return {
    companyName: nameMatch?.[1]?.trim() ?? "",
    price,
    per,
    pbr,
    cnper,
    eps,
    dividendYield,
    roe,
    w52High,
    fcf,
    marketCap,
    sharpeRatio,
    volume,
    avgVolume5d,
    volumeRatio,
    equityRatio,
    consolidationDays,
    earningsDate,
  };
}

function extractJsonBlock(text: string): AnalysisResult | null {
  const match = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    const pp = (val: unknown): PeriodPrices | undefined => {
      if (!val) return undefined;
      if (typeof val === "object") {
        const o = val as Record<string, unknown>;
        return {
          decision: String(o.decision ?? "wait"),
          buyPrice: typeof o.buyPrice === "number" ? o.buyPrice : undefined,
          takeProfitPrice: typeof o.takeProfitPrice === "number" ? o.takeProfitPrice : undefined,
          stopLossPrice: typeof o.stopLossPrice === "number" ? o.stopLossPrice : undefined,
        };
      }
      return { decision: String(val) };
    };
    const shortTerm = pp(parsed.shortTerm);
    const midTerm = pp(parsed.midTerm);
    const longTerm = pp(parsed.longTerm);
    const decision = parsed.decision ?? midTerm?.decision ?? "wait";
    return {
      decision,
      confidence: parsed.confidence,
      shortTerm,
      midTerm,
      longTerm,
      signalEvaluation: parsed.signalEvaluation ?? parsed.summary ?? "",
      riskFactor: parsed.riskFactor ?? "",
      catalyst: parsed.catalyst ?? "",
      summary: parsed.summary ?? "",
      validatedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

// ---------- POST ハンドラ ----------

export async function POST(request: NextRequest) {
  // ── 認可チェック ──
  try {
    await requireAllowedUser();
  } catch {
    return NextResponse.json(
      { status: "error", error: "この機能は許可されたユーザーのみ使用できます" },
      { status: 403 },
    );
  }

  const body = await request.json();
  const rawSymbol: string = body.symbol ?? "";
  const model: "flash" | "pro" = body.model === "pro" ? "pro" : "flash";
  const allDocs: boolean = body.allDocs ?? false;
  const force: boolean = body.force ?? false;

  // シンボル正規化
  const symbol = rawSymbol.includes(".T") ? rawSymbol : `${rawSymbol}.T`;
  const code = symbol.replace(".T", "");

  const startTime = Date.now();

  try {
    // ── 同日スキップチェック ──
    if (isNotionConfigured() && !force) {
      try {
        const alreadyDone = await hasAnalysisToday(symbol);
        if (alreadyDone) {
          return NextResponse.json({
            symbol,
            status: "skipped",
            message: "本日分析済み",
            elapsedSec: 0,
          });
        }
      } catch {
        // チェック失敗は続行
      }
    }

    // ── Step 1: プロンプト生成 ──
    let promptText: string;
    try {
      promptText = await generateAnalysisPrompt(symbol);
    } catch (err) {
      return NextResponse.json(
        {
          symbol,
          status: "error",
          error: `プロンプト生成失敗: ${err instanceof Error ? err.message : String(err)}`,
          elapsedSec: (Date.now() - startTime) / 1000,
        },
        { status: 500 },
      );
    }

    // ── Step 2: PDF読み込み（まず既存を確認） ──
    const includeTypes = allDocs
      ? ["決算短信", "説明資料", "半期報", "有報"]
      : ["決算短信", "説明資料"];
    const pdfs = loadEarningsPdfs(symbol, { includeTypes });

    // ── Step 3: PDFなしの場合は警告のみ（Vercelではダウンロード不可） ──
    if (pdfs.length === 0) {
      console.warn(
        `[analyze-full] ${symbol}: 決算PDFなし。事前に npm run fetch:earnings --symbol ${symbol} でダウンロードしてください`,
      );
    }

    // ── Step 4: Gemini API ──
    const geminiResult = await callGeminiWithPdf(
      {
        textPrompt: promptText,
        systemInstruction: SYSTEM_INSTRUCTION,
        pdfs: pdfs.map((p) => ({ filename: p.filename, data: p.data })),
      },
      { model },
    );

    // ── Step 5: 結果保存 ──
    mkdirSync(ANALYSIS_DIR, { recursive: true });
    const now = new Date().toISOString().slice(0, 19).replace("T", " ");
    const header = `<!-- 分析日時: ${now} | モデル: ${geminiResult.model} | PDF: ${pdfs.map((p) => p.filename).join(", ")} -->\n\n`;
    writeFileSync(
      join(ANALYSIS_DIR, `${code}.md`),
      header + geminiResult.text,
      "utf-8",
    );

    // ── Step 6: JSON判定抽出 ──
    const validation = extractJsonBlock(geminiResult.text);
    if (validation) {
      setCachedValidation(symbol, "full_analysis", validation);
    }

    // ── Step 7: Notion登録 ──
    let notionUrl: string | undefined;
    if (validation && isNotionConfigured()) {
      try {
        const quant = extractQuantFromPrompt(promptText);
        const confidence = (validation.confidence ?? "medium") as
          | "high"
          | "medium"
          | "low";

        let marketSegment: string | undefined;
        let hasYutai: boolean | undefined;
        try {
          const wlRaw = readFileSync(
            join(process.cwd(), "data", "watchlist.json"),
            "utf-8",
          );
          const wlData = JSON.parse(wlRaw);
          const stocks = (wlData.stocks ?? wlData) as {
            symbol: string;
            marketSegment?: string;
          }[];
          const found = stocks.find((s) => s.symbol === symbol);
          marketSegment = found?.marketSegment;
        } catch {
          // watchlist 読み込み失敗は無視
        }
        try {
          const { getCachedYutai } = await import("@/lib/cache/yutaiCache");
          const yutai = getCachedYutai(symbol);
          hasYutai = yutai != null && yutai.hasYutai;
        } catch {
          // 優待キャッシュ無しは無視
        }

        const notionEntry: NotionAnalysisEntry = {
          symbol,
          companyName: quant.companyName,
          decision: validation.decision as "entry" | "wait" | "avoid",
          confidence,
          summary: validation.summary ?? "",
          signalEvaluation: validation.signalEvaluation ?? "",
          catalyst: validation.catalyst ?? "",
          riskFactor: validation.riskFactor ?? "",
          analysisDate:
            new Date(Date.now() + 9 * 3600_000)
              .toISOString()
              .slice(0, 19) + "+09:00",
          model: geminiResult.model,
          pdfCount: pdfs.length,
          totalTokens: geminiResult.usage?.total ?? 0,
          reportMarkdown: geminiResult.text,
          price: quant.price,
          per: quant.per,
          pbr: quant.pbr,
          cnper: quant.cnper,
          psr: undefined,
          eps: quant.eps,
          roe: quant.roe,
          dividendYield: quant.dividendYield,
          marketCap: quant.marketCap,
          w52High: quant.w52High,
          fcf: quant.fcf,
          sharpeRatio: quant.sharpeRatio,
          volume: quant.volume,
          avgVolume5d: quant.avgVolume5d,
          volumeRatio: quant.volumeRatio,
          equityRatio: quant.equityRatio,
          consolidationDays: quant.consolidationDays,
          earningsDate: quant.earningsDate,
          marketSegment,
          hasYutai,
          shortTerm: validation.shortTerm?.decision as "entry" | "wait" | "avoid" | undefined,
          midTerm: validation.midTerm?.decision as "entry" | "wait" | "avoid" | undefined,
          longTerm: validation.longTerm?.decision as "entry" | "wait" | "avoid" | undefined,
          shortTermBuy: validation.shortTerm?.buyPrice,
          shortTermTP: validation.shortTerm?.takeProfitPrice,
          shortTermSL: validation.shortTerm?.stopLossPrice,
          midTermBuy: validation.midTerm?.buyPrice,
          midTermTP: validation.midTerm?.takeProfitPrice,
          midTermSL: validation.midTerm?.stopLossPrice,
          longTermBuy: validation.longTerm?.buyPrice,
          longTermTP: validation.longTerm?.takeProfitPrice,
          longTermSL: validation.longTerm?.stopLossPrice,
        };
        const result = await createAnalysisPage(notionEntry);
        notionUrl = result.url;
      } catch (err) {
        console.warn(
          `[analyze-full] Notion登録失敗: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    const elapsedSec =
      Math.round(((Date.now() - startTime) / 1000) * 10) / 10;

    return NextResponse.json({
      symbol,
      companyName:
        extractQuantFromPrompt(promptText).companyName || code,
      decision: validation?.decision ?? "wait",
      confidence: validation?.confidence ?? "medium",
      shortTerm: validation?.shortTerm,
      midTerm: validation?.midTerm,
      longTerm: validation?.longTerm,
      summary: validation?.summary ?? "",
      catalyst: validation?.catalyst ?? "",
      riskFactor: validation?.riskFactor ?? "",
      signalEvaluation: validation?.signalEvaluation ?? "",
      notionUrl,
      model: geminiResult.model,
      pdfCount: pdfs.length,
      totalTokens: geminiResult.usage?.total ?? 0,
      elapsedSec,
      status: "done",
    });
  } catch (err) {
    const elapsedSec =
      Math.round(((Date.now() - startTime) / 1000) * 10) / 10;
    return NextResponse.json(
      {
        symbol,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
        elapsedSec,
      },
      { status: 500 },
    );
  }
}

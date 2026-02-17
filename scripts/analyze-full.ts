#!/usr/bin/env npx tsx
// ============================================================
// 統合分析スクリプト - プロンプト生成 + 決算PDF + Gemini分析
//
// 既存の generate-gemini-prompt.ts / fetch-earnings.ts を活用し、
// Gemini APIにPDFをネイティブ送信して投資分析レポートを生成する。
//
// 使い方:
//   npx tsx scripts/analyze-full.ts 4415.T
//   npx tsx scripts/analyze-full.ts 4415.T 7203.T 6503.T
//   npx tsx scripts/analyze-full.ts 4415.T --skip-download
//   npx tsx scripts/analyze-full.ts 4415.T --model pro
//   npx tsx scripts/analyze-full.ts 4415.T --all-docs
//   npx tsx scripts/analyze-full.ts 4415.T --slack
//   npx tsx scripts/analyze-full.ts --list
// ============================================================

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { execSync } from "child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

import { callGeminiWithPdf } from "@/lib/api/geminiPdf";
import { loadEarningsPdfs } from "@/lib/analysis/earningsPdfLoader";
import { listAvailableEarnings } from "@/lib/utils/earningsReader";
import { setCachedValidation } from "@/lib/cache/fundamentalCache";
import {
  isNotionConfigured,
  createAnalysisPage,
  hasAnalysisToday,
} from "@/lib/api/notion";
import type { NotionAnalysisEntry } from "@/lib/api/notion";
import type { SignalValidation } from "@/types";

// ---------- 定数 ----------

const PROMPTS_DIR = join(process.cwd(), "data", "prompts");
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

// ---------- CLI引数パース ----------

const args = process.argv.slice(2);
const showList = args.includes("--list");
const skipDownload = args.includes("--skip-download");
const allDocs = args.includes("--all-docs");
const sendSlack = args.includes("--slack");
const dryRun = args.includes("--dry-run");
const forceRerun = args.includes("--force");
const modelArg = args.includes("--model")
  ? args[args.indexOf("--model") + 1]
  : "flash";

const symbols = args
  .filter((a) => !a.startsWith("--") && a !== modelArg)
  .map((s) => (s.includes(".T") ? s : `${s}.T`));

// ---------- ユーティリティ ----------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** プロンプトテキストから定量データを抽出 */
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
  const fcf = fcfMatch ? parseFloat(fcfMatch[1].replace(/,/g, "")) : undefined;
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
  const volumeRatio = volRatioMatch ? parseFloat(volRatioMatch[1]) : undefined;
  // D/Eレシオから自己資本比率を概算: 自己資本比率 ≈ 1 / (1 + D/E) * 100
  const deMatch = p(/D\/Eレシオ:\s*([\d.]+)/);
  const equityRatio = deMatch
    ? Math.round((1 / (1 + parseFloat(deMatch[1]) / 100)) * 1000) / 10
    : undefined;
  // 決算日
  const earningsDateMatch = p(
    /決算発表:\s*(\d{4}-\d{2}-\d{2})/,
  );
  const earningsDate = earningsDateMatch?.[1];

  // もみ合い日数（OHLCVから: 直近終値の±3%以内が何日続くか）
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

interface AnalysisResult extends SignalValidation {
  confidence?: string;
  shortTerm?: string;
  midTerm?: string;
  longTerm?: string;
  buyPrice?: number;
  takeProfitPrice?: number;
  stopLossPrice?: number;
}

function extractJsonBlock(text: string): AnalysisResult | null {
  const match = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    // 後方互換: 旧フォーマットのdecisionも受け付ける
    const decision = parsed.decision ?? parsed.midTerm ?? "wait";
    return {
      decision,
      confidence: parsed.confidence,
      shortTerm: parsed.shortTerm,
      midTerm: parsed.midTerm,
      longTerm: parsed.longTerm,
      buyPrice: parsed.buyPrice,
      takeProfitPrice: parsed.takeProfitPrice,
      stopLossPrice: parsed.stopLossPrice,
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

// ---------- --list モード ----------

if (showList) {
  const available = listAvailableEarnings();
  if (available.length === 0) {
    console.log("決算資料なし。先に npm run fetch:earnings を実行してください。");
    process.exit(0);
  }
  console.log(`\n分析可能な銘柄 (${available.length}件):\n`);
  for (const item of available) {
    console.log(`  ${item.symbol}  ${item.pdfCount}PDF  ${item.files.join(", ")}`);
  }
  process.exit(0);
}

// ---------- シンボル未指定チェック ----------

if (symbols.length === 0) {
  console.log("使い方:");
  console.log("  npx tsx scripts/analyze-full.ts 4415.T");
  console.log("  npx tsx scripts/analyze-full.ts 4415.T 7203.T 6503.T");
  console.log("");
  console.log("オプション:");
  console.log("  --skip-download  PDFダウンロードをスキップ（DL済みを使用）");
  console.log("  --model pro      Gemini 2.5 Pro を使用（デフォルト: flash）");
  console.log("  --all-docs       有報・半期報も含める（デフォルト: 決算短信+説明資料）");
  console.log("  --slack          Slack通知を送信");
  console.log("  --dry-run        分析せずPDF読み込みまで確認");
  console.log("  --force          同日分析済みでもスキップしない");
  console.log("  --list           分析可能な銘柄一覧");
  process.exit(0);
}

// ---------- メイン処理 ----------

async function analyzeSymbol(
  symbol: string,
  index: number,
  total: number,
): Promise<"done" | "skipped" | "error"> {
  const code = symbol.replace(".T", "");
  const prefix = total > 1 ? `[${index + 1}/${total}] ` : "";

  console.log(`\n${"═".repeat(60)}`);
  console.log(`${prefix}${symbol} - 統合分析開始`);
  console.log(`${"═".repeat(60)}\n`);

  // ── 同日スキップチェック ──
  if (isNotionConfigured() && !forceRerun) {
    try {
      const alreadyDone = await hasAnalysisToday(symbol);
      if (alreadyDone) {
        console.log(`${prefix}${symbol}: 本日分析済み → スキップ`);
        return "skipped";
      }
    } catch {
      // チェック失敗は無視して続行
    }
  }

  // ── Step 1: プロンプト生成 ──
  console.log("[1/5] プロンプト生成中...");
  try {
    execSync(`npx tsx scripts/generate-gemini-prompt.ts ${symbol}`, {
      stdio: "pipe",
      timeout: 60_000,
    });
  } catch (err) {
    console.error(
      `[ERROR] プロンプト生成失敗: ${err instanceof Error ? err.message : err}`,
    );
    return "error";
  }

  const promptFile = join(PROMPTS_DIR, `${code}.md`);
  if (!existsSync(promptFile)) {
    console.error(`[ERROR] プロンプトファイルが見つかりません: ${promptFile}`);
    return "error";
  }
  const promptText = readFileSync(promptFile, "utf-8");
  console.log(`  プロンプト: ${promptText.length.toLocaleString()}文字`);

  // ── Step 2: PDF読み込み（まず既存を確認） ──
  console.log("\n[2/5] PDF読み込み中...");
  const includeTypes = allDocs
    ? ["決算短信", "説明資料", "半期報", "有報"]
    : ["決算短信", "説明資料"];
  let pdfs = loadEarningsPdfs(symbol, { includeTypes });

  // ── Step 3: PDFがなければダウンロード → 再読み込み ──
  if (pdfs.length === 0 && !skipDownload) {
    console.log("\n[3/5] PDFなし → 決算資料ダウンロード中...");
    try {
      execSync(
        `npx tsx scripts/fetch-earnings.ts --symbol ${symbol} --kabutan-only`,
        { stdio: "pipe", timeout: 120_000 },
      );
      // 再読み込み
      pdfs = loadEarningsPdfs(symbol, { includeTypes });
    } catch (err) {
      console.warn(
        `[WARN] ダウンロード失敗: ${err instanceof Error ? err.message : err}`,
      );
    }
  } else if (pdfs.length === 0) {
    console.log("\n[3/5] PDFなし（--skip-download のためDLスキップ）");
  } else {
    console.log("\n[3/5] PDFダウンロード: 既存PDF使用（スキップ）");
  }

  if (pdfs.length === 0) {
    console.warn("[WARN] PDFが見つかりません。プロンプトのみで分析します。");
  }

  // ── dry-run ならここで終了 ──
  if (dryRun) {
    console.log("\n[dry-run] ここまで確認完了。--dry-run を外して実行してください。");
    return "error";
  }

  // ── Step 4: Gemini API送信 ──
  console.log(`\n[4/5] Gemini API (${modelArg}) に送信中...`);

  const startTime = Date.now();
  let result;
  try {
    result = await callGeminiWithPdf(
      {
        textPrompt: promptText,
        systemInstruction: SYSTEM_INSTRUCTION,
        pdfs: pdfs.map((p) => ({ filename: p.filename, data: p.data })),
      },
      { model: modelArg as "flash" | "pro" },
    );
  } catch (err) {
    console.error(
      `[ERROR] Gemini API失敗: ${err instanceof Error ? err.message : err}`,
    );
    return "error";
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`  応答時間: ${elapsed}秒`);

  // ── Step 5: 結果出力 ──
  console.log("\n[5/5] 結果出力中...");

  // Markdownファイル保存
  mkdirSync(ANALYSIS_DIR, { recursive: true });
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  const header = `<!-- 分析日時: ${now} | モデル: ${result.model} | PDF: ${pdfs.map((p) => p.filename).join(", ")} -->\n\n`;
  const analysisFile = join(ANALYSIS_DIR, `${code}.md`);
  writeFileSync(analysisFile, header + result.text, "utf-8");
  console.log(`  保存先: ${analysisFile}`);

  // JSON判定抽出
  const validation = extractJsonBlock(result.text);
  if (validation) {
    setCachedValidation(symbol, "full_analysis", validation);
    const dl = (d: string | undefined) =>
      d === "entry" ? "GO ✅" : d === "avoid" ? "AVOID ❌" : "WAIT ⏳";
    console.log(`\n${"─".repeat(50)}`);
    console.log(`  短期判定: ${dl(validation.shortTerm)}`);
    console.log(`  中期判定: ${dl(validation.midTerm)}`);
    console.log(`  長期判定: ${dl(validation.longTerm)}`);
    if (validation.buyPrice) {
      console.log(
        `  推奨価格: 買値 ¥${validation.buyPrice.toLocaleString()} / 利確 ¥${(validation.takeProfitPrice ?? 0).toLocaleString()} / 損切 ¥${(validation.stopLossPrice ?? 0).toLocaleString()}`,
      );
    }
    console.log(`  概要: ${validation.summary}`);
    console.log(`  カタリスト: ${validation.catalyst}`);
    console.log(`  リスク: ${validation.riskFactor}`);
    console.log(`${"─".repeat(50)}`);
  } else {
    console.warn("[WARN] JSONブロックの抽出に失敗しました。Markdownファイルを確認してください。");
  }

  // Notion登録
  if (validation && isNotionConfigured()) {
    try {
      const quant = extractQuantFromPrompt(promptText);
      const confidence = (validation.confidence ?? "medium") as
        | "high"
        | "medium"
        | "low";

      // 市場区分と優待をウォッチリストから取得
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
        // watchlist読み込み失敗は無視
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
        model: result.model,
        pdfCount: pdfs.length,
        totalTokens: result.usage?.total ?? 0,
        reportMarkdown: result.text,
        price: quant.price,
        per: quant.per,
        pbr: quant.pbr,
        cnper: quant.cnper,
        psr: undefined, // PSRはプロンプトに含まれない
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
        shortTerm: validation.shortTerm as "entry" | "wait" | "avoid" | undefined,
        midTerm: validation.midTerm as "entry" | "wait" | "avoid" | undefined,
        longTerm: validation.longTerm as "entry" | "wait" | "avoid" | undefined,
        buyPrice: validation.buyPrice,
        takeProfitPrice: validation.takeProfitPrice,
        stopLossPrice: validation.stopLossPrice,
      };
      const { url } = await createAnalysisPage(notionEntry);
      console.log(`  Notion: 登録完了 ${url}`);
    } catch (err) {
      console.warn(
        `  Notion: 失敗 (${err instanceof Error ? err.message : err})`,
      );
    }
  }

  // Slack通知
  if (sendSlack && validation) {
    try {
      const { isSlackConfigured } = await import("@/lib/api/slack");
      if (isSlackConfigured()) {
        const { sendSignalNotification } = await import("@/lib/api/slack");
        await sendSignalNotification({
          symbol,
          symbolName: code,
          sectors: [],
          strategyId: "full_analysis",
          strategyName: "統合分析 (Gemini PDF)",
          timeframe: "daily",
          signalDate: new Date().toISOString().slice(0, 10),
          signalType: "buy",
          currentPrice: 0,
          suggestedQty: 0,
          suggestedAmount: 0,
          validation,
        });
        console.log("  Slack通知: 送信完了");
      } else {
        console.warn("  Slack通知: 未設定のためスキップ");
      }
    } catch (err) {
      console.warn(
        `  Slack通知: 失敗 (${err instanceof Error ? err.message : err})`,
      );
    }
  }

  return "done";
}

async function main(): Promise<void> {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║  統合分析 - Gemini PDF ネイティブ入力     ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log(`  モデル: gemini-2.5-${modelArg}`);
  console.log(`  銘柄数: ${symbols.length}`);
  console.log(`  資料: ${allDocs ? "全種類" : "決算短信 + 説明資料"}`);

  const stats = { done: 0, skipped: 0, error: 0 };
  const startAll = Date.now();

  for (let i = 0; i < symbols.length; i++) {
    if (i > 0 && stats.done > 0) {
      console.log("\n⏳ 3秒待機（レート制限対策）...");
      await sleep(3000);
    }
    const result = await analyzeSymbol(symbols[i], i, symbols.length);
    stats[result]++;

    // 進捗サマリー
    const elapsed = ((Date.now() - startAll) / 1000 / 60).toFixed(1);
    const remaining = symbols.length - (i + 1);
    console.log(
      `\n📊 進捗: ${i + 1}/${symbols.length} (完了${stats.done} / スキップ${stats.skipped} / エラー${stats.error}) | 経過${elapsed}分 | 残${remaining}件`,
    );
  }

  const totalMin = ((Date.now() - startAll) / 1000 / 60).toFixed(1);
  console.log(`\n${"═".repeat(60)}`);
  console.log(`✅ 全${symbols.length}銘柄完了 (${totalMin}分)`);
  console.log(`   完了: ${stats.done} / スキップ: ${stats.skipped} / エラー: ${stats.error}`);
  console.log(`   結果: ${ANALYSIS_DIR}/`);
}

main().catch((err) => {
  console.error("致命的エラー:", err);
  process.exit(1);
});

#!/usr/bin/env npx tsx
// ============================================================
// 決算資料分析スクリプト - ローカルPDFを読み込んでLLM Go/NoGo判定
//
// 使い方:
//   npx tsx scripts/analyze-earnings.ts 7203.T        # 単一銘柄
//   npx tsx scripts/analyze-earnings.ts --all          # 全決算資料
//   npx tsx scripts/analyze-earnings.ts --list         # 利用可能な銘柄一覧
//   npx tsx scripts/analyze-earnings.ts 7203.T --slack # Slack通知付き
// ============================================================

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { getEarningsText, listAvailableEarnings } from "@/lib/utils/earningsReader";
import { getQuote, getFinancialData } from "@/lib/api/yahooFinance";
import { fetchFundamentalResearch } from "@/lib/api/webResearch";
import { validateSignal } from "@/lib/api/llm";
import { setCachedValidation } from "@/lib/cache/fundamentalCache";

// ---------- CLI引数 ----------

const args = process.argv.slice(2);
const showList = args.includes("--list");
const runAll = args.includes("--all");
const sendSlack = args.includes("--slack");
const skipWeb = args.includes("--skip-web");
const symbolArg = args.find((a) => !a.startsWith("--"));

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------- 単一銘柄の分析 ----------

async function analyzeWithEarnings(symbol: string): Promise<void> {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`決算資料分析: ${symbol}`);
  console.log("=".repeat(60));

  // Step 1: 決算資料テキスト抽出
  console.log("\n[1/4] 決算資料読み込み中...");
  const earnings = await getEarningsText(symbol);
  if (!earnings) {
    console.log(
      `  → ${symbol} の決算資料が見つかりません (data/earnings/ を確認)`,
    );
    return;
  }
  console.log(
    `  → ${earnings.sources.length}件読み込み完了 (${earnings.totalChars.toLocaleString()}文字)`,
  );

  // Step 2: 定量データ取得
  console.log("\n[2/4] 定量データ取得中...");
  let quote: Awaited<ReturnType<typeof getQuote>>;
  let financial: Awaited<ReturnType<typeof getFinancialData>>;
  try {
    [quote, financial] = await Promise.all([
      getQuote(symbol),
      getFinancialData(symbol),
    ]);
  } catch (err) {
    console.error(
      `  → データ取得失敗: ${err instanceof Error ? err.message : err}`,
    );
    return;
  }
  const stats = {
    per: quote.per,
    pbr: quote.pbr,
    roe: financial.roe,
    dividendYield: quote.dividendYield,
  };
  const name = quote.name ?? symbol;
  console.log(
    `  ${name} | PER: ${stats.per ?? "N/A"} | PBR: ${stats.pbr ?? "N/A"} | ROE: ${stats.roe != null ? (stats.roe * 100).toFixed(1) + "%" : "N/A"}`,
  );

  // Step 3: ファンダメンタルズ Web調査 (オプション)
  let fundamentalText = "";
  if (!skipWeb) {
    console.log("\n[3/4] ファンダメンタルズWeb調査中...");
    try {
      const ticker = symbol.replace(".T", "");
      const research = await fetchFundamentalResearch(symbol, name, ticker, {
        pbr: stats.pbr ?? 0,
        per: stats.per ?? 0,
      });
      fundamentalText = research.rawText;
      console.log(
        `  → Web調査完了 (${fundamentalText.length.toLocaleString()}文字)`,
      );
    } catch (err) {
      console.warn(
        `  → Web調査失敗 (続行): ${err instanceof Error ? err.message : err}`,
      );
    }
  } else {
    console.log("\n[3/4] ファンダメンタルズWeb調査: スキップ (--skip-web)");
  }

  // Step 4: Go/NoGo判定 (決算資料込み)
  console.log("\n[4/4] Go/NoGo判定中 (決算資料込み)...");
  const enrichedContext = [
    fundamentalText ? `### Web調査結果\n${fundamentalText}` : "",
    `### 決算資料 (${earnings.sources.join(", ")})\n${earnings.text}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await validateSignal(
    symbol,
    name,
    {
      description: `決算資料ベースの総合分析 (現在株価: ${quote.price?.toLocaleString() ?? "N/A"}円)`,
      strategyName: "決算分析",
    },
    stats,
    enrichedContext,
  );

  // 結果表示
  console.log(`\n${"─".repeat(60)}`);
  const decisionEmoji =
    result.decision === "entry"
      ? "GO"
      : result.decision === "avoid"
        ? "NO-GO"
        : "WAIT";
  console.log(`  判定: [${decisionEmoji}] ${result.decision.toUpperCase()}`);
  console.log(`  概要: ${result.summary}`);
  if (result.signalEvaluation)
    console.log(`  評価: ${result.signalEvaluation}`);
  if (result.riskFactor) console.log(`  リスク: ${result.riskFactor}`);
  if (result.catalyst) console.log(`  カタリスト: ${result.catalyst}`);
  console.log("─".repeat(60));

  // キャッシュ保存（UIから参照可能にする）
  setCachedValidation(symbol, "earnings_analysis", result);
  console.log("  → キャッシュ保存完了");

  // Slack通知 (オプション)
  if (sendSlack) {
    try {
      const { sendSignalNotification, isSlackConfigured } = await import(
        "@/lib/api/slack"
      );
      if (isSlackConfigured()) {
        await sendSignalNotification({
          symbol,
          symbolName: name,
          strategyId: "earnings_analysis",
          strategyName: "決算資料分析",
          timeframe: "daily",
          signalDate: new Date().toISOString().split("T")[0],
          signalType: "buy",
          currentPrice: quote.price ?? 0,
          suggestedQty: 0,
          suggestedAmount: 0,
          validation: {
            decision: result.decision,
            summary: result.summary,
            signalEvaluation: result.signalEvaluation,
            riskFactor: result.riskFactor,
            catalyst: result.catalyst,
          },
          fundamentalSummary: `決算資料: ${earnings.sources.join(", ")}`,
        });
        console.log("  → Slack通知送信完了");
      } else {
        console.warn("  → Slack未設定 (SLACK_WEBHOOK_URL)");
      }
    } catch (err) {
      console.warn(
        `  → Slack送信失敗: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}

// ---------- メイン ----------

async function main() {
  // --list: 利用可能な銘柄一覧
  if (showList) {
    const available = listAvailableEarnings();
    console.log(`決算資料がある銘柄: ${available.length}件\n`);
    for (const a of available) {
      console.log(`  ${a.symbol.padEnd(10)} ${a.folder.padEnd(40)} ${a.pdfCount} PDFs`);
      for (const f of a.files) {
        console.log(`    └ ${f}`);
      }
    }
    return;
  }

  // 対象銘柄の決定
  let symbols: string[];
  if (runAll) {
    symbols = listAvailableEarnings().map((a) => a.symbol);
    console.log(`全銘柄分析モード: ${symbols.length}銘柄`);
  } else if (symbolArg) {
    const s = symbolArg.includes(".T") ? symbolArg : `${symbolArg}.T`;
    symbols = [s];
  } else {
    console.log("使い方:");
    console.log("  npx tsx scripts/analyze-earnings.ts 7203.T");
    console.log("  npx tsx scripts/analyze-earnings.ts --all");
    console.log("  npx tsx scripts/analyze-earnings.ts --list");
    console.log("");
    console.log("オプション:");
    console.log("  --slack      Slack通知を送信");
    console.log("  --skip-web   Web調査をスキップ（決算資料のみで判定）");
    console.log("  --list       決算資料がある銘柄一覧");
    console.log("  --all        全銘柄を分析");
    return;
  }

  const startTime = Date.now();

  for (let i = 0; i < symbols.length; i++) {
    await analyzeWithEarnings(symbols[i]);
    // API負荷対策
    if (i < symbols.length - 1) await sleep(2000);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n完了 (${elapsed}秒, ${symbols.length}銘柄)`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

#!/usr/bin/env npx tsx
// ============================================================
// シグナルモニター - ウォッチリスト全銘柄のシグナル検出 + Slack通知
// 使い方: npx tsx scripts/monitor-signals.ts [--dry-run]
// ============================================================

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { readFileSync } from "fs";
import { sleep } from "@/lib/utils/cli";
import { join } from "path";
import type { WatchList } from "../src/types";

function getWatchList(): WatchList {
  const raw = readFileSync(join(process.cwd(), "data", "watchlist.json"), "utf-8");
  return JSON.parse(raw) as WatchList;
}
import { getHistoricalPrices, getQuote, getFinancialData } from "@/lib/api/yahooFinance";
import { strategies, getStrategyParams } from "@/lib/backtest/strategies";
import { getExitLevels } from "@/lib/utils/exitLevels";
import {
  getNotificationConfig,
  calculatePositionSize,
} from "@/lib/config/notificationConfig";
import {
  hasBeenNotified,
  markAsNotified,
  cleanupOldNotifications,
} from "@/lib/cache/signalNotificationCache";
import {
  sendSignalNotification,
  sendSummaryNotification,
  isSlackConfigured,
  type SignalNotification,
} from "@/lib/api/slack";
import { fetchNewsAndSentiment, fetchFundamentalResearch } from "@/lib/api/webResearch";
import { analyzeSentiment, validateSignal } from "@/lib/api/llm";
import { setCachedValidation, getCachedValidation } from "@/lib/cache/fundamentalCache";
import { setCachedNews } from "@/lib/cache/newsCache";
import { getEarningsTextWithXbrl } from "@/lib/utils/earningsReader";
import type { PriceData, NewsItem } from "@/types";
import type { Signal } from "@/lib/backtest/types";
import type { PeriodType } from "@/lib/backtest/presets";

// ---------- ユーティリティ ----------

/** 直近N日以内のbuyシグナルインデックスを取得 */
function findRecentBuySignals(
  data: PriceData[],
  signals: Signal[],
  lookbackDays: number,
): { index: number; date: string; price: number }[] {
  const results: { index: number; date: string; price: number }[] = [];
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

  for (let i = signals.length - 1; i >= 0; i--) {
    if (new Date(data[i].date) < cutoffDate) break;
    if (signals[i] === "buy") {
      results.push({
        index: i,
        date: data[i].date,
        price: data[i].close,
      });
    }
  }

  return results;
}

// ---------- 分析パイプライン ----------

interface AnalysisResult {
  validation?: {
    decision: "entry" | "wait" | "avoid";
    summary: string;
    signalEvaluation: string;
    riskFactor: string;
    catalyst: string;
  };
  sentiment?: { score: number; label: string };
  newsHighlights?: string[];
  fundamentalSummary?: string;
}

/**
 * シグナルに対してニュース・ファンダ・Go/NoGo判定を実行
 * 各ステップの失敗は個別にcatchし、部分結果を返す（graceful degradation）
 */
async function analyzeSignal(
  symbol: string,
  name: string,
  strategyId: string,
  strategyName: string,
  timeframe: "daily" | "weekly",
  buyDate: string,
  buyPrice: number,
  currentPrice: number,
  withEarnings: boolean = false,
): Promise<AnalysisResult> {
  const result: AnalysisResult = {};

  try {
    // Step 1: 定量データ取得
    console.log(`    [分析] 定量データ取得中...`);
    const [quote, financial] = await Promise.all([
      getQuote(symbol),
      getFinancialData(symbol),
    ]);
    const stats = {
      per: quote.per,
      pbr: quote.pbr,
      roe: financial.roe,
      dividendYield: quote.dividendYield,
    };
    const ticker = symbol.replace(".T", "");

    // Step 2: ニュース + センチメント（Gemini Grounding）
    let newsData: { news: NewsItem[]; snsOverview: string; analystRating: string } = {
      news: [], snsOverview: "", analystRating: "",
    };
    console.log(`    [分析] ニュース収集中...`);
    try {
      newsData = await fetchNewsAndSentiment(symbol, name);
      setCachedNews(symbol, newsData.news, newsData.snsOverview, newsData.analystRating);
      result.newsHighlights = newsData.news
        .slice(0, 3)
        .map((n) => `${n.title} (${n.source})`);
    } catch (err) {
      console.warn(`    [分析] ニュース取得失敗: ${err instanceof Error ? err.message : err}`);
    }

    // Step 3: ファンダメンタルズ調査（Gemini Grounding）
    let fundamentalRawText = "";
    if (stats.pbr != null && stats.per != null) {
      console.log(`    [分析] ファンダメンタルズ調査中...`);
      try {
        const research = await fetchFundamentalResearch(symbol, name, ticker, {
          pbr: stats.pbr ?? 0,
          per: stats.per ?? 0,
        });
        fundamentalRawText = research.rawText;
        result.fundamentalSummary = [
          research.valuationReason ? `評価: ${research.valuationReason.slice(0, 80)}` : "",
          research.catalystAndRisk ? `材料/リスク: ${research.catalystAndRisk.slice(0, 80)}` : "",
        ].filter(Boolean).join(" | ");
      } catch (err) {
        console.warn(`    [分析] ファンダ調査失敗: ${err instanceof Error ? err.message : err}`);
      }
    }

    // Step 4: センチメント分析（LLM）
    if (newsData.news.length > 0) {
      console.log(`    [分析] センチメント分析中...`);
      try {
        const sentimentResult = await analyzeSentiment(
          newsData.news,
          newsData.snsOverview,
          newsData.analystRating,
        );
        result.sentiment = {
          score: sentimentResult.score,
          label: sentimentResult.label,
        };
      } catch (err) {
        console.warn(`    [分析] センチメント失敗: ${err instanceof Error ? err.message : err}`);
      }
    }

    // Step 5: 決算資料テキスト取得（--with-earnings 時のみ）
    let earningsContext = "";
    if (withEarnings) {
      console.log(`    [分析] 決算資料読み込み中...`);
      try {
        const earnings = await getEarningsTextWithXbrl(symbol);
        if (earnings) {
          earningsContext = `\n\n### 決算資料 (${earnings.sources.join(", ")})\n${earnings.text}`;
          console.log(`    [分析] 決算資料: ${earnings.sources.length}件 (${earnings.totalChars.toLocaleString()}文字)`);
        } else {
          console.log(`    [分析] 決算資料: なし`);
        }
      } catch (err) {
        console.warn(`    [分析] 決算資料読み込み失敗: ${err instanceof Error ? err.message : err}`);
      }
    }

    // Step 6: Go/NoGo判定（LLM）
    console.log(`    [分析] Go/NoGo判定中...`);
    try {
      const pnlPct = ((currentPrice - buyPrice) / buyPrice * 100).toFixed(1);
      const signalDesc = `${strategyName} (${timeframe === "daily" ? "日足" : "週足"}): ${buyDate}にエントリー (買値:${buyPrice}円, 現在価格:${currentPrice}円, 損益:${Number(pnlPct) > 0 ? "+" : ""}${pnlPct}%)`;

      const enrichedFundamental = (fundamentalRawText || "ファンダ調査データなし") + earningsContext;

      const validationResult = await validateSignal(
        symbol,
        name,
        { description: signalDesc, strategyName },
        stats,
        enrichedFundamental,
      );

      result.validation = {
        decision: validationResult.decision,
        summary: validationResult.summary,
        signalEvaluation: validationResult.signalEvaluation,
        riskFactor: validationResult.riskFactor,
        catalyst: validationResult.catalyst,
      };

      // UI用にキャッシュ書込み（compositeキー形式）
      const compositeKey = `${strategyId}_${timeframe}_${buyDate}`;
      setCachedValidation(symbol, compositeKey, validationResult);
      console.log(`    [分析] 判定: ${validationResult.decision} - ${validationResult.summary.slice(0, 60)}`);
    } catch (err) {
      console.warn(`    [分析] Go/NoGo判定失敗: ${err instanceof Error ? err.message : err}`);
    }
  } catch (err) {
    console.warn(`    [分析] パイプラインエラー: ${err instanceof Error ? err.message : err}`);
  }

  return result;
}

// ---------- メイン処理 ----------

async function main() {
  const isDryRun = process.argv.includes("--dry-run");
  const skipAnalysis = process.argv.includes("--skip-analysis");
  const withEarnings = process.argv.includes("--with-earnings");
  const startTime = Date.now();

  console.log("=".repeat(60));
  console.log(`シグナルモニター開始 (${new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })})`);
  if (isDryRun) console.log("** DRY RUN モード - 通知は送信しません **");
  if (skipAnalysis) console.log("** SKIP ANALYSIS - 分析なし高速モード **");
  if (withEarnings) console.log("** WITH EARNINGS - 決算資料込み分析 **");
  console.log("=".repeat(60));

  // Slack設定チェック
  if (!isDryRun && !isSlackConfigured()) {
    console.warn("SLACK_WEBHOOK_URL が未設定です。--dry-run で実行するか、.env.local に設定してください。");
  }

  // 設定読み込み
  const config = getNotificationConfig();
  if (!config.enabled) {
    console.log("通知機能が無効化されています (config.enabled = false)");
    return;
  }

  const enabledStrategies = config.strategies.filter((s) => s.enabled);
  console.log(`有効な戦略: ${enabledStrategies.map((s) => s.strategyId).join(", ")}`);
  console.log(`検出対象: 直近 ${config.lookbackDays} 日以内のシグナル`);
  console.log("");

  // 古い通知履歴のクリーンアップ
  const cleaned = cleanupOldNotifications();
  if (cleaned > 0) console.log(`古い通知履歴を ${cleaned} 件削除しました`);

  // ウォッチリスト読み込み
  const watchlist = getWatchList();
  let jpStocks = watchlist.stocks.filter((s) => s.market === "JP");

  // お気に入りフィルタ
  if (config.favoritesOnly) {
    jpStocks = jpStocks.filter((s) => s.favorite);
    console.log(`対象: お気に入り銘柄のみ (${jpStocks.length} 銘柄)\n`);
  } else {
    console.log(`チェック対象: ${jpStocks.length} 銘柄\n`);
  }

  let totalNewSignals = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  // 銘柄ごとに処理（API負荷を考慮して逐次実行）
  for (let idx = 0; idx < jpStocks.length; idx++) {
    const stock = jpStocks[idx];
    const progress = `[${idx + 1}/${jpStocks.length}]`;

    try {
      // タイムフレームごとにデータ取得・シグナル検出
      const timeframes: PeriodType[] = ["daily", "weekly"];

      for (const tf of timeframes) {
        // この銘柄×タイムフレームで有効な戦略があるかチェック
        const activeStrats = enabledStrategies.filter((s) =>
          s.timeframes.includes(tf),
        );
        if (activeStrats.length === 0) continue;

        // 価格データ取得
        let data: PriceData[];
        try {
          data = await getHistoricalPrices(stock.symbol, tf);
        } catch (err) {
          console.error(`${progress} ${stock.symbol} ${tf} データ取得失敗:`, err instanceof Error ? err.message : err);
          totalErrors++;
          continue;
        }

        if (data.length < 30) {
          continue; // データ不足
        }

        const currentPrice = data[data.length - 1].close;

        // 各戦略でシグナル検出
        for (const stratConfig of activeStrats) {
          const strat = strategies.find((s) => s.id === stratConfig.strategyId);
          if (!strat) continue;

          const params = getStrategyParams(stratConfig.strategyId, "optimized", tf);
          const signals = strat.compute(data, params);

          // 直近のbuyシグナルを取得
          const recentBuys = findRecentBuySignals(data, signals, config.lookbackDays);

          for (const buy of recentBuys) {
            const alreadyNotified = hasBeenNotified(stock.symbol, stratConfig.strategyId, tf, buy.date);

            // 通知済みの場合: バリデーションキャッシュが切れていれば再分析のみ実行
            if (alreadyNotified) {
              const compositeKey = `${stratConfig.strategyId}_${tf}_${buy.date}`;
              const cachedVal = getCachedValidation(stock.symbol, compositeKey);
              if (cachedVal || skipAnalysis) {
                totalSkipped++;
                continue;
              }
              // バリデーションキャッシュ切れ → 再分析（Slack通知なし）
              console.log(
                `${progress} ${stock.name} (${stock.symbol}) - ${strat.name} [${tf === "daily" ? "日足" : "週足"}] バリデーション再分析: ${buy.date}`,
              );
              await analyzeSignal(
                stock.symbol,
                stock.name,
                stratConfig.strategyId,
                strat.name,
                tf,
                buy.date,
                buy.price,
                currentPrice,
                withEarnings,
              );
              totalSkipped++;
              continue;
            }

            // ポジションサイズ算出
            const posSize = calculatePositionSize(config, currentPrice);

            // 利確/損切レベル
            const exits = getExitLevels(stratConfig.strategyId, data, buy.index, buy.price, params);

            // 利確/損切時の損益率
            const pnlAtTakeProfit = exits.takeProfitPrice
              ? ((exits.takeProfitPrice - currentPrice) / currentPrice) * 100
              : undefined;
            const pnlAtStopLoss = exits.stopLossPrice
              ? ((exits.stopLossPrice - currentPrice) / currentPrice) * 100
              : undefined;

            console.log(
              `${progress} ${stock.name} (${stock.symbol}) - ${strat.name} [${tf === "daily" ? "日足" : "週足"}] シグナル: ${buy.date} 現在値: ¥${currentPrice.toLocaleString()}`,
            );

            // 分析パイプライン実行
            let analysisResult: AnalysisResult = {};
            if (!skipAnalysis) {
              console.log(`  → 分析パイプライン実行中...`);
              analysisResult = await analyzeSignal(
                stock.symbol,
                stock.name,
                stratConfig.strategyId,
                strat.name,
                tf,
                buy.date,
                buy.price,
                currentPrice,
                withEarnings,
              );
            }

            const notification: SignalNotification = {
              symbol: stock.symbol,
              symbolName: stock.name,
              sectors: stock.sectors,
              strategyId: stratConfig.strategyId,
              strategyName: strat.name,
              timeframe: tf,
              signalDate: buy.date,
              signalType: "buy",
              currentPrice,
              suggestedQty: posSize.qty,
              suggestedAmount: posSize.amount,
              ...exits,
              pnlAtTakeProfit,
              pnlAtStopLoss,
              ...analysisResult,
            };

            if (!isDryRun) {
              const sent = await sendSignalNotification(notification);
              if (sent) {
                markAsNotified(stock.symbol, stratConfig.strategyId, tf, buy.date, "buy");
                totalNewSignals++;
                // Slack API レート制限対策
                await sleep(1000);
              } else {
                console.warn(`  → Slack送信失敗`);
              }
            } else {
              totalNewSignals++;
              console.log(`  → [DRY RUN] 通知をスキップ`);
            }
          }
        }
      }
    } catch (error) {
      console.error(
        `${progress} ${stock.symbol} 処理エラー:`,
        error instanceof Error ? error.message : error,
      );
      totalErrors++;
    }

    // Yahoo Finance API負荷対策（200ms間隔）
    if (idx < jpStocks.length - 1) {
      await sleep(200);
    }
  }

  // サマリー
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("");
  console.log("=".repeat(60));
  console.log(`完了 (${elapsed}秒)`);
  console.log(`  チェック銘柄: ${jpStocks.length}`);
  console.log(`  新規シグナル: ${totalNewSignals}`);
  console.log(`  スキップ（通知済み）: ${totalSkipped}`);
  console.log(`  エラー: ${totalErrors}`);
  console.log("=".repeat(60));

  // サマリー通知
  if (!isDryRun && config.sendSummary && isSlackConfigured() && totalNewSignals > 0) {
    await sendSummaryNotification(jpStocks.length, totalNewSignals, totalSkipped);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

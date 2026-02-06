#!/usr/bin/env npx tsx
// ============================================================
// シグナルモニター - ウォッチリスト全銘柄のシグナル検出 + Slack通知
// 使い方: npx tsx scripts/monitor-signals.ts [--dry-run]
// ============================================================

import "dotenv/config";
import { getWatchList } from "@/lib/data/watchlist";
import { getHistoricalPrices } from "@/lib/api/yahooFinance";
import { strategies, getStrategyParams } from "@/lib/backtest/strategies";
import { getExitLevels } from "@/lib/utils/exitLevels";
import {
  getNotificationConfig,
  isStrategyEnabled,
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
import type { PriceData } from "@/types";
import type { Signal } from "@/lib/backtest/types";
import type { PeriodType } from "@/lib/backtest/presets";

// ---------- ユーティリティ ----------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

// ---------- メイン処理 ----------

async function main() {
  const isDryRun = process.argv.includes("--dry-run");
  const startTime = Date.now();

  console.log("=".repeat(60));
  console.log(`シグナルモニター開始 (${new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })})`);
  if (isDryRun) console.log("** DRY RUN モード - 通知は送信しません **");
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
  const jpStocks = watchlist.stocks.filter((s) => s.market === "JP");
  console.log(`チェック対象: ${jpStocks.length} 銘柄\n`);

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
            // 重複チェック
            if (hasBeenNotified(stock.symbol, stratConfig.strategyId, tf, buy.date)) {
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
            };

            console.log(
              `${progress} ${stock.name} (${stock.symbol}) - ${strat.name} [${tf === "daily" ? "日足" : "週足"}] シグナル: ${buy.date} 現在値: ¥${currentPrice.toLocaleString()}`,
            );

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

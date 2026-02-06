// ============================================================
// Slack Webhook 通知クライアント
// ============================================================

interface SlackBlock {
  type: string;
  text?: { type: string; text: string; emoji?: boolean };
  fields?: { type: string; text: string }[];
  elements?: unknown[];
  accessory?: unknown;
}

interface SlackMessage {
  text: string;          // フォールバックテキスト
  blocks?: SlackBlock[];
  username?: string;
  icon_emoji?: string;
  channel?: string;
}

export interface SignalNotification {
  symbol: string;
  symbolName: string;
  sectors?: string[];
  strategyId: string;
  strategyName: string;
  timeframe: "daily" | "weekly";
  signalDate: string;
  signalType: "buy" | "sell";
  currentPrice: number;
  suggestedQty: number;
  suggestedAmount: number;
  takeProfitPrice?: number;
  takeProfitLabel?: string;
  stopLossPrice?: number;
  stopLossLabel?: string;
  pnlAtTakeProfit?: number;
  pnlAtStopLoss?: number;
}

function getWebhookUrl(): string | null {
  return process.env.SLACK_WEBHOOK_URL || null;
}

export function isSlackConfigured(): boolean {
  return !!getWebhookUrl();
}

async function postToSlack(message: SlackMessage): Promise<boolean> {
  const url = getWebhookUrl();
  if (!url) {
    console.warn("[Slack] SLACK_WEBHOOK_URL が未設定です");
    return false;
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[Slack] 送信失敗: ${res.status} ${text}`);
      return false;
    }

    return true;
  } catch (error) {
    console.error("[Slack] 送信エラー:", error);
    return false;
  }
}

/** シグナル通知を送信 */
export async function sendSignalNotification(signal: SignalNotification): Promise<boolean> {
  const emoji = signal.signalType === "buy" ? ":chart_with_upwards_trend:" : ":chart_with_downwards_trend:";
  const sideLabel = signal.signalType === "buy" ? "買いシグナル" : "売りシグナル";
  const tfLabel = signal.timeframe === "daily" ? "日足" : "週足";
  const sectorText = signal.sectors?.length ? signal.sectors.join(", ") : "";

  const fields: { type: string; text: string }[] = [
    { type: "mrkdwn", text: `*戦略:*\n${signal.strategyName}` },
    { type: "mrkdwn", text: `*タイムフレーム:*\n${tfLabel}` },
    { type: "mrkdwn", text: `*現在価格:*\n¥${signal.currentPrice.toLocaleString()}` },
    { type: "mrkdwn", text: `*シグナル日:*\n${signal.signalDate}` },
  ];

  // ポジションサイズ
  fields.push({
    type: "mrkdwn",
    text: `*推奨数量:*\n${signal.suggestedQty}株 (¥${signal.suggestedAmount.toLocaleString()})`,
  });

  // 利確レベル
  if (signal.takeProfitPrice) {
    const tpPnl = signal.pnlAtTakeProfit
      ? ` (+${signal.pnlAtTakeProfit.toFixed(1)}%)`
      : "";
    fields.push({
      type: "mrkdwn",
      text: `*利確:*\n¥${signal.takeProfitPrice.toLocaleString()} ${signal.takeProfitLabel || ""}${tpPnl}`,
    });
  }

  // 損切レベル
  if (signal.stopLossPrice) {
    const slPnl = signal.pnlAtStopLoss
      ? ` (${signal.pnlAtStopLoss.toFixed(1)}%)`
      : "";
    fields.push({
      type: "mrkdwn",
      text: `*損切:*\n¥${signal.stopLossPrice.toLocaleString()} ${signal.stopLossLabel || ""}${slPnl}`,
    });
  } else if (signal.stopLossLabel) {
    fields.push({
      type: "mrkdwn",
      text: `*損切条件:*\n${signal.stopLossLabel}`,
    });
  }

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `${emoji} ${sideLabel}: ${signal.symbolName} (${signal.symbol})`,
        emoji: true,
      },
    },
  ];

  if (sectorText) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `_${sectorText}_` },
    });
  }

  blocks.push({
    type: "section",
    fields,
  });

  blocks.push({ type: "divider" } as SlackBlock);

  const fallbackText = `${sideLabel}: ${signal.symbolName} (${signal.symbol}) - ${signal.strategyName} [${tfLabel}] ¥${signal.currentPrice.toLocaleString()}`;

  return postToSlack({
    text: fallbackText,
    blocks,
    username: process.env.SLACK_USERNAME || "Stock Signal Bot",
    icon_emoji: ":robot_face:",
  });
}

/** サマリー通知を送信 */
export async function sendSummaryNotification(
  totalStocks: number,
  newSignals: number,
  skippedSignals: number,
): Promise<boolean> {
  const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });

  return postToSlack({
    text: `シグナルモニター完了: ${newSignals}件の新規通知 (${now})`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: [
            `*シグナルモニター完了* (${now})`,
            `- チェック銘柄数: ${totalStocks}`,
            `- 新規シグナル通知: ${newSignals}件`,
            `- スキップ（通知済み）: ${skippedSignals}件`,
          ].join("\n"),
        },
      },
    ],
    username: process.env.SLACK_USERNAME || "Stock Signal Bot",
    icon_emoji: ":robot_face:",
  });
}

/** テストメッセージ送信 */
export async function sendTestMessage(): Promise<boolean> {
  const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });

  return postToSlack({
    text: `Slack通知テスト (${now})`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:white_check_mark: *Slack通知テスト成功*\n接続日時: ${now}\nStock Signal Bot は正常に動作しています。`,
        },
      },
    ],
    username: process.env.SLACK_USERNAME || "Stock Signal Bot",
    icon_emoji: ":robot_face:",
  });
}

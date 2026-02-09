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
  // --- 分析データ（オプション） ---
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

function getWebhookUrl(): string | null {
  return process.env.SLACK_WEBHOOK_URL || null;
}

function getBotToken(): string | null {
  return process.env.SLACK_BOT_TOKEN || null;
}

function getChannelId(): string | null {
  return process.env.SLACK_CHANNEL_ID || null;
}

/** Bot Token モード（インタラクティブボタン対応）が使えるか */
export function isBotMode(): boolean {
  return !!getBotToken() && !!getChannelId();
}

export function isSlackConfigured(): boolean {
  return !!getWebhookUrl() || isBotMode();
}

/**
 * Slack にメッセージ送信
 * Bot Token がある場合は chat.postMessage API を使用（メッセージ更新可能）
 * ない場合は Incoming Webhook にフォールバック
 */
async function postToSlack(message: SlackMessage): Promise<boolean> {
  const botToken = getBotToken();
  const channelId = getChannelId();

  // Bot Token モード
  if (botToken && channelId) {
    try {
      const res = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${botToken}`,
        },
        body: JSON.stringify({
          channel: message.channel || channelId,
          text: message.text,
          blocks: message.blocks,
        }),
      });

      const data = await res.json() as { ok: boolean; error?: string };
      if (!data.ok) {
        console.error(`[Slack] Bot API送信失敗: ${data.error}`);
        return false;
      }
      return true;
    } catch (error) {
      console.error("[Slack] Bot API送信エラー:", error);
      return false;
    }
  }

  // Webhook フォールバック
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

  // Go/NoGo判定
  if (signal.validation) {
    const decisionEmoji = signal.validation.decision === "entry"
      ? ":large_green_circle:"
      : signal.validation.decision === "avoid"
        ? ":red_circle:"
        : ":large_yellow_circle:";
    const decisionLabel = signal.validation.decision === "entry"
      ? "Go (エントリー推奨)"
      : signal.validation.decision === "avoid"
        ? "No Go (見送り推奨)"
        : "様子見";

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${decisionEmoji} *Go/NoGo判定: ${decisionLabel}*\n${signal.validation.summary}`,
      },
    });

    const validationFields: { type: string; text: string }[] = [];
    if (signal.validation.catalyst) {
      validationFields.push({
        type: "mrkdwn",
        text: `*:rocket: カタリスト:*\n${signal.validation.catalyst.slice(0, 150)}`,
      });
    }
    if (signal.validation.riskFactor) {
      validationFields.push({
        type: "mrkdwn",
        text: `*:warning: リスク:*\n${signal.validation.riskFactor.slice(0, 150)}`,
      });
    }
    if (validationFields.length > 0) {
      blocks.push({ type: "section", fields: validationFields });
    }
  }

  // センチメント
  if (signal.sentiment) {
    const sentimentEmoji = signal.sentiment.score > 0.2
      ? ":chart_with_upwards_trend:"
      : signal.sentiment.score < -0.2
        ? ":chart_with_downwards_trend:"
        : ":left_right_arrow:";
    blocks.push({
      type: "context",
      elements: [{
        type: "mrkdwn",
        text: `${sentimentEmoji} *センチメント:* ${signal.sentiment.label} (${signal.sentiment.score > 0 ? "+" : ""}${signal.sentiment.score.toFixed(2)})`,
      }],
    });
  }

  // ニュースハイライト
  if (signal.newsHighlights && signal.newsHighlights.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*:newspaper: 直近ニュース:*\n${signal.newsHighlights.map((n) => `• ${n}`).join("\n")}`,
      },
    });
  }

  // ファンダメンタルズ要約
  if (signal.fundamentalSummary) {
    blocks.push({
      type: "context",
      elements: [{
        type: "mrkdwn",
        text: `:bar_chart: *ファンダ:* ${signal.fundamentalSummary.slice(0, 200)}`,
      }],
    });
  }

  blocks.push({ type: "divider" } as SlackBlock);

  // Bot Token モード時のみ購入/スキップボタン追加
  if (isBotMode() && signal.signalType === "buy") {
    const actionPayload = JSON.stringify({
      symbol: signal.symbol,
      symbolName: signal.symbolName,
      strategyId: signal.strategyId,
      strategyName: signal.strategyName,
      qty: signal.suggestedQty,
      price: signal.currentPrice,
      signalDate: signal.signalDate,
      timeframe: signal.timeframe,
    });

    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "購入実行", emoji: true },
          style: "primary",
          action_id: "execute_buy",
          value: actionPayload,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "スキップ", emoji: true },
          action_id: "skip_signal",
          value: actionPayload,
        },
      ],
    } as SlackBlock);
  }

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

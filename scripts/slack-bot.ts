#!/usr/bin/env npx tsx
// ============================================================
// Slack Bot - Socket Mode で常駐し、ボタンクリックを処理
// 使い方: npx tsx scripts/slack-bot.ts
// 前提: SLACK_BOT_TOKEN, SLACK_APP_TOKEN を .env.local に設定
// ============================================================

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { App, BlockAction, ButtonAction } from "@slack/bolt";
import fs from "fs";
import path from "path";

// ---------- 注文履歴管理 ----------

const ORDER_HISTORY_FILE = path.join(process.cwd(), "data", "order-history.json");

interface OrderRecord {
  symbol: string;
  symbolName: string;
  strategyId: string;
  strategyName: string;
  qty: number;
  price: number;
  signalDate: string;
  timeframe: string;
  action: "buy" | "skip";
  executedAt: string;
  executedBy: string;  // Slack user ID
}

function loadOrderHistory(): OrderRecord[] {
  try {
    if (fs.existsSync(ORDER_HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(ORDER_HISTORY_FILE, "utf-8"));
    }
  } catch { /* ignore */ }
  return [];
}

function saveOrderRecord(record: OrderRecord): void {
  const dir = path.dirname(ORDER_HISTORY_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const history = loadOrderHistory();
  history.push(record);
  fs.writeFileSync(ORDER_HISTORY_FILE, JSON.stringify(history, null, 2), "utf-8");
}

// ---------- Slack Bot 起動 ----------

const botToken = process.env.SLACK_BOT_TOKEN;
const appToken = process.env.SLACK_APP_TOKEN;

if (!botToken || !appToken) {
  console.error("SLACK_BOT_TOKEN と SLACK_APP_TOKEN を .env.local に設定してください。");
  console.error("  SLACK_BOT_TOKEN=xoxb-... (Bot User OAuth Token)");
  console.error("  SLACK_APP_TOKEN=xapp-... (App-Level Token, connections:write scope)");
  process.exit(1);
}

const app = new App({
  token: botToken,
  appToken: appToken,
  socketMode: true,
});

// ---------- 「購入実行」ボタンハンドラ ----------

app.action<BlockAction<ButtonAction>>("execute_buy", async ({ body, ack, client }) => {
  await ack();

  const action = body.actions[0];
  const payload = JSON.parse(action.value ?? "{}");
  const userId = body.user.id;
  const channelId = body.channel?.id;
  const messageTs = body.message?.ts;

  console.log(`[Bot] 購入選択: ${payload.symbolName} (${payload.symbol}) ${payload.qty}株 by ${userId}`);

  // ローカルに購入意思を保存
  saveOrderRecord({
    ...payload,
    action: "buy",
    executedAt: new Date().toISOString(),
    executedBy: userId,
  });

  // Slackメッセージ更新（ボタン → 記録済み表示）
  if (channelId && messageTs && body.message) {
    const originalBlocks = (body.message.blocks || []).filter(
      (b: { type: string }) => b.type !== "actions",
    );
    await client.chat.update({
      channel: channelId,
      ts: messageTs,
      blocks: [
        ...originalBlocks,
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:white_check_mark: *購入記録済み* ${payload.qty}株 @¥${payload.price.toLocaleString()} (<@${userId}>)`,
          },
        },
      ],
      text: `購入記録: ${payload.symbolName} ${payload.qty}株`,
    });
  }

  console.log(`[Bot] 購入記録保存完了: ${payload.symbolName}`);
});

// ---------- 「スキップ」ボタンハンドラ ----------

app.action<BlockAction<ButtonAction>>("skip_signal", async ({ body, ack, client }) => {
  await ack();

  const action = body.actions[0];
  const payload = JSON.parse(action.value ?? "{}");
  const userId = body.user.id;
  const channelId = body.channel?.id;
  const messageTs = body.message?.ts;

  console.log(`[Bot] スキップ: ${payload.symbolName} (${payload.symbol}) by ${userId}`);

  // スキップ履歴保存
  saveOrderRecord({
    ...payload,
    action: "skip",
    executedAt: new Date().toISOString(),
    executedBy: userId,
  });

  // Slackメッセージ更新（ボタン → スキップ済み）
  if (channelId && messageTs && body.message) {
    const originalBlocks = (body.message.blocks || []).filter(
      (b: { type: string }) => b.type !== "actions",
    );
    await client.chat.update({
      channel: channelId,
      ts: messageTs,
      blocks: [
        ...originalBlocks,
        {
          type: "context",
          elements: [{
            type: "mrkdwn",
            text: `:fast_forward: スキップ済み (<@${userId}>)`,
          }],
        },
      ],
      text: `スキップ: ${payload.symbolName}`,
    });
  }
});

// ---------- 起動 ----------

(async () => {
  await app.start();
  console.log("=".repeat(60));
  console.log("Slack Bot 起動完了 (Socket Mode)");
  console.log("  ボタンクリックを待機中...");
  console.log("  Ctrl+C で停止");
  console.log("=".repeat(60));
})();

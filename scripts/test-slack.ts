#!/usr/bin/env npx tsx
// Slack Webhook 接続テスト
// 使い方: npx tsx scripts/test-slack.ts

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { sendTestMessage, isSlackConfigured } from "@/lib/api/slack";

async function main() {
  if (!isSlackConfigured()) {
    console.error("SLACK_WEBHOOK_URL が .env.local に設定されていません。");
    console.error("Slack App の Incoming Webhook URL を設定してください。");
    process.exit(1);
  }

  console.log("Slackテストメッセージを送信中...");
  const ok = await sendTestMessage();

  if (ok) {
    console.log("送信成功! Slackチャンネルを確認してください。");
  } else {
    console.error("送信失敗。Webhook URLが正しいか確認してください。");
    process.exit(1);
  }
}

main();

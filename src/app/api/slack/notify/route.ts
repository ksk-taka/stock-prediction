import { NextRequest, NextResponse } from "next/server";
import {
  sendSignalNotification,
  isSlackConfigured,
  type SignalNotification,
} from "@/lib/api/slack";
import {
  getNotificationConfig,
  calculatePositionSize,
} from "@/lib/config/notificationConfig";

export const dynamic = "force-dynamic";

/**
 * POST /api/slack/notify
 * body: { symbol, symbolName, sectors?, strategyId, strategyName,
 *         timeframe, signalDate, currentPrice,
 *         takeProfitPrice?, takeProfitLabel?, stopLossPrice?, stopLossLabel?,
 *         validation? }
 */
export async function POST(request: NextRequest) {
  if (!isSlackConfigured()) {
    return NextResponse.json(
      { error: "Slack が設定されていません (SLACK_WEBHOOK_URL or SLACK_BOT_TOKEN)" },
      { status: 500 },
    );
  }

  const body = await request.json();
  const {
    symbol,
    symbolName,
    sectors,
    strategyId,
    strategyName,
    timeframe,
    signalDate,
    currentPrice,
    takeProfitPrice,
    takeProfitLabel,
    stopLossPrice,
    stopLossLabel,
    validation,
  } = body;

  if (!symbol || !strategyId || !strategyName || !currentPrice) {
    return NextResponse.json(
      { error: "必須パラメータが不足しています" },
      { status: 400 },
    );
  }

  const config = getNotificationConfig();
  const { qty, amount } = calculatePositionSize(config, currentPrice);

  const signal: SignalNotification = {
    symbol,
    symbolName: symbolName ?? symbol,
    sectors: sectors ?? [],
    strategyId,
    strategyName,
    timeframe: timeframe ?? "daily",
    signalDate: signalDate ?? new Date().toISOString().slice(0, 10),
    signalType: "buy",
    currentPrice,
    suggestedQty: qty,
    suggestedAmount: amount,
    takeProfitPrice,
    takeProfitLabel,
    stopLossPrice,
    stopLossLabel,
    validation,
  };

  const ok = await sendSignalNotification(signal);

  if (!ok) {
    return NextResponse.json(
      { error: "Slack通知の送信に失敗しました" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}

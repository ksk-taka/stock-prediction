"use client";

import type { SentimentData } from "@/types";
import { sentimentLabelJa } from "@/lib/utils/format";

interface SentimentGaugeProps {
  sentiment: SentimentData | null;
}

export default function SentimentGauge({ sentiment }: SentimentGaugeProps) {
  if (!sentiment) {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg bg-white dark:bg-slate-800 p-4 shadow dark:shadow-slate-900/50">
        <span className="text-gray-400 dark:text-slate-500">センチメントデータなし</span>
      </div>
    );
  }

  // スコア -1〜+1 を 0〜180度に変換
  const angle = ((sentiment.score + 1) / 2) * 180;
  const radians = (angle * Math.PI) / 180;

  // ゲージの針の先端座標
  const cx = 100;
  const cy = 100;
  const r = 70;
  const needleX = cx - r * Math.cos(radians);
  const needleY = cy - r * Math.sin(radians);

  // 色を決定
  function getColor(score: number): string {
    if (score <= -0.6) return "#ef4444";
    if (score <= -0.2) return "#f97316";
    if (score <= 0.2) return "#eab308";
    if (score <= 0.6) return "#84cc16";
    return "#22c55e";
  }

  const color = getColor(sentiment.score);

  return (
    <div className="rounded-lg bg-white dark:bg-slate-800 p-4 shadow dark:shadow-slate-900/50">
      <h3 className="mb-2 text-center text-sm font-semibold text-gray-700 dark:text-slate-300">
        センチメント
      </h3>
      <div className="flex justify-center">
        <svg width="200" height="120" viewBox="0 0 200 120">
          {/* 背景の半円 */}
          <path
            d="M 15 100 A 85 85 0 0 1 185 100"
            fill="none"
            stroke="#e5e7eb"
            strokeWidth="16"
            strokeLinecap="round"
          />
          {/* カラーグラデーションセグメント */}
          <path
            d="M 15 100 A 85 85 0 0 1 58 32"
            fill="none"
            stroke="#ef4444"
            strokeWidth="16"
            strokeLinecap="round"
          />
          <path
            d="M 58 32 A 85 85 0 0 1 100 15"
            fill="none"
            stroke="#f97316"
            strokeWidth="16"
          />
          <path
            d="M 100 15 A 85 85 0 0 1 142 32"
            fill="none"
            stroke="#eab308"
            strokeWidth="16"
          />
          <path
            d="M 142 32 A 85 85 0 0 1 185 100"
            fill="none"
            stroke="#22c55e"
            strokeWidth="16"
            strokeLinecap="round"
          />
          {/* 針 */}
          <line
            x1={cx}
            y1={cy}
            x2={needleX}
            y2={needleY}
            stroke={color}
            strokeWidth="3"
            strokeLinecap="round"
          />
          <circle cx={cx} cy={cy} r="5" fill={color} />
          {/* スコア表示 */}
          <text
            x={cx}
            y={cy + 15}
            textAnchor="middle"
            fontSize="14"
            fontWeight="bold"
            fill={color}
          >
            {sentiment.score > 0 ? "+" : ""}
            {sentiment.score.toFixed(2)}
          </text>
        </svg>
      </div>
      <div className="text-center">
        <span
          className="text-sm font-medium"
          style={{ color }}
        >
          {sentimentLabelJa(sentiment.label)}
        </span>
        <span className="ml-2 text-xs text-gray-400 dark:text-slate-500">
          確信度: {Math.round(sentiment.confidence * 100)}%
        </span>
      </div>
    </div>
  );
}

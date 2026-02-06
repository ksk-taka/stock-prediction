"use client";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import type { SentimentData } from "@/types";

interface SentimentChartProps {
  data: { date: string; sentiment: SentimentData }[];
}

export default function SentimentChart({ data }: SentimentChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg bg-white p-4 shadow text-gray-400">
        センチメント推移データなし
      </div>
    );
  }

  const chartData = data.map((d) => ({
    date: d.date,
    score: d.sentiment.score,
    news: d.sentiment.sources.news,
    sns: d.sentiment.sources.sns,
    analyst: d.sentiment.sources.analyst,
  }));

  return (
    <div className="rounded-lg bg-white p-4 shadow">
      <h3 className="mb-4 text-lg font-semibold text-gray-900">
        センチメント推移
      </h3>
      <ResponsiveContainer width="100%" height={250}>
        <AreaChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11 }}
            tickFormatter={(v) => {
              const d = v.split("-");
              return `${d[1]}/${d[2]}`;
            }}
          />
          <YAxis domain={[-1, 1]} tick={{ fontSize: 11 }} />
          <Tooltip
            formatter={(value, name) => {
              const labels: Record<string, string> = {
                score: "総合スコア",
                news: "ニュース",
                sns: "SNS",
                analyst: "アナリスト",
              };
              return [Number(value).toFixed(2), labels[String(name)] ?? name];
            }}
          />
          <ReferenceLine y={0} stroke="#6b7280" strokeDasharray="3 3" />
          <Area
            type="monotone"
            dataKey="score"
            stroke="#3b82f6"
            fill="#93c5fd"
            fillOpacity={0.3}
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

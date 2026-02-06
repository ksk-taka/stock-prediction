"use client";

import { useState, useEffect, useCallback } from "react";
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

interface HistoryEntry {
  judgment: "bullish" | "neutral" | "bearish";
  summary: string;
  analyzedAt: string;
}

interface FundamentalHistoryChartProps {
  symbol: string;
}

const judgmentScore = (j: string): number =>
  j === "bullish" ? 1 : j === "bearish" ? -1 : 0;

const judgmentLabel = (j: string): string =>
  j === "bullish" ? "強気" : j === "bearish" ? "弱気" : "中立";

const judgmentColor = (j: string): string =>
  j === "bullish" ? "#22c55e" : j === "bearish" ? "#ef4444" : "#eab308";

export default function FundamentalHistoryChart({ symbol }: FundamentalHistoryChartProps) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/fundamental?symbol=${encodeURIComponent(symbol)}&step=history`
      );
      const data = await res.json();
      setHistory(data.history ?? []);
    } catch {
      console.error("Failed to fetch fundamental history");
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  if (loading) {
    return (
      <div className="rounded-lg bg-white dark:bg-slate-800 p-4 shadow dark:shadow-slate-900/50">
        <h3 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
          ファンダメンタルズ判定推移
        </h3>
        <div className="flex h-48 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-500" />
        </div>
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="rounded-lg bg-white dark:bg-slate-800 p-4 shadow dark:shadow-slate-900/50">
        <h3 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
          ファンダメンタルズ判定推移
        </h3>
        <p className="text-sm text-gray-400 dark:text-slate-500">
          まだ分析履歴がありません。「ファンダ分析」タブで分析を実行すると、ここに推移が記録されます。
        </p>
      </div>
    );
  }

  const chartData = history.map((h) => ({
    date: h.analyzedAt.slice(0, 10),
    score: judgmentScore(h.judgment),
    judgment: h.judgment,
    summary: h.summary,
  }));

  return (
    <div className="rounded-lg bg-white dark:bg-slate-800 p-4 shadow dark:shadow-slate-900/50">
      <h3 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
        ファンダメンタルズ判定推移
      </h3>

      {/* チャート */}
      {chartData.length >= 2 ? (
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11 }}
              tickFormatter={(v) => {
                const d = v.split("-");
                return `${d[1]}/${d[2]}`;
              }}
            />
            <YAxis
              domain={[-1.5, 1.5]}
              ticks={[-1, 0, 1]}
              tick={{ fontSize: 10 }}
              tickFormatter={(v) =>
                v === 1 ? "強気" : v === -1 ? "弱気" : "中立"
              }
              width={40}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0]?.payload;
                if (!d) return null;
                return (
                  <div className="max-w-xs rounded border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 p-2 text-xs shadow dark:shadow-slate-900/50">
                    <p className="font-medium text-gray-700 dark:text-slate-300">{d.date}</p>
                    <p className="mt-1" style={{ color: judgmentColor(d.judgment) }}>
                      <span className="font-bold">{judgmentLabel(d.judgment)}</span>
                    </p>
                    <p className="mt-1 text-gray-500 dark:text-slate-400 line-clamp-3">{d.summary}</p>
                  </div>
                );
              }}
            />
            <ReferenceLine y={0} stroke="#9ca3af" strokeDasharray="3 3" />
            <defs>
              <linearGradient id="fundamentalGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#22c55e" stopOpacity={0.3} />
                <stop offset="50%" stopColor="#eab308" stopOpacity={0.1} />
                <stop offset="100%" stopColor="#ef4444" stopOpacity={0.3} />
              </linearGradient>
            </defs>
            <Area
              type="stepAfter"
              dataKey="score"
              stroke="#6366f1"
              fill="url(#fundamentalGrad)"
              strokeWidth={2}
              dot={(props: any) => {
                const { cx, cy, payload } = props;
                if (cx == null || cy == null) return <g key={props.key} />;
                return (
                  <circle
                    key={props.key}
                    cx={cx}
                    cy={cy}
                    r={5}
                    fill={judgmentColor(payload.judgment)}
                    stroke="#fff"
                    strokeWidth={2}
                  />
                );
              }}
            />
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <div className="mb-4 flex items-center gap-2 text-sm text-gray-500 dark:text-slate-400">
          <span>チャート表示には2回以上の分析が必要です</span>
        </div>
      )}

      {/* 履歴一覧 */}
      <div className="mt-4 space-y-2">
        <h4 className="text-sm font-semibold text-gray-700 dark:text-slate-300">分析履歴</h4>
        {[...history].reverse().map((h, i) => (
          <div
            key={`${h.analyzedAt}-${i}`}
            className="rounded border border-gray-100 dark:border-slate-700 px-3 py-2"
          >
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 dark:text-slate-500">
                {h.analyzedAt.slice(0, 10)}
              </span>
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                  h.judgment === "bullish"
                    ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                    : h.judgment === "bearish"
                      ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"
                      : "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400"
                }`}
              >
                {h.judgment === "bullish" ? "▲強気" : h.judgment === "bearish" ? "▼弱気" : "◆中立"}
              </span>
            </div>
            <p className="mt-1 text-xs text-gray-500 dark:text-slate-400 line-clamp-2">
              {h.summary}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

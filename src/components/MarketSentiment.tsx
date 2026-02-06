"use client";

import { useState, useEffect } from "react";

interface MarketData {
  sentiment: "bullish" | "bearish" | "neutral";
  price: number;
  ma25: number;
  diff: number;
  diffPct: number;
}

export default function MarketSentiment() {
  const [data, setData] = useState<MarketData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch("/api/market-sentiment");
        const json = await res.json();
        if (json.sentiment) setData(json);
      } catch {
        // skip
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-white dark:bg-slate-800 px-3 py-2 shadow dark:shadow-slate-900/50">
        <div className="h-4 w-4 animate-pulse rounded-full bg-gray-200 dark:bg-slate-700" />
        <span className="text-xs text-gray-400 dark:text-slate-500">地合い判定中...</span>
      </div>
    );
  }

  if (!data) return null;

  const config = {
    bullish: {
      bg: "bg-green-50 dark:bg-green-900/20",
      border: "border-green-200 dark:border-green-800",
      dot: "bg-green-500",
      text: "text-green-700 dark:text-green-400",
      label: "強気",
      icon: "▲",
    },
    bearish: {
      bg: "bg-red-50 dark:bg-red-900/20",
      border: "border-red-200 dark:border-red-800",
      dot: "bg-red-500",
      text: "text-red-700 dark:text-red-400",
      label: "弱気",
      icon: "▼",
    },
    neutral: {
      bg: "bg-yellow-50 dark:bg-yellow-900/20",
      border: "border-yellow-200 dark:border-yellow-800",
      dot: "bg-yellow-500",
      text: "text-yellow-700 dark:text-yellow-400",
      label: "中立",
      icon: "◆",
    },
  }[data.sentiment];

  return (
    <div
      className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${config.bg} ${config.border}`}
    >
      <div className="flex items-center gap-1.5">
        <span className={`inline-block h-2.5 w-2.5 rounded-full ${config.dot}`} />
        <span className={`text-sm font-bold ${config.text}`}>
          {config.icon} 地合い: {config.label}
        </span>
      </div>
      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-slate-400">
        <span>
          日経平均 {data.price.toLocaleString()}
        </span>
        <span className="text-gray-300 dark:text-slate-600">|</span>
        <span>
          25日MA {data.ma25.toLocaleString()}
        </span>
        <span className={config.text}>
          ({data.diffPct >= 0 ? "+" : ""}{data.diffPct}%)
        </span>
      </div>
    </div>
  );
}

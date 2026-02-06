"use client";

import { useState, useEffect } from "react";

interface MarketIntelligence {
  summary: string;
  sectorHighlights: string;
  macroFactors: string;
  risks: string;
  opportunities: string;
  rawText: string;
}

interface MarketData {
  sentiment: "bullish" | "bearish" | "neutral";
  price: number;
  ma25: number;
  diff: number;
  diffPct: number;
  intelligence?: MarketIntelligence | null;
}

export default function MarketSentiment() {
  const [data, setData] = useState<MarketData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

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

  const intel = data.intelligence;

  return (
    <div className={`rounded-lg border ${config.bg} ${config.border}`}>
      {/* ヘッダー行 */}
      <div
        className="flex cursor-pointer items-center gap-3 px-3 py-2"
        onClick={() => intel && setExpanded(!expanded)}
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
        {intel && (
          <svg
            className={`ml-auto h-4 w-4 text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        )}
      </div>

      {/* 展開可能な市況詳細 */}
      {expanded && intel && (
        <div className="border-t border-gray-200 dark:border-slate-700 px-3 py-3 space-y-3">
          {intel.summary && (
            <IntelSection title="市場概況" content={intel.summary} />
          )}
          {intel.sectorHighlights && (
            <IntelSection title="注目セクター" content={intel.sectorHighlights} />
          )}
          {intel.macroFactors && (
            <IntelSection title="マクロ要因" content={intel.macroFactors} />
          )}
          {intel.risks && (
            <IntelSection title="リスク要因" content={intel.risks} color="red" />
          )}
          {intel.opportunities && (
            <IntelSection title="投資機会" content={intel.opportunities} color="green" />
          )}
        </div>
      )}
    </div>
  );
}

function IntelSection({
  title,
  content,
  color,
}: {
  title: string;
  content: string;
  color?: "red" | "green";
}) {
  const titleClass = color === "red"
    ? "text-red-600 dark:text-red-400"
    : color === "green"
      ? "text-green-600 dark:text-green-400"
      : "text-gray-700 dark:text-slate-300";

  return (
    <div>
      <h5 className={`mb-1 text-xs font-semibold ${titleClass}`}>{title}</h5>
      <p className="whitespace-pre-wrap text-xs text-gray-600 dark:text-slate-400">{content}</p>
    </div>
  );
}

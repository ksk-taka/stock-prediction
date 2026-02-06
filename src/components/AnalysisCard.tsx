"use client";

import { useState } from "react";
import type { LLMAnalysis } from "@/types";
import { formatDateTimeJa } from "@/lib/utils/date";

interface AnalysisCardProps {
  analysis: LLMAnalysis | null;
  loading?: boolean;
}

function outlookIcon(outlook: "bullish" | "neutral" | "bearish") {
  switch (outlook) {
    case "bullish":
      return (
        <span className="flex items-center gap-1 text-green-600">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
          </svg>
          強気
        </span>
      );
    case "bearish":
      return (
        <span className="flex items-center gap-1 text-red-600">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 13.5L12 21m0 0l-7.5-7.5M12 21V3" />
          </svg>
          弱気
        </span>
      );
    default:
      return (
        <span className="flex items-center gap-1 text-gray-500 dark:text-slate-400">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14" />
          </svg>
          中立
        </span>
      );
  }
}

function confidenceBadge(confidence: "high" | "medium" | "low") {
  const styles = {
    high: "bg-green-100 text-green-700",
    medium: "bg-yellow-100 text-yellow-700",
    low: "bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-slate-400",
  };
  const labels = { high: "高", medium: "中", low: "低" };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[confidence]}`}>
      確信度: {labels[confidence]}
    </span>
  );
}

export default function AnalysisCard({ analysis, loading }: AnalysisCardProps) {
  const [tab, setTab] = useState<"risks" | "opportunities">("opportunities");

  if (loading) {
    return (
      <div className="rounded-lg bg-white dark:bg-slate-800 p-4 shadow dark:shadow-slate-900/50">
        <h3 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">AI分析</h3>
        <div className="animate-pulse space-y-3">
          <div className="h-4 w-1/3 rounded bg-gray-200 dark:bg-slate-700" />
          <div className="h-16 rounded bg-gray-100 dark:bg-slate-700" />
          <div className="h-4 w-1/2 rounded bg-gray-200 dark:bg-slate-700" />
        </div>
      </div>
    );
  }

  if (!analysis) {
    return (
      <div className="rounded-lg bg-white dark:bg-slate-800 p-4 shadow dark:shadow-slate-900/50">
        <h3 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">AI分析</h3>
        <p className="text-gray-400 dark:text-slate-500">
          分析データがありません。「分析を実行」ボタンを押してください。
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-white dark:bg-slate-800 p-4 shadow dark:shadow-slate-900/50">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">AI分析</h3>
        <div className="flex items-center gap-2">
          {confidenceBadge(analysis.confidence)}
          {outlookIcon(analysis.outlook)}
        </div>
      </div>

      <p className="mb-4 text-sm text-gray-700 dark:text-slate-300">{analysis.summary}</p>

      {analysis.keyPoints.length > 0 && (
        <div className="mb-4">
          <h4 className="mb-2 text-sm font-semibold text-gray-600 dark:text-slate-300">
            重要ポイント
          </h4>
          <ul className="space-y-1">
            {analysis.keyPoints.map((point, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-700 dark:text-slate-300">
                <span className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-blue-500" />
                {point}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mb-3 flex gap-2 border-b border-gray-200 dark:border-slate-600">
        <button
          onClick={() => setTab("opportunities")}
          className={`px-3 py-2 text-sm ${
            tab === "opportunities"
              ? "border-b-2 border-green-500 font-medium text-green-600"
              : "text-gray-500 dark:text-slate-400"
          }`}
        >
          好材料
        </button>
        <button
          onClick={() => setTab("risks")}
          className={`px-3 py-2 text-sm ${
            tab === "risks"
              ? "border-b-2 border-red-500 font-medium text-red-600"
              : "text-gray-500 dark:text-slate-400"
          }`}
        >
          リスク
        </button>
      </div>

      <ul className="space-y-1">
        {(tab === "opportunities" ? analysis.opportunities : analysis.risks).map(
          (item, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-gray-700 dark:text-slate-300">
              <span
                className={`mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full ${
                  tab === "opportunities" ? "bg-green-500" : "bg-red-500"
                }`}
              />
              {item}
            </li>
          )
        )}
        {(tab === "opportunities"
          ? analysis.opportunities
          : analysis.risks
        ).length === 0 && (
          <li className="text-sm text-gray-400 dark:text-slate-500">データなし</li>
        )}
      </ul>

      {analysis.priceTarget && (
        <div className="mt-4 flex gap-4 rounded bg-gray-50 dark:bg-slate-900 p-3">
          <div>
            <span className="text-xs text-gray-500 dark:text-slate-400">短期目標</span>
            <p className="text-sm font-semibold text-gray-900 dark:text-white">
              {analysis.priceTarget.short.toLocaleString()}
            </p>
          </div>
          <div>
            <span className="text-xs text-gray-500 dark:text-slate-400">中期目標</span>
            <p className="text-sm font-semibold text-gray-900 dark:text-white">
              {analysis.priceTarget.medium.toLocaleString()}
            </p>
          </div>
        </div>
      )}

      <p className="mt-3 text-right text-xs text-gray-400 dark:text-slate-500">
        分析日時: {formatDateTimeJa(analysis.analyzedAt)}
      </p>
    </div>
  );
}

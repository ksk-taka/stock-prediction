"use client";

import { useState } from "react";
import type { NewsItem } from "@/types";

type SubTab = "news" | "sns" | "analyst";

interface NewsPanelProps {
  news: NewsItem[];
  snsOverview?: string;
  analystRating?: string;
  loading?: boolean;
  onRefresh?: () => void;
}

function sentimentBadge(sentiment?: "positive" | "negative" | "neutral") {
  if (!sentiment) return null;
  const styles = {
    positive: "bg-green-100 text-green-700",
    negative: "bg-red-100 text-red-700",
    neutral: "bg-gray-100 text-gray-600",
  };
  const labels = {
    positive: "好材料",
    negative: "悪材料",
    neutral: "中立",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[sentiment]}`}>
      {labels[sentiment]}
    </span>
  );
}

export default function NewsPanel({
  news,
  snsOverview,
  analystRating,
  loading,
  onRefresh,
}: NewsPanelProps) {
  const [subTab, setSubTab] = useState<SubTab>("news");

  if (loading) {
    return (
      <div className="rounded-lg bg-white dark:bg-slate-800 p-4 shadow dark:shadow-slate-900/50">
        <h3 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">ニュース・情報</h3>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse">
              <div className="h-4 w-3/4 rounded bg-gray-200 dark:bg-slate-700" />
              <div className="mt-2 h-3 w-1/2 rounded bg-gray-100 dark:bg-slate-700" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const subTabs: { value: SubTab; label: string }[] = [
    { value: "news", label: "ニュース" },
    { value: "sns", label: "SNS評判" },
    { value: "analyst", label: "アナリスト評価" },
  ];

  return (
    <div className="rounded-lg bg-white dark:bg-slate-800 p-4 shadow dark:shadow-slate-900/50">
      {/* ヘッダー + 更新ボタン */}
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">ニュース・情報</h3>
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
            </svg>
            更新
          </button>
        )}
      </div>

      {/* サブタブ */}
      <div className="mb-3 flex gap-1 border-b border-gray-200 dark:border-slate-700">
        {subTabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setSubTab(tab.value)}
            className={`whitespace-nowrap px-3 py-1.5 text-sm font-medium ${
              subTab === tab.value
                ? "border-b-2 border-blue-500 text-blue-600"
                : "text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ニュースタブ */}
      {subTab === "news" && (
        <>
          {news.length === 0 ? (
            <p className="text-gray-400 dark:text-slate-500">ニュースデータがありません</p>
          ) : (
            <ul className="space-y-3">
              {news.map((item, i) => (
                <li key={i} className="border-b border-gray-200 dark:border-slate-600 pb-3 last:border-0">
                  <div className="flex items-start gap-2">
                    <div className="flex-1">
                      {item.url ? (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-medium text-gray-900 dark:text-white hover:text-blue-600"
                        >
                          {item.title}
                        </a>
                      ) : (
                        <span className="text-sm font-medium text-gray-900 dark:text-white">
                          {item.title}
                        </span>
                      )}
                      {item.summary && (
                        <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">{item.summary}</p>
                      )}
                      <div className="mt-1 flex items-center gap-2">
                        <span className="text-xs text-gray-400 dark:text-slate-500">{item.source}</span>
                        <span className="text-xs text-gray-400 dark:text-slate-500">
                          {item.publishedAt}
                        </span>
                        {sentimentBadge(item.sentiment)}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* SNS評判タブ */}
      {subTab === "sns" && (
        <div className="prose prose-sm dark:prose-invert max-w-none">
          {snsOverview ? (
            <p className="whitespace-pre-wrap text-sm text-gray-700 dark:text-slate-300">{snsOverview}</p>
          ) : (
            <p className="text-gray-400 dark:text-slate-500">SNS評判データがありません</p>
          )}
        </div>
      )}

      {/* アナリスト評価タブ */}
      {subTab === "analyst" && (
        <div className="prose prose-sm dark:prose-invert max-w-none">
          {analystRating ? (
            <p className="whitespace-pre-wrap text-sm text-gray-700 dark:text-slate-300">{analystRating}</p>
          ) : (
            <p className="text-gray-400 dark:text-slate-500">アナリスト評価データがありません</p>
          )}
        </div>
      )}
    </div>
  );
}

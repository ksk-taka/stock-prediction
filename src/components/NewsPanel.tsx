"use client";

import type { NewsItem } from "@/types";

interface NewsPanelProps {
  news: NewsItem[];
  loading?: boolean;
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

export default function NewsPanel({ news, loading }: NewsPanelProps) {
  if (loading) {
    return (
      <div className="rounded-lg bg-white p-4 shadow">
        <h3 className="mb-4 text-lg font-semibold text-gray-900">ニュース</h3>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse">
              <div className="h-4 w-3/4 rounded bg-gray-200" />
              <div className="mt-2 h-3 w-1/2 rounded bg-gray-100" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-white p-4 shadow">
      <h3 className="mb-4 text-lg font-semibold text-gray-900">ニュース</h3>
      {news.length === 0 ? (
        <p className="text-gray-400">ニュースデータがありません</p>
      ) : (
        <ul className="space-y-3">
          {news.map((item, i) => (
            <li key={i} className="border-b border-gray-100 pb-3 last:border-0">
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  {item.url ? (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium text-gray-900 hover:text-blue-600"
                    >
                      {item.title}
                    </a>
                  ) : (
                    <span className="text-sm font-medium text-gray-900">
                      {item.title}
                    </span>
                  )}
                  {item.summary && (
                    <p className="mt-1 text-xs text-gray-500">{item.summary}</p>
                  )}
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-xs text-gray-400">{item.source}</span>
                    <span className="text-xs text-gray-400">
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
    </div>
  );
}

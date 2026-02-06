"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import PriceChart, { PERIODS } from "@/components/PriceChart";
import SentimentGauge from "@/components/SentimentGauge";
import SentimentChart from "@/components/SentimentChart";
import NewsPanel from "@/components/NewsPanel";
import AnalysisCard from "@/components/AnalysisCard";
import { formatChange } from "@/lib/utils/format";
import type { PriceData, NewsItem, SentimentData, LLMAnalysis } from "@/types";
import type { Period } from "@/lib/utils/date";

type Tab = "chart" | "news" | "sentiment" | "analysis";

export default function StockDetailPage() {
  const params = useParams();
  const symbol = decodeURIComponent(params.symbol as string);

  // 複数期間サポート
  const [activePeriods, setActivePeriods] = useState<Period[]>(["daily"]);
  const [pricesMap, setPricesMap] = useState<Partial<Record<Period, PriceData[]>>>({});
  const [loadingMap, setLoadingMap] = useState<Partial<Record<Period, boolean>>>({});

  const [quote, setQuote] = useState<{
    name: string;
    price: number;
    change: number;
    changePercent: number;
    volume: number;
  } | null>(null);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [sentiment, setSentiment] = useState<SentimentData | null>(null);
  const [analysis, setAnalysis] = useState<LLMAnalysis | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("chart");
  const [loadingNews, setLoadingNews] = useState(true);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);

  // 特定期間の株価データ取得
  const fetchPricesForPeriod = useCallback(
    async (period: Period) => {
      setLoadingMap((prev) => ({ ...prev, [period]: true }));
      try {
        const res = await fetch(
          `/api/price?symbol=${encodeURIComponent(symbol)}&period=${period}`
        );
        const data = await res.json();
        setPricesMap((prev) => ({ ...prev, [period]: data.prices ?? [] }));
        if (data.quote && !quote) {
          setQuote({
            name: data.quote.name,
            price: data.quote.price,
            change: data.quote.change,
            changePercent: data.quote.changePercent,
            volume: data.quote.volume,
          });
        }
      } catch {
        console.error(`Failed to fetch prices for ${period}`);
      } finally {
        setLoadingMap((prev) => ({ ...prev, [period]: false }));
      }
    },
    [symbol, quote]
  );

  // activePeriods が変わったら、まだ取得していない期間のデータをfetch
  useEffect(() => {
    for (const p of activePeriods) {
      if (pricesMap[p] === undefined && !loadingMap[p]) {
        fetchPricesForPeriod(p);
      }
    }
  }, [activePeriods, fetchPricesForPeriod, pricesMap, loadingMap]);

  // ニュース取得
  const fetchNews = useCallback(async () => {
    setLoadingNews(true);
    try {
      const res = await fetch(
        `/api/news?symbol=${encodeURIComponent(symbol)}&name=${encodeURIComponent(quote?.name ?? symbol)}`
      );
      const data = await res.json();
      setNews(data.news ?? []);
    } catch {
      console.error("Failed to fetch news");
    } finally {
      setLoadingNews(false);
    }
  }, [symbol, quote?.name]);

  // LLM分析実行
  const runAnalysis = async () => {
    setLoadingAnalysis(true);
    try {
      const res = await fetch(
        `/api/analyze?symbol=${encodeURIComponent(symbol)}&name=${encodeURIComponent(quote?.name ?? symbol)}`
      );
      const data = await res.json();
      if (data.analysis) setAnalysis(data.analysis);
      if (data.sentiment) setSentiment(data.sentiment);
    } catch {
      console.error("Failed to run analysis");
    } finally {
      setLoadingAnalysis(false);
    }
  };

  useEffect(() => {
    if (quote) {
      fetchNews();
    }
  }, [quote, fetchNews]);

  // 期間トグル
  const togglePeriod = (period: Period) => {
    setActivePeriods((prev) => {
      if (prev.includes(period)) {
        // 最低1つは残す
        if (prev.length <= 1) return prev;
        return prev.filter((p) => p !== period);
      }
      return [...prev, period];
    });
  };

  // 単一チャートの期間変更（PriceChart の onPeriodChange 経由）
  const handleSinglePeriodChange = (newPeriod: Period) => {
    setActivePeriods([newPeriod]);
  };

  const isMulti = activePeriods.length > 1;
  const isPositive = (quote?.changePercent ?? 0) >= 0;

  const tabs: { value: Tab; label: string }[] = [
    { value: "chart", label: "チャート詳細" },
    { value: "news", label: "ニュース" },
    { value: "sentiment", label: "センチメント推移" },
    { value: "analysis", label: "AI分析詳細" },
  ];

  return (
    <div>
      {/* 上部: 銘柄情報 */}
      <div className="mb-6 flex flex-wrap items-end gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {quote?.name ?? symbol}
          </h1>
          <p className="text-sm text-gray-500">{symbol}</p>
        </div>
        {quote && (
          <div className="flex items-end gap-3">
            <span className="text-3xl font-bold text-gray-900">
              {quote.price.toLocaleString()}
            </span>
            <span
              className={`text-lg font-medium ${
                isPositive ? "text-green-600" : "text-red-600"
              }`}
            >
              {isPositive ? "+" : ""}
              {quote.change.toLocaleString()} ({formatChange(quote.changePercent)})
            </span>
          </div>
        )}
        <div className="ml-auto">
          <button
            onClick={runAnalysis}
            disabled={loadingAnalysis}
            className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50"
          >
            {loadingAnalysis ? "分析中..." : "AI分析を実行"}
          </button>
        </div>
      </div>

      {/* 期間マルチセレクタ */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-gray-600">期間:</span>
        <div className="flex flex-wrap gap-1">
          {PERIODS.map((p) => {
            const isActive = activePeriods.includes(p.value);
            return (
              <button
                key={p.value}
                onClick={() => togglePeriod(p.value)}
                className={`rounded px-3 py-1 text-sm transition ${
                  isActive
                    ? "bg-blue-500 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        <span className="text-xs text-gray-400">
          (複数選択で並べて比較)
        </span>
      </div>

      {/* チャートエリア */}
      <div className="mb-6">
        {isMulti ? (
          /* 複数期間: グリッド表示 */
          <div className="grid gap-4 grid-cols-1 xl:grid-cols-2">
            {activePeriods.map((p) => (
              <div key={p}>
                {loadingMap[p] ? (
                  <div className="flex h-60 items-center justify-center rounded-lg bg-white shadow">
                    <div className="text-gray-400">読み込み中...</div>
                  </div>
                ) : (
                  <PriceChart
                    data={pricesMap[p] ?? []}
                    period={p}
                    onPeriodChange={handleSinglePeriodChange}
                    compact
                    onRemove={() =>
                      setActivePeriods((prev) =>
                        prev.length > 1 ? prev.filter((x) => x !== p) : prev
                      )
                    }
                    chartHeight={260}
                  />
                )}
              </div>
            ))}
          </div>
        ) : (
          /* 単一期間: フル幅表示 */
          loadingMap[activePeriods[0]] ? (
            <div className="flex h-80 items-center justify-center rounded-lg bg-white shadow">
              <div className="text-gray-400">読み込み中...</div>
            </div>
          ) : (
            <PriceChart
              data={pricesMap[activePeriods[0]] ?? []}
              period={activePeriods[0]}
              onPeriodChange={handleSinglePeriodChange}
            />
          )
        )}
      </div>

      {/* センチメント・AI分析エリア */}
      <div className="mb-6 grid grid-cols-1 gap-6 md:grid-cols-2">
        <SentimentGauge sentiment={sentiment} />
        <AnalysisCard analysis={analysis} loading={loadingAnalysis} />
      </div>

      {/* タブ切り替え */}
      <div className="mb-4 flex gap-1 border-b border-gray-200">
        {tabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            className={`px-4 py-2 text-sm font-medium ${
              activeTab === tab.value
                ? "border-b-2 border-blue-500 text-blue-600"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* タブコンテンツ */}
      <div>
        {activeTab === "chart" && (
          <div className="rounded-lg bg-white p-4 shadow">
            <h3 className="mb-4 text-lg font-semibold text-gray-900">
              詳細チャート
            </h3>
            {(() => {
              const mainPrices = pricesMap[activePeriods[0]] ?? [];
              return mainPrices.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-gray-500">
                        <th className="px-2 py-2">日付</th>
                        <th className="px-2 py-2 text-right">始値</th>
                        <th className="px-2 py-2 text-right">高値</th>
                        <th className="px-2 py-2 text-right">安値</th>
                        <th className="px-2 py-2 text-right">終値</th>
                        <th className="px-2 py-2 text-right">出来高</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mainPrices
                        .slice()
                        .reverse()
                        .slice(0, 20)
                        .map((p) => (
                          <tr key={p.date} className="border-b border-gray-50">
                            <td className="px-2 py-1.5 text-gray-700">
                              {p.date}
                            </td>
                            <td className="px-2 py-1.5 text-right">
                              {p.open.toLocaleString()}
                            </td>
                            <td className="px-2 py-1.5 text-right text-red-500">
                              {p.high.toLocaleString()}
                            </td>
                            <td className="px-2 py-1.5 text-right text-blue-500">
                              {p.low.toLocaleString()}
                            </td>
                            <td className="px-2 py-1.5 text-right font-medium">
                              {p.close.toLocaleString()}
                            </td>
                            <td className="px-2 py-1.5 text-right text-gray-500">
                              {p.volume.toLocaleString()}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-gray-400">データなし</p>
              );
            })()}
          </div>
        )}
        {activeTab === "news" && (
          <NewsPanel news={news} loading={loadingNews} />
        )}
        {activeTab === "sentiment" && <SentimentChart data={[]} />}
        {activeTab === "analysis" && (
          <AnalysisCard analysis={analysis} loading={loadingAnalysis} />
        )}
      </div>
    </div>
  );
}

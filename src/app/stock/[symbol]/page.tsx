"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import PriceChart, { PERIODS } from "@/components/PriceChart";
import SentimentGauge from "@/components/SentimentGauge";
import FundamentalHistoryChart from "@/components/FundamentalHistoryChart";
import NewsPanel from "@/components/NewsPanel";
import AnalysisCard from "@/components/AnalysisCard";
import BacktestPanel from "@/components/BacktestPanel";
import FundamentalPanel from "@/components/FundamentalPanel";
import MarketSentiment from "@/components/MarketSentiment";
import PerEpsChart from "@/components/PerEpsChart";
import { formatChange, formatMarketCap } from "@/lib/utils/format";
import { isMarketOpen } from "@/lib/utils/date";
import GroupAssignPopup from "@/components/GroupAssignPopup";
import type { PriceData, NewsItem, SentimentData, LLMAnalysis, FundamentalResearchData, FundamentalAnalysis, SignalValidation, WatchlistGroup } from "@/types";
import type { Period } from "@/lib/utils/date";

type Tab = "chart" | "news" | "sentiment" | "analysis" | "fundamental" | "backtest";

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
  const [loadingNews, setLoadingNews] = useState(false);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [eps, setEps] = useState<number | null>(null);
  const [per, setPer] = useState<number | null>(null);
  const [pbr, setPbr] = useState<number | null>(null);
  const [roe, setRoe] = useState<number | null>(null);
  const [simpleNcRatio, setSimpleNcRatio] = useState<number | null>(null);
  const [marketCap, setMarketCap] = useState<number | null>(null);
  const [sharpe1y, setSharpe1y] = useState<number | null>(null);
  const [sharpe3y, setSharpe3y] = useState<number | null>(null);
  const [tenYearHigh, setTenYearHigh] = useState<number | null>(null);
  const [activeSignals, setActiveSignals] = useState<{
    daily: { strategyId: string; strategyName: string; buyDate: string; buyPrice: number; currentPrice: number; pnlPct: number; takeProfitPrice?: number; takeProfitLabel?: string; stopLossPrice?: number; stopLossLabel?: string }[];
    weekly: { strategyId: string; strategyName: string; buyDate: string; buyPrice: number; currentPrice: number; pnlPct: number; takeProfitPrice?: number; takeProfitLabel?: string; stopLossPrice?: number; stopLossLabel?: string }[];
  } | null>(null);

  // ファンダメンタルズ分析
  const [fundamentalResearch, setFundamentalResearch] = useState<FundamentalResearchData | null>(null);
  const [fundamentalAnalysis, setFundamentalAnalysis] = useState<FundamentalAnalysis | null>(null);
  const [loadingFundamental, setLoadingFundamental] = useState(false);
  const [fundamentalStep, setFundamentalStep] = useState<"idle" | "research" | "research_done" | "analysis" | "complete" | "error">("idle");
  // シグナル検証
  const [signalValidations, setSignalValidations] = useState<Record<string, SignalValidation>>({});
  const [validatingSignal, setValidatingSignal] = useState<string | null>(null);
  // ニュースの追加データ
  const [snsOverview, setSnsOverview] = useState("");
  const [analystRating, setAnalystRating] = useState("");
  // グループ管理
  const [stockGroups, setStockGroups] = useState<WatchlistGroup[]>([]);
  const [allGroups, setAllGroups] = useState<WatchlistGroup[]>([]);
  const [inWatchlist, setInWatchlist] = useState(false);
  const [groupPopup, setGroupPopup] = useState<{ anchor: DOMRect } | null>(null);
  // シグナル期間フィルタ
  const [signalPeriodFilter, setSignalPeriodFilter] = useState<string>("all");

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
  const fetchNews = useCallback(async (forceRefresh = false) => {
    setLoadingNews(true);
    try {
      const res = await fetch(
        `/api/news?symbol=${encodeURIComponent(symbol)}&name=${encodeURIComponent(quote?.name ?? symbol)}${forceRefresh ? "&refresh=true" : ""}`
      );
      const data = await res.json();
      setNews(data.news ?? []);
      setSnsOverview(data.snsOverview ?? "");
      setAnalystRating(data.analystRating ?? "");
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

  // ファンダメンタルズ分析実行（2段階: Perplexity → Ollama）
  const runFundamentalAnalysis = async (refresh = false) => {
    const base = `/api/fundamental?symbol=${encodeURIComponent(symbol)}&name=${encodeURIComponent(quote?.name ?? symbol)}${refresh ? "&refresh=true" : ""}`;
    setLoadingFundamental(true);
    setFundamentalStep("research");

    try {
      // Step 1: Perplexity調査
      const res1 = await fetch(`${base}&step=research`);
      const data1 = await res1.json();
      if (data1.error) throw new Error(data1.error);
      if (data1.research) setFundamentalResearch(data1.research);
      setFundamentalStep("research_done");

      // Step 2: Ollama分析
      setFundamentalStep("analysis");
      const res2 = await fetch(base);
      const data2 = await res2.json();
      if (data2.error) throw new Error(data2.error);
      if (data2.research) setFundamentalResearch(data2.research);
      if (data2.analysis) {
        setFundamentalAnalysis(data2.analysis);
        // ウォッチリストに判定結果を保存
        fetch("/api/watchlist", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            symbol,
            fundamental: {
              judgment: data2.analysis.judgment,
              memo: data2.analysis.summary,
              analyzedAt: data2.analysis.analyzedAt,
            },
          }),
        }).catch(() => {});
      }
      setFundamentalStep("complete");
    } catch (e) {
      console.error("Failed to run fundamental analysis", e);
      setFundamentalStep("error");
    } finally {
      setLoadingFundamental(false);
    }
  };

  // シグナル検証（Go/No Go判定）
  const validateActiveSignal = async (strategyId: string, strategyName: string) => {
    const signalKey = strategyId;
    setValidatingSignal(signalKey);
    try {
      const res = await fetch(
        `/api/fundamental?symbol=${encodeURIComponent(symbol)}&name=${encodeURIComponent(quote?.name ?? symbol)}&signalDesc=${encodeURIComponent(strategyName + "の買いシグナル検出")}&signalStrategy=${encodeURIComponent(strategyName)}&signalStrategyId=${encodeURIComponent(strategyId)}`
      );
      const data = await res.json();
      if (data.validation) {
        setSignalValidations((prev) => ({ ...prev, [signalKey]: data.validation }));
      }
    } catch {
      console.error("Failed to validate signal");
    } finally {
      setValidatingSignal(null);
    }
  };

  // 全シグナル一括検証（直列実行）
  const [validatingAll, setValidatingAll] = useState(false);
  const validateAllSignals = async () => {
    if (!activeSignals) return;
    const allSigs = [
      ...activeSignals.daily.map((s) => ({ ...s, period: "日足" as const })),
      ...activeSignals.weekly.map((s) => ({ ...s, period: "週足" as const })),
    ].filter((s) => !signalValidations[s.strategyId]);
    if (allSigs.length === 0) return;
    setValidatingAll(true);
    for (const s of allSigs) {
      await validateActiveSignal(s.strategyId, s.strategyName);
    }
    setValidatingAll(false);
  };

  // ニュース取得 → AI分析の連鎖実行
  const fetchNewsAndAnalyze = async () => {
    await fetchNews(true);
    runAnalysis();
  };

  // ウォッチリスト状態の取得
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/watchlist");
        if (res.ok) {
          const data = await res.json();
          if (data.groups) setAllGroups(data.groups);
          const stock = data.stocks?.find((s: { symbol: string }) => s.symbol === symbol);
          if (stock) {
            setInWatchlist(true);
            setStockGroups(stock.groups ?? []);
          }
        }
      } catch { /* skip */ }
    })();
  }, [symbol]);

  // グループ編集ポップアップ表示
  const handleEditGroups = (event: React.MouseEvent) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setGroupPopup({ anchor: rect });
  };

  const handleSaveGroups = async (groupIds: number[]) => {
    // ウォッチリスト未登録なら先に追加
    if (!inWatchlist) {
      const market = symbol.endsWith(".T") ? "JP" : "US";
      await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, name: quote?.name ?? symbol, market }),
      });
      setInWatchlist(true);
    }
    // 楽観的更新
    const groupMap = new Map(allGroups.map((g) => [g.id, g]));
    const newGroups = groupIds.map((id) => groupMap.get(id)).filter((g): g is WatchlistGroup => g != null);
    setStockGroups(newGroups);
    try {
      await fetch("/api/watchlist", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, groupIds }),
      });
    } catch { /* skip */ }
  };

  const handleCreateGroup = async (name: string, color: string) => {
    try {
      const res = await fetch("/api/watchlist/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, color }),
      });
      const newGroup: WatchlistGroup = await res.json();
      setAllGroups((prev) => [...prev, newGroup]);
    } catch { /* skip */ }
  };

  // EPS取得（PERバンド用）+ アクティブシグナル取得
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch(`/api/stats?symbol=${encodeURIComponent(symbol)}`);
        const data = await res.json();
        if (data.eps != null) setEps(data.eps);
        if (data.per != null) setPer(data.per);
        if (data.pbr != null) setPbr(data.pbr);
        if (data.roe != null) setRoe(data.roe);
        if (data.simpleNcRatio != null) setSimpleNcRatio(data.simpleNcRatio);
        if (data.marketCap != null) setMarketCap(data.marketCap);
        if (data.sharpe1y != null) setSharpe1y(data.sharpe1y);
        if (data.sharpe3y != null) setSharpe3y(data.sharpe3y);
      } catch {
        // skip
      }
    };
    const fetchSignals = async () => {
      try {
        const res = await fetch(`/api/signals?symbol=${encodeURIComponent(symbol)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.activeSignals) {
            setActiveSignals(data.activeSignals);
            // キャッシュ済みバリデーション結果を読み込み
            try {
              const vRes = await fetch(`/api/fundamental?symbol=${encodeURIComponent(symbol)}&step=validations`);
              if (vRes.ok) {
                const vData = await vRes.json();
                if (vData.validations && Object.keys(vData.validations).length > 0) {
                  setSignalValidations(vData.validations);
                }
              }
            } catch {
              // skip
            }
          }
        }
      } catch {
        // skip
      }
    };
    const fetchPriceHighs = async () => {
      try {
        const res = await fetch(`/api/price-highs?symbol=${encodeURIComponent(symbol)}`);
        const data = await res.json();
        if (data.tenYearHigh != null) setTenYearHigh(data.tenYearHigh);
      } catch {
        // skip
      }
    };
    fetchStats();
    fetchSignals();
    fetchPriceHighs();
  }, [symbol]);

  // 取引時間中の自動更新（30秒間隔）
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    const market = symbol.endsWith(".T") ? "JP" : "US";
    const tick = () => {
      if (!isMarketOpen(market as "JP" | "US")) return;
      // 各アクティブ期間のキャッシュをクリアして再取得
      for (const p of activePeriods) {
        setPricesMap((prev) => {
          const next = { ...prev };
          delete next[p];
          return next;
        });
      }
    };
    refreshRef.current = setInterval(tick, 30_000);
    return () => {
      if (refreshRef.current) clearInterval(refreshRef.current);
    };
  }, [symbol, activePeriods]);

  // 期間ソート順（短い順）
  const periodOrder: Period[] = ["1min", "5min", "15min", "daily", "weekly", "monthly"];
  const sortPeriods = (periods: Period[]) =>
    [...periods].sort((a, b) => periodOrder.indexOf(a) - periodOrder.indexOf(b));

  // 期間トグル（単純クリック=1つ選択、Shift+クリック=複数選択）
  const togglePeriod = (period: Period, shiftKey: boolean) => {
    if (!shiftKey) {
      // 単純クリック: この期間だけ選択
      setActivePeriods([period]);
      return;
    }
    // Shift+クリック: 複数選択トグル
    setActivePeriods((prev) => {
      if (prev.includes(period)) {
        if (prev.length <= 1) return prev;
        return sortPeriods(prev.filter((p) => p !== period));
      }
      return sortPeriods([...prev, period]);
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
    { value: "sentiment", label: "ファンダ判定推移" },
    { value: "analysis", label: "AI分析詳細" },
    { value: "fundamental", label: "ファンダ分析" },
    { value: "backtest", label: "バックテスト" },
  ];

  return (
    <div>
      {/* 上部: 銘柄情報（sticky） */}
      <div className="sticky top-[49px] z-[9] -mx-3 mb-6 flex flex-wrap items-end gap-3 bg-gray-50 px-3 py-2 dark:bg-slate-900 sm:-mx-4 sm:gap-4 sm:px-4">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={handleEditGroups}
            title="グループ設定"
            className="text-2xl transition-colors hover:scale-110"
          >
            {stockGroups.length > 0 ? (
              <span className="text-yellow-400">&#9733;</span>
            ) : (
              <span className="text-gray-300 dark:text-slate-600 hover:text-yellow-300">&#9734;</span>
            )}
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-xl font-bold text-gray-900 dark:text-white sm:text-2xl">
                {quote?.name ?? symbol}
              </h1>
              {stockGroups.length > 0 && (
                <div className="flex gap-1">
                  {stockGroups.slice(0, 3).map((g) => (
                    <span key={g.id} className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium text-gray-600 dark:text-slate-400" style={{ backgroundColor: g.color + "20" }}>
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: g.color }} />
                      {g.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <p className="text-sm text-gray-500 dark:text-slate-400">{symbol}</p>
          </div>
        </div>
        {quote && (
          <div className="flex items-end gap-2 sm:gap-3">
            <span className="text-2xl font-bold text-gray-900 dark:text-white sm:text-3xl">
              {quote.price.toLocaleString()}
            </span>
            <span
              className={`text-base font-medium sm:text-lg ${
                isPositive ? "text-green-600" : "text-red-600"
              }`}
            >
              {isPositive ? "+" : ""}
              {quote.change.toLocaleString()} ({formatChange(quote.changePercent)})
            </span>
          </div>
        )}
        {(marketCap != null || per != null || pbr != null || roe != null || simpleNcRatio != null) && (
          <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-slate-400">
            {marketCap != null && marketCap > 0 && (
              <span>時価総額 <b className="text-gray-700 dark:text-slate-300">{formatMarketCap(marketCap)}</b></span>
            )}
            {per != null && (
              <span>PER <b className="text-gray-700 dark:text-slate-300">{per.toFixed(1)}</b></span>
            )}
            {pbr != null && (
              <span>PBR <b className={pbr < 1 ? "text-blue-600 dark:text-blue-400" : "text-gray-700 dark:text-slate-300"}>{pbr.toFixed(2)}</b></span>
            )}
            {roe != null && (
              <span>ROE <b className={roe >= 10 ? "text-green-600 dark:text-green-400" : "text-gray-700 dark:text-slate-300"}>{roe.toFixed(1)}%</b></span>
            )}
            {simpleNcRatio != null && (
              <span>簡易NC率 <b className={
                simpleNcRatio > 50 ? "text-green-600 dark:text-green-400"
                  : simpleNcRatio < -50 ? "text-red-600 dark:text-red-400"
                  : "text-gray-700 dark:text-slate-300"
              }>{simpleNcRatio > 0 ? "+" : ""}{simpleNcRatio.toFixed(1)}%</b></span>
            )}
            {per != null && simpleNcRatio != null && (
              <span>簡易CNPER <b className="text-gray-700 dark:text-slate-300">{(per * (1 - simpleNcRatio / 100)).toFixed(1)}</b></span>
            )}
            {sharpe1y != null && (
              <span>Sharpe(1Y) <b className={
                sharpe1y > 1 ? "text-green-600 dark:text-green-400"
                  : sharpe1y < 0 ? "text-red-600 dark:text-red-400"
                  : "text-gray-700 dark:text-slate-300"
              }>{sharpe1y > 0 ? "+" : ""}{sharpe1y.toFixed(2)}</b></span>
            )}
            {sharpe3y != null && (
              <span>Sharpe(3Y) <b className={
                sharpe3y > 1 ? "text-green-600 dark:text-green-400"
                  : sharpe3y < 0 ? "text-red-600 dark:text-red-400"
                  : "text-gray-700 dark:text-slate-300"
              }>{sharpe3y > 0 ? "+" : ""}{sharpe3y.toFixed(2)}</b></span>
            )}
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={fetchNewsAndAnalyze}
            disabled={loadingNews || loadingAnalysis}
            className="rounded-lg bg-indigo-500 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-600 disabled:opacity-50 sm:px-4"
          >
            {loadingNews
              ? "ニュース取得中..."
              : loadingAnalysis
                ? "AI分析中..."
                : "ニュース取得"}
          </button>
          <button
            onClick={() => runFundamentalAnalysis()}
            disabled={loadingFundamental}
            className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50 sm:px-4"
          >
            {loadingFundamental
              ? fundamentalStep === "research"
                ? "Perplexity調査中..."
                : fundamentalStep === "analysis"
                  ? "Ollama分析中..."
                  : "処理中..."
              : "ファンダ分析"}
          </button>
        </div>
      </div>

      {/* 地合い判定 */}
      <div className="mb-4">
        <MarketSentiment />
      </div>

      {/* アクティブシグナル（保有中ポジション） */}
      {activeSignals && (activeSignals.daily.length > 0 || activeSignals.weekly.length > 0) && (() => {
        const signalPeriodOptions = [
          { value: "1w", label: "1週間" },
          { value: "1m", label: "1ヶ月" },
          { value: "3m", label: "3ヶ月" },
          { value: "6m", label: "半年" },
        ];
        const filterByPeriod = (buyDate: string) => {
          if (signalPeriodFilter === "all") return true;
          const d = new Date(buyDate);
          const now = new Date();
          const diffMs = now.getTime() - d.getTime();
          const days = diffMs / (1000 * 60 * 60 * 24);
          switch (signalPeriodFilter) {
            case "1w": return days <= 7;
            case "1m": return days <= 31;
            case "3m": return days <= 93;
            case "6m": return days <= 183;
            default: return true;
          }
        };
        const allMerged = [
          ...activeSignals.daily.map((s) => ({ ...s, period: "日足" as const })),
          ...activeSignals.weekly.map((s) => ({ ...s, period: "週足" as const })),
        ];
        const filteredSignals = allMerged.filter((s) => filterByPeriod(s.buyDate));
        return (
        <div className="mb-4 rounded-lg bg-white dark:bg-slate-800 p-4 shadow dark:shadow-slate-900/50">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300">
              保有中シグナル
            </h3>
            <div className="flex gap-0.5">
              {signalPeriodOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setSignalPeriodFilter(signalPeriodFilter === opt.value ? "all" : opt.value)}
                  className={`rounded px-1.5 py-0.5 text-[10px] transition ${
                    signalPeriodFilter === opt.value
                      ? "bg-blue-500 text-white"
                      : "bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-slate-400 hover:bg-gray-200 dark:hover:bg-slate-600"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <span className="text-[10px] text-gray-400 dark:text-slate-500">
              {filteredSignals.length}/{allMerged.length}件
            </span>
            <div className="ml-auto">
            {(() => {
              const unvalidated = allMerged.filter((s) => !signalValidations[s.strategyId]);
              if (unvalidated.length === 0) return null;
              return (
                <button
                  onClick={validateAllSignals}
                  disabled={validatingAll || validatingSignal !== null}
                  className="rounded bg-indigo-50 dark:bg-indigo-900/20 px-2.5 py-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 disabled:opacity-50"
                >
                  {validatingAll
                    ? `検証中 (${allMerged.length - unvalidated.length}/${allMerged.length})...`
                    : `全検証 (${unvalidated.length}件)`}
                </button>
              );
            })()}
            </div>
          </div>
          <div className="space-y-2">
            {filteredSignals.length === 0 ? (
              <p className="text-xs text-gray-400 dark:text-slate-500">該当するシグナルはありません</p>
            ) : filteredSignals.map((s) => {
              const diff = s.currentPrice - s.buyPrice;
              const isProfit = diff >= 0;
              const validation = signalValidations[s.strategyId];
              return (
                <div key={`${s.period}-${s.strategyId}`}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-gray-100 dark:border-slate-700 px-3 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-xs font-bold ${
                      s.strategyId.startsWith("choruko") ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400"
                      : s.strategyId === "tabata_cwh" ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400"
                      : s.strategyId === "rsi_reversal" ? "bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400"
                      : s.strategyId === "ma_cross" ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400"
                      : s.strategyId === "macd_trail" ? "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400"
                      : "bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400"
                    }`}>
                      {s.period}
                    </span>
                    <span className="text-sm font-semibold text-gray-800 dark:text-slate-200">
                      {s.strategyName}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-slate-400">
                      {s.buyDate} エントリー
                    </span>
                    <div className="flex items-center gap-1.5 text-sm">
                      <span className="text-gray-500 dark:text-slate-400">
                        {s.buyPrice.toLocaleString()}
                      </span>
                      <span className="text-gray-400 dark:text-slate-500">→</span>
                      <span className="font-medium text-gray-800 dark:text-slate-200">
                        {s.currentPrice.toLocaleString()}
                      </span>
                    </div>
                    <span className={`text-sm font-bold ${isProfit ? "text-green-600" : "text-red-500"}`}>
                      {isProfit ? "+" : ""}{diff.toLocaleString()}円
                      <span className="ml-1 text-xs font-medium">
                        ({isProfit ? "+" : ""}{s.pnlPct.toFixed(1)}%)
                      </span>
                    </span>
                    {/* 利確/損切レベル */}
                    {(s.takeProfitPrice != null || s.stopLossPrice != null || s.takeProfitLabel || s.stopLossLabel) && (
                      <div className="w-full flex flex-wrap gap-x-4 gap-y-0.5 pl-1 text-[11px]">
                        {(s.takeProfitPrice != null || s.takeProfitLabel) && (
                          <span className="text-green-600 dark:text-green-400">
                            {s.takeProfitPrice != null ? (
                              <>利確: <b>{s.takeProfitPrice.toLocaleString()}円</b>{s.takeProfitLabel && <span className="ml-1 text-[10px] opacity-70">({s.takeProfitLabel})</span>}</>
                            ) : (
                              <>利確: {s.takeProfitLabel}</>
                            )}
                          </span>
                        )}
                        {(s.stopLossPrice != null || s.stopLossLabel) && (
                          <span className="text-red-500 dark:text-red-400">
                            {s.stopLossPrice != null ? (
                              <>損切: <b>{s.stopLossPrice.toLocaleString()}円</b>{s.stopLossLabel && <span className="ml-1 text-[10px] opacity-70">({s.stopLossLabel})</span>}</>
                            ) : (
                              <>売却条件: {s.stopLossLabel}</>
                            )}
                          </span>
                        )}
                      </div>
                    )}
                    {/* シグナル検証ボタン */}
                    <div className="ml-auto">
                      {validation ? (
                        <span className={`rounded px-2 py-0.5 text-xs font-bold ${
                          validation.decision === "entry"
                            ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                            : validation.decision === "avoid"
                              ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"
                              : "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400"
                        }`}>
                          {validation.decision === "entry" ? "Go" : validation.decision === "avoid" ? "No Go" : "様子見"}
                        </span>
                      ) : (
                        <button
                          onClick={() => validateActiveSignal(s.strategyId, s.strategyName)}
                          disabled={validatingSignal === s.strategyId}
                          className="rounded bg-indigo-50 dark:bg-indigo-900/20 px-2 py-0.5 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 disabled:opacity-50"
                        >
                          {validatingSignal === s.strategyId ? "検証中..." : "Go/No Go"}
                        </button>
                      )}
                    </div>
                  </div>
                  {/* 検証結果の詳細 */}
                  {validation && (
                    <div className="ml-8 mt-1 rounded bg-gray-50 dark:bg-slate-700/30 p-2 text-xs">
                      <p className="text-gray-600 dark:text-slate-400">{validation.summary}</p>
                      {validation.catalyst && (
                        <p className="mt-1 text-green-600 dark:text-green-400">
                          <span className="font-semibold">カタリスト:</span> {validation.catalyst}
                        </p>
                      )}
                      {validation.riskFactor && (
                        <p className="mt-1 text-red-500 dark:text-red-400">
                          <span className="font-semibold">リスク:</span> {validation.riskFactor}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        );
      })()}

      {/* 決算資料LLM分析結果 */}
      {signalValidations["earnings_analysis"] && (() => {
        const ea = signalValidations["earnings_analysis"];
        return (
          <div className="mb-4 rounded-lg bg-white dark:bg-slate-800 p-4 shadow dark:shadow-slate-900/50">
            <div className="mb-2 flex items-center gap-2">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300">
                決算資料分析
              </h3>
              <span className={`rounded px-2 py-0.5 text-xs font-bold ${
                ea.decision === "entry"
                  ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                  : ea.decision === "avoid"
                    ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"
                    : "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400"
              }`}>
                {ea.decision === "entry" ? "Go" : ea.decision === "avoid" ? "No Go" : "様子見"}
              </span>
              {ea.validatedAt && (
                <span className="text-[10px] text-gray-400 dark:text-slate-500">
                  {new Date(ea.validatedAt).toLocaleDateString("ja-JP")}
                </span>
              )}
            </div>
            <p className="text-xs text-gray-600 dark:text-slate-400">{ea.summary}</p>
            {ea.signalEvaluation && (
              <p className="mt-1 text-xs text-blue-600 dark:text-blue-400">
                <span className="font-semibold">評価:</span> {ea.signalEvaluation}
              </p>
            )}
            {ea.catalyst && (
              <p className="mt-1 text-xs text-green-600 dark:text-green-400">
                <span className="font-semibold">カタリスト:</span> {ea.catalyst}
              </p>
            )}
            {ea.riskFactor && (
              <p className="mt-1 text-xs text-red-500 dark:text-red-400">
                <span className="font-semibold">リスク:</span> {ea.riskFactor}
              </p>
            )}
          </div>
        );
      })()}

      {/* 期間マルチセレクタ */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-gray-600">期間:</span>
        <div className="flex flex-wrap gap-1">
          {PERIODS.map((p) => {
            const isActive = activePeriods.includes(p.value);
            return (
              <button
                key={p.value}
                onClick={(e) => togglePeriod(p.value, e.shiftKey)}
                className={`rounded px-3 py-1 text-sm transition ${
                  isActive
                    ? "bg-blue-500 text-white"
                    : "bg-gray-100 dark:bg-slate-700 text-gray-600 hover:bg-gray-200 dark:hover:bg-slate-600"
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        <span className="text-xs text-gray-400 dark:text-slate-500">
          (Shift+クリックで複数選択・比較)
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
                  <div className="flex h-60 items-center justify-center rounded-lg bg-white dark:bg-slate-800 shadow dark:shadow-slate-900/50">
                    <div className="text-gray-400 dark:text-slate-500">読み込み中...</div>
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
                    eps={eps ?? undefined}
                    tenYearHigh={tenYearHigh}
                  />
                )}
              </div>
            ))}
          </div>
        ) : (
          /* 単一期間: フル幅表示 */
          loadingMap[activePeriods[0]] ? (
            <div className="flex h-80 items-center justify-center rounded-lg bg-white dark:bg-slate-800 shadow dark:shadow-slate-900/50">
              <div className="text-gray-400 dark:text-slate-500">読み込み中...</div>
            </div>
          ) : (
            <PriceChart
              data={pricesMap[activePeriods[0]] ?? []}
              period={activePeriods[0]}
              onPeriodChange={handleSinglePeriodChange}
              eps={eps ?? undefined}
              tenYearHigh={tenYearHigh}
            />
          )
        )}
      </div>

      {/* PER/EPSチャート */}
      <div className="mb-6">
        <PerEpsChart symbol={symbol} />
      </div>

      {/* センチメント・AI分析エリア */}
      <div className="mb-6 grid grid-cols-1 gap-6 md:grid-cols-2">
        <SentimentGauge sentiment={sentiment} />
        <AnalysisCard analysis={analysis} loading={loadingAnalysis} />
      </div>

      {/* タブ切り替え */}
      <div className="mb-4 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        <div className="flex gap-1 border-b border-gray-200 dark:border-slate-700 min-w-max">
          {tabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setActiveTab(tab.value)}
              className={`whitespace-nowrap px-3 py-2 text-sm font-medium sm:px-4 ${
                activeTab === tab.value
                  ? "border-b-2 border-blue-500 text-blue-600"
                  : "text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* タブコンテンツ */}
      <div>
        {activeTab === "chart" && (
          <div className="rounded-lg bg-white dark:bg-slate-800 p-4 shadow dark:shadow-slate-900/50">
            <h3 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
              詳細チャート
            </h3>
            {(() => {
              const mainPrices = pricesMap[activePeriods[0]] ?? [];
              return mainPrices.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-gray-500 dark:text-slate-400">
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
                          <tr key={p.date} className="border-b border-gray-50 dark:border-slate-700">
                            <td className="px-2 py-1.5 text-gray-700 dark:text-slate-300">
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
                            <td className="px-2 py-1.5 text-right text-gray-500 dark:text-slate-400">
                              {p.volume.toLocaleString()}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-gray-400 dark:text-slate-500">データなし</p>
              );
            })()}
          </div>
        )}
        {activeTab === "news" && (
          <NewsPanel
            news={news}
            snsOverview={snsOverview}
            analystRating={analystRating}
            loading={loadingNews}
            onRefresh={() => fetchNews(true)}
          />
        )}
        {activeTab === "sentiment" && <FundamentalHistoryChart symbol={symbol} />}
        {activeTab === "analysis" && (
          <AnalysisCard analysis={analysis} loading={loadingAnalysis} />
        )}
        {activeTab === "fundamental" && (
          <FundamentalPanel
            analysis={fundamentalAnalysis}
            research={fundamentalResearch}
            loading={loadingFundamental}
            step={fundamentalStep}
            onRunAnalysis={() => runFundamentalAnalysis()}
            onRefresh={() => runFundamentalAnalysis(true)}
          />
        )}
        {activeTab === "backtest" && (
          <BacktestPanel
            symbol={symbol}
            pricesMap={pricesMap}
            fetchPricesForPeriod={fetchPricesForPeriod}
            loadingMap={loadingMap}
          />
        )}
      </div>

      {groupPopup && (
        <GroupAssignPopup
          symbol={symbol}
          currentGroupIds={stockGroups.map((g) => g.id)}
          allGroups={allGroups}
          anchor={groupPopup.anchor}
          onToggleGroup={(groupId, checked) => {
            const currentIds = stockGroups.map((g) => g.id);
            const newIds = checked
              ? [...currentIds, groupId]
              : currentIds.filter((id) => id !== groupId);
            handleSaveGroups(newIds);
          }}
          onCreateGroup={handleCreateGroup}
          onClose={() => setGroupPopup(null)}
        />
      )}
    </div>
  );
}

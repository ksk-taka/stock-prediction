"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import StockCard from "./StockCard";
import AddStockModal from "./AddStockModal";
import { isJPMarketOpen, isUSMarketOpen } from "@/lib/utils/date";
import type { Stock, SignalValidation } from "@/types";

interface StockQuote {
  symbol: string;
  price: number;
  changePercent: number;
}

interface StockStats {
  per: number | null;
  pbr: number | null;
  roe: number | null;
  eps: number | null;
}

export interface ActiveSignalInfo {
  strategyId: string;
  strategyName: string;
  buyDate: string;
  buyPrice: number;
  currentPrice: number;
  pnlPct: number;
  takeProfitPrice?: number;
  takeProfitLabel?: string;
  stopLossPrice?: number;
  stopLossLabel?: string;
}

export interface SignalSummary {
  activeSignals?: {
    daily: ActiveSignalInfo[];
    weekly: ActiveSignalInfo[];
  };
  validations?: Record<string, SignalValidation>;
}

interface FilterPreset {
  name: string;
  sectors: string[];
  strategies: string[];
  segments: string[];
  signalFilterMode?: "or" | "and";
  signalAgeDays: number | null;
  decision: string | null;
  judgment: string | null;
}

const PRESETS_KEY = "watchlist-filter-presets";
const PAGE_SIZE = 50;

function loadPresets(): FilterPreset[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function savePresets(presets: FilterPreset[]) {
  localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
}

export default function WatchList() {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [quotes, setQuotes] = useState<Record<string, StockQuote>>({});
  const [stats, setStats] = useState<Record<string, StockStats>>({});
  const [signals, setSignals] = useState<Record<string, SignalSummary>>({});
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  // フィルター
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSectors, setSelectedSectors] = useState<Set<string>>(new Set());
  const [selectedStrategies, setSelectedStrategies] = useState<Set<string>>(new Set());
  const [selectedSegments, setSelectedSegments] = useState<Set<string>>(new Set());
  const [signalFilterMode, setSignalFilterMode] = useState<"or" | "and">("or");
  const [signalAgeDays, setSignalAgeDays] = useState<number | null>(null);
  const [selectedDecision, setSelectedDecision] = useState<string | null>(null);
  const [selectedJudgment, setSelectedJudgment] = useState<string | null>(null);
  const [filterPresets, setFilterPresets] = useState<FilterPreset[]>([]);
  const [activePresetName, setActivePresetName] = useState<string | null>(null);

  // 表示件数制御
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);

  // 可視カード追跡（自動更新用）
  const visibleSymbolsRef = useRef<Set<string>>(new Set());
  // データ取得済みシンボル追跡（price/stats/validation）
  const fetchedSymbolsRef = useRef<Set<string>>(new Set());
  // シグナルデータ取得済み追跡（インデックスから読み込み or API取得）
  const signalsFetchedRef = useRef<Set<string>>(new Set());
  // スキャン済み件数
  const [signalScannedCount, setSignalScannedCount] = useState(0);

  useEffect(() => {
    setFilterPresets(loadPresets());
  }, []);

  // フィルタ変更時に表示件数をリセット
  useEffect(() => {
    setDisplayCount(PAGE_SIZE);
  }, [searchQuery, selectedSectors, selectedStrategies, selectedSegments, signalFilterMode, signalAgeDays, selectedDecision, selectedJudgment]);

  const fetchWatchlist = useCallback(async () => {
    try {
      const res = await fetch("/api/watchlist");
      const data = await res.json();
      setStocks(data.stocks ?? []);
    } catch {
      console.error("Failed to fetch watchlist");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWatchlist();
  }, [fetchWatchlist]);

  // キャッシュ済みシグナル＋バリデーションインデックスを一括読み込み（起動時）
  useEffect(() => {
    if (stocks.length === 0) return;
    const loadIndices = async () => {
      try {
        const [sigRes, valRes] = await Promise.all([
          fetch("/api/signals/index"),
          fetch("/api/fundamental/validations-index"),
        ]);

        const merged: Record<string, SignalSummary> = {};

        // シグナルインデックス
        if (sigRes.ok) {
          const sigData = await sigRes.json();
          if (sigData.signals) {
            for (const [symbol, value] of Object.entries(sigData.signals)) {
              merged[symbol] = value as SignalSummary;
              signalsFetchedRef.current.add(symbol);
            }
            setSignalScannedCount(sigData.scannedCount ?? 0);
          }
        }

        // バリデーションインデックス
        if (valRes.ok) {
          const valData = await valRes.json();
          if (valData.validations) {
            for (const [symbol, vals] of Object.entries(valData.validations)) {
              if (!merged[symbol]) merged[symbol] = {};
              merged[symbol] = {
                ...merged[symbol],
                validations: vals as Record<string, SignalValidation>,
              };
            }
          }
        }

        setSignals((prev) => ({ ...prev, ...merged }));
      } catch {
        // ignore
      }
    };
    loadIndices();
  }, [stocks]);

  // 個別銘柄データ取得（遅延ロード用）
  const fetchDataForSymbol = useCallback(async (symbol: string) => {
    if (fetchedSymbolsRef.current.has(symbol)) return;
    fetchedSymbolsRef.current.add(symbol);

    // シグナルがインデックスから読み込み済みなら、price/stats/validationのみ取得
    const needsSignals = !signalsFetchedRef.current.has(symbol);

    const fetches: Promise<Response>[] = [
      fetch(`/api/price?symbol=${encodeURIComponent(symbol)}&period=daily`),
      fetch(`/api/stats?symbol=${encodeURIComponent(symbol)}`),
    ];
    if (needsSignals) {
      fetches.push(fetch(`/api/signals?symbol=${encodeURIComponent(symbol)}`));
    }
    fetches.push(fetch(`/api/fundamental?symbol=${encodeURIComponent(symbol)}&step=validations`));

    const results = await Promise.allSettled(fetches);
    let idx = 0;

    // price
    const priceRes = results[idx++];
    if (priceRes.status === "fulfilled" && priceRes.value.ok) {
      const data = await priceRes.value.json();
      if (data.quote) {
        setQuotes((prev) => ({
          ...prev,
          [symbol]: {
            symbol,
            price: data.quote.price,
            changePercent: data.quote.changePercent,
          },
        }));
      }
    }

    // stats
    const statsRes = results[idx++];
    if (statsRes.status === "fulfilled" && statsRes.value.ok) {
      const data = await statsRes.value.json();
      setStats((prev) => ({
        ...prev,
        [symbol]: {
          per: data.per ?? null,
          pbr: data.pbr ?? null,
          roe: data.roe ?? null,
          eps: data.eps ?? null,
        },
      }));
    }

    // signals (only if not from index)
    if (needsSignals) {
      const sigRes = results[idx++];
      if (sigRes.status === "fulfilled" && sigRes.value.ok) {
        const data = await sigRes.value.json();
        setSignals((prev) => ({
          ...prev,
          [symbol]: {
            ...prev[symbol],
            activeSignals: data.activeSignals,
          },
        }));
        signalsFetchedRef.current.add(symbol);
      }
    }

    // validations
    const valRes = results[idx++];
    if (valRes.status === "fulfilled" && valRes.value.ok) {
      const data = await valRes.value.json();
      if (data.validations && Object.keys(data.validations).length > 0) {
        setSignals((prev) => ({
          ...prev,
          [symbol]: {
            ...prev[symbol],
            validations: data.validations,
          },
        }));
      }
    }
  }, []);

  // カード可視状態管理
  const handleCardVisible = useCallback(
    (symbol: string, isVisible: boolean) => {
      if (isVisible) {
        visibleSymbolsRef.current.add(symbol);
        fetchDataForSymbol(symbol);
      } else {
        visibleSymbolsRef.current.delete(symbol);
      }
    },
    [fetchDataForSymbol]
  );

  // 取引時間中の自動更新（30秒間隔、表示中カードのみ）
  useEffect(() => {
    if (stocks.length === 0) return;
    const tick = async () => {
      const anyMarketOpen = isJPMarketOpen() || isUSMarketOpen();
      if (!anyMarketOpen || visibleSymbolsRef.current.size === 0) return;

      const symbolsToUpdate = Array.from(visibleSymbolsRef.current);
      await Promise.allSettled(
        symbolsToUpdate.map(async (symbol) => {
          try {
            const res = await fetch(
              `/api/price?symbol=${encodeURIComponent(symbol)}&period=daily`
            );
            const data = await res.json();
            if (data.quote) {
              setQuotes((prev) => ({
                ...prev,
                [symbol]: {
                  symbol,
                  price: data.quote.price,
                  changePercent: data.quote.changePercent,
                },
              }));
            }
          } catch {
            // skip
          }
        })
      );
    };
    const interval = setInterval(tick, 30_000);
    return () => clearInterval(interval);
  }, [stocks]);

  const handleAddStock = (stock: Stock) => {
    setStocks((prev) => [...prev, stock]);
  };

  const handleDeleteStock = async (symbol: string) => {
    try {
      const res = await fetch("/api/watchlist", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol }),
      });
      if (res.ok) {
        setStocks((prev) => prev.filter((s) => s.symbol !== symbol));
      }
    } catch {
      console.error("Failed to delete stock");
    }
  };

  // セクター一覧を抽出
  const allSectors = Array.from(
    new Set(stocks.flatMap((s) => s.sectors ?? []))
  ).sort();

  // 市場区分一覧
  const allSegments: ("プライム" | "スタンダード" | "グロース")[] = ["プライム", "スタンダード", "グロース"];

  // アクティブシグナルの戦略一覧を抽出
  const allActiveStrategies = Array.from(
    new Map(
      Object.values(signals)
        .flatMap((s) => [
          ...(s.activeSignals?.daily ?? []),
          ...(s.activeSignals?.weekly ?? []),
        ])
        .map((a) => [a.strategyId, a.strategyName] as const)
    )
  );

  // フィルタ適用
  const filteredStocks = stocks.filter((stock) => {
    // テキスト検索
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const symbolMatch = stock.symbol.toLowerCase().includes(q);
      const nameMatch = stock.name.toLowerCase().includes(q);
      if (!symbolMatch && !nameMatch) return false;
    }
    // 市場区分フィルタ
    if (selectedSegments.size > 0) {
      if (!stock.marketSegment || !selectedSegments.has(stock.marketSegment)) return false;
    }
    // セクターフィルタ
    if (selectedSectors.size > 0) {
      const match = stock.sectors?.some((s) => selectedSectors.has(s));
      if (!match) return false;
    }
    // 保有中シグナル（戦略 × 検知日）フィルタ
    if (selectedStrategies.size > 0 || signalAgeDays !== null) {
      const sig = signals[stock.symbol];
      const allSignals = [
        ...(sig?.activeSignals?.daily ?? []),
        ...(sig?.activeSignals?.weekly ?? []),
      ];
      if (allSignals.length === 0) return false;
      const cutoffStr = signalAgeDays !== null
        ? (() => { const d = new Date(); d.setDate(d.getDate() - signalAgeDays); return d.toISOString().slice(0, 10); })()
        : null;

      if (signalFilterMode === "and" && selectedStrategies.size > 0) {
        // AND: 選択した全戦略がアクティブシグナルに存在する
        const activeStratIds = new Set(
          allSignals
            .filter((a) => !cutoffStr || a.buyDate >= cutoffStr)
            .map((a) => a.strategyId)
        );
        for (const stratId of selectedStrategies) {
          if (!activeStratIds.has(stratId)) return false;
        }
      } else {
        // OR: いずれかの戦略がマッチ
        const match = allSignals.some((a) => {
          if (selectedStrategies.size > 0 && !selectedStrategies.has(a.strategyId)) return false;
          if (cutoffStr && a.buyDate < cutoffStr) return false;
          return true;
        });
        if (!match) return false;
      }
    }
    // Go/No Go フィルタ
    if (selectedDecision !== null) {
      const sig = signals[stock.symbol];
      const validations = sig?.validations;
      if (!validations) return false;
      const activeCompositeKeys = new Set([
        ...(sig?.activeSignals?.daily ?? []).map((a) => `${a.strategyId}_daily_${a.buyDate}`),
        ...(sig?.activeSignals?.weekly ?? []).map((a) => `${a.strategyId}_weekly_${a.buyDate}`),
      ]);
      const activeSimpleIds = new Set([
        ...(sig?.activeSignals?.daily ?? []).map((a) => a.strategyId),
        ...(sig?.activeSignals?.weekly ?? []).map((a) => a.strategyId),
      ]);
      const match = Object.entries(validations).some(
        ([stratId, v]) =>
          (activeCompositeKeys.has(stratId) || activeSimpleIds.has(stratId)) &&
          v.decision === selectedDecision
      );
      if (!match) return false;
    }
    // ファンダ判定フィルタ
    if (selectedJudgment !== null) {
      if (stock.fundamental?.judgment !== selectedJudgment) return false;
    }
    return true;
  });

  // 表示する銘柄（Load More制御）
  const displayedStocks = filteredStocks.slice(0, displayCount);
  const hasMore = displayCount < filteredStocks.length;

  const toggleSector = (sector: string) => {
    setSelectedSectors((prev) => {
      const next = new Set(prev);
      if (next.has(sector)) next.delete(sector);
      else next.add(sector);
      return next;
    });
  };

  const toggleStrategy = (strategyId: string) => {
    setSelectedStrategies((prev) => {
      const next = new Set(prev);
      if (next.has(strategyId)) next.delete(strategyId);
      else next.add(strategyId);
      return next;
    });
  };

  const toggleSegment = (segment: string) => {
    setSelectedSegments((prev) => {
      const next = new Set(prev);
      if (next.has(segment)) next.delete(segment);
      else next.add(segment);
      return next;
    });
  };

  const hasAnyFilter = searchQuery !== "" || selectedSectors.size > 0 || selectedStrategies.size > 0 || selectedSegments.size > 0 || signalAgeDays !== null || selectedDecision !== null || selectedJudgment !== null || signalFilterMode !== "or";

  const clearAllFilters = () => {
    setSearchQuery("");
    setSelectedSectors(new Set());
    setSelectedStrategies(new Set());
    setSelectedSegments(new Set());
    setSignalFilterMode("or");
    setSignalAgeDays(null);
    setSelectedDecision(null);
    setSelectedJudgment(null);
    setActivePresetName(null);
  };

  const handleSavePreset = () => {
    const name = prompt("フィルタ名を入力してください");
    if (!name?.trim()) return;
    const preset: FilterPreset = {
      name: name.trim(),
      sectors: Array.from(selectedSectors),
      strategies: Array.from(selectedStrategies),
      segments: Array.from(selectedSegments),
      signalFilterMode: signalFilterMode !== "or" ? signalFilterMode : undefined,
      signalAgeDays,
      decision: selectedDecision,
      judgment: selectedJudgment,
    };
    const next = [...filterPresets.filter((p) => p.name !== preset.name), preset];
    setFilterPresets(next);
    savePresets(next);
    setActivePresetName(preset.name);
  };

  const handleApplyPreset = (preset: FilterPreset) => {
    setSelectedSectors(new Set(preset.sectors));
    setSelectedStrategies(new Set(preset.strategies));
    setSelectedSegments(new Set(preset.segments ?? []));
    setSignalFilterMode(preset.signalFilterMode ?? "or");
    setSignalAgeDays(preset.signalAgeDays);
    setSelectedDecision(preset.decision);
    setSelectedJudgment(preset.judgment);
    setActivePresetName(preset.name);
  };

  const handleDeletePreset = (name: string) => {
    const next = filterPresets.filter((p) => p.name !== name);
    setFilterPresets(next);
    savePresets(next);
    if (activePresetName === name) setActivePresetName(null);
  };

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="animate-pulse rounded-lg bg-white dark:bg-slate-800 p-4 shadow">
            <div className="h-5 w-1/2 rounded bg-gray-200 dark:bg-slate-700" />
            <div className="mt-2 h-4 w-1/3 rounded bg-gray-100 dark:bg-slate-700" />
            <div className="mt-4 h-8 w-1/2 rounded bg-gray-200 dark:bg-slate-700" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white">ウォッチリスト</h2>
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-1 rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          銘柄追加
        </button>
      </div>

      {/* 検索 + フィルター */}
      {stocks.length > 0 && (
        <div className="mb-4 space-y-3">
          {/* テキスト検索 */}
          <div className="relative">
            <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-slate-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="銘柄コードまたは会社名で検索（例: 7203, トヨタ）"
              className="w-full rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 py-2 pl-10 pr-4 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-slate-500 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:text-slate-500 dark:hover:text-slate-300"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* 市場区分フィルタ */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-gray-500 dark:text-slate-400">市場区分:</span>
            {allSegments.map((segment) => (
              <button
                key={segment}
                onClick={() => toggleSegment(segment)}
                className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                  selectedSegments.has(segment)
                    ? "border-cyan-400 bg-cyan-50 text-cyan-700 dark:border-cyan-500 dark:bg-cyan-900/30 dark:text-cyan-300"
                    : "border-gray-300 bg-white text-gray-500 hover:border-gray-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500"
                }`}
              >
                {segment}
              </button>
            ))}
          </div>

          {/* 保存済みプリセット */}
          {filterPresets.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-gray-500 dark:text-slate-400">プリセット:</span>
              {filterPresets.map((preset) => (
                <span key={preset.name} className="inline-flex items-center gap-0.5">
                  <button
                    onClick={() => handleApplyPreset(preset)}
                    className={`rounded-l-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                      activePresetName === preset.name
                        ? "border-purple-400 bg-purple-50 text-purple-700 dark:border-purple-500 dark:bg-purple-900/30 dark:text-purple-300"
                        : "border-gray-300 bg-white text-gray-500 hover:border-gray-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500"
                    }`}
                  >
                    {preset.name}
                  </button>
                  <button
                    onClick={() => handleDeletePreset(preset.name)}
                    className={`rounded-r-full border border-l-0 px-1.5 py-0.5 text-xs transition-colors ${
                      activePresetName === preset.name
                        ? "border-purple-400 bg-purple-50 text-purple-400 hover:text-purple-600 dark:border-purple-500 dark:bg-purple-900/30 dark:text-purple-400 dark:hover:text-purple-200"
                        : "border-gray-300 bg-white text-gray-300 hover:text-gray-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-500 dark:hover:text-slate-300"
                    }`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* 保有中シグナル（戦略別）フィルタ */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-gray-500 dark:text-slate-400">
              保有中
              {signalScannedCount > 0 && (
                <span className="ml-1 font-normal text-gray-400 dark:text-slate-500">
                  ({signalScannedCount}/{stocks.length}スキャン済)
                </span>
              )}
              :
            </span>
            {allActiveStrategies.length > 0 ? (
              <>
                {allActiveStrategies.map(([id, name]) => (
                  <button
                    key={id}
                    onClick={() => toggleStrategy(id)}
                    className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                      selectedStrategies.has(id)
                        ? "border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-500 dark:bg-amber-900/30 dark:text-amber-300"
                        : "border-gray-300 bg-white text-gray-500 hover:border-gray-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500"
                    }`}
                  >
                    {name}
                  </button>
                ))}
                {selectedStrategies.size >= 2 && (
                  <button
                    onClick={() => setSignalFilterMode((m) => (m === "or" ? "and" : "or"))}
                    className={`rounded-full border px-2 py-0.5 text-xs font-bold transition-colors ${
                      signalFilterMode === "and"
                        ? "border-orange-400 bg-orange-50 text-orange-700 dark:border-orange-500 dark:bg-orange-900/30 dark:text-orange-300"
                        : "border-gray-300 bg-white text-gray-500 hover:border-gray-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500"
                    }`}
                  >
                    {signalFilterMode === "and" ? "AND" : "OR"}
                  </button>
                )}
              </>
            ) : (
              <span className="text-xs text-gray-400 dark:text-slate-500">なし</span>
            )}
            {hasAnyFilter && (
              <>
                <button
                  onClick={clearAllFilters}
                  className="ml-1 text-xs text-gray-400 hover:text-gray-600 dark:text-slate-500 dark:hover:text-slate-300"
                >
                  フィルタ解除
                </button>
                <button
                  onClick={handleSavePreset}
                  className="text-xs text-purple-500 hover:text-purple-700 dark:text-purple-400 dark:hover:text-purple-300"
                >
                  保存
                </button>
                <span className="text-xs text-gray-400 dark:text-slate-500">
                  {filteredStocks.length}/{stocks.length}件
                </span>
              </>
            )}
          </div>

          {/* シグナル検知日フィルタ */}
          {allActiveStrategies.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-gray-500 dark:text-slate-400">検知日:</span>
              {([
                { label: "1週間以内", days: 7 },
                { label: "1ヶ月以内", days: 30 },
                { label: "3ヶ月以内", days: 90 },
              ] as const).map(({ label, days }) => (
                <button
                  key={days}
                  onClick={() => setSignalAgeDays(signalAgeDays === days ? null : days)}
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                    signalAgeDays === days
                      ? "border-indigo-400 bg-indigo-50 text-indigo-700 dark:border-indigo-500 dark:bg-indigo-900/30 dark:text-indigo-300"
                      : "border-gray-300 bg-white text-gray-500 hover:border-gray-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* Go/No Go フィルタ */}
          {Object.values(signals).some((s) => s.validations && Object.keys(s.validations).length > 0) && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-gray-500 dark:text-slate-400">判定:</span>
              {([
                { label: "Go", value: "entry", activeClass: "border-green-400 bg-green-50 text-green-700 dark:border-green-500 dark:bg-green-900/30 dark:text-green-300" },
                { label: "様子見", value: "wait", activeClass: "border-yellow-400 bg-yellow-50 text-yellow-700 dark:border-yellow-500 dark:bg-yellow-900/30 dark:text-yellow-300" },
                { label: "No Go", value: "avoid", activeClass: "border-red-400 bg-red-50 text-red-700 dark:border-red-500 dark:bg-red-900/30 dark:text-red-300" },
              ] as const).map(({ label, value, activeClass }) => (
                <button
                  key={value}
                  onClick={() => setSelectedDecision(selectedDecision === value ? null : value)}
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                    selectedDecision === value
                      ? activeClass
                      : "border-gray-300 bg-white text-gray-500 hover:border-gray-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* ファンダ判定フィルタ */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-gray-500 dark:text-slate-400">ファンダ:</span>
            {([
              { label: "▲強気", value: "bullish", activeClass: "border-green-400 bg-green-50 text-green-700 dark:border-green-500 dark:bg-green-900/30 dark:text-green-300" },
              { label: "◆中立", value: "neutral", activeClass: "border-yellow-400 bg-yellow-50 text-yellow-700 dark:border-yellow-500 dark:bg-yellow-900/30 dark:text-yellow-300" },
              { label: "▼弱気", value: "bearish", activeClass: "border-red-400 bg-red-50 text-red-700 dark:border-red-500 dark:bg-red-900/30 dark:text-red-300" },
            ] as const).map(({ label, value, activeClass }) => (
              <button
                key={value}
                onClick={() => setSelectedJudgment(selectedJudgment === value ? null : value)}
                className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                  selectedJudgment === value
                    ? activeClass
                    : "border-gray-300 bg-white text-gray-500 hover:border-gray-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* セクターフィルタ */}
          <div className="flex flex-wrap gap-1.5">
            {allSectors.map((sector) => (
              <button
                key={sector}
                onClick={() => toggleSector(sector)}
                className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                  selectedSectors.has(sector)
                    ? "border-blue-400 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-900/30 dark:text-blue-300"
                    : "border-gray-200 bg-white text-gray-500 hover:border-gray-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-600"
                }`}
              >
                {sector}
              </button>
            ))}
          </div>
        </div>
      )}

      {stocks.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-gray-300 dark:border-slate-600 p-12 text-center">
          <p className="text-gray-500 dark:text-slate-400">
            ウォッチリストに銘柄がありません
          </p>
          <button
            onClick={() => setModalOpen(true)}
            className="mt-4 text-blue-500 hover:text-blue-600"
          >
            銘柄を追加する
          </button>
        </div>
      ) : (
        <>
          {/* 件数表示 */}
          {!hasAnyFilter && (
            <p className="mb-2 text-xs text-gray-400 dark:text-slate-500">
              {Math.min(displayCount, filteredStocks.length)}/{filteredStocks.length}件表示中
            </p>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {displayedStocks.length === 0 ? (
              <div className="col-span-full rounded-lg border border-dashed border-gray-300 dark:border-slate-600 p-8 text-center">
                <p className="text-sm text-gray-500 dark:text-slate-400">
                  該当する銘柄がありません
                </p>
              </div>
            ) : (
              displayedStocks.map((stock) => {
                const q = quotes[stock.symbol];
                const s = stats[stock.symbol];
                const sig = signals[stock.symbol];
                return (
                  <StockCard
                    key={stock.symbol}
                    stock={stock}
                    price={q?.price}
                    change={q?.changePercent}
                    per={s?.per ?? undefined}
                    pbr={s?.pbr ?? undefined}
                    roe={s?.roe ?? undefined}
                    signals={sig}
                    fundamentalJudgment={stock.fundamental?.judgment}
                    fundamentalMemo={stock.fundamental?.memo}
                    onDelete={handleDeleteStock}
                    onVisible={handleCardVisible}
                  />
                );
              })
            )}
          </div>

          {/* もっと見る */}
          {hasMore && (
            <div className="mt-6 text-center">
              <button
                onClick={() => setDisplayCount((prev) => prev + PAGE_SIZE)}
                className="rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-6 py-2.5 text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
              >
                もっと見る（残り {filteredStocks.length - displayCount} 件）
              </button>
            </div>
          )}
        </>
      )}

      <AddStockModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onAdd={handleAddStock}
      />
    </div>
  );
}

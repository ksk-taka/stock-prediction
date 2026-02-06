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

export default function WatchList() {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [quotes, setQuotes] = useState<Record<string, StockQuote>>({});
  const [stats, setStats] = useState<Record<string, StockStats>>({});
  const [signals, setSignals] = useState<Record<string, SignalSummary>>({});
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedSectors, setSelectedSectors] = useState<Set<string>>(new Set());
  const [selectedStrategies, setSelectedStrategies] = useState<Set<string>>(new Set());
  const [signalAgeDays, setSignalAgeDays] = useState<number | null>(null); // null=全期間
  const [selectedDecision, setSelectedDecision] = useState<string | null>(null); // "entry" | "wait" | "avoid" | null

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

  // 株価を取得（インクリメンタル更新）
  const fetchQuotes = useCallback(async () => {
    if (stocks.length === 0) return;
    await Promise.allSettled(
      stocks.map(async (stock) => {
        try {
          const res = await fetch(
            `/api/price?symbol=${encodeURIComponent(stock.symbol)}&period=daily`
          );
          const data = await res.json();
          if (data.quote) {
            setQuotes((prev) => ({
              ...prev,
              [stock.symbol]: {
                symbol: stock.symbol,
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
  }, [stocks]);

  useEffect(() => {
    if (stocks.length === 0) return;

    fetchQuotes();

    // stats は初回のみ取得（インクリメンタル更新）
    const fetchStats = async () => {
      await Promise.allSettled(
        stocks.map(async (stock) => {
          try {
            const res = await fetch(
              `/api/stats?symbol=${encodeURIComponent(stock.symbol)}`
            );
            const data = await res.json();
            setStats((prev) => ({
              ...prev,
              [stock.symbol]: {
                per: data.per ?? null,
                pbr: data.pbr ?? null,
                roe: data.roe ?? null,
                eps: data.eps ?? null,
              },
            }));
          } catch {
            // skip
          }
        })
      );
    };
    fetchStats();

    // アクティブシグナル検出 + Go/No Goキャッシュ取得（初回のみ、インクリメンタル更新）
    const fetchSignals = async () => {
      await Promise.allSettled(
        stocks.map(async (stock) => {
          try {
            const [sigRes, valRes] = await Promise.allSettled([
              fetch(`/api/signals?symbol=${encodeURIComponent(stock.symbol)}`),
              fetch(`/api/fundamental?symbol=${encodeURIComponent(stock.symbol)}&step=validations`),
            ]);
            const summary: SignalSummary = {};
            if (sigRes.status === "fulfilled" && sigRes.value.ok) {
              const data = await sigRes.value.json();
              summary.activeSignals = data.activeSignals;
            }
            if (valRes.status === "fulfilled" && valRes.value.ok) {
              const data = await valRes.value.json();
              if (data.validations && Object.keys(data.validations).length > 0) {
                summary.validations = data.validations;
              }
            }
            setSignals((prev) => ({ ...prev, [stock.symbol]: summary }));
          } catch {
            // skip
          }
        })
      );
    };
    fetchSignals();
  }, [stocks, fetchQuotes]);

  // 取引時間中の自動更新（30秒間隔）
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (stocks.length === 0) return;
    const tick = () => {
      const anyMarketOpen = isJPMarketOpen() || isUSMarketOpen();
      if (anyMarketOpen) fetchQuotes();
    };
    intervalRef.current = setInterval(tick, 30_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [stocks, fetchQuotes]);

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
    // セクターフィルタ
    if (selectedSectors.size > 0) {
      const match = stock.sectors?.some((s) => selectedSectors.has(s));
      if (!match) return false;
    }
    // 保有中シグナル（戦略 × 検知日 AND条件）フィルタ
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
      const match = allSignals.some((a) => {
        if (selectedStrategies.size > 0 && !selectedStrategies.has(a.strategyId)) return false;
        if (cutoffStr && a.buyDate < cutoffStr) return false;
        return true;
      });
      if (!match) return false;
    }
    // Go/No Go フィルタ
    if (selectedDecision !== null) {
      const sig = signals[stock.symbol];
      const validations = sig?.validations;
      if (!validations) return false;
      const match = Object.values(validations).some((v) => v.decision === selectedDecision);
      if (!match) return false;
    }
    return true;
  });

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

  const hasAnyFilter = selectedSectors.size > 0 || selectedStrategies.size > 0 || signalAgeDays !== null || selectedDecision !== null;

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

      {/* フィルター */}
      {stocks.length > 0 && (
        <div className="mb-4 space-y-3">
          {/* 保有中シグナル（戦略別）フィルタ */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-gray-500 dark:text-slate-400">保有中:</span>
            {allActiveStrategies.length > 0 ? (
              allActiveStrategies.map(([id, name]) => (
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
              ))
            ) : (
              <span className="text-xs text-gray-400 dark:text-slate-500">なし</span>
            )}
            {hasAnyFilter && (
              <>
                <button
                  onClick={() => {
                    setSelectedSectors(new Set());
                    setSelectedStrategies(new Set());
                    setSignalAgeDays(null);
                    setSelectedDecision(null);
                  }}
                  className="ml-1 text-xs text-gray-400 hover:text-gray-600 dark:text-slate-500 dark:hover:text-slate-300"
                >
                  フィルタ解除
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredStocks.length === 0 ? (
            <div className="col-span-full rounded-lg border border-dashed border-gray-300 dark:border-slate-600 p-8 text-center">
              <p className="text-sm text-gray-500 dark:text-slate-400">
                該当する銘柄がありません
              </p>
            </div>
          ) : (
            filteredStocks.map((stock) => {
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
                />
              );
            })
          )}
        </div>
      )}

      <AddStockModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onAdd={handleAddStock}
      />
    </div>
  );
}

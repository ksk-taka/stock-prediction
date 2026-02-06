"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import StockCard from "./StockCard";
import AddStockModal from "./AddStockModal";
import { isJPMarketOpen, isUSMarketOpen } from "@/lib/utils/date";
import type { Stock } from "@/types";

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

export interface SignalSummary {
  daily: {
    choruko: { count: number; latest: string | null };
    cwh: { count: number; latest: string | null };
  };
  weekly: {
    choruko: { count: number; latest: string | null };
    cwh: { count: number; latest: string | null };
  };
}

export default function WatchList() {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [quotes, setQuotes] = useState<Record<string, StockQuote>>({});
  const [stats, setStats] = useState<Record<string, StockStats>>({});
  const [signals, setSignals] = useState<Record<string, SignalSummary>>({});
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);

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

  // 株価を取得
  const fetchQuotes = useCallback(async () => {
    if (stocks.length === 0) return;
    const results: Record<string, StockQuote> = {};
    await Promise.allSettled(
      stocks.map(async (stock) => {
        try {
          const res = await fetch(
            `/api/price?symbol=${encodeURIComponent(stock.symbol)}&period=daily`
          );
          const data = await res.json();
          if (data.quote) {
            results[stock.symbol] = {
              symbol: stock.symbol,
              price: data.quote.price,
              changePercent: data.quote.changePercent,
            };
          }
        } catch {
          // skip
        }
      })
    );
    setQuotes(results);
  }, [stocks]);

  useEffect(() => {
    if (stocks.length === 0) return;

    fetchQuotes();

    // stats は初回のみ取得
    const fetchStats = async () => {
      const results: Record<string, StockStats> = {};
      await Promise.allSettled(
        stocks.map(async (stock) => {
          try {
            const res = await fetch(
              `/api/stats?symbol=${encodeURIComponent(stock.symbol)}`
            );
            const data = await res.json();
            results[stock.symbol] = {
              per: data.per ?? null,
              pbr: data.pbr ?? null,
              roe: data.roe ?? null,
              eps: data.eps ?? null,
            };
          } catch {
            // skip
          }
        })
      );
      setStats(results);
    };
    fetchStats();

    // シグナル検出（初回のみ）
    const fetchSignals = async () => {
      const results: Record<string, SignalSummary> = {};
      await Promise.allSettled(
        stocks.map(async (stock) => {
          try {
            const res = await fetch(
              `/api/signals?symbol=${encodeURIComponent(stock.symbol)}`
            );
            if (res.ok) {
              results[stock.symbol] = await res.json();
            }
          } catch {
            // skip
          }
        })
      );
      setSignals(results);
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
          {stocks.map((stock) => {
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
                onDelete={handleDeleteStock}
              />
            );
          })}
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

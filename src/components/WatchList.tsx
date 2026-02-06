"use client";

import { useState, useEffect, useCallback } from "react";
import StockCard from "./StockCard";
import AddStockModal from "./AddStockModal";
import type { Stock } from "@/types";

interface StockQuote {
  symbol: string;
  price: number;
  changePercent: number;
}

export default function WatchList() {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [quotes, setQuotes] = useState<Record<string, StockQuote>>({});
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
  useEffect(() => {
    if (stocks.length === 0) return;

    const fetchQuotes = async () => {
      const results: Record<string, StockQuote> = {};
      await Promise.allSettled(
        stocks.map(async (stock) => {
          try {
            const res = await fetch(
              `/api/price?symbol=${encodeURIComponent(stock.symbol)}&period=1d`
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
    };

    fetchQuotes();
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

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="animate-pulse rounded-lg bg-white p-4 shadow">
            <div className="h-5 w-1/2 rounded bg-gray-200" />
            <div className="mt-2 h-4 w-1/3 rounded bg-gray-100" />
            <div className="mt-4 h-8 w-1/2 rounded bg-gray-200" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">ウォッチリスト</h2>
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
        <div className="rounded-lg border-2 border-dashed border-gray-300 p-12 text-center">
          <p className="text-gray-500">
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
            return (
              <StockCard
                key={stock.symbol}
                stock={stock}
                price={q?.price}
                change={q?.changePercent}
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

"use client";

import { useState, useEffect, useRef } from "react";
import type { Stock } from "@/types";

interface SearchResult {
  symbol: string;
  name: string;
  exchange: string;
}

interface AddStockModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (stock: Stock) => void;
}

export default function AddStockModal({
  isOpen,
  onClose,
  onAdd,
}: AddStockModalProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      setQuery("");
      setResults([]);
    }
  }, [isOpen]);

  // デバウンス検索
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    if (query.length < 1) {
      setResults([]);
      return;
    }

    timerRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        setResults(data.results ?? []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 400);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query]);

  const handleSelect = async (result: SearchResult) => {
    setAdding(true);
    try {
      const market: "JP" | "US" = result.symbol.endsWith(".T") ? "JP" : "US";
      const stock: Stock = {
        symbol: result.symbol,
        name: String(result.name),
        market,
      };

      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(stock),
      });

      if (res.ok) {
        onAdd(stock);
        setQuery("");
        setResults([]);
        onClose();
      }
    } finally {
      setAdding(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">銘柄を追加</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="銘柄コードまたは会社名を入力（例: 7203, AAPL, トヨタ）"
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div className="mt-3 max-h-72 overflow-y-auto">
          {searching && (
            <div className="py-4 text-center text-sm text-gray-400">
              検索中...
            </div>
          )}

          {!searching && query.length > 0 && results.length === 0 && (
            <div className="py-4 text-center text-sm text-gray-400">
              該当する銘柄が見つかりません
            </div>
          )}

          {results.map((r) => (
            <button
              key={r.symbol}
              onClick={() => handleSelect(r)}
              disabled={adding}
              className="flex w-full items-center justify-between rounded px-3 py-2 text-left hover:bg-blue-50 disabled:opacity-50"
            >
              <div>
                <span className="text-sm font-medium text-gray-900">
                  {String(r.name)}
                </span>
                <span className="ml-2 text-xs text-gray-500">{r.symbol}</span>
              </div>
              <span className="text-xs text-gray-400">{String(r.exchange)}</span>
            </button>
          ))}
        </div>

        <div className="mt-4 text-right">
          <button
            onClick={onClose}
            className="rounded bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}

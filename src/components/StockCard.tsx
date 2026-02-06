"use client";

import Link from "next/link";
import { formatChange } from "@/lib/utils/format";
import type { Stock } from "@/types";

interface StockCardProps {
  stock: Stock;
  price?: number;
  change?: number;
  sentimentScore?: number;
  onDelete?: (symbol: string) => void;
}

export default function StockCard({
  stock,
  price,
  change,
  sentimentScore,
  onDelete,
}: StockCardProps) {
  const isPositive = (change ?? 0) >= 0;

  return (
    <div className="relative rounded-lg bg-white p-4 shadow transition hover:shadow-md">
      {onDelete && (
        <button
          onClick={(e) => {
            e.preventDefault();
            if (confirm(`${stock.name} をウォッチリストから削除しますか？`)) {
              onDelete(stock.symbol);
            }
          }}
          className="absolute right-2 top-2 rounded p-1 text-gray-300 hover:bg-red-50 hover:text-red-500"
          title="削除"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
      <Link
        href={`/stock/${encodeURIComponent(stock.symbol)}`}
        className="block"
      >
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold text-gray-900">{stock.name}</h3>
          <p className="text-sm text-gray-500">{stock.symbol}</p>
        </div>
        {stock.sector && (
          <span className="mr-5 rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-600">
            {stock.sector}
          </span>
        )}
      </div>
      <div className="mt-3 flex items-end justify-between">
        <div>
          {price !== undefined ? (
            <p className="text-2xl font-bold text-gray-900">
              {price.toLocaleString()}
            </p>
          ) : (
            <p className="text-2xl font-bold text-gray-300">---</p>
          )}
          {change !== undefined && (
            <p
              className={`text-sm font-medium ${
                isPositive ? "text-green-600" : "text-red-600"
              }`}
            >
              {formatChange(change)}
            </p>
          )}
        </div>
        {sentimentScore !== undefined && (
          <div className="text-right">
            <span className="text-xs text-gray-400">センチメント</span>
            <p
              className={`text-lg font-bold ${
                sentimentScore > 0.2
                  ? "text-green-600"
                  : sentimentScore < -0.2
                    ? "text-red-600"
                    : "text-gray-500"
              }`}
            >
              {sentimentScore > 0 ? "+" : ""}
              {sentimentScore.toFixed(2)}
            </p>
          </div>
        )}
      </div>
      </Link>
    </div>
  );
}

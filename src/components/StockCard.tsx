"use client";

import Link from "next/link";
import { formatChange } from "@/lib/utils/format";
import type { Stock } from "@/types";
import type { SignalSummary } from "./WatchList";

interface StockCardProps {
  stock: Stock;
  price?: number;
  change?: number;
  sentimentScore?: number;
  per?: number;
  pbr?: number;
  roe?: number;
  signals?: SignalSummary;
  onDelete?: (symbol: string) => void;
}

export default function StockCard({
  stock,
  price,
  change,
  sentimentScore,
  per,
  pbr,
  roe,
  signals,
  onDelete,
}: StockCardProps) {
  const isPositive = (change ?? 0) >= 0;

  // シグナルバッジ生成
  const signalBadges: { label: string; color: string; date: string }[] = [];
  if (signals) {
    if (signals.daily.choruko.count > 0) {
      signalBadges.push({
        label: `日足▲${signals.daily.choruko.count}`,
        color: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400",
        date: signals.daily.choruko.latest ?? "",
      });
    }
    if (signals.weekly.choruko.count > 0) {
      signalBadges.push({
        label: `週足▲${signals.weekly.choruko.count}`,
        color: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400",
        date: signals.weekly.choruko.latest ?? "",
      });
    }
    if (signals.daily.cwh.count > 0) {
      signalBadges.push({
        label: `日足◆${signals.daily.cwh.count}`,
        color: "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400",
        date: signals.daily.cwh.latest ?? "",
      });
    }
    if (signals.weekly.cwh.count > 0) {
      signalBadges.push({
        label: `週足◆${signals.weekly.cwh.count}`,
        color: "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400",
        date: signals.weekly.cwh.latest ?? "",
      });
    }
  }

  return (
    <div className="relative rounded-lg bg-white dark:bg-slate-800 p-4 shadow dark:shadow-slate-900/50 transition hover:shadow-md">
      {onDelete && (
        <button
          onClick={(e) => {
            e.preventDefault();
            if (confirm(`${stock.name} をウォッチリストから削除しますか？`)) {
              onDelete(stock.symbol);
            }
          }}
          className="absolute right-2 top-2 rounded p-1 text-gray-300 dark:text-slate-600 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500"
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
          <h3 className="font-semibold text-gray-900 dark:text-white">{stock.name}</h3>
          <p className="text-sm text-gray-500 dark:text-slate-400">{stock.symbol}</p>
        </div>
        {stock.sector && (
          <span className="mr-5 rounded-full bg-blue-50 dark:bg-blue-900/30 px-2 py-0.5 text-xs text-blue-600">
            {stock.sector}
          </span>
        )}
      </div>
      <div className="mt-3 flex items-end justify-between">
        <div>
          {price !== undefined ? (
            <p className="text-2xl font-bold text-gray-900 dark:text-white">
              {price.toLocaleString()}
            </p>
          ) : (
            <p className="text-2xl font-bold text-gray-300 dark:text-slate-600">---</p>
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
            <span className="text-xs text-gray-400 dark:text-slate-500">センチメント</span>
            <p
              className={`text-lg font-bold ${
                sentimentScore > 0.2
                  ? "text-green-600"
                  : sentimentScore < -0.2
                    ? "text-red-600"
                    : "text-gray-500 dark:text-slate-400"
              }`}
            >
              {sentimentScore > 0 ? "+" : ""}
              {sentimentScore.toFixed(2)}
            </p>
          </div>
        )}
      </div>
      {/* PER / PBR / ROE */}
      {(per !== undefined || pbr !== undefined || roe !== undefined) && (
        <div className="mt-2 flex gap-3 border-t border-gray-100 dark:border-slate-700 pt-2">
          {per !== undefined && (
            <div className="text-center">
              <span className="block text-[10px] text-gray-400 dark:text-slate-500">PER</span>
              <span className="text-xs font-semibold text-gray-700 dark:text-slate-300">{per.toFixed(1)}x</span>
            </div>
          )}
          {pbr !== undefined && (
            <div className="text-center">
              <span className="block text-[10px] text-gray-400 dark:text-slate-500">PBR</span>
              <span className="text-xs font-semibold text-gray-700 dark:text-slate-300">{pbr.toFixed(2)}x</span>
            </div>
          )}
          {roe !== undefined && (
            <div className="text-center">
              <span className="block text-[10px] text-gray-400 dark:text-slate-500">ROE</span>
              <span className="text-xs font-semibold text-gray-700 dark:text-slate-300">{(roe * 100).toFixed(1)}%</span>
            </div>
          )}
        </div>
      )}
      {/* シグナルバッジ */}
      {signalBadges.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1 border-t border-gray-100 dark:border-slate-700 pt-2">
          {signalBadges.map((b) => (
            <span
              key={b.label}
              className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold ${b.color}`}
              title={`直近: ${b.date}`}
            >
              {b.label}
            </span>
          ))}
        </div>
      )}
      </Link>
    </div>
  );
}

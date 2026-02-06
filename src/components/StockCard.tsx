"use client";

import Link from "next/link";
import { formatChange } from "@/lib/utils/format";
import type { Stock } from "@/types";
import type { SignalSummary, ActiveSignalInfo } from "./WatchList";

interface StockCardProps {
  stock: Stock;
  price?: number;
  change?: number;
  sentimentScore?: number;
  per?: number;
  pbr?: number;
  roe?: number;
  signals?: SignalSummary;
  fundamentalJudgment?: "bullish" | "neutral" | "bearish";
  fundamentalMemo?: string;
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
  fundamentalJudgment,
  fundamentalMemo,
  onDelete,
}: StockCardProps) {
  const isPositive = (change ?? 0) >= 0;

  // アクティブシグナル（保有中ポジション）
  const activeSignals: { period: string; signal: ActiveSignalInfo }[] = [];
  if (signals?.activeSignals) {
    for (const s of signals.activeSignals.daily) {
      activeSignals.push({ period: "日足", signal: s });
    }
    for (const s of signals.activeSignals.weekly) {
      activeSignals.push({ period: "週足", signal: s });
    }
  }

  // 戦略IDから短縮名を取得
  const strategyShortName = (id: string): string => {
    switch (id) {
      case "choruko_bb": return "BB逆張";
      case "choruko_shitabanare": return "下放れ";
      case "tabata_cwh": return "CWH";
      case "rsi_reversal": return "RSI";
      case "ma_cross": return "MAクロス";
      case "macd_signal": return "MACD";
      case "macd_trail12": return "Trail12";
      default: return id;
    }
  };

  // 戦略IDからバッジ色を取得
  const strategyBadgeClass = (id: string): string => {
    switch (id) {
      case "choruko_bb":
      case "choruko_shitabanare":
        return "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400";
      case "tabata_cwh":
        return "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400";
      case "rsi_reversal":
        return "bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400";
      case "ma_cross":
        return "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400";
      case "macd_signal":
        return "bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400";
      case "macd_trail12":
        return "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400";
      default:
        return "bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400";
    }
  };

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
        {stock.sectors && stock.sectors.length > 0 && (
          <div className="mr-5 flex flex-wrap gap-1">
            {stock.sectors.map((s) => (
              <span key={s} className="rounded-full bg-blue-50 dark:bg-blue-900/30 px-2 py-0.5 text-xs text-blue-600">
                {s}
              </span>
            ))}
          </div>
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
      {/* PER / PBR / ROE / ファンダ判定 */}
      {(per !== undefined || pbr !== undefined || roe !== undefined || fundamentalJudgment) && (
        <div className="mt-2 flex items-center gap-3 border-t border-gray-100 dark:border-slate-700 pt-2">
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
          {fundamentalJudgment && (
            <div className="ml-auto">
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                fundamentalJudgment === "bullish"
                  ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                  : fundamentalJudgment === "bearish"
                    ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"
                    : "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400"
              }`}>
                {fundamentalJudgment === "bullish" ? "▲強気" : fundamentalJudgment === "bearish" ? "▼弱気" : "◆中立"}
              </span>
            </div>
          )}
        </div>
      )}
      {/* ファンダメモ */}
      {fundamentalMemo && (
        <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-gray-500 dark:text-slate-400">
          {fundamentalMemo}
        </p>
      )}
      {/* アクティブシグナル（保有中）- 日足/週足 2カラム */}
      {activeSignals.length > 0 && (() => {
        const dailySigs = activeSignals.filter((a) => a.period === "日足").sort((a, b) => b.signal.buyDate.localeCompare(a.signal.buyDate));
        const weeklySigs = activeSignals.filter((a) => a.period === "週足").sort((a, b) => b.signal.buyDate.localeCompare(a.signal.buyDate));
        const renderSignal = (a: { period: string; signal: ActiveSignalInfo }) => {
          const isProfit = a.signal.pnlPct >= 0;
          const validation = signals?.validations?.[a.signal.strategyId];
          return (
            <div key={`${a.period}-${a.signal.strategyId}`} className="flex items-center gap-1 text-[10px]">
              <span className={`shrink-0 rounded px-1 py-0.5 font-bold ${strategyBadgeClass(a.signal.strategyId)}`}>
                {strategyShortName(a.signal.strategyId)}
              </span>
              {validation && (
                <span className={`shrink-0 rounded px-0.5 py-0.5 text-[9px] font-bold ${
                  validation.decision === "entry"
                    ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                    : validation.decision === "avoid"
                      ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"
                      : "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400"
                }`}>
                  {validation.decision === "entry" ? "Go" : validation.decision === "avoid" ? "NG" : "様子見"}
                </span>
              )}
              <span className="text-gray-400 dark:text-slate-500">
                {a.signal.buyDate.slice(5).replace(/-/g, "/")}
              </span>
              <span className={`ml-auto font-bold ${isProfit ? "text-green-600" : "text-red-500"}`}>
                {isProfit ? "+" : ""}{a.signal.pnlPct.toFixed(1)}%
              </span>
            </div>
          );
        };
        return (
          <div className="mt-2 border-t border-gray-100 dark:border-slate-700 pt-2">
            <span className="text-[10px] font-semibold text-gray-500 dark:text-slate-400">保有中シグナル</span>
            <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0">
              {/* 日足カラム */}
              <div className="space-y-0.5">
                {dailySigs.length > 0 ? (
                  <>
                    <div className="text-[9px] font-bold text-gray-400 dark:text-slate-500 border-b border-gray-100 dark:border-slate-700 pb-0.5 mb-0.5">日足</div>
                    {dailySigs.map(renderSignal)}
                  </>
                ) : (
                  <div className="text-[9px] text-gray-300 dark:text-slate-600">日足: なし</div>
                )}
              </div>
              {/* 週足カラム */}
              <div className="space-y-0.5">
                {weeklySigs.length > 0 ? (
                  <>
                    <div className="text-[9px] font-bold text-gray-400 dark:text-slate-500 border-b border-gray-100 dark:border-slate-700 pb-0.5 mb-0.5">週足</div>
                    {weeklySigs.map(renderSignal)}
                  </>
                ) : (
                  <div className="text-[9px] text-gray-300 dark:text-slate-600">週足: なし</div>
                )}
              </div>
            </div>
          </div>
        );
      })()}
      </Link>
    </div>
  );
}

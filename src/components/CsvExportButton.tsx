"use client";

import { useState, useRef, useEffect } from "react";
import type { WatchlistGroup } from "@/types";
import { generateMoomooCsv, downloadCsv } from "@/lib/utils/csvExport";

interface CsvExportButtonProps {
  /** フィルタ済みの表示中銘柄 */
  stocks: { symbol: string; name: string }[];
  /** 全グループ一覧 */
  allGroups: WatchlistGroup[];
  /** symbol → groupIds マップ */
  watchlistGroupMap: Map<string, number[]>;
  /** ファイル名プレフィックス (例: "new-highs") */
  filenamePrefix?: string;
}

export default function CsvExportButton({
  stocks,
  allGroups,
  watchlistGroupMap,
  filenamePrefix = "moomoo",
}: CsvExportButtonProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const handleExport = (groupId?: number) => {
    let target = stocks;
    let suffix = "all";
    if (groupId != null) {
      target = stocks.filter((s) => {
        const gids = watchlistGroupMap.get(s.symbol);
        return gids?.includes(groupId);
      });
      const group = allGroups.find((g) => g.id === groupId);
      suffix = group?.name ?? String(groupId);
    }
    if (target.length === 0) return;
    const csv = generateMoomooCsv(target);
    const date = new Date().toISOString().slice(0, 10);
    downloadCsv(csv, `${filenamePrefix}_${suffix}_${date}.csv`);
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:border-blue-600 dark:bg-slate-800 dark:text-blue-400 dark:hover:bg-slate-700"
        title="moomoo証券インポート用CSVをダウンロード"
      >
        CSV出力
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 min-w-[180px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-slate-600 dark:bg-slate-800">
          <button
            onClick={() => handleExport()}
            className="w-full px-3 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-50 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            表示中の全銘柄 ({stocks.length})
          </button>
          {allGroups.length > 0 && (
            <div className="border-t border-gray-100 dark:border-slate-700 my-0.5" />
          )}
          {allGroups.map((g) => {
            const count = stocks.filter((s) => watchlistGroupMap.get(s.symbol)?.includes(g.id)).length;
            return (
              <button
                key={g.id}
                onClick={() => handleExport(g.id)}
                disabled={count === 0}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: g.color }}
                />
                <span className="flex-1">{g.name}</span>
                <span className="text-gray-400 dark:text-slate-500">{count}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

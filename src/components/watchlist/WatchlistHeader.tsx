"use client";

import { useState, useEffect, useRef } from "react";
import type { WatchlistGroup } from "@/types";

interface WatchlistHeaderProps {
  allGroups: WatchlistGroup[];
  selectedGroupIds: Set<number>;
  onToggleGroup: (groupId: number) => void;
  onOpenModal: () => void;
}

export function WatchlistHeader({
  allGroups,
  selectedGroupIds,
  onToggleGroup,
  onOpenModal,
}: WatchlistHeaderProps) {
  const [showGroupDropdown, setShowGroupDropdown] = useState(false);
  const groupDropdownRef = useRef<HTMLDivElement>(null);

  // Click-outside to close
  useEffect(() => {
    if (!showGroupDropdown) return;
    function handleClick(e: MouseEvent) {
      if (groupDropdownRef.current && !groupDropdownRef.current.contains(e.target as Node)) {
        setShowGroupDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showGroupDropdown]);

  return (
    <div className="mb-4 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white">ウォッチリスト</h2>
        {allGroups.length > 0 && (
          <div className="relative" ref={groupDropdownRef}>
            <button
              onClick={() => setShowGroupDropdown((v) => !v)}
              className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                selectedGroupIds.size > 0
                  ? "border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/30 dark:text-blue-300"
                  : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              }`}
            >
              グループ
              {selectedGroupIds.size > 0 && (
                <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-bold text-white">
                  {selectedGroupIds.size}
                </span>
              )}
              <svg className="ml-1 inline h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
            {showGroupDropdown && (
              <div className="absolute left-0 top-full z-50 mt-1 min-w-48 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-slate-600 dark:bg-slate-800">
                {allGroups.map((g) => (
                  <label
                    key={g.id}
                    className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-slate-700"
                  >
                    <input
                      type="checkbox"
                      checked={selectedGroupIds.has(g.id)}
                      onChange={() => onToggleGroup(g.id)}
                      className="h-3.5 w-3.5 rounded"
                    />
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: g.color }}
                    />
                    <span className="text-gray-700 dark:text-slate-300">{g.name}</span>
                  </label>
                ))}
                {selectedGroupIds.size > 0 && (
                  <>
                    <div className="my-1 border-t border-gray-100 dark:border-slate-700" />
                    <button
                      onClick={() => {
                        for (const id of selectedGroupIds) onToggleGroup(id);
                      }}
                      className="w-full px-3 py-1.5 text-left text-xs text-gray-500 hover:bg-gray-50 dark:text-slate-400 dark:hover:bg-slate-700"
                    >
                      選択解除
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      <button
        onClick={onOpenModal}
        className="flex items-center gap-1 rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
      >
        <svg
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        銘柄追加
      </button>
    </div>
  );
}

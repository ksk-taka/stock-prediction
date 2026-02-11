"use client";

import { useState, useEffect, useRef } from "react";
import type { WatchlistGroup } from "@/types";

const GROUP_COLORS = [
  { value: "#fbbf24", label: "黄" },
  { value: "#3b82f6", label: "青" },
  { value: "#22c55e", label: "緑" },
  { value: "#ef4444", label: "赤" },
  { value: "#a855f7", label: "紫" },
  { value: "#ec4899", label: "桃" },
  { value: "#06b6d4", label: "水" },
  { value: "#f97316", label: "橙" },
];

interface GroupAssignPopupProps {
  symbol: string;
  currentGroupIds: number[];
  allGroups: WatchlistGroup[];
  anchor: DOMRect;
  onToggleGroup: (groupId: number, checked: boolean) => void;
  onCreateGroup: (name: string, color: string) => void;
  onClose: () => void;
}

export default function GroupAssignPopup({
  symbol,
  currentGroupIds,
  allGroups,
  anchor,
  onToggleGroup,
  onCreateGroup,
  onClose,
}: GroupAssignPopupProps) {
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(GROUP_COLORS[0].value);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);

  // クリック外で閉じる
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  // Escで閉じる
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // ポップアップ位置を計算
  const style: React.CSSProperties = {
    position: "fixed",
    zIndex: 50,
    top: Math.min(anchor.bottom + 4, window.innerHeight - 300),
    left: Math.min(anchor.left, window.innerWidth - 260),
  };

  const currentSet = new Set(currentGroupIds);

  const handleCreateGroup = () => {
    const name = newName.trim();
    if (!name) return;
    onCreateGroup(name, newColor);
    setNewName("");
    setShowColorPicker(false);
  };

  return (
    <div ref={popupRef} style={style} className="w-60 rounded-lg border border-gray-200 bg-white shadow-xl dark:border-slate-600 dark:bg-slate-800">
      <div className="border-b border-gray-100 px-3 py-2 dark:border-slate-700">
        <p className="text-xs font-medium text-gray-500 dark:text-slate-400">
          グループ設定 — {symbol.replace(".T", "")}
        </p>
      </div>

      {/* グループ一覧 */}
      <div className="max-h-48 overflow-y-auto px-1 py-1">
        {allGroups.length === 0 && (
          <p className="px-2 py-3 text-center text-xs text-gray-400 dark:text-slate-500">
            グループがありません
          </p>
        )}
        {allGroups.map((g) => (
          <label
            key={g.id}
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-slate-700"
          >
            <input
              type="checkbox"
              checked={currentSet.has(g.id)}
              onChange={(e) => onToggleGroup(g.id, e.target.checked)}
              className="rounded border-gray-300 dark:border-slate-500"
            />
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: g.color }}
            />
            <span className="text-sm text-gray-700 dark:text-slate-300">{g.name}</span>
          </label>
        ))}
      </div>

      {/* 新規グループ作成 */}
      <div className="border-t border-gray-100 px-3 py-2 dark:border-slate-700">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowColorPicker((v) => !v)}
            className="shrink-0 rounded-full border border-gray-200 p-0.5 dark:border-slate-600"
            title="色を選択"
          >
            <span
              className="block h-3.5 w-3.5 rounded-full"
              style={{ backgroundColor: newColor }}
            />
          </button>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleCreateGroup(); }}
            placeholder="新しいグループ..."
            className="min-w-0 flex-1 rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 placeholder-gray-400 focus:border-blue-400 focus:outline-none dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300 dark:placeholder-slate-500"
          />
          <button
            type="button"
            onClick={handleCreateGroup}
            disabled={!newName.trim()}
            className="shrink-0 rounded bg-blue-500 px-2 py-1 text-xs font-medium text-white hover:bg-blue-600 disabled:opacity-40"
          >
            追加
          </button>
        </div>
        {showColorPicker && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {GROUP_COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => { setNewColor(c.value); setShowColorPicker(false); }}
                className={`h-5 w-5 rounded-full border-2 transition-transform ${
                  newColor === c.value ? "border-gray-800 scale-110 dark:border-white" : "border-transparent hover:scale-110"
                }`}
                style={{ backgroundColor: c.value }}
                title={c.label}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

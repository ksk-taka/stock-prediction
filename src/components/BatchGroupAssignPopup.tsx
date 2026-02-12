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

interface BatchGroupAssignPopupProps {
  stockCount: number;
  allGroups: WatchlistGroup[];
  onConfirm: (groupId: number) => Promise<{ updated: number; alreadyInGroup: number }>;
  onCreateGroup: (name: string, color: string) => Promise<WatchlistGroup>;
  onClose: () => void;
}

export default function BatchGroupAssignPopup({
  stockCount,
  allGroups,
  onConfirm,
  onCreateGroup,
  onClose,
}: BatchGroupAssignPopupProps) {
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(GROUP_COLORS[0].value);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ updated: number; alreadyInGroup: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Escで閉じる
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !running) onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, running]);

  const handleCreateGroup = async () => {
    const name = newName.trim();
    if (!name) return;
    const group = await onCreateGroup(name, newColor);
    setNewName("");
    setShowColorPicker(false);
    setSelectedGroupId(group.id);
  };

  const handleConfirm = async () => {
    if (selectedGroupId == null) return;
    setRunning(true);
    try {
      const res = await onConfirm(selectedGroupId);
      setResult(res);
    } catch {
      setResult({ updated: 0, alreadyInGroup: 0 });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div
        ref={panelRef}
        className="w-72 rounded-lg border border-gray-200 bg-white shadow-xl dark:border-slate-600 dark:bg-slate-800"
      >
        {/* ヘッダ */}
        <div className="border-b border-gray-100 px-4 py-3 dark:border-slate-700">
          <p className="text-sm font-medium text-gray-700 dark:text-slate-200">
            {stockCount}銘柄をグループに追加
          </p>
        </div>

        {/* 結果表示 */}
        {result ? (
          <div className="px-4 py-6 text-center">
            <p className="text-sm text-gray-700 dark:text-slate-300">
              {result.updated > 0 ? (
                <span className="font-medium text-emerald-600 dark:text-emerald-400">
                  {result.updated}銘柄を追加しました
                </span>
              ) : (
                <span className="text-gray-500 dark:text-slate-400">追加対象はありませんでした</span>
              )}
            </p>
            {result.alreadyInGroup > 0 && (
              <p className="mt-1 text-xs text-gray-400 dark:text-slate-500">
                ({result.alreadyInGroup}銘柄は既に所属済み)
              </p>
            )}
            <button
              onClick={onClose}
              className="mt-4 rounded-lg bg-gray-100 px-4 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
            >
              閉じる
            </button>
          </div>
        ) : (
          <>
            {/* グループ一覧 */}
            <div className="max-h-52 overflow-y-auto px-1 py-1">
              {allGroups.length === 0 && (
                <p className="px-3 py-4 text-center text-xs text-gray-400 dark:text-slate-500">
                  グループがありません。下から作成してください。
                </p>
              )}
              {allGroups.map((g) => (
                <label
                  key={g.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-slate-700"
                >
                  <input
                    type="radio"
                    name="batch-group"
                    checked={selectedGroupId === g.id}
                    onChange={() => setSelectedGroupId(g.id)}
                    disabled={running}
                    className="border-gray-300 text-blue-600 dark:border-slate-500"
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
                  disabled={running}
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
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreateGroup();
                  }}
                  placeholder="新しいグループ..."
                  disabled={running}
                  className="min-w-0 flex-1 rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 placeholder-gray-400 focus:border-blue-400 focus:outline-none dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300 dark:placeholder-slate-500"
                />
                <button
                  type="button"
                  onClick={handleCreateGroup}
                  disabled={!newName.trim() || running}
                  className="shrink-0 rounded bg-blue-500 px-2 py-1 text-xs font-medium text-white hover:bg-blue-600 disabled:opacity-40"
                >
                  作成
                </button>
              </div>
              {showColorPicker && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {GROUP_COLORS.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => {
                        setNewColor(c.value);
                        setShowColorPicker(false);
                      }}
                      className={`h-5 w-5 rounded-full border-2 transition-transform ${
                        newColor === c.value
                          ? "scale-110 border-gray-800 dark:border-white"
                          : "border-transparent hover:scale-110"
                      }`}
                      style={{ backgroundColor: c.value }}
                      title={c.label}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* フッタ */}
            <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-3 py-2 dark:border-slate-700">
              <button
                onClick={onClose}
                disabled={running}
                className="rounded-lg px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100 dark:text-slate-400 dark:hover:bg-slate-700"
              >
                キャンセル
              </button>
              <button
                onClick={handleConfirm}
                disabled={selectedGroupId == null || running}
                className="rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-500 dark:hover:bg-emerald-600"
              >
                {running ? "追加中..." : "追加"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

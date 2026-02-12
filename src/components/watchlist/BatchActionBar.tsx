interface BatchActionBarProps {
  filteredSignalStockCount: number;
  filteredSignalCount: number;
  batchAnalysis: boolean;
  onBatchAnalysisChange: (value: boolean) => void;
  batchSlack: boolean;
  onBatchSlackChange: (value: boolean) => void;
  batchRunning: boolean;
  batchProgress: { current: number; total: number; currentName: string } | null;
  onExecute: () => void;
}

export function BatchActionBar({
  filteredSignalStockCount,
  filteredSignalCount,
  batchAnalysis,
  onBatchAnalysisChange,
  batchSlack,
  onBatchSlackChange,
  batchRunning,
  batchProgress,
  onExecute,
}: BatchActionBarProps) {
  if (filteredSignalCount === 0) return null;

  return (
    <div className="mb-4 rounded-lg border border-indigo-200 bg-indigo-50 p-3 dark:border-indigo-700 dark:bg-indigo-900/20">
      <div className="flex flex-wrap items-center gap-4">
        <span className="text-xs font-medium text-indigo-700 dark:text-indigo-300">
          フィルタ中の{filteredSignalStockCount}銘柄（{filteredSignalCount}シグナル）に対して実行:
        </span>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-gray-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={batchAnalysis}
              onChange={(e) => onBatchAnalysisChange(e.target.checked)}
              className="rounded border-gray-300 dark:border-slate-600"
              disabled={batchRunning}
            />
            分析（Go/NoGo判断）
          </label>
          <label className="flex items-center gap-1.5 text-xs text-gray-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={batchSlack}
              onChange={(e) => onBatchSlackChange(e.target.checked)}
              className="rounded border-gray-300 dark:border-slate-600"
              disabled={batchRunning}
            />
            Slack通知
          </label>
        </div>

        <button
          onClick={onExecute}
          disabled={batchRunning || (!batchAnalysis && !batchSlack)}
          className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-600"
        >
          {batchRunning ? "実行中..." : "実行"}
        </button>
      </div>

      {/* バッチ進捗 */}
      {batchProgress && (
        <div className="mt-2">
          <div className="mb-1 flex items-center justify-between text-[11px]">
            <span className="text-indigo-600 dark:text-indigo-300">{batchProgress.currentName}</span>
            <span className="text-indigo-500 dark:text-indigo-400">
              {batchProgress.current}/{batchProgress.total}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-indigo-100 dark:bg-indigo-800">
            <div
              className="h-full rounded-full bg-indigo-500 transition-all duration-300"
              style={{
                width: `${(batchProgress.current / batchProgress.total) * 100}%`,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

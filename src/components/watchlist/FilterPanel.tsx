import type { Stock } from "@/types";
import type { FilterPreset, NewHighInfo, SignalSummary } from "@/types/watchlist";

interface FilterPanelProps {
  // Search
  searchQuery: string;
  onSearchChange: (value: string) => void;

  // Segments
  allSegments: readonly ("プライム" | "スタンダード" | "グロース")[];
  selectedSegments: Set<string>;
  onToggleSegment: (segment: string) => void;

  // Cap Size
  selectedCapSizes: Set<string>;
  onToggleCapSize: (size: string) => void;

  // Numeric range filters
  priceMin: string;
  onPriceMinChange: (value: string) => void;
  priceMax: string;
  onPriceMaxChange: (value: string) => void;
  ncRatioMin: string;
  onNcRatioMinChange: (value: string) => void;
  ncRatioMax: string;
  onNcRatioMaxChange: (value: string) => void;
  sharpeMin: string;
  onSharpeMinChange: (value: string) => void;
  increaseMin: string;
  onIncreaseMinChange: (value: string) => void;
  roeMin: string;
  onRoeMinChange: (value: string) => void;
  roeMax: string;
  onRoeMaxChange: (value: string) => void;
  onClearNumericFilters: () => void;
  hasNumericFilter: boolean;
  batchStatsLoading: boolean;

  // Presets
  filterPresets: FilterPreset[];
  activePresetName: string | null;
  onApplyPreset: (preset: FilterPreset) => void;
  onDeletePreset: (name: string) => void;

  // Signals
  stocks: Stock[];
  signals: Record<string, SignalSummary>;
  signalScannedCount: number;
  signalLastScannedAt: string | null;
  signalScanning: boolean;
  signalScanProgress: { scanned: number; total: number } | null;
  onSignalScan: () => void;
  onSignalScanAbort: () => void;
  allActiveStrategies: readonly [string, string][];
  selectedStrategies: Set<string>;
  onToggleStrategy: (strategyId: string) => void;
  signalFilterMode: "or" | "and";
  onToggleSignalFilterMode: () => void;

  // Period
  signalPeriodFilter: string;
  onSignalPeriodChange: (value: string) => void;

  // Decision
  selectedDecision: string | null;
  onDecisionChange: (value: string | null) => void;

  // Judgment
  selectedJudgment: string | null;
  onJudgmentChange: (value: string | null) => void;

  // New Highs
  newHighsMap: Record<string, NewHighInfo>;
  newHighsScannedAt: string | null;
  scanning: boolean;
  onScan: () => void;
  breakoutFilter: boolean;
  onBreakoutFilterChange: (value: boolean) => void;
  consolidationFilter: boolean;
  onConsolidationFilterChange: (value: boolean) => void;

  // Sectors
  allSectors: string[];
  selectedSectors: Set<string>;
  onToggleSector: (sector: string) => void;

  // Filter actions
  hasAnyFilter: boolean;
  filteredCount: number;
  totalCount: number;
  onClearFilters: () => void;
  onSavePreset: () => void;
}

export function FilterPanel({
  searchQuery,
  onSearchChange,
  allSegments,
  selectedSegments,
  onToggleSegment,
  selectedCapSizes,
  onToggleCapSize,
  priceMin,
  onPriceMinChange,
  priceMax,
  onPriceMaxChange,
  ncRatioMin,
  onNcRatioMinChange,
  ncRatioMax,
  onNcRatioMaxChange,
  sharpeMin,
  onSharpeMinChange,
  increaseMin,
  onIncreaseMinChange,
  roeMin,
  onRoeMinChange,
  roeMax,
  onRoeMaxChange,
  onClearNumericFilters,
  hasNumericFilter,
  batchStatsLoading,
  filterPresets,
  activePresetName,
  onApplyPreset,
  onDeletePreset,
  stocks,
  signals,
  signalScannedCount,
  signalLastScannedAt,
  signalScanning,
  signalScanProgress,
  onSignalScan,
  onSignalScanAbort,
  allActiveStrategies,
  selectedStrategies,
  onToggleStrategy,
  signalFilterMode,
  onToggleSignalFilterMode,
  signalPeriodFilter,
  onSignalPeriodChange,
  selectedDecision,
  onDecisionChange,
  selectedJudgment,
  onJudgmentChange,
  newHighsMap,
  newHighsScannedAt,
  scanning,
  onScan,
  breakoutFilter,
  onBreakoutFilterChange,
  consolidationFilter,
  onConsolidationFilterChange,
  allSectors,
  selectedSectors,
  onToggleSector,
  hasAnyFilter,
  filteredCount,
  totalCount,
  onClearFilters,
  onSavePreset,
}: FilterPanelProps) {
  const hasValidations = Object.values(signals).some(
    (s) => s.validations && Object.keys(s.validations).length > 0
  );

  return (
    <div className="mb-4 space-y-3">
      {/* テキスト検索 */}
      <div className="relative">
        <svg
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-slate-500"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
          />
        </svg>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="銘柄コードまたは会社名で検索（例: 7203, トヨタ）"
          className="w-full rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 py-2 pl-10 pr-4 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-slate-500 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
        {searchQuery && (
          <button
            onClick={() => onSearchChange("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:text-slate-500 dark:hover:text-slate-300"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* 市場区分フィルタ */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-gray-500 dark:text-slate-400">市場区分:</span>
        {allSegments.map((segment) => (
          <button
            key={segment}
            onClick={() => onToggleSegment(segment)}
            className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
              selectedSegments.has(segment)
                ? "border-cyan-400 bg-cyan-50 text-cyan-700 dark:border-cyan-500 dark:bg-cyan-900/30 dark:text-cyan-300"
                : "border-gray-300 bg-white text-gray-500 hover:border-gray-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500"
            }`}
          >
            {segment}
          </button>
        ))}
      </div>

      {/* 時価総額フィルタ */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-gray-500 dark:text-slate-400">時価総額:</span>
        {(
          [
            ["small", "小型株"],
            ["mid", "中型株"],
            ["large", "大型株"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            onClick={() => onToggleCapSize(value)}
            className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
              selectedCapSizes.has(value)
                ? "border-teal-400 bg-teal-50 text-teal-700 dark:border-teal-500 dark:bg-teal-900/30 dark:text-teal-300"
                : "border-gray-300 bg-white text-gray-500 hover:border-gray-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 数値範囲フィルタ */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-1">
          <span className="text-xs font-medium text-gray-500 dark:text-slate-400">株価</span>
          <input
            type="number"
            step="100"
            value={priceMin}
            onChange={(e) => onPriceMinChange(e.target.value)}
            placeholder=""
            className="w-20 rounded border border-gray-300 bg-white px-2 py-1 text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
          <span className="text-xs text-gray-400">円〜</span>
          <input
            type="number"
            step="100"
            value={priceMax}
            onChange={(e) => onPriceMaxChange(e.target.value)}
            placeholder=""
            className="w-20 rounded border border-gray-300 bg-white px-2 py-1 text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
          <span className="text-xs text-gray-400">円</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs font-medium text-gray-500 dark:text-slate-400">NC率</span>
          <input
            type="number"
            step="10"
            value={ncRatioMin}
            onChange={(e) => onNcRatioMinChange(e.target.value)}
            placeholder=""
            className="w-16 rounded border border-gray-300 bg-white px-2 py-1 text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
          <span className="text-xs text-gray-400">%以上</span>
          <span className="text-xs text-gray-400">〜</span>
          <input
            type="number"
            step="10"
            value={ncRatioMax}
            onChange={(e) => onNcRatioMaxChange(e.target.value)}
            placeholder="100"
            className="w-16 rounded border border-gray-300 bg-white px-2 py-1 text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
          <span className="text-xs text-gray-400">%未満</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs font-medium text-gray-500 dark:text-slate-400">Sharpe</span>
          <input
            type="number"
            step="0.1"
            value={sharpeMin}
            onChange={(e) => onSharpeMinChange(e.target.value)}
            placeholder="0.5"
            className="w-16 rounded border border-gray-300 bg-white px-2 py-1 text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
          <span className="text-xs text-gray-400">以上</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs font-medium text-gray-500 dark:text-slate-400">増配額</span>
          <input
            type="number"
            step="1"
            value={increaseMin}
            onChange={(e) => onIncreaseMinChange(e.target.value)}
            placeholder="0"
            className="w-16 rounded border border-gray-300 bg-white px-2 py-1 text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
          <span className="text-xs text-gray-400">以上</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs font-medium text-gray-500 dark:text-slate-400">ROE</span>
          <input
            type="number"
            step="1"
            value={roeMin}
            onChange={(e) => onRoeMinChange(e.target.value)}
            placeholder="10"
            className="w-16 rounded border border-gray-300 bg-white px-2 py-1 text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
          <span className="text-xs text-gray-400">%以上</span>
          <span className="text-xs text-gray-400">〜</span>
          <input
            type="number"
            step="1"
            value={roeMax}
            onChange={(e) => onRoeMaxChange(e.target.value)}
            placeholder=""
            className="w-16 rounded border border-gray-300 bg-white px-2 py-1 text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
          <span className="text-xs text-gray-400">%未満</span>
        </div>
        {batchStatsLoading && (
          <span className="text-xs text-blue-500 dark:text-blue-400">読込中...</span>
        )}
        {hasNumericFilter && (
          <button
            onClick={onClearNumericFilters}
            className="rounded-full px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
          >
            クリア
          </button>
        )}
      </div>

      {/* 保存済みプリセット */}
      {filterPresets.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-gray-500 dark:text-slate-400">
            プリセット:
          </span>
          {filterPresets.map((preset) => (
            <span key={preset.name} className="inline-flex items-center gap-0.5">
              <button
                onClick={() => onApplyPreset(preset)}
                className={`rounded-l-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                  activePresetName === preset.name
                    ? "border-purple-400 bg-purple-50 text-purple-700 dark:border-purple-500 dark:bg-purple-900/30 dark:text-purple-300"
                    : "border-gray-300 bg-white text-gray-500 hover:border-gray-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500"
                }`}
              >
                {preset.name}
              </button>
              <button
                onClick={() => onDeletePreset(preset.name)}
                className={`rounded-r-full border border-l-0 px-1.5 py-0.5 text-xs transition-colors ${
                  activePresetName === preset.name
                    ? "border-purple-400 bg-purple-50 text-purple-400 hover:text-purple-600 dark:border-purple-500 dark:bg-purple-900/30 dark:text-purple-400 dark:hover:text-purple-200"
                    : "border-gray-300 bg-white text-gray-300 hover:text-gray-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-500 dark:hover:text-slate-300"
                }`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* シグナル（戦略別）フィルタ */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-gray-500 dark:text-slate-400">
          シグナル
          {signalScannedCount > 0 && (
            <span className="ml-1 font-normal text-gray-400 dark:text-slate-500">
              ({signalScannedCount}/{stocks.length}スキャン済)
            </span>
          )}
          :
        </span>
        {/* 全銘柄スキャンボタン */}
        {!signalScanning ? (
          <button
            onClick={onSignalScan}
            className="rounded-full border border-blue-300 bg-white px-2.5 py-0.5 text-xs font-medium text-blue-600 transition-colors hover:border-blue-400 hover:bg-blue-50 dark:border-blue-600 dark:bg-slate-800 dark:text-blue-400 dark:hover:border-blue-500 dark:hover:bg-slate-700"
          >
            全銘柄スキャン
          </button>
        ) : (
          <span className="inline-flex items-center gap-2">
            <span className="text-xs text-blue-600 dark:text-blue-400">
              {signalScanProgress
                ? `${signalScanProgress.scanned.toLocaleString()}/${signalScanProgress.total.toLocaleString()} スキャン中...`
                : "スキャン開始中..."}
            </span>
            {signalScanProgress && (
              <span className="inline-block h-1.5 w-24 overflow-hidden rounded-full bg-gray-200 dark:bg-slate-700">
                <span
                  className="block h-full rounded-full bg-blue-500 transition-all"
                  style={{
                    width: `${(signalScanProgress.scanned / signalScanProgress.total) * 100}%`,
                  }}
                />
              </span>
            )}
            <button
              onClick={onSignalScanAbort}
              className="rounded-full border border-red-300 px-2 py-0.5 text-xs text-red-500 hover:bg-red-50 dark:border-red-600 dark:text-red-400 dark:hover:bg-red-900/20"
            >
              中断
            </button>
          </span>
        )}
        {signalLastScannedAt && !signalScanning && (
          <span className="text-[10px] text-gray-400 dark:text-slate-500">
            更新:{" "}
            {new Date(signalLastScannedAt).toLocaleString("ja-JP", {
              month: "numeric",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        )}
        {allActiveStrategies.length > 0 ? (
          <>
            {allActiveStrategies.map(([id, name]) => (
              <button
                key={id}
                onClick={() => onToggleStrategy(id)}
                className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                  selectedStrategies.has(id)
                    ? "border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-500 dark:bg-amber-900/30 dark:text-amber-300"
                    : "border-gray-300 bg-white text-gray-500 hover:border-gray-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500"
                }`}
              >
                {name}
              </button>
            ))}
            {selectedStrategies.size >= 2 && (
              <button
                onClick={onToggleSignalFilterMode}
                className={`rounded-full border px-2 py-0.5 text-xs font-bold transition-colors ${
                  signalFilterMode === "and"
                    ? "border-orange-400 bg-orange-50 text-orange-700 dark:border-orange-500 dark:bg-orange-900/30 dark:text-orange-300"
                    : "border-gray-300 bg-white text-gray-500 hover:border-gray-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500"
                }`}
              >
                {signalFilterMode === "and" ? "AND" : "OR"}
              </button>
            )}
          </>
        ) : (
          <span className="text-xs text-gray-400 dark:text-slate-500">なし</span>
        )}
        {hasAnyFilter && (
          <>
            <button
              onClick={onClearFilters}
              className="ml-1 text-xs text-gray-400 hover:text-gray-600 dark:text-slate-500 dark:hover:text-slate-300"
            >
              フィルタ解除
            </button>
            <button
              onClick={onSavePreset}
              className="text-xs text-purple-500 hover:text-purple-700 dark:text-purple-400 dark:hover:text-purple-300"
            >
              保存
            </button>
            <span className="text-xs text-gray-400 dark:text-slate-500">
              {filteredCount}/{totalCount}件
            </span>
          </>
        )}
      </div>

      {/* シグナル期間フィルタ */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-gray-500 dark:text-slate-400">期間:</span>
        {(
          [
            { value: "1w", label: "1週間" },
            { value: "1m", label: "1ヶ月" },
            { value: "3m", label: "3ヶ月" },
            { value: "6m", label: "半年" },
          ] as const
        ).map(({ value, label }) => (
          <button
            key={value}
            onClick={() => onSignalPeriodChange(signalPeriodFilter === value ? "all" : value)}
            className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
              signalPeriodFilter === value
                ? "border-blue-400 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-900/30 dark:text-blue-300"
                : "border-gray-300 bg-white text-gray-500 hover:border-gray-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Go/No Go フィルタ */}
      {hasValidations && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-gray-500 dark:text-slate-400">判定:</span>
          {(
            [
              {
                label: "Go",
                value: "entry",
                activeClass:
                  "border-green-400 bg-green-50 text-green-700 dark:border-green-500 dark:bg-green-900/30 dark:text-green-300",
              },
              {
                label: "様子見",
                value: "wait",
                activeClass:
                  "border-yellow-400 bg-yellow-50 text-yellow-700 dark:border-yellow-500 dark:bg-yellow-900/30 dark:text-yellow-300",
              },
              {
                label: "No Go",
                value: "avoid",
                activeClass:
                  "border-red-400 bg-red-50 text-red-700 dark:border-red-500 dark:bg-red-900/30 dark:text-red-300",
              },
            ] as const
          ).map(({ label, value, activeClass }) => (
            <button
              key={value}
              onClick={() => onDecisionChange(selectedDecision === value ? null : value)}
              className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                selectedDecision === value
                  ? activeClass
                  : "border-gray-300 bg-white text-gray-500 hover:border-gray-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* ファンダ判定フィルタ */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-gray-500 dark:text-slate-400">ファンダ:</span>
        {(
          [
            {
              label: "▲強気",
              value: "bullish",
              activeClass:
                "border-green-400 bg-green-50 text-green-700 dark:border-green-500 dark:bg-green-900/30 dark:text-green-300",
            },
            {
              label: "◆中立",
              value: "neutral",
              activeClass:
                "border-yellow-400 bg-yellow-50 text-yellow-700 dark:border-yellow-500 dark:bg-yellow-900/30 dark:text-yellow-300",
            },
            {
              label: "▼弱気",
              value: "bearish",
              activeClass:
                "border-red-400 bg-red-50 text-red-700 dark:border-red-500 dark:bg-red-900/30 dark:text-red-300",
            },
          ] as const
        ).map(({ label, value, activeClass }) => (
          <button
            key={value}
            onClick={() => onJudgmentChange(selectedJudgment === value ? null : value)}
            className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
              selectedJudgment === value
                ? activeClass
                : "border-gray-300 bg-white text-gray-500 hover:border-gray-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 新高値フィルタ */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-gray-500 dark:text-slate-400">新高値:</span>
        {Object.keys(newHighsMap).length > 0 ? (
          <>
            <button
              onClick={() => onBreakoutFilterChange(!breakoutFilter)}
              className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                breakoutFilter
                  ? "border-emerald-400 bg-emerald-50 text-emerald-700 dark:border-emerald-500 dark:bg-emerald-900/30 dark:text-emerald-300"
                  : "border-gray-300 bg-white text-gray-500 hover:border-gray-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500"
              }`}
            >
              52w突破
            </button>
            <button
              onClick={() => onConsolidationFilterChange(!consolidationFilter)}
              className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                consolidationFilter
                  ? "border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-500 dark:bg-amber-900/30 dark:text-amber-300"
                  : "border-gray-300 bg-white text-gray-500 hover:border-gray-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500"
              }`}
            >
              もみ合いあり
            </button>
            <span className="text-[10px] text-gray-400 dark:text-slate-500">
              ({Object.values(newHighsMap).filter((v) => v.isTrue52wBreakout).length}銘柄)
            </span>
          </>
        ) : (
          <span className="text-xs text-gray-400 dark:text-slate-500">データなし</span>
        )}
        <button
          onClick={onScan}
          disabled={scanning}
          className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
            scanning
              ? "cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-600"
              : "border-blue-300 bg-white text-blue-600 hover:border-blue-400 hover:bg-blue-50 dark:border-blue-600 dark:bg-slate-800 dark:text-blue-400 dark:hover:border-blue-500 dark:hover:bg-slate-700"
          }`}
        >
          {scanning ? "スキャン中..." : "スキャン更新"}
        </button>
        {newHighsScannedAt && (
          <span className="text-[10px] text-gray-400 dark:text-slate-500">
            更新: {newHighsScannedAt}
          </span>
        )}
      </div>

      {/* セクターフィルタ */}
      <div className="flex flex-wrap gap-1.5">
        {allSectors.map((sector) => (
          <button
            key={sector}
            onClick={() => onToggleSector(sector)}
            className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
              selectedSectors.has(sector)
                ? "border-blue-400 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-900/30 dark:text-blue-300"
                : "border-gray-200 bg-white text-gray-500 hover:border-gray-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-600"
            }`}
          >
            {sector}
          </button>
        ))}
      </div>
    </div>
  );
}

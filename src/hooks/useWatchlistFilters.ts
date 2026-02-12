import { useState, useEffect, useCallback, useMemo } from "react";
import type { Stock } from "@/types";
import type {
  FilterPreset,
  StockStats,
  SignalSummary,
  NewHighInfo,
} from "@/types/watchlist";
import { PRESETS_KEY, WL_EXCLUDE_STRATEGIES, PAGE_SIZE } from "@/types/watchlist";
import { getCapSize } from "@/lib/utils/format";

function loadPresets(): FilterPreset[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function savePresets(presets: FilterPreset[]) {
  localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
}

interface UseWatchlistFiltersOptions {
  stocks: Stock[];
  stats: Record<string, StockStats>;
  signals: Record<string, SignalSummary>;
  newHighsMap: Record<string, NewHighInfo>;
}

export function useWatchlistFilters({
  stocks,
  stats,
  signals,
  newHighsMap,
}: UseWatchlistFiltersOptions) {
  // フィルター状態
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSectors, setSelectedSectors] = useState<Set<string>>(new Set());
  const [selectedStrategies, setSelectedStrategies] = useState<Set<string>>(new Set());
  const [selectedSegments, setSelectedSegments] = useState<Set<string>>(new Set());
  const [signalFilterMode, setSignalFilterMode] = useState<"or" | "and">("or");
  const [selectedDecision, setSelectedDecision] = useState<string | null>(null);
  const [selectedJudgment, setSelectedJudgment] = useState<string | null>(null);
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<number>>(new Set());
  const [breakoutFilter, setBreakoutFilter] = useState(false);
  const [consolidationFilter, setConsolidationFilter] = useState(false);
  const [selectedCapSizes, setSelectedCapSizes] = useState<Set<string>>(new Set());
  const [filterPresets, setFilterPresets] = useState<FilterPreset[]>([]);
  const [activePresetName, setActivePresetName] = useState<string | null>(null);
  const [signalPeriodFilter, setSignalPeriodFilter] = useState("all");
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);

  // 数値範囲フィルタ
  const [ncRatioMin, setNcRatioMin] = useState("");
  const [ncRatioMax, setNcRatioMax] = useState("");
  const [sharpeMin, setSharpeMin] = useState("");
  const [increaseMin, setIncreaseMin] = useState("");
  const [roeMin, setRoeMin] = useState("");
  const [roeMax, setRoeMax] = useState("");

  // 初期化: プリセット読み込み
  useEffect(() => {
    setFilterPresets(loadPresets());
  }, []);

  // フィルタ変更時に表示件数をリセット
  useEffect(() => {
    setDisplayCount(PAGE_SIZE);
  }, [
    searchQuery,
    selectedSectors,
    selectedStrategies,
    selectedSegments,
    signalFilterMode,
    signalPeriodFilter,
    selectedDecision,
    selectedJudgment,
    selectedGroupIds,
    breakoutFilter,
    consolidationFilter,
    selectedCapSizes,
    ncRatioMin,
    ncRatioMax,
    sharpeMin,
    increaseMin,
    roeMin,
    roeMax,
  ]);

  // トグル関数
  const toggleSector = useCallback((sector: string) => {
    setSelectedSectors((prev) => {
      const next = new Set(prev);
      if (next.has(sector)) next.delete(sector);
      else next.add(sector);
      return next;
    });
  }, []);

  const toggleStrategy = useCallback((strategyId: string) => {
    setSelectedStrategies((prev) => {
      const next = new Set(prev);
      if (next.has(strategyId)) next.delete(strategyId);
      else next.add(strategyId);
      return next;
    });
  }, []);

  const toggleSegment = useCallback((segment: string) => {
    setSelectedSegments((prev) => {
      const next = new Set(prev);
      if (next.has(segment)) next.delete(segment);
      else next.add(segment);
      return next;
    });
  }, []);

  const toggleCapSize = useCallback((size: string) => {
    setSelectedCapSizes((prev) => {
      const next = new Set(prev);
      if (next.has(size)) next.delete(size);
      else next.add(size);
      return next;
    });
  }, []);

  const toggleGroupId = useCallback((groupId: number) => {
    setSelectedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  const hasAnyFilter = useMemo(
    () =>
      searchQuery !== "" ||
      selectedSectors.size > 0 ||
      selectedStrategies.size > 0 ||
      selectedSegments.size > 0 ||
      selectedCapSizes.size > 0 ||
      selectedGroupIds.size > 0 ||
      signalPeriodFilter !== "all" ||
      selectedDecision !== null ||
      selectedJudgment !== null ||
      signalFilterMode !== "or" ||
      breakoutFilter ||
      consolidationFilter ||
      ncRatioMin !== "" ||
      ncRatioMax !== "" ||
      sharpeMin !== "" ||
      increaseMin !== "" ||
      roeMin !== "" ||
      roeMax !== "",
    [
      searchQuery,
      selectedSectors,
      selectedStrategies,
      selectedSegments,
      selectedCapSizes,
      selectedGroupIds,
      signalPeriodFilter,
      selectedDecision,
      selectedJudgment,
      signalFilterMode,
      breakoutFilter,
      consolidationFilter,
      ncRatioMin,
      ncRatioMax,
      sharpeMin,
      increaseMin,
      roeMin,
      roeMax,
    ]
  );

  const clearAllFilters = useCallback(() => {
    setSearchQuery("");
    setSelectedSectors(new Set());
    setSelectedStrategies(new Set());
    setSelectedSegments(new Set());
    setSelectedCapSizes(new Set());
    setSignalFilterMode("or");
    setSignalPeriodFilter("all");
    setSelectedDecision(null);
    setSelectedJudgment(null);
    setSelectedGroupIds(new Set());
    setBreakoutFilter(false);
    setConsolidationFilter(false);
    setNcRatioMin("");
    setNcRatioMax("");
    setSharpeMin("");
    setIncreaseMin("");
    setRoeMin("");
    setRoeMax("");
    setActivePresetName(null);
  }, []);

  const handleSavePreset = useCallback(() => {
    const name = prompt("フィルタ名を入力してください");
    if (!name?.trim()) return;
    const preset: FilterPreset = {
      name: name.trim(),
      sectors: Array.from(selectedSectors),
      strategies: Array.from(selectedStrategies),
      segments: Array.from(selectedSegments),
      capSizes: selectedCapSizes.size > 0 ? Array.from(selectedCapSizes) : undefined,
      groupIds: selectedGroupIds.size > 0 ? Array.from(selectedGroupIds) : undefined,
      signalFilterMode: signalFilterMode !== "or" ? signalFilterMode : undefined,
      signalPeriodFilter: signalPeriodFilter !== "all" ? signalPeriodFilter : undefined,
      decision: selectedDecision,
      judgment: selectedJudgment,
      ncRatioMin: ncRatioMin || undefined,
      ncRatioMax: ncRatioMax || undefined,
      sharpeMin: sharpeMin || undefined,
      increaseMin: increaseMin || undefined,
      roeMin: roeMin || undefined,
      roeMax: roeMax || undefined,
    };
    const next = [...filterPresets.filter((p) => p.name !== preset.name), preset];
    setFilterPresets(next);
    savePresets(next);
    setActivePresetName(preset.name);
  }, [
    selectedSectors,
    selectedStrategies,
    selectedSegments,
    selectedCapSizes,
    selectedGroupIds,
    signalFilterMode,
    signalPeriodFilter,
    selectedDecision,
    selectedJudgment,
    ncRatioMin,
    ncRatioMax,
    sharpeMin,
    increaseMin,
    roeMin,
    roeMax,
    filterPresets,
  ]);

  const handleApplyPreset = useCallback((preset: FilterPreset) => {
    setSelectedSectors(new Set(preset.sectors));
    setSelectedStrategies(new Set(preset.strategies));
    setSelectedSegments(new Set(preset.segments ?? []));
    setSelectedCapSizes(new Set(preset.capSizes ?? []));
    setSelectedGroupIds(new Set(preset.groupIds ?? []));
    setSignalFilterMode(preset.signalFilterMode ?? "or");
    setSignalPeriodFilter(preset.signalPeriodFilter ?? "all");
    setSelectedDecision(preset.decision);
    setSelectedJudgment(preset.judgment);
    setNcRatioMin(preset.ncRatioMin ?? "");
    setNcRatioMax(preset.ncRatioMax ?? "");
    setSharpeMin(preset.sharpeMin ?? "");
    setIncreaseMin(preset.increaseMin ?? "");
    setRoeMin(preset.roeMin ?? "");
    setRoeMax(preset.roeMax ?? "");
    setActivePresetName(preset.name);
  }, []);

  const handleDeletePreset = useCallback(
    (name: string) => {
      const next = filterPresets.filter((p) => p.name !== name);
      setFilterPresets(next);
      savePresets(next);
      if (activePresetName === name) setActivePresetName(null);
    },
    [filterPresets, activePresetName]
  );

  // セクター一覧を抽出
  const allSectors = useMemo(
    () => Array.from(new Set(stocks.flatMap((s) => s.sectors ?? []))).sort(),
    [stocks]
  );

  // 市場区分一覧
  const allSegments: ("プライム" | "スタンダード" | "グロース")[] = [
    "プライム",
    "スタンダード",
    "グロース",
  ];

  // シグナル検出済み戦略一覧を抽出（保有中 + 直近シグナル、除外戦略は非表示）
  const allActiveStrategies = useMemo(
    () =>
      Array.from(
        new Map(
          Object.values(signals)
            .flatMap((s) => [
              ...(s.activeSignals?.daily ?? []),
              ...(s.activeSignals?.weekly ?? []),
              ...(s.recentSignals?.daily ?? []),
              ...(s.recentSignals?.weekly ?? []),
            ])
            .filter((a) => !WL_EXCLUDE_STRATEGIES.has(a.strategyId))
            .map((a) => [a.strategyId, a.strategyName] as const)
        )
      ),
    [signals]
  );

  // フィルタ適用済み銘柄
  const filteredStocks = useMemo(() => {
    return stocks.filter((stock) => {
      // グループフィルタ
      if (selectedGroupIds.size > 0 && !stock.groups?.some((g) => selectedGroupIds.has(g.id)))
        return false;
      // テキスト検索
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const symbolMatch = stock.symbol.toLowerCase().includes(q);
        const nameMatch = stock.name.toLowerCase().includes(q);
        if (!symbolMatch && !nameMatch) return false;
      }
      // 市場区分フィルタ
      if (selectedSegments.size > 0) {
        if (!stock.marketSegment || !selectedSegments.has(stock.marketSegment)) return false;
      }
      // 時価総額フィルタ
      if (selectedCapSizes.size > 0) {
        const s = stats[stock.symbol];
        const capSize = getCapSize(s?.marketCap);
        if (!capSize || !selectedCapSizes.has(capSize)) return false;
      }
      // セクターフィルタ
      if (selectedSectors.size > 0) {
        const match = stock.sectors?.some((s) => selectedSectors.has(s));
        if (!match) return false;
      }
      // シグナル（戦略 × 期間）フィルタ - 保有中 + 直近シグナル
      if (selectedStrategies.size > 0 || signalPeriodFilter !== "all") {
        const sig = signals[stock.symbol];
        const allSignals = [
          ...(sig?.activeSignals?.daily ?? []).map((a) => ({
            strategyId: a.strategyId,
            date: a.buyDate,
          })),
          ...(sig?.activeSignals?.weekly ?? []).map((a) => ({
            strategyId: a.strategyId,
            date: a.buyDate,
          })),
          ...(sig?.recentSignals?.daily ?? []).map((r) => ({
            strategyId: r.strategyId,
            date: r.date,
          })),
          ...(sig?.recentSignals?.weekly ?? []).map((r) => ({
            strategyId: r.strategyId,
            date: r.date,
          })),
        ].filter((a) => !WL_EXCLUDE_STRATEGIES.has(a.strategyId));
        if (allSignals.length === 0) return false;
        const periodDays: Record<string, number> = { "1w": 7, "1m": 31, "3m": 93, "6m": 183 };
        const cutoffStr =
          signalPeriodFilter !== "all"
            ? (() => {
                const d = new Date();
                d.setDate(d.getDate() - (periodDays[signalPeriodFilter] ?? 0));
                return d.toISOString().slice(0, 10);
              })()
            : null;

        if (signalFilterMode === "and" && selectedStrategies.size > 0) {
          const stratIds = new Set(
            allSignals.filter((a) => !cutoffStr || a.date >= cutoffStr).map((a) => a.strategyId)
          );
          for (const stratId of selectedStrategies) {
            if (!stratIds.has(stratId)) return false;
          }
        } else {
          const match = allSignals.some((a) => {
            if (selectedStrategies.size > 0 && !selectedStrategies.has(a.strategyId)) return false;
            if (cutoffStr && a.date < cutoffStr) return false;
            return true;
          });
          if (!match) return false;
        }
      }
      // Go/No Go フィルタ
      if (selectedDecision !== null) {
        const sig = signals[stock.symbol];
        const validations = sig?.validations;
        if (!validations) return false;
        const activeCompositeKeys = new Set([
          ...(sig?.activeSignals?.daily ?? []).map((a) => `${a.strategyId}_daily_${a.buyDate}`),
          ...(sig?.activeSignals?.weekly ?? []).map((a) => `${a.strategyId}_weekly_${a.buyDate}`),
        ]);
        const activeSimpleIds = new Set([
          ...(sig?.activeSignals?.daily ?? []).map((a) => a.strategyId),
          ...(sig?.activeSignals?.weekly ?? []).map((a) => a.strategyId),
        ]);
        const match = Object.entries(validations).some(
          ([stratId, v]) =>
            (activeCompositeKeys.has(stratId) || activeSimpleIds.has(stratId)) &&
            v.decision === selectedDecision
        );
        if (!match) return false;
      }
      // ファンダ判定フィルタ
      if (selectedJudgment !== null) {
        if (stock.fundamental?.judgment !== selectedJudgment) return false;
      }
      // 52週ブレイクアウトフィルタ
      if (breakoutFilter) {
        const nh = newHighsMap[stock.symbol];
        if (!nh?.isTrue52wBreakout) return false;
      }
      // もみ合いフィルタ
      if (consolidationFilter) {
        const nh = newHighsMap[stock.symbol];
        if (!nh || nh.consolidationDays < 10) return false;
      }
      // NC率フィルタ
      if (ncRatioMin !== "" || ncRatioMax !== "") {
        const nc = stats[stock.symbol]?.simpleNcRatio;
        if (nc == null) return false;
        const min = ncRatioMin !== "" ? parseFloat(ncRatioMin) : NaN;
        const max = ncRatioMax !== "" ? parseFloat(ncRatioMax) : NaN;
        if (!isNaN(min) && nc < min) return false;
        if (!isNaN(max) && nc >= max) return false;
      }
      // シャープレシオ フィルタ
      if (sharpeMin !== "") {
        const min = parseFloat(sharpeMin);
        if (!isNaN(min)) {
          const sh = stats[stock.symbol]?.sharpe1y;
          if (sh == null || sh < min) return false;
        }
      }
      // 増配額フィルタ
      if (increaseMin !== "") {
        const min = parseFloat(increaseMin);
        if (!isNaN(min)) {
          const inc = stats[stock.symbol]?.latestIncrease;
          if (inc == null || inc < min) return false;
        }
      }
      // ROEフィルタ (入力は%、データは小数)
      if (roeMin !== "" || roeMax !== "") {
        const roe = stats[stock.symbol]?.roe;
        if (roe == null) return false;
        const roePct = roe * 100;
        const min = roeMin !== "" ? parseFloat(roeMin) : NaN;
        const max = roeMax !== "" ? parseFloat(roeMax) : NaN;
        if (!isNaN(min) && roePct < min) return false;
        if (!isNaN(max) && roePct >= max) return false;
      }
      return true;
    });
  }, [
    stocks,
    selectedGroupIds,
    searchQuery,
    selectedSegments,
    selectedCapSizes,
    selectedSectors,
    selectedStrategies,
    signalPeriodFilter,
    signalFilterMode,
    selectedDecision,
    selectedJudgment,
    breakoutFilter,
    consolidationFilter,
    ncRatioMin,
    ncRatioMax,
    sharpeMin,
    increaseMin,
    roeMin,
    roeMax,
    stats,
    signals,
    newHighsMap,
  ]);

  // グループ所属銘柄を先頭にソート
  const sortedStocks = useMemo(
    () =>
      [...filteredStocks].sort(
        (a, b) => ((b.groups?.length ?? 0) > 0 ? 1 : 0) - ((a.groups?.length ?? 0) > 0 ? 1 : 0)
      ),
    [filteredStocks]
  );

  // 表示する銘柄（Load More制御）
  const hasActiveFilter = useMemo(
    () =>
      selectedGroupIds.size > 0 ||
      !!searchQuery ||
      selectedSegments.size > 0 ||
      selectedCapSizes.size > 0 ||
      selectedSectors.size > 0 ||
      selectedStrategies.size > 0 ||
      signalPeriodFilter !== "all" ||
      selectedDecision !== null ||
      selectedJudgment !== null ||
      breakoutFilter ||
      consolidationFilter ||
      ncRatioMin !== "" ||
      ncRatioMax !== "" ||
      sharpeMin !== "" ||
      increaseMin !== "" ||
      roeMin !== "" ||
      roeMax !== "",
    [
      selectedGroupIds,
      searchQuery,
      selectedSegments,
      selectedCapSizes,
      selectedSectors,
      selectedStrategies,
      signalPeriodFilter,
      selectedDecision,
      selectedJudgment,
      breakoutFilter,
      consolidationFilter,
      ncRatioMin,
      ncRatioMax,
      sharpeMin,
      increaseMin,
      roeMin,
      roeMax,
    ]
  );

  const displayedStocks = useMemo(
    () => (hasActiveFilter ? sortedStocks : sortedStocks.slice(0, displayCount)),
    [hasActiveFilter, sortedStocks, displayCount]
  );

  const hasMore = !hasActiveFilter && displayCount < sortedStocks.length;

  const loadMore = useCallback(() => {
    setDisplayCount((prev) => prev + PAGE_SIZE);
  }, []);

  return {
    // State
    searchQuery,
    setSearchQuery,
    selectedSectors,
    selectedStrategies,
    selectedSegments,
    signalFilterMode,
    setSignalFilterMode,
    selectedDecision,
    setSelectedDecision,
    selectedJudgment,
    setSelectedJudgment,
    selectedGroupIds,
    breakoutFilter,
    setBreakoutFilter,
    consolidationFilter,
    setConsolidationFilter,
    selectedCapSizes,
    filterPresets,
    activePresetName,
    signalPeriodFilter,
    setSignalPeriodFilter,

    // Numeric range filters
    ncRatioMin,
    setNcRatioMin,
    ncRatioMax,
    setNcRatioMax,
    sharpeMin,
    setSharpeMin,
    increaseMin,
    setIncreaseMin,
    roeMin,
    setRoeMin,
    roeMax,
    setRoeMax,

    // Actions
    toggleSector,
    toggleStrategy,
    toggleSegment,
    toggleCapSize,
    toggleGroupId,
    clearAllFilters,
    handleSavePreset,
    handleApplyPreset,
    handleDeletePreset,
    loadMore,

    // Derived
    allSectors,
    allSegments,
    allActiveStrategies,
    filteredStocks,
    sortedStocks,
    displayedStocks,
    hasAnyFilter,
    hasActiveFilter,
    hasMore,
  };
}

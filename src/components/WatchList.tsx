"use client";

import { useState, useCallback, useEffect } from "react";
import AddStockModal from "./AddStockModal";
import GroupAssignPopup from "./GroupAssignPopup";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { useWatchlistData } from "@/hooks/useWatchlistData";
import { useWatchlistFilters } from "@/hooks/useWatchlistFilters";
import { useSignalScanner } from "@/hooks/useSignalScanner";
import { useBatchActions } from "@/hooks/useBatchActions";
import { WatchlistHeader } from "./watchlist/WatchlistHeader";
import { FilterPanel } from "./watchlist/FilterPanel";
import { BatchActionBar } from "./watchlist/BatchActionBar";
import { StockGrid } from "./watchlist/StockGrid";
import { PAGE_SIZE } from "@/types/watchlist";

// Re-export types for backward compatibility
export type { ActiveSignalInfo, RecentSignalInfo, SignalSummary } from "@/types/watchlist";

export default function WatchList() {
  const [modalOpen, setModalOpen] = useState(false);
  const [groupPopup, setGroupPopup] = useState<{ symbol: string; anchor: DOMRect } | null>(null);

  // Data hook
  const {
    stocks,
    quotes,
    stats,
    signals,
    setSignals,
    loading,
    allGroups,
    newHighsMap,
    newHighsScannedAt,
    scanning,
    signalScannedCount,
    signalLastScannedAt,
    setSignalScannedCount,
    setSignalLastScannedAt,
    fetchWatchlist,
    handleScan,
    handleCardVisible,
    handleAddStock,
    handleDeleteStock,
    handleSaveGroups,
    handleCreateGroup,
    signalsFetchedRef,
    initialSignalLoadComplete,
    fetchBatchStats,
    batchStatsLoading,
  } = useWatchlistData();

  // Pull-to-refresh
  const {
    pullDistance,
    isRefreshing,
    PULL_THRESHOLD,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
  } = usePullToRefresh({ onRefresh: fetchWatchlist });

  // Filters hook
  const filters = useWatchlistFilters({
    stocks,
    stats,
    signals,
    newHighsMap,
  });

  // 数値フィルタが有効になったら全銘柄statsをバッチ取得
  const hasNumericFilter =
    filters.ncRatioMin !== "" ||
    filters.ncRatioMax !== "" ||
    filters.sharpeMin !== "" ||
    filters.increaseMin !== "" ||
    filters.roeMin !== "" ||
    filters.roeMax !== "";

  useEffect(() => {
    if (hasNumericFilter) {
      fetchBatchStats();
    }
  }, [hasNumericFilter, fetchBatchStats]);

  // Signal scanner hook
  const signalScanner = useSignalScanner({
    onSignalsUpdate: useCallback(
      (updater) => setSignals(updater),
      [setSignals]
    ),
    signalsFetchedRef,
    signalScannedCount,
    signalLastScannedAt,
    setSignalScannedCount,
    setSignalLastScannedAt,
  });

  // Batch actions hook
  const batch = useBatchActions({
    filteredStocks: filters.filteredStocks,
    signals,
    selectedStrategies: filters.selectedStrategies,
    signalPeriodFilter: filters.signalPeriodFilter,
    initialSignalLoadComplete,
    onSignalsUpdate: useCallback(
      (updater) => setSignals(updater),
      [setSignals]
    ),
  });

  const handleEditGroups = (symbol: string, event: React.MouseEvent) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setGroupPopup({ symbol, anchor: rect });
  };

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="animate-pulse rounded-lg bg-white dark:bg-slate-800 p-4 shadow">
            <div className="h-5 w-1/2 rounded bg-gray-200 dark:bg-slate-700" />
            <div className="mt-2 h-4 w-1/3 rounded bg-gray-100 dark:bg-slate-700" />
            <div className="mt-4 h-8 w-1/2 rounded bg-gray-200 dark:bg-slate-700" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      {/* Pull-to-refresh indicator */}
      {(pullDistance > 0 || isRefreshing) && (
        <div
          className="flex items-center justify-center overflow-hidden transition-[height] duration-200 ease-out"
          style={{ height: isRefreshing ? PULL_THRESHOLD : pullDistance }}
        >
          <svg
            className={`h-6 w-6 text-gray-400 dark:text-slate-500 ${isRefreshing ? "animate-spin" : ""}`}
            style={{
              transform: isRefreshing
                ? undefined
                : `rotate(${Math.min((pullDistance / PULL_THRESHOLD) * 180, 180)}deg)`,
              opacity: Math.min(pullDistance / PULL_THRESHOLD, 1),
            }}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            {isRefreshing ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            )}
          </svg>
        </div>
      )}

      <WatchlistHeader
        allGroups={allGroups}
        selectedGroupIds={filters.selectedGroupIds}
        onToggleGroup={filters.toggleGroupId}
        onOpenModal={() => setModalOpen(true)}
      />

      {stocks.length > 0 && (
        <FilterPanel
          searchQuery={filters.searchQuery}
          onSearchChange={filters.setSearchQuery}
          allSegments={filters.allSegments}
          selectedSegments={filters.selectedSegments}
          onToggleSegment={filters.toggleSegment}
          selectedCapSizes={filters.selectedCapSizes}
          onToggleCapSize={filters.toggleCapSize}
          ncRatioMin={filters.ncRatioMin}
          onNcRatioMinChange={filters.setNcRatioMin}
          ncRatioMax={filters.ncRatioMax}
          onNcRatioMaxChange={filters.setNcRatioMax}
          sharpeMin={filters.sharpeMin}
          onSharpeMinChange={filters.setSharpeMin}
          increaseMin={filters.increaseMin}
          onIncreaseMinChange={filters.setIncreaseMin}
          roeMin={filters.roeMin}
          onRoeMinChange={filters.setRoeMin}
          roeMax={filters.roeMax}
          onRoeMaxChange={filters.setRoeMax}
          onClearNumericFilters={() => {
            filters.setNcRatioMin("");
            filters.setNcRatioMax("");
            filters.setSharpeMin("");
            filters.setIncreaseMin("");
            filters.setRoeMin("");
            filters.setRoeMax("");
          }}
          hasNumericFilter={hasNumericFilter}
          batchStatsLoading={batchStatsLoading}
          filterPresets={filters.filterPresets}
          activePresetName={filters.activePresetName}
          onApplyPreset={filters.handleApplyPreset}
          onDeletePreset={filters.handleDeletePreset}
          stocks={stocks}
          signals={signals}
          signalScannedCount={signalScanner.signalScannedCount}
          signalLastScannedAt={signalScanner.signalLastScannedAt}
          signalScanning={signalScanner.signalScanning}
          signalScanProgress={signalScanner.signalScanProgress}
          onSignalScan={signalScanner.handleSignalScan}
          onSignalScanAbort={signalScanner.handleSignalScanAbort}
          allActiveStrategies={filters.allActiveStrategies}
          selectedStrategies={filters.selectedStrategies}
          onToggleStrategy={filters.toggleStrategy}
          signalFilterMode={filters.signalFilterMode}
          onToggleSignalFilterMode={() =>
            filters.setSignalFilterMode((m) => (m === "or" ? "and" : "or"))
          }
          signalPeriodFilter={filters.signalPeriodFilter}
          onSignalPeriodChange={filters.setSignalPeriodFilter}
          selectedDecision={filters.selectedDecision}
          onDecisionChange={filters.setSelectedDecision}
          selectedJudgment={filters.selectedJudgment}
          onJudgmentChange={filters.setSelectedJudgment}
          newHighsMap={newHighsMap}
          newHighsScannedAt={newHighsScannedAt}
          scanning={scanning}
          onScan={handleScan}
          breakoutFilter={filters.breakoutFilter}
          onBreakoutFilterChange={filters.setBreakoutFilter}
          consolidationFilter={filters.consolidationFilter}
          onConsolidationFilterChange={filters.setConsolidationFilter}
          allSectors={filters.allSectors}
          selectedSectors={filters.selectedSectors}
          onToggleSector={filters.toggleSector}
          hasAnyFilter={filters.hasAnyFilter}
          filteredCount={filters.filteredStocks.length}
          totalCount={stocks.length}
          onClearFilters={filters.clearAllFilters}
          onSavePreset={filters.handleSavePreset}
        />
      )}

      <BatchActionBar
        filteredSignalStockCount={batch.filteredSignalStockCount}
        filteredSignalCount={batch.filteredSignalCount}
        batchAnalysis={batch.batchAnalysis}
        onBatchAnalysisChange={batch.setBatchAnalysis}
        batchSlack={batch.batchSlack}
        onBatchSlackChange={batch.setBatchSlack}
        batchRunning={batch.batchRunning}
        batchProgress={batch.batchProgress}
        onExecute={batch.handleBatchExecute}
      />

      <StockGrid
        displayedStocks={filters.displayedStocks}
        sortedStocks={filters.sortedStocks}
        quotes={quotes}
        stats={stats}
        signals={signals}
        signalPeriodFilter={filters.signalPeriodFilter}
        hasAnyFilter={filters.hasAnyFilter}
        hasMore={filters.hasMore}
        displayCount={PAGE_SIZE}
        onLoadMore={filters.loadMore}
        onDeleteStock={handleDeleteStock}
        onEditGroups={handleEditGroups}
        onCardVisible={handleCardVisible}
        onOpenModal={() => setModalOpen(true)}
      />

      <AddStockModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onAdd={handleAddStock}
      />

      {groupPopup && (
        <GroupAssignPopup
          symbol={groupPopup.symbol}
          currentGroupIds={stocks.find((s) => s.symbol === groupPopup.symbol)?.groups?.map((g) => g.id) ?? []}
          allGroups={allGroups}
          anchor={groupPopup.anchor}
          onToggleGroup={(groupId, checked) => {
            const stock = stocks.find((s) => s.symbol === groupPopup.symbol);
            const currentIds = stock?.groups?.map((g) => g.id) ?? [];
            const newIds = checked
              ? [...currentIds, groupId]
              : currentIds.filter((id) => id !== groupId);
            handleSaveGroups(groupPopup.symbol, newIds);
          }}
          onCreateGroup={handleCreateGroup}
          onClose={() => setGroupPopup(null)}
        />
      )}
    </div>
  );
}

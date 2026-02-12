import { useState, useCallback, useMemo } from "react";
import type { Stock } from "@/types";
import type { SignalSummary, ActiveSignalInfo } from "@/types/watchlist";
import { WL_EXCLUDE_STRATEGIES } from "@/types/watchlist";

interface UseBatchActionsOptions {
  filteredStocks: Stock[];
  signals: Record<string, SignalSummary>;
  selectedStrategies: Set<string>;
  signalPeriodFilter: string;
  onSignalsUpdate: (
    updater: (prev: Record<string, SignalSummary>) => Record<string, SignalSummary>
  ) => void;
}

export function useBatchActions({
  filteredStocks,
  signals,
  selectedStrategies,
  signalPeriodFilter,
  onSignalsUpdate,
}: UseBatchActionsOptions) {
  const [batchAnalysis, setBatchAnalysis] = useState(true);
  const [batchSlack, setBatchSlack] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{
    current: number;
    total: number;
    currentName: string;
  } | null>(null);

  // 戦略・期間フィルタに基づいてシグナルを絞り込む
  const getFilteredSignals = useCallback(
    (
      sig: SignalSummary | undefined
    ): { signal: ActiveSignalInfo; timeframe: "daily" | "weekly" }[] => {
      if (!sig) return [];
      const periodDays: Record<string, number> = { "1w": 7, "1m": 31, "3m": 93, "6m": 183 };
      const cutoffStr =
        signalPeriodFilter !== "all"
          ? (() => {
              const d = new Date();
              d.setDate(d.getDate() - (periodDays[signalPeriodFilter] ?? 0));
              return d.toISOString().slice(0, 10);
            })()
          : null;

      const result: { signal: ActiveSignalInfo; timeframe: "daily" | "weekly" }[] = [];
      const seen = new Set<string>();

      // 1. アクティブシグナル（保有中）を優先
      for (const a of sig.activeSignals?.daily ?? []) {
        if (WL_EXCLUDE_STRATEGIES.has(a.strategyId)) continue;
        if (selectedStrategies.size > 0 && !selectedStrategies.has(a.strategyId)) continue;
        if (cutoffStr && a.buyDate < cutoffStr) continue;
        result.push({ signal: a, timeframe: "daily" });
        seen.add(a.strategyId);
      }

      // 2. 直近シグナル（activeにない戦略のみ追加）
      for (const r of sig.recentSignals?.daily ?? []) {
        if (WL_EXCLUDE_STRATEGIES.has(r.strategyId)) continue;
        if (seen.has(r.strategyId)) continue;
        if (selectedStrategies.size > 0 && !selectedStrategies.has(r.strategyId)) continue;
        if (cutoffStr && r.date < cutoffStr) continue;
        result.push({
          signal: {
            strategyId: r.strategyId,
            strategyName: r.strategyName,
            buyDate: r.date,
            buyPrice: r.price,
            currentPrice: r.price,
            pnlPct: 0,
          },
          timeframe: "daily",
        });
        seen.add(r.strategyId);
      }

      return result;
    },
    [selectedStrategies, signalPeriodFilter]
  );

  // フィルタ中銘柄のシグナル数・銘柄数を計算（メモ化）
  const { filteredSignalCount, filteredSignalStockCount } = useMemo(() => {
    return filteredStocks.reduce(
      (acc, stock) => {
        const count = getFilteredSignals(signals[stock.symbol]).length;
        if (count > 0) {
          acc.filteredSignalCount += count;
          acc.filteredSignalStockCount += 1;
        }
        return acc;
      },
      { filteredSignalCount: 0, filteredSignalStockCount: 0 }
    );
  }, [filteredStocks, signals, getFilteredSignals]);

  const handleBatchExecute = useCallback(async () => {
    if (!batchAnalysis && !batchSlack) return;
    if (batchRunning) return;

    type SignalTarget = {
      symbol: string;
      stockName: string;
      sectors?: string[];
      signal: ActiveSignalInfo;
      timeframe: "daily" | "weekly";
    };
    const targets: SignalTarget[] = [];
    for (const stock of filteredStocks) {
      for (const { signal, timeframe } of getFilteredSignals(signals[stock.symbol])) {
        targets.push({
          symbol: stock.symbol,
          stockName: stock.name,
          sectors: stock.sectors,
          signal,
          timeframe,
        });
      }
    }

    if (targets.length === 0) return;

    setBatchRunning(true);
    setBatchProgress(null);
    let errors = 0;

    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      const tfLabel = t.timeframe === "daily" ? "日足" : "週足";
      setBatchProgress({
        current: i + 1,
        total: targets.length,
        currentName: `${t.stockName} (${t.signal.strategyName} ${tfLabel})`,
      });

      let validationResult:
        | {
            decision: string;
            summary: string;
            signalEvaluation: string;
            riskFactor: string;
            catalyst: string;
          }
        | undefined;

      if (batchAnalysis) {
        try {
          const isActive =
            t.signal.currentPrice !== t.signal.buyPrice || t.signal.pnlPct !== 0;
          const signalDesc = isActive
            ? `${t.signal.strategyName} (${tfLabel}): ${t.signal.buyDate}にエントリー (買値:${t.signal.buyPrice}円, 現在値:${t.signal.currentPrice}円, 損益:${t.signal.pnlPct > 0 ? "+" : ""}${t.signal.pnlPct.toFixed(1)}%)`
            : `${t.signal.strategyName} (${tfLabel}): ${t.signal.buyDate}にシグナル検出 (価格:${t.signal.buyPrice}円)`;
          const strategyId = `${t.signal.strategyId}_${t.timeframe}_${t.signal.buyDate}`;

          const params = new URLSearchParams({
            symbol: t.symbol,
            signalDesc,
            signalStrategy: t.signal.strategyName,
            signalStrategyId: strategyId,
            step: "validation",
          });

          const res = await fetch(`/api/fundamental?${params}`);
          if (res.ok) {
            const data = await res.json();
            validationResult = data.validation;
            onSignalsUpdate((prev) => ({
              ...prev,
              [t.symbol]: {
                ...prev[t.symbol],
                validations: {
                  ...prev[t.symbol]?.validations,
                  [strategyId]: data.validation,
                },
              },
            }));
          } else {
            errors++;
          }
        } catch {
          errors++;
        }
      }

      if (batchSlack) {
        try {
          await fetch("/api/slack/notify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              symbol: t.symbol,
              symbolName: t.stockName,
              sectors: t.sectors,
              strategyId: t.signal.strategyId,
              strategyName: t.signal.strategyName,
              timeframe: t.timeframe,
              signalDate: t.signal.buyDate,
              currentPrice: t.signal.currentPrice,
              takeProfitPrice: t.signal.takeProfitPrice,
              takeProfitLabel: t.signal.takeProfitLabel,
              stopLossPrice: t.signal.stopLossPrice,
              stopLossLabel: t.signal.stopLossLabel,
              validation: validationResult,
            }),
          });
        } catch {
          errors++;
        }
      }
    }

    setBatchRunning(false);
    setBatchProgress(null);
    if (errors > 0) {
      console.error(`Batch: ${errors}件のエラーが発生`);
    }
  }, [
    batchAnalysis,
    batchSlack,
    batchRunning,
    filteredStocks,
    signals,
    getFilteredSignals,
    onSignalsUpdate,
  ]);

  return {
    batchAnalysis,
    setBatchAnalysis,
    batchSlack,
    setBatchSlack,
    batchRunning,
    batchProgress,
    filteredSignalCount,
    filteredSignalStockCount,
    handleBatchExecute,
    getFilteredSignals,
  };
}

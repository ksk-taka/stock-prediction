import { useState, useRef, useCallback } from "react";
import type { SignalSummary } from "@/types/watchlist";

interface UseSignalScannerOptions {
  onSignalsUpdate: (
    updater: (prev: Record<string, SignalSummary>) => Record<string, SignalSummary>
  ) => void;
  signalsFetchedRef: React.MutableRefObject<Set<string>>;
  signalScannedCount: number;
  signalLastScannedAt: string | null;
  setSignalScannedCount: React.Dispatch<React.SetStateAction<number>>;
  setSignalLastScannedAt: React.Dispatch<React.SetStateAction<string | null>>;
}

export function useSignalScanner({
  onSignalsUpdate,
  signalsFetchedRef,
  signalScannedCount,
  signalLastScannedAt,
  setSignalScannedCount,
  setSignalLastScannedAt,
}: UseSignalScannerOptions) {
  const [signalScanning, setSignalScanning] = useState(false);
  const [signalScanProgress, setSignalScanProgress] = useState<{
    scanned: number;
    total: number;
  } | null>(null);
  const signalScanAbortRef = useRef<AbortController | null>(null);

  const handleSignalScan = useCallback(async () => {
    if (signalScanning) return;
    setSignalScanning(true);
    setSignalScanProgress(null);

    const abort = new AbortController();
    signalScanAbortRef.current = abort;

    try {
      const res = await fetch("/api/signals/scan", {
        method: "POST",
        signal: abort.signal,
      });
      if (!res.ok) throw new Error("Scan request failed");

      const data = await res.json();

      if (data.scanId) {
        // Vercel: GHA triggered -> poll scan status until completion
        const POLL_INTERVAL = 10_000;
        const POLL_TIMEOUT = 70 * 60 * 1000;

        await new Promise<void>((resolve, reject) => {
          let intervalId: ReturnType<typeof setInterval>;

          const timeoutId = setTimeout(() => {
            clearInterval(intervalId);
            reject(new Error("スキャンがタイムアウトしました"));
          }, POLL_TIMEOUT);

          const cleanup = () => {
            clearInterval(intervalId);
            clearTimeout(timeoutId);
          };

          const onAbort = () => {
            cleanup();
            reject(new DOMException("Aborted", "AbortError"));
          };
          abort.signal.addEventListener("abort", onAbort, { once: true });

          intervalId = setInterval(async () => {
            try {
              const statusRes = await fetch(
                `/api/signals/scan/status?scanId=${data.scanId}`
              );
              if (!statusRes.ok) return;
              const scan = await statusRes.json();

              const current = scan.progress?.current ?? scan.processed_stocks ?? 0;
              const total = scan.progress?.total ?? scan.total_stocks ?? 0;
              if (total > 0) {
                setSignalScanProgress({ scanned: current, total });
              }

              if (scan.status === "completed") {
                cleanup();
                abort.signal.removeEventListener("abort", onAbort);
                setSignalLastScannedAt(scan.completed_at ?? new Date().toISOString());
                resolve();
              } else if (scan.status === "failed") {
                cleanup();
                abort.signal.removeEventListener("abort", onAbort);
                reject(new Error(scan.error_message ?? "スキャンが失敗しました"));
              }
            } catch {
              // network error, keep polling
            }
          }, POLL_INTERVAL);
        });
      }

      // 完了後にシグナルデータを再読み込み
      const sigUrl = data?.scanId
        ? `/api/signals/detected?scanId=${data.scanId}`
        : "/api/signals/index";
      const sigRes = await fetch(sigUrl);
      if (sigRes.ok) {
        const sigData = await sigRes.json();

        if (sigData.signals && Array.isArray(sigData.signals)) {
          // Supabase detected_signals -> SignalSummary 変換
          const merged: Record<string, SignalSummary> = {};
          for (const sig of sigData.signals as Array<{
            symbol: string;
            strategy_id: string;
            strategy_name: string;
            timeframe: string;
            signal_date: string;
            buy_price: number;
            current_price: number;
            exit_levels?: {
              takeProfitPrice?: number;
              takeProfitLabel?: string;
              stopLossPrice?: number;
              stopLossLabel?: string;
            };
          }>) {
            if (!merged[sig.symbol]) {
              merged[sig.symbol] = {
                activeSignals: { daily: [], weekly: [] },
                recentSignals: { daily: [], weekly: [] },
              };
            }
            const tf = sig.timeframe as "daily" | "weekly";
            const pnl =
              sig.buy_price > 0
                ? ((sig.current_price - sig.buy_price) / sig.buy_price) * 100
                : 0;
            merged[sig.symbol].activeSignals![tf].push({
              strategyId: sig.strategy_id,
              strategyName: sig.strategy_name,
              buyDate: sig.signal_date,
              buyPrice: sig.buy_price,
              currentPrice: sig.current_price,
              pnlPct: pnl,
              takeProfitPrice: sig.exit_levels?.takeProfitPrice,
              takeProfitLabel: sig.exit_levels?.takeProfitLabel,
              stopLossPrice: sig.exit_levels?.stopLossPrice,
              stopLossLabel: sig.exit_levels?.stopLossLabel,
            });
            merged[sig.symbol].recentSignals![tf].push({
              strategyId: sig.strategy_id,
              strategyName: sig.strategy_name,
              date: sig.signal_date,
              price: sig.buy_price,
            });
            signalsFetchedRef.current.add(sig.symbol);
          }
          onSignalsUpdate((prev) => ({ ...prev, ...merged }));
          setSignalScannedCount(sigData.scan?.total_stocks ?? Object.keys(merged).length);
          setSignalLastScannedAt(sigData.scan?.completed_at ?? new Date().toISOString());
        } else if (sigData.signals && !Array.isArray(sigData.signals)) {
          // ローカルファイルキャッシュ形式 (signals/index)
          const merged: Record<string, SignalSummary> = {};
          for (const [symbol, value] of Object.entries(sigData.signals)) {
            merged[symbol] = value as SignalSummary;
            signalsFetchedRef.current.add(symbol);
          }
          onSignalsUpdate((prev) => ({ ...prev, ...merged }));
          setSignalScannedCount(sigData.scannedCount ?? 0);
          setSignalLastScannedAt(sigData.lastScannedAt ?? null);
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        console.error("Signal scan error:", e);
      }
    } finally {
      setSignalScanning(false);
      setSignalScanProgress(null);
      signalScanAbortRef.current = null;
    }
  }, [signalScanning, onSignalsUpdate, signalsFetchedRef, setSignalScannedCount, setSignalLastScannedAt]);

  const handleSignalScanAbort = useCallback(() => {
    signalScanAbortRef.current?.abort();
  }, []);

  return {
    signalScanning,
    signalScanProgress,
    signalScannedCount,
    signalLastScannedAt,
    handleSignalScan,
    handleSignalScanAbort,
  };
}

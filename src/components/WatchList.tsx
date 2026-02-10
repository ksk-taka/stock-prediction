"use client";

import { useState, useEffect, useCallback, useRef, type TouchEvent as ReactTouchEvent } from "react";
import StockCard from "./StockCard";
import AddStockModal from "./AddStockModal";
import { isJPMarketOpen, isUSMarketOpen } from "@/lib/utils/date";
import type { Stock, SignalValidation } from "@/types";

interface StockQuote {
  symbol: string;
  price: number;
  changePercent: number;
}

interface StockStats {
  per: number | null;
  pbr: number | null;
  roe: number | null;
  eps: number | null;
}

export interface ActiveSignalInfo {
  strategyId: string;
  strategyName: string;
  buyDate: string;
  buyPrice: number;
  currentPrice: number;
  pnlPct: number;
  takeProfitPrice?: number;
  takeProfitLabel?: string;
  stopLossPrice?: number;
  stopLossLabel?: string;
}

export interface RecentSignalInfo {
  strategyId: string;
  strategyName: string;
  date: string;
  price: number;
}

export interface SignalSummary {
  activeSignals?: {
    daily: ActiveSignalInfo[];
    weekly: ActiveSignalInfo[];
  };
  recentSignals?: {
    daily: RecentSignalInfo[];
    weekly: RecentSignalInfo[];
  };
  validations?: Record<string, SignalValidation>;
}

interface NewHighInfo {
  isTrue52wBreakout: boolean;
  consolidationDays: number;
  consolidationRangePct: number;
  pctAbove52wHigh: number;
}

interface FilterPreset {
  name: string;
  sectors: string[];
  strategies: string[];
  segments: string[];
  signalFilterMode?: "or" | "and";
  signalPeriodFilter?: string;
  decision: string | null;
  judgment: string | null;
}

const PRESETS_KEY = "watchlist-filter-presets";
const PAGE_SIZE = 50;

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

export default function WatchList() {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [quotes, setQuotes] = useState<Record<string, StockQuote>>({});
  const [stats, setStats] = useState<Record<string, StockStats>>({});
  const [signals, setSignals] = useState<Record<string, SignalSummary>>({});
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  // フィルター
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSectors, setSelectedSectors] = useState<Set<string>>(new Set());
  const [selectedStrategies, setSelectedStrategies] = useState<Set<string>>(new Set());
  const [selectedSegments, setSelectedSegments] = useState<Set<string>>(new Set());
  const [signalFilterMode, setSignalFilterMode] = useState<"or" | "and">("or");
  const [selectedDecision, setSelectedDecision] = useState<string | null>(null);
  const [selectedJudgment, setSelectedJudgment] = useState<string | null>(null);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [breakoutFilter, setBreakoutFilter] = useState(false);
  const [consolidationFilter, setConsolidationFilter] = useState(false);
  const [newHighsMap, setNewHighsMap] = useState<Record<string, NewHighInfo>>({});
  const [newHighsScannedAt, setNewHighsScannedAt] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [filterPresets, setFilterPresets] = useState<FilterPreset[]>([]);
  const [activePresetName, setActivePresetName] = useState<string | null>(null);
  const [signalPeriodFilter, setSignalPeriodFilter] = useState("all");

  // 表示件数制御
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);

  // 可視カード追跡（自動更新用）
  const visibleSymbolsRef = useRef<Set<string>>(new Set());
  // データ取得済みシンボル追跡（price/stats/validation）
  const fetchedSymbolsRef = useRef<Set<string>>(new Set());
  // シグナルデータ取得済み追跡（インデックスから読み込み or API取得）
  const signalsFetchedRef = useRef<Set<string>>(new Set());
  // スキャン済み件数
  const [signalScannedCount, setSignalScannedCount] = useState(0);
  const [signalLastScannedAt, setSignalLastScannedAt] = useState<string | null>(null);
  // 全銘柄シグナルスキャン
  const [signalScanning, setSignalScanning] = useState(false);
  const [signalScanProgress, setSignalScanProgress] = useState<{ scanned: number; total: number } | null>(null);
  const signalScanAbortRef = useRef<AbortController | null>(null);

  // バッチアクション
  const [batchAnalysis, setBatchAnalysis] = useState(true);
  const [batchSlack, setBatchSlack] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number; currentName: string } | null>(null);

  // Pull-to-refresh
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const touchStartY = useRef(0);
  const isPulling = useRef(false);
  const PULL_THRESHOLD = 60;

  useEffect(() => {
    setFilterPresets(loadPresets());
  }, []);

  // フィルタ変更時に表示件数をリセット
  useEffect(() => {
    setDisplayCount(PAGE_SIZE);
  }, [searchQuery, selectedSectors, selectedStrategies, selectedSegments, signalFilterMode, signalPeriodFilter, selectedDecision, selectedJudgment, showFavoritesOnly, breakoutFilter, consolidationFilter]);

  const fetchWatchlist = useCallback(async () => {
    try {
      const res = await fetch("/api/watchlist");
      const data = await res.json();
      setStocks(data.stocks ?? []);
    } catch {
      console.error("Failed to fetch watchlist");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWatchlist();
  }, [fetchWatchlist]);

  // Pull-to-refresh handlers (fetchWatchlist の後に定義)
  const onTouchStart = useCallback((e: ReactTouchEvent) => {
    if (window.scrollY === 0 && !isRefreshing) {
      touchStartY.current = e.touches[0].clientY;
      isPulling.current = true;
    }
  }, [isRefreshing]);

  const onTouchMove = useCallback((e: ReactTouchEvent) => {
    if (!isPulling.current) return;
    const delta = e.touches[0].clientY - touchStartY.current;
    if (delta > 0) {
      setPullDistance(Math.min(delta * 0.4, 100));
    } else {
      isPulling.current = false;
      setPullDistance(0);
    }
  }, []);

  const onTouchEnd = useCallback(async () => {
    if (!isPulling.current) return;
    isPulling.current = false;
    if (pullDistance >= PULL_THRESHOLD) {
      setIsRefreshing(true);
      setPullDistance(PULL_THRESHOLD);
      try {
        await fetchWatchlist();
      } finally {
        setIsRefreshing(false);
        setPullDistance(0);
      }
    } else {
      setPullDistance(0);
    }
  }, [pullDistance, fetchWatchlist]);

  // 新高値スキャンデータを読み込み（フィルタ用）
  const loadNewHighs = useCallback(async () => {
    try {
      const res = await fetch("/api/new-highs");
      if (!res.ok) return;
      const data = await res.json();
      const map: Record<string, NewHighInfo> = {};
      for (const s of data.stocks ?? []) {
        map[s.symbol] = {
          isTrue52wBreakout: s.isTrue52wBreakout,
          consolidationDays: s.consolidationDays ?? 0,
          consolidationRangePct: s.consolidationRangePct ?? 0,
          pctAbove52wHigh: s.pctAbove52wHigh ?? 0,
        };
      }
      setNewHighsMap(map);
      setNewHighsScannedAt(data.scannedAt ?? null);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadNewHighs();
  }, [loadNewHighs]);

  const handleScan = async () => {
    setScanning(true);
    try {
      const res = await fetch("/api/new-highs/scan", { method: "POST" });
      if (res.ok) {
        await loadNewHighs();
      }
    } catch {
      // ignore
    } finally {
      setScanning(false);
    }
  };

  // キャッシュ済みシグナル＋バリデーションインデックスを一括読み込み（起動時）
  useEffect(() => {
    if (stocks.length === 0) return;
    const loadIndices = async () => {
      try {
        const [sigRes, valRes] = await Promise.all([
          fetch("/api/signals/index"),
          fetch("/api/fundamental/validations-index"),
        ]);

        const merged: Record<string, SignalSummary> = {};
        let fileScannedCount = 0;

        // シグナルインデックス（ローカルファイルキャッシュ）
        if (sigRes.ok) {
          const sigData = await sigRes.json();
          if (sigData.signals && sigData.scannedCount > 0) {
            for (const [symbol, value] of Object.entries(sigData.signals)) {
              merged[symbol] = value as SignalSummary;
              signalsFetchedRef.current.add(symbol);
            }
            fileScannedCount = sigData.scannedCount ?? 0;
            setSignalScannedCount(fileScannedCount);
            setSignalLastScannedAt(sigData.lastScannedAt ?? null);
          }
        }

        // Supabase から最新スキャン結果を補完
        // ファイルキャッシュが全銘柄をカバーしていない場合、Supabaseで不足分を補う
        if (fileScannedCount < stocks.length * 0.9) {
          try {
            const detRes = await fetch("/api/signals/detected");
            if (detRes.ok) {
              const detData = await detRes.json();
              const detSignals = detData.signals ?? [];
              if (detSignals.length > 0) {
                for (const sig of detSignals as Array<{
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
                  // ファイルキャッシュに既にある銘柄はスキップ（より新しいデータ）
                  if (signalsFetchedRef.current.has(sig.symbol)) continue;

                  if (!merged[sig.symbol]) {
                    merged[sig.symbol] = {
                      activeSignals: { daily: [], weekly: [] },
                      recentSignals: { daily: [], weekly: [] },
                    };
                  }
                  const tf = sig.timeframe as "daily" | "weekly";
                  const pnl = sig.buy_price > 0
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
                // Supabase のスキャン情報がより包括的なら更新
                const supabaseTotal = detData.scan?.total_stocks ?? 0;
                if (supabaseTotal > fileScannedCount) {
                  setSignalScannedCount(supabaseTotal);
                  setSignalLastScannedAt(detData.scan?.completed_at ?? null);
                }
              }
            }
          } catch {
            // ignore Supabase fallback errors
          }
        }

        // 両ソース読み込み後、全銘柄をfetched扱い（遅延ロードで再取得させない）
        for (const stock of stocks) {
          signalsFetchedRef.current.add(stock.symbol);
        }

        // バリデーションインデックス
        if (valRes.ok) {
          const valData = await valRes.json();
          if (valData.validations) {
            for (const [symbol, vals] of Object.entries(valData.validations)) {
              if (!merged[symbol]) merged[symbol] = {};
              merged[symbol] = {
                ...merged[symbol],
                validations: vals as Record<string, SignalValidation>,
              };
            }
          }
        }

        setSignals((prev) => ({ ...prev, ...merged }));
      } catch {
        // ignore
      }
    };
    loadIndices();
  }, [stocks]);

  // 全銘柄シグナルスキャン
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
        // Vercel: GHA triggered → poll scan status until completion
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
                `/api/signals/scan/status?scanId=${data.scanId}`,
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
          // Supabase detected_signals → SignalSummary 変換
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
            const pnl = sig.buy_price > 0
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
          setSignals((prev) => ({ ...prev, ...merged }));
          setSignalScannedCount(sigData.scan?.total_stocks ?? Object.keys(merged).length);
          setSignalLastScannedAt(sigData.scan?.completed_at ?? new Date().toISOString());
        } else if (sigData.signals && !Array.isArray(sigData.signals)) {
          // ローカルファイルキャッシュ形式 (signals/index)
          const merged: Record<string, SignalSummary> = {};
          for (const [symbol, value] of Object.entries(sigData.signals)) {
            merged[symbol] = value as SignalSummary;
            signalsFetchedRef.current.add(symbol);
          }
          setSignals((prev) => ({ ...prev, ...merged }));
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
  }, [signalScanning]);

  const handleSignalScanAbort = useCallback(() => {
    signalScanAbortRef.current?.abort();
  }, []);

  // 個別銘柄データ取得（遅延ロード用）
  const fetchDataForSymbol = useCallback(async (symbol: string) => {
    if (fetchedSymbolsRef.current.has(symbol)) return;
    fetchedSymbolsRef.current.add(symbol);

    // シグナルがインデックスから読み込み済みなら、price/stats/validationのみ取得
    const needsSignals = !signalsFetchedRef.current.has(symbol);

    const fetches: Promise<Response>[] = [
      fetch(`/api/price?symbol=${encodeURIComponent(symbol)}&period=daily`),
      fetch(`/api/stats?symbol=${encodeURIComponent(symbol)}`),
    ];
    if (needsSignals) {
      fetches.push(fetch(`/api/signals?symbol=${encodeURIComponent(symbol)}`));
    }
    fetches.push(fetch(`/api/fundamental?symbol=${encodeURIComponent(symbol)}&step=validations`));

    const results = await Promise.allSettled(fetches);
    let idx = 0;

    // price
    const priceRes = results[idx++];
    if (priceRes.status === "fulfilled" && priceRes.value.ok) {
      const data = await priceRes.value.json();
      if (data.quote) {
        setQuotes((prev) => ({
          ...prev,
          [symbol]: {
            symbol,
            price: data.quote.price,
            changePercent: data.quote.changePercent,
          },
        }));
      }
    }

    // stats
    const statsRes = results[idx++];
    if (statsRes.status === "fulfilled" && statsRes.value.ok) {
      const data = await statsRes.value.json();
      setStats((prev) => ({
        ...prev,
        [symbol]: {
          per: data.per ?? null,
          pbr: data.pbr ?? null,
          roe: data.roe ?? null,
          eps: data.eps ?? null,
        },
      }));
    }

    // signals (only if not from index)
    if (needsSignals) {
      const sigRes = results[idx++];
      if (sigRes.status === "fulfilled" && sigRes.value.ok) {
        const data = await sigRes.value.json();
        setSignals((prev) => ({
          ...prev,
          [symbol]: {
            ...prev[symbol],
            activeSignals: data.activeSignals,
            recentSignals: data.recentSignals,
          },
        }));
        signalsFetchedRef.current.add(symbol);
      }
    }

    // validations
    const valRes = results[idx++];
    if (valRes.status === "fulfilled" && valRes.value.ok) {
      const data = await valRes.value.json();
      if (data.validations && Object.keys(data.validations).length > 0) {
        setSignals((prev) => ({
          ...prev,
          [symbol]: {
            ...prev[symbol],
            validations: data.validations,
          },
        }));
      }
    }
  }, []);

  // カード可視状態管理
  const handleCardVisible = useCallback(
    (symbol: string, isVisible: boolean) => {
      if (isVisible) {
        visibleSymbolsRef.current.add(symbol);
        fetchDataForSymbol(symbol);
      } else {
        visibleSymbolsRef.current.delete(symbol);
      }
    },
    [fetchDataForSymbol]
  );

  // 取引時間中の自動更新（30秒間隔、表示中カードのみ）
  useEffect(() => {
    if (stocks.length === 0) return;
    const tick = async () => {
      const anyMarketOpen = isJPMarketOpen() || isUSMarketOpen();
      if (!anyMarketOpen || visibleSymbolsRef.current.size === 0) return;

      const symbolsToUpdate = Array.from(visibleSymbolsRef.current);
      await Promise.allSettled(
        symbolsToUpdate.map(async (symbol) => {
          try {
            const res = await fetch(
              `/api/price?symbol=${encodeURIComponent(symbol)}&period=daily`
            );
            const data = await res.json();
            if (data.quote) {
              setQuotes((prev) => ({
                ...prev,
                [symbol]: {
                  symbol,
                  price: data.quote.price,
                  changePercent: data.quote.changePercent,
                },
              }));
            }
          } catch {
            // skip
          }
        })
      );
    };
    const interval = setInterval(tick, 30_000);
    return () => clearInterval(interval);
  }, [stocks]);

  const handleAddStock = (stock: Stock) => {
    setStocks((prev) => [...prev, stock]);
  };

  const handleDeleteStock = async (symbol: string) => {
    try {
      const res = await fetch("/api/watchlist", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol }),
      });
      if (res.ok) {
        setStocks((prev) => prev.filter((s) => s.symbol !== symbol));
      }
    } catch {
      console.error("Failed to delete stock");
    }
  };

  const handleToggleFavorite = async (symbol: string) => {
    // 即座にUI更新（楽観的更新）
    setStocks((prev) => prev.map((s) => s.symbol === symbol ? { ...s, favorite: !s.favorite } : s));
    try {
      await fetch("/api/watchlist", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol }),
      });
    } catch {
      // ロールバック
      setStocks((prev) => prev.map((s) => s.symbol === symbol ? { ...s, favorite: !s.favorite } : s));
    }
  };

  // セクター一覧を抽出
  const allSectors = Array.from(
    new Set(stocks.flatMap((s) => s.sectors ?? []))
  ).sort();

  // 市場区分一覧
  const allSegments: ("プライム" | "スタンダード" | "グロース")[] = ["プライム", "スタンダード", "グロース"];

  // シグナル検出済み戦略一覧を抽出（保有中 + 直近シグナル）
  const allActiveStrategies = Array.from(
    new Map(
      Object.values(signals)
        .flatMap((s) => [
          ...(s.activeSignals?.daily ?? []),
          ...(s.activeSignals?.weekly ?? []),
          ...(s.recentSignals?.daily ?? []),
          ...(s.recentSignals?.weekly ?? []),
        ])
        .map((a) => [a.strategyId, a.strategyName] as const)
    )
  );

  // フィルタ適用
  const filteredStocks = stocks.filter((stock) => {
    // お気に入りフィルタ
    if (showFavoritesOnly && !stock.favorite) return false;
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
    // セクターフィルタ
    if (selectedSectors.size > 0) {
      const match = stock.sectors?.some((s) => selectedSectors.has(s));
      if (!match) return false;
    }
    // シグナル（戦略 × 期間）フィルタ - 保有中 + 直近シグナル
    if (selectedStrategies.size > 0 || signalPeriodFilter !== "all") {
      const sig = signals[stock.symbol];
      // 保有中 + 直近シグナルを統合（date フィールドを buyDate に正規化）
      const allSignals = [
        ...(sig?.activeSignals?.daily ?? []).map((a) => ({ strategyId: a.strategyId, date: a.buyDate })),
        ...(sig?.activeSignals?.weekly ?? []).map((a) => ({ strategyId: a.strategyId, date: a.buyDate })),
        ...(sig?.recentSignals?.daily ?? []).map((r) => ({ strategyId: r.strategyId, date: r.date })),
        ...(sig?.recentSignals?.weekly ?? []).map((r) => ({ strategyId: r.strategyId, date: r.date })),
      ];
      if (allSignals.length === 0) return false;
      const periodDays: Record<string, number> = { "1w": 7, "1m": 31, "3m": 93, "6m": 183 };
      const cutoffStr = signalPeriodFilter !== "all"
        ? (() => { const d = new Date(); d.setDate(d.getDate() - (periodDays[signalPeriodFilter] ?? 0)); return d.toISOString().slice(0, 10); })()
        : null;

      if (signalFilterMode === "and" && selectedStrategies.size > 0) {
        // AND: 選択した全戦略がシグナルに存在する
        const stratIds = new Set(
          allSignals
            .filter((a) => !cutoffStr || a.date >= cutoffStr)
            .map((a) => a.strategyId)
        );
        for (const stratId of selectedStrategies) {
          if (!stratIds.has(stratId)) return false;
        }
      } else {
        // OR: いずれかの戦略がマッチ
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
    return true;
  });

  // 戦略・期間フィルタに基づいてアクティブシグナルを絞り込む
  const getFilteredSignals = useCallback((sig: SignalSummary | undefined): { signal: ActiveSignalInfo; timeframe: "daily" | "weekly" }[] => {
    if (!sig?.activeSignals) return [];
    const all: { signal: ActiveSignalInfo; timeframe: "daily" | "weekly" }[] = [
      ...(sig.activeSignals.daily ?? []).map((a) => ({ signal: a, timeframe: "daily" as const })),
    ];
    const periodDays: Record<string, number> = { "1w": 7, "1m": 31, "3m": 93, "6m": 183 };
    const cutoffStr = signalPeriodFilter !== "all"
      ? (() => { const d = new Date(); d.setDate(d.getDate() - (periodDays[signalPeriodFilter] ?? 0)); return d.toISOString().slice(0, 10); })()
      : null;
    return all.filter(({ signal }) => {
      if (selectedStrategies.size > 0 && !selectedStrategies.has(signal.strategyId)) return false;
      if (cutoffStr && signal.buyDate < cutoffStr) return false;
      return true;
    });
  }, [selectedStrategies, signalPeriodFilter]);

  // フィルタ中銘柄のアクティブシグナル数・銘柄数を計算（戦略・期間フィルタ適用）
  const { filteredActiveSignalCount, filteredActiveStockCount } = filteredStocks.reduce(
    (acc, stock) => {
      const count = getFilteredSignals(signals[stock.symbol]).length;
      if (count > 0) {
        acc.filteredActiveSignalCount += count;
        acc.filteredActiveStockCount += 1;
      }
      return acc;
    },
    { filteredActiveSignalCount: 0, filteredActiveStockCount: 0 },
  );

  // ── バッチアクション実行 ──
  const handleBatchExecute = useCallback(async () => {
    if (!batchAnalysis && !batchSlack) return;
    if (batchRunning) return;

    // フィルタ中の銘柄からアクティブシグナルを収集（戦略・期間フィルタ適用）
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
        targets.push({ symbol: stock.symbol, stockName: stock.name, sectors: stock.sectors, signal, timeframe });
      }
    }

    if (targets.length === 0) return;

    setBatchRunning(true);
    setBatchProgress(null);
    let errors = 0;

    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      const tfLabel = t.timeframe === "daily" ? "日足" : "週足";
      setBatchProgress({ current: i + 1, total: targets.length, currentName: `${t.stockName} (${t.signal.strategyName} ${tfLabel})` });

      // 分析（Go/NoGo判断）
      let validationResult: { decision: string; summary: string; signalEvaluation: string; riskFactor: string; catalyst: string } | undefined;
      if (batchAnalysis) {
        try {
          const pnlPct = t.signal.pnlPct.toFixed(1);
          const signalDesc = `${t.signal.strategyName} (${tfLabel}): ${t.signal.buyDate}にエントリー (買値:${t.signal.buyPrice}円, 現在値:${t.signal.currentPrice}円, 損益:${Number(pnlPct) > 0 ? "+" : ""}${pnlPct}%)`;
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
            // UIのvalidationsを更新
            setSignals((prev) => ({
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

      // Slack通知
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
  }, [batchAnalysis, batchSlack, batchRunning, filteredStocks, signals, getFilteredSignals]);

  // お気に入りを先頭にソート
  const sortedStocks = [...filteredStocks].sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0));

  // 表示する銘柄（Load More制御）
  const displayedStocks = sortedStocks.slice(0, displayCount);
  const hasMore = displayCount < sortedStocks.length;

  const toggleSector = (sector: string) => {
    setSelectedSectors((prev) => {
      const next = new Set(prev);
      if (next.has(sector)) next.delete(sector);
      else next.add(sector);
      return next;
    });
  };

  const toggleStrategy = (strategyId: string) => {
    setSelectedStrategies((prev) => {
      const next = new Set(prev);
      if (next.has(strategyId)) next.delete(strategyId);
      else next.add(strategyId);
      return next;
    });
  };

  const toggleSegment = (segment: string) => {
    setSelectedSegments((prev) => {
      const next = new Set(prev);
      if (next.has(segment)) next.delete(segment);
      else next.add(segment);
      return next;
    });
  };

  const hasAnyFilter = searchQuery !== "" || selectedSectors.size > 0 || selectedStrategies.size > 0 || selectedSegments.size > 0 || signalPeriodFilter !== "all" || selectedDecision !== null || selectedJudgment !== null || signalFilterMode !== "or" || showFavoritesOnly || breakoutFilter || consolidationFilter;

  const clearAllFilters = () => {
    setSearchQuery("");
    setSelectedSectors(new Set());
    setSelectedStrategies(new Set());
    setSelectedSegments(new Set());
    setSignalFilterMode("or");
    setSignalPeriodFilter("all");
    setSelectedDecision(null);
    setSelectedJudgment(null);
    setShowFavoritesOnly(false);
    setBreakoutFilter(false);
    setConsolidationFilter(false);
    setActivePresetName(null);
  };

  const handleSavePreset = () => {
    const name = prompt("フィルタ名を入力してください");
    if (!name?.trim()) return;
    const preset: FilterPreset = {
      name: name.trim(),
      sectors: Array.from(selectedSectors),
      strategies: Array.from(selectedStrategies),
      segments: Array.from(selectedSegments),
      signalFilterMode: signalFilterMode !== "or" ? signalFilterMode : undefined,
      signalPeriodFilter: signalPeriodFilter !== "all" ? signalPeriodFilter : undefined,
      decision: selectedDecision,
      judgment: selectedJudgment,
    };
    const next = [...filterPresets.filter((p) => p.name !== preset.name), preset];
    setFilterPresets(next);
    savePresets(next);
    setActivePresetName(preset.name);
  };

  const handleApplyPreset = (preset: FilterPreset) => {
    setSelectedSectors(new Set(preset.sectors));
    setSelectedStrategies(new Set(preset.strategies));
    setSelectedSegments(new Set(preset.segments ?? []));
    setSignalFilterMode(preset.signalFilterMode ?? "or");
    setSignalPeriodFilter(preset.signalPeriodFilter ?? "all");
    setSelectedDecision(preset.decision);
    setSelectedJudgment(preset.judgment);
    setActivePresetName(preset.name);
  };

  const handleDeletePreset = (name: string) => {
    const next = filterPresets.filter((p) => p.name !== name);
    setFilterPresets(next);
    savePresets(next);
    if (activePresetName === name) setActivePresetName(null);
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
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">ウォッチリスト</h2>
          <button
            onClick={() => setShowFavoritesOnly((v) => !v)}
            className={`flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              showFavoritesOnly
                ? "border-yellow-400 bg-yellow-50 text-yellow-700 dark:border-yellow-500 dark:bg-yellow-900/30 dark:text-yellow-300"
                : "border-gray-300 bg-white text-gray-500 hover:border-yellow-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400"
            }`}
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill={showFavoritesOnly ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.562.562 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
            </svg>
            お気に入り
            {showFavoritesOnly && <span>({stocks.filter((s) => s.favorite).length})</span>}
          </button>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-1 rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          銘柄追加
        </button>
      </div>

      {/* 検索 + フィルター */}
      {stocks.length > 0 && (
        <div className="mb-4 space-y-3">
          {/* テキスト検索 */}
          <div className="relative">
            <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-slate-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="銘柄コードまたは会社名で検索（例: 7203, トヨタ）"
              className="w-full rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 py-2 pl-10 pr-4 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-slate-500 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:text-slate-500 dark:hover:text-slate-300"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
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
                onClick={() => toggleSegment(segment)}
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

          {/* 保存済みプリセット */}
          {filterPresets.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-gray-500 dark:text-slate-400">プリセット:</span>
              {filterPresets.map((preset) => (
                <span key={preset.name} className="inline-flex items-center gap-0.5">
                  <button
                    onClick={() => handleApplyPreset(preset)}
                    className={`rounded-l-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                      activePresetName === preset.name
                        ? "border-purple-400 bg-purple-50 text-purple-700 dark:border-purple-500 dark:bg-purple-900/30 dark:text-purple-300"
                        : "border-gray-300 bg-white text-gray-500 hover:border-gray-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500"
                    }`}
                  >
                    {preset.name}
                  </button>
                  <button
                    onClick={() => handleDeletePreset(preset.name)}
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
                onClick={handleSignalScan}
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
                      style={{ width: `${(signalScanProgress.scanned / signalScanProgress.total) * 100}%` }}
                    />
                  </span>
                )}
                <button
                  onClick={handleSignalScanAbort}
                  className="rounded-full border border-red-300 px-2 py-0.5 text-xs text-red-500 hover:bg-red-50 dark:border-red-600 dark:text-red-400 dark:hover:bg-red-900/20"
                >
                  中断
                </button>
              </span>
            )}
            {signalLastScannedAt && !signalScanning && (
              <span className="text-[10px] text-gray-400 dark:text-slate-500">
                更新: {new Date(signalLastScannedAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
            {allActiveStrategies.length > 0 ? (
              <>
                {allActiveStrategies.map(([id, name]) => (
                  <button
                    key={id}
                    onClick={() => toggleStrategy(id)}
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
                    onClick={() => setSignalFilterMode((m) => (m === "or" ? "and" : "or"))}
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
                  onClick={clearAllFilters}
                  className="ml-1 text-xs text-gray-400 hover:text-gray-600 dark:text-slate-500 dark:hover:text-slate-300"
                >
                  フィルタ解除
                </button>
                <button
                  onClick={handleSavePreset}
                  className="text-xs text-purple-500 hover:text-purple-700 dark:text-purple-400 dark:hover:text-purple-300"
                >
                  保存
                </button>
                <span className="text-xs text-gray-400 dark:text-slate-500">
                  {filteredStocks.length}/{stocks.length}件
                </span>
              </>
            )}
          </div>

          {/* シグナル期間フィルタ（検知日 + 表示の統合） */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-gray-500 dark:text-slate-400">期間:</span>
            {([
              { value: "1w", label: "1週間" },
              { value: "1m", label: "1ヶ月" },
              { value: "3m", label: "3ヶ月" },
              { value: "6m", label: "半年" },
            ] as const).map(({ value, label }) => (
              <button
                key={value}
                onClick={() => setSignalPeriodFilter(signalPeriodFilter === value ? "all" : value)}
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
          {Object.values(signals).some((s) => s.validations && Object.keys(s.validations).length > 0) && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-gray-500 dark:text-slate-400">判定:</span>
              {([
                { label: "Go", value: "entry", activeClass: "border-green-400 bg-green-50 text-green-700 dark:border-green-500 dark:bg-green-900/30 dark:text-green-300" },
                { label: "様子見", value: "wait", activeClass: "border-yellow-400 bg-yellow-50 text-yellow-700 dark:border-yellow-500 dark:bg-yellow-900/30 dark:text-yellow-300" },
                { label: "No Go", value: "avoid", activeClass: "border-red-400 bg-red-50 text-red-700 dark:border-red-500 dark:bg-red-900/30 dark:text-red-300" },
              ] as const).map(({ label, value, activeClass }) => (
                <button
                  key={value}
                  onClick={() => setSelectedDecision(selectedDecision === value ? null : value)}
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
            {([
              { label: "▲強気", value: "bullish", activeClass: "border-green-400 bg-green-50 text-green-700 dark:border-green-500 dark:bg-green-900/30 dark:text-green-300" },
              { label: "◆中立", value: "neutral", activeClass: "border-yellow-400 bg-yellow-50 text-yellow-700 dark:border-yellow-500 dark:bg-yellow-900/30 dark:text-yellow-300" },
              { label: "▼弱気", value: "bearish", activeClass: "border-red-400 bg-red-50 text-red-700 dark:border-red-500 dark:bg-red-900/30 dark:text-red-300" },
            ] as const).map(({ label, value, activeClass }) => (
              <button
                key={value}
                onClick={() => setSelectedJudgment(selectedJudgment === value ? null : value)}
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
                  onClick={() => setBreakoutFilter((v) => !v)}
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                    breakoutFilter
                      ? "border-emerald-400 bg-emerald-50 text-emerald-700 dark:border-emerald-500 dark:bg-emerald-900/30 dark:text-emerald-300"
                      : "border-gray-300 bg-white text-gray-500 hover:border-gray-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500"
                  }`}
                >
                  52w突破
                </button>
                <button
                  onClick={() => setConsolidationFilter((v) => !v)}
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
              onClick={handleScan}
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
                onClick={() => toggleSector(sector)}
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
      )}

      {/* ── バッチアクションバー ── */}
      {filteredActiveSignalCount > 0 && (
        <div className="mb-4 rounded-lg border border-indigo-200 bg-indigo-50 p-3 dark:border-indigo-700 dark:bg-indigo-900/20">
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-xs font-medium text-indigo-700 dark:text-indigo-300">
              フィルタ中の{filteredActiveStockCount}銘柄（{filteredActiveSignalCount}シグナル）に対して実行:
            </span>

            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs text-gray-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={batchAnalysis}
                  onChange={(e) => setBatchAnalysis(e.target.checked)}
                  className="rounded border-gray-300 dark:border-slate-600"
                  disabled={batchRunning}
                />
                分析（Go/NoGo判断）
              </label>
              <label className="flex items-center gap-1.5 text-xs text-gray-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={batchSlack}
                  onChange={(e) => setBatchSlack(e.target.checked)}
                  className="rounded border-gray-300 dark:border-slate-600"
                  disabled={batchRunning}
                />
                Slack通知
              </label>
            </div>

            <button
              onClick={handleBatchExecute}
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
      )}

      {stocks.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-gray-300 dark:border-slate-600 p-12 text-center">
          <p className="text-gray-500 dark:text-slate-400">
            ウォッチリストに銘柄がありません
          </p>
          <button
            onClick={() => setModalOpen(true)}
            className="mt-4 text-blue-500 hover:text-blue-600"
          >
            銘柄を追加する
          </button>
        </div>
      ) : (
        <>
          {/* 件数表示 */}
          {!hasAnyFilter && (
            <p className="mb-2 text-xs text-gray-400 dark:text-slate-500">
              {Math.min(displayCount, sortedStocks.length)}/{sortedStocks.length}件表示中
            </p>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {displayedStocks.length === 0 ? (
              <div className="col-span-full rounded-lg border border-dashed border-gray-300 dark:border-slate-600 p-8 text-center">
                <p className="text-sm text-gray-500 dark:text-slate-400">
                  該当する銘柄がありません
                </p>
              </div>
            ) : (
              displayedStocks.map((stock) => {
                const q = quotes[stock.symbol];
                const s = stats[stock.symbol];
                const sig = signals[stock.symbol];
                return (
                  <StockCard
                    key={stock.symbol}
                    stock={stock}
                    price={q?.price}
                    change={q?.changePercent}
                    per={s?.per ?? undefined}
                    pbr={s?.pbr ?? undefined}
                    roe={s?.roe ?? undefined}
                    signals={sig}
                    signalPeriodFilter={signalPeriodFilter}
                    fundamentalJudgment={stock.fundamental?.judgment}
                    fundamentalMemo={stock.fundamental?.memo}
                    onDelete={handleDeleteStock}
                    onToggleFavorite={handleToggleFavorite}
                    onVisible={handleCardVisible}
                  />
                );
              })
            )}
          </div>

          {/* もっと見る */}
          {hasMore && (
            <div className="mt-6 text-center">
              <button
                onClick={() => setDisplayCount((prev) => prev + PAGE_SIZE)}
                className="rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-6 py-2.5 text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
              >
                もっと見る（残り {sortedStocks.length - displayCount} 件）
              </button>
            </div>
          )}
        </>
      )}

      <AddStockModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onAdd={handleAddStock}
      />
    </div>
  );
}

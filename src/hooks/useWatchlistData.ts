import { useState, useEffect, useCallback, useRef } from "react";
import type { Stock, WatchlistGroup, SignalValidation } from "@/types";
import type { StockQuote, StockStats, SignalSummary, NewHighInfo } from "@/types/watchlist";
import { isJPMarketOpen, isUSMarketOpen } from "@/lib/utils/date";

const BATCH_CHUNK = 200; // URL長制限を考慮

// ── localStorage キャッシュ設定 ──
const CACHE_KEY = "watchlist-cache-v2";
const CACHE_VERSION = 2;

// TTL設定（データ種別ごと）
const TTL_QUOTES_MARKET = 5 * 60 * 1000;       // 株価: 場中5分
const TTL_QUOTES_CLOSED = 6 * 60 * 60 * 1000;  // 株価: 場外6時間
const TTL_STATIC = 24 * 60 * 60 * 1000;        // 銘柄リスト/指標/シグナル: 24時間

interface WatchlistCache {
  version: number;
  quotesTimestamp: number;  // 株価の更新時刻
  staticTimestamp: number;  // その他データの更新時刻
  stocks: Stock[];
  quotes: Record<string, StockQuote>;
  stats: Record<string, StockStats>;
  signals: Record<string, SignalSummary>;
  allGroups: WatchlistGroup[];
  newHighsMap: Record<string, NewHighInfo>;
}

function getQuotesTTL(): number {
  return isJPMarketOpen() || isUSMarketOpen() ? TTL_QUOTES_MARKET : TTL_QUOTES_CLOSED;
}

function loadCache(): { cache: Partial<WatchlistCache>; quotesExpired: boolean } | null {
  if (typeof window === "undefined") return null;
  try {
    const saved = localStorage.getItem(CACHE_KEY);
    if (!saved) return null;
    const cache: WatchlistCache = JSON.parse(saved);
    if (cache.version !== CACHE_VERSION) return null;

    const now = Date.now();
    const staticExpired = now - cache.staticTimestamp > TTL_STATIC;
    const quotesExpired = now - cache.quotesTimestamp > getQuotesTTL();

    // 静的データも期限切れなら全キャッシュ無効
    if (staticExpired) return null;

    return { cache, quotesExpired };
  } catch {
    return null;
  }
}

function saveCache(
  data: Omit<WatchlistCache, "version" | "quotesTimestamp" | "staticTimestamp">,
  updateQuotes: boolean = true
): void {
  if (typeof window === "undefined") return;
  try {
    // 既存キャッシュのタイムスタンプを保持
    let prevQuotesTs = Date.now();
    let prevStaticTs = Date.now();
    try {
      const prev = localStorage.getItem(CACHE_KEY);
      if (prev) {
        const parsed = JSON.parse(prev) as WatchlistCache;
        prevQuotesTs = parsed.quotesTimestamp ?? prevQuotesTs;
        prevStaticTs = parsed.staticTimestamp ?? prevStaticTs;
      }
    } catch { /* ignore */ }

    const cache: WatchlistCache = {
      ...data,
      version: CACHE_VERSION,
      quotesTimestamp: updateQuotes ? Date.now() : prevQuotesTs,
      staticTimestamp: Date.now(),
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    try {
      localStorage.removeItem(CACHE_KEY);
      const cache: WatchlistCache = {
        ...data,
        version: CACHE_VERSION,
        quotesTimestamp: Date.now(),
        staticTimestamp: Date.now(),
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch { /* ignore */ }
  }
}

interface UseWatchlistDataReturn {
  stocks: Stock[];
  setStocks: React.Dispatch<React.SetStateAction<Stock[]>>;
  quotes: Record<string, StockQuote>;
  stats: Record<string, StockStats>;
  signals: Record<string, SignalSummary>;
  setSignals: React.Dispatch<React.SetStateAction<Record<string, SignalSummary>>>;
  loading: boolean;
  allGroups: WatchlistGroup[];
  setAllGroups: React.Dispatch<React.SetStateAction<WatchlistGroup[]>>;
  newHighsMap: Record<string, NewHighInfo>;
  newHighsScannedAt: string | null;
  scanning: boolean;
  signalScannedCount: number;
  signalLastScannedAt: string | null;
  setSignalScannedCount: React.Dispatch<React.SetStateAction<number>>;
  setSignalLastScannedAt: React.Dispatch<React.SetStateAction<string | null>>;
  fetchWatchlist: () => Promise<void>;
  handleScan: () => Promise<void>;
  handleCardVisible: (symbol: string, isVisible: boolean) => void;
  handleAddStock: (stock: Stock) => void;
  handleDeleteStock: (symbol: string) => Promise<void>;
  handleSaveGroups: (symbol: string, groupIds: number[]) => Promise<void>;
  handleCreateGroup: (name: string, color: string) => Promise<void>;
  signalsFetchedRef: React.MutableRefObject<Set<string>>;
  initialSignalLoadComplete: boolean;
  fetchBatchStats: () => Promise<void>;
  batchStatsLoading: boolean;
}

export function useWatchlistData(): UseWatchlistDataReturn {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [quotes, setQuotes] = useState<Record<string, StockQuote>>({});
  const [stats, setStats] = useState<Record<string, StockStats>>({});
  const [signals, setSignals] = useState<Record<string, SignalSummary>>({});
  const [loading, setLoading] = useState(true);
  const [allGroups, setAllGroups] = useState<WatchlistGroup[]>([]);
  const [newHighsMap, setNewHighsMap] = useState<Record<string, NewHighInfo>>({});
  const [newHighsScannedAt, setNewHighsScannedAt] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [initialSignalLoadComplete, setInitialSignalLoadComplete] = useState(false);
  const [signalScannedCount, setSignalScannedCount] = useState(0);
  const [signalLastScannedAt, setSignalLastScannedAt] = useState<string | null>(null);
  const [cacheRestored, setCacheRestored] = useState(false);

  // 可視カード追跡（自動更新用）
  const visibleSymbolsRef = useRef<Set<string>>(new Set());
  // データ取得済みシンボル追跡（price/stats/validation）
  const fetchedSymbolsRef = useRef<Set<string>>(new Set());
  // シグナルデータ取得済み追跡
  const signalsFetchedRef = useRef<Set<string>>(new Set());

  // 株価のみ再取得が必要かどうか
  const quotesNeedRefreshRef = useRef(false);

  // マウント時にlocalStorageから復元
  useEffect(() => {
    const result = loadCache();
    if (result) {
      const { cache, quotesExpired } = result;
      if (cache.stocks) setStocks(cache.stocks);
      if (cache.stats) setStats(cache.stats);
      if (cache.signals) {
        setSignals(cache.signals);
        Object.keys(cache.signals).forEach((sym) => signalsFetchedRef.current.add(sym));
      }
      if (cache.allGroups) setAllGroups(cache.allGroups);
      if (cache.newHighsMap) setNewHighsMap(cache.newHighsMap);

      // 株価: 期限切れでなければ復元、期限切れなら再取得フラグ
      if (!quotesExpired && cache.quotes) {
        setQuotes(cache.quotes);
      } else {
        quotesNeedRefreshRef.current = true;
      }

      if (cache.stocks && cache.stocks.length > 0) {
        setLoading(false);
      }
    }
    setCacheRestored(true);
  }, []);

  // データ変更時にlocalStorageに保存
  const saveCacheRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!cacheRestored) return;
    // デバウンス: 100ms後に保存（連続更新時の負荷軽減）
    if (saveCacheRef.current) clearTimeout(saveCacheRef.current);
    saveCacheRef.current = setTimeout(() => {
      saveCache({ stocks, quotes, stats, signals, allGroups, newHighsMap });
    }, 100);
    return () => {
      if (saveCacheRef.current) clearTimeout(saveCacheRef.current);
    };
  }, [cacheRestored, stocks, quotes, stats, signals, allGroups, newHighsMap]);

  const fetchWatchlist = useCallback(async () => {
    try {
      const res = await fetch("/api/watchlist");
      const data = await res.json();
      setStocks(data.stocks ?? []);
      if (data.groups) setAllGroups(data.groups);
    } catch {
      console.error("Failed to fetch watchlist");
    } finally {
      setLoading(false);
    }
  }, []);

  // キャッシュ復元後にAPI取得（最新データで上書き）
  useEffect(() => {
    if (!cacheRestored) return;
    fetchWatchlist();
  }, [cacheRestored, fetchWatchlist]);

  // 株価キャッシュ期限切れ時にバッチ更新（stock-table APIを使用）
  useEffect(() => {
    if (!cacheRestored || !quotesNeedRefreshRef.current || stocks.length === 0) return;
    quotesNeedRefreshRef.current = false;

    const refreshQuotes = async () => {
      const symbols = stocks.map((s) => s.symbol);
      const CHUNK_SIZE = 50; // stock-table APIの上限
      for (let i = 0; i < symbols.length; i += CHUNK_SIZE) {
        const chunk = symbols.slice(i, i + CHUNK_SIZE);
        try {
          const res = await fetch(`/api/stock-table?symbols=${chunk.join(",")}`);
          if (res.ok) {
            const data = await res.json();
            const newQuotes: Record<string, StockQuote> = {};
            const newStats: Record<string, StockStats> = {};
            for (const row of data.rows ?? []) {
              newQuotes[row.symbol] = {
                symbol: row.symbol,
                price: row.price ?? 0,
                changePercent: row.changePercent ?? 0,
              };
              newStats[row.symbol] = {
                per: row.per ?? null,
                pbr: row.pbr ?? null,
                roe: row.roe ?? null,
                eps: row.eps ?? null,
                simpleNcRatio: row.simpleNcRatio ?? null,
                marketCap: row.marketCap ?? null,
                sharpe1y: row.sharpe1y ?? null,
                latestDividend: row.latestDividend ?? null,
                latestIncrease: row.latestIncrease ?? null,
              };
            }
            setQuotes((prev) => ({ ...prev, ...newQuotes }));
            setStats((prev) => ({ ...prev, ...newStats }));
          }
        } catch { /* ignore */ }
      }
    };
    refreshQuotes();
  }, [cacheRestored, stocks]);

  // 新高値スキャンデータを読み込み
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

  const handleScan = useCallback(async () => {
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
  }, [loadNewHighs]);

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
        let lastScannedAtFromFile: string | null = null;
        if (sigRes.ok) {
          const sigData = await sigRes.json();
          if (sigData.signals && sigData.scannedCount > 0) {
            for (const [symbol, value] of Object.entries(sigData.signals)) {
              merged[symbol] = value as SignalSummary;
              signalsFetchedRef.current.add(symbol);
            }
            fileScannedCount = sigData.scannedCount ?? 0;
            lastScannedAtFromFile = sigData.lastScannedAt ?? null;
            setSignalScannedCount(fileScannedCount);
            setSignalLastScannedAt(lastScannedAtFromFile);
          }
        }

        // Supabase から最新スキャン結果を補完
        if (fileScannedCount < stocks.length * 0.9) {
          try {
            const detRes = await fetch("/api/signals/detected/grouped");
            if (detRes.ok) {
              const detData = await detRes.json();
              const groupedSignals = detData.signals ?? {};
              const sNames: Record<string, string> = detData.strategyNames ?? {};

              for (const [symbol, sigs] of Object.entries(groupedSignals)) {
                if (signalsFetchedRef.current.has(symbol)) continue;

                if (!merged[symbol]) {
                  merged[symbol] = {
                    activeSignals: { daily: [], weekly: [] },
                    recentSignals: { daily: [], weekly: [] },
                  };
                }

                for (const sig of sigs as Array<{
                  s: string;
                  t: string;
                  d: string;
                  bp: number;
                  cp: number;
                }>) {
                  const tf = sig.t === "d" ? "daily" : "weekly";
                  const strategyName = sNames[sig.s] ?? sig.s;
                  const pnl = sig.bp > 0 ? ((sig.cp - sig.bp) / sig.bp) * 100 : 0;
                  merged[symbol].activeSignals![tf as "daily" | "weekly"].push({
                    strategyId: sig.s,
                    strategyName,
                    buyDate: sig.d,
                    buyPrice: sig.bp,
                    currentPrice: sig.cp,
                    pnlPct: Math.round(pnl * 100) / 100,
                  });
                  merged[symbol].recentSignals![tf as "daily" | "weekly"].push({
                    strategyId: sig.s,
                    strategyName,
                    date: sig.d,
                    price: sig.bp,
                  });
                }
              }

              // Supabase のスキャン情報がより包括的なら更新
              const supabaseTotal = detData.scan?.total_stocks ?? 0;
              if (supabaseTotal > fileScannedCount) {
                setSignalScannedCount(supabaseTotal);
                setSignalLastScannedAt(detData.scan?.completed_at ?? null);
              }
            }
          } catch {
            // ignore Supabase fallback errors
          }
        }

        // 全銘柄をfetched扱い
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
        setInitialSignalLoadComplete(true);
      } catch {
        // ignore
        setInitialSignalLoadComplete(true);
      }
    };
    loadIndices();
  }, [stocks]);

  // 個別銘柄データ取得（遅延ロード用）
  const fetchDataForSymbol = useCallback(async (symbol: string) => {
    if (fetchedSymbolsRef.current.has(symbol)) return;
    fetchedSymbolsRef.current.add(symbol);

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
          simpleNcRatio: data.simpleNcRatio ?? null,
          marketCap: data.marketCap ?? null,
          sharpe1y: data.sharpe1y ?? null,
          latestDividend: data.dividendSummary?.latestAmount ?? null,
          latestIncrease: data.dividendSummary?.latestIncrease ?? null,
        },
      }));
    }

    // signals
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

  const handleAddStock = useCallback((stock: Stock) => {
    setStocks((prev) => [...prev, stock]);
  }, []);

  const handleDeleteStock = useCallback(async (symbol: string) => {
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
  }, []);

  const handleSaveGroups = useCallback(
    async (symbol: string, groupIds: number[]) => {
      // 楽観的更新
      const groupMap = new Map(allGroups.map((g) => [g.id, g]));
      const newGroups = groupIds
        .map((id) => groupMap.get(id))
        .filter((g): g is WatchlistGroup => g != null);
      setStocks((prev) =>
        prev.map((s) =>
          s.symbol === symbol ? { ...s, groups: newGroups, favorite: newGroups.length > 0 } : s
        )
      );
      try {
        await fetch("/api/watchlist", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol, groupIds }),
        });
      } catch {
        // ロールバック: 再取得
        fetchWatchlist();
      }
    },
    [allGroups, fetchWatchlist]
  );

  // バッチstats取得（数値フィルタ用: stock-table APIで取得）
  const [batchStatsLoading, setBatchStatsLoading] = useState(false);
  const batchStatsFetchedRef = useRef(false);

  const fetchBatchStats = useCallback(async () => {
    if (batchStatsFetchedRef.current || stocks.length === 0) return;
    batchStatsFetchedRef.current = true;
    setBatchStatsLoading(true);

    try {
      // stats未取得の銘柄のみ対象
      const missing = stocks
        .map((s) => s.symbol)
        .filter((sym) => !stats[sym]);

      if (missing.length === 0) {
        setBatchStatsLoading(false);
        return;
      }

      // stock-table API (Yahoo Finance取得あり) を使用
      const CHUNK_SIZE = 50;
      const newQuotes: Record<string, StockQuote> = {};
      const newStats: Record<string, StockStats> = {};

      for (let i = 0; i < missing.length; i += CHUNK_SIZE) {
        const chunk = missing.slice(i, i + CHUNK_SIZE);
        try {
          const res = await fetch(`/api/stock-table?symbols=${chunk.join(",")}`);
          if (res.ok) {
            const data = await res.json();
            for (const row of data.rows ?? []) {
              newQuotes[row.symbol] = {
                symbol: row.symbol,
                price: row.price ?? 0,
                changePercent: row.changePercent ?? 0,
              };
              newStats[row.symbol] = {
                per: row.per ?? null,
                pbr: row.pbr ?? null,
                roe: row.roe ?? null,
                eps: row.eps ?? null,
                simpleNcRatio: row.simpleNcRatio ?? null,
                marketCap: row.marketCap ?? null,
                sharpe1y: row.sharpe1y ?? null,
                latestDividend: row.latestDividend ?? null,
                latestIncrease: row.latestIncrease ?? null,
              };
            }
          }
        } catch {
          // ignore chunk errors
        }
      }

      if (Object.keys(newStats).length > 0) {
        setQuotes((prev) => ({ ...prev, ...newQuotes }));
        setStats((prev) => ({ ...prev, ...newStats }));
      }
    } finally {
      setBatchStatsLoading(false);
    }
  }, [stocks, stats]);

  const handleCreateGroup = useCallback(async (name: string, color: string) => {
    try {
      const res = await fetch("/api/watchlist/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, color }),
      });
      const newGroup: WatchlistGroup = await res.json();
      setAllGroups((prev) => [...prev, newGroup]);
    } catch {
      console.error("Failed to create group");
    }
  }, []);

  return {
    stocks,
    setStocks,
    quotes,
    stats,
    signals,
    setSignals,
    loading,
    allGroups,
    setAllGroups,
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
  };
}

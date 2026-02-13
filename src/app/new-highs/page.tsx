"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import Link from "next/link";
import { formatMarketCap, getCapSize } from "@/lib/utils/format";
import GroupAssignPopup from "@/components/GroupAssignPopup";
import type { WatchlistGroup } from "@/types";

interface Stock {
  code: string;
  symbol: string;
  name: string;
  market: string;
  price: number;
  changePct: number;
  volume: number;
  per: number | null;
  pbr: number | null;
  yield: number | null;
  fiftyTwoWeekHigh: number;
  currentYfPrice: number;
  isTrue52wBreakout: boolean;
  pctAbove52wHigh: number;
  consolidationDays: number;
  consolidationRangePct: number;
  simpleNcRatio: number | null;
  cnPer: number | null;
  marketCap: number | null;
  currentRatio: number | null;
}

type SortKey = keyof Stock;
type SortDir = "asc" | "desc";

const COLUMNS: { key: SortKey; label: string; align: "left" | "right"; width?: string }[] = [
  { key: "code", label: "コード", align: "left" },
  { key: "name", label: "銘柄名", align: "left", width: "min-w-[120px]" },
  { key: "market", label: "市場", align: "left" },
  { key: "currentYfPrice", label: "株価", align: "right" },
  { key: "changePct", label: "前日比%", align: "right" },
  { key: "per", label: "PER", align: "right" },
  { key: "pbr", label: "PBR", align: "right" },
  { key: "marketCap", label: "時価総額", align: "right" },
  { key: "simpleNcRatio", label: "簡易NC率", align: "right" },
  { key: "cnPer", label: "簡易CNPER", align: "right" },
  { key: "fiftyTwoWeekHigh", label: "52w高値", align: "right" },
  { key: "pctAbove52wHigh", label: "乖離%", align: "right" },
  { key: "consolidationDays", label: "もみ合い", align: "right" },
  { key: "consolidationRangePct", label: "レンジ%", align: "right" },
  { key: "currentRatio", label: "流動比率", align: "right" },
  { key: "volume", label: "出来高", align: "right" },
];

function formatNum(v: number | null, digits = 1): string {
  if (v === null) return "－";
  return v.toLocaleString("ja-JP", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatVolume(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return String(v);
}

export default function NewHighsPage() {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [scannedAt, setScannedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [sortKey, setSortKey] = useState<SortKey>("pctAbove52wHigh");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [marketFilter, setMarketFilter] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [breakoutOnly, setBreakoutOnly] = useState(true);
  const [consolidationOnly, setConsolidationOnly] = useState(false);
  const [capSizeFilter, setCapSizeFilter] = useState<Set<string>>(new Set());
  // 数値範囲フィルタ
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");
  const [consolidationMin, setConsolidationMin] = useState("");
  const [consolidationMax, setConsolidationMax] = useState("");
  const [currentRatioMin, setCurrentRatioMin] = useState("");
  const [currentRatioMax, setCurrentRatioMax] = useState("");
  // グループ関連
  const [allGroups, setAllGroups] = useState<WatchlistGroup[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<number>>(new Set());
  const [watchlistGroupMap, setWatchlistGroupMap] = useState<Map<string, number[]>>(new Map());
  const [groupPopup, setGroupPopup] = useState<{ symbol: string; anchor: DOMRect } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState<{ stage: string; current: number; total: number; message: string } | null>(null);
  const pollingRef = useRef<{ interval: ReturnType<typeof setInterval>; timeout: ReturnType<typeof setTimeout> } | null>(null);
  // ドロップダウン
  const [showGroupDropdown, setShowGroupDropdown] = useState(false);
  const groupDropdownRef = useRef<HTMLDivElement>(null);
  const [showMarketDropdown, setShowMarketDropdown] = useState(false);
  const marketDropdownRef = useRef<HTMLDivElement>(null);
  const [showCapDropdown, setShowCapDropdown] = useState(false);
  const capDropdownRef = useRef<HTMLDivElement>(null);

  // ドロップダウン: 外側クリックで閉じる
  useEffect(() => {
    if (!showGroupDropdown && !showMarketDropdown && !showCapDropdown) return;
    function handleClick(e: MouseEvent) {
      const t = e.target as Node;
      if (showGroupDropdown && groupDropdownRef.current && !groupDropdownRef.current.contains(t)) setShowGroupDropdown(false);
      if (showMarketDropdown && marketDropdownRef.current && !marketDropdownRef.current.contains(t)) setShowMarketDropdown(false);
      if (showCapDropdown && capDropdownRef.current && !capDropdownRef.current.contains(t)) setShowCapDropdown(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showGroupDropdown, showMarketDropdown, showCapDropdown]);

  const loadData = useCallback(async () => {
    try {
      const res = await fetch("/api/new-highs");
      const data = await res.json();
      setStocks((data.stocks ?? []).map((s: Stock) => ({
        ...s,
        cnPer: (s.per != null && s.simpleNcRatio != null) ? s.per * (1 - s.simpleNcRatio / 100) : null,
      })));
      setScannedAt(data.scannedAt ?? null);
      if (data.error) setError(data.error);
      else setError(null);
    } catch {
      setError("データの取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ウォッチリストグループ取得
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/watchlist");
        const data = await res.json();
        if (data.groups) setAllGroups(data.groups);
        // symbol → groupIds マップ構築
        const map = new Map<string, number[]>();
        for (const s of data.stocks ?? []) {
          const ids = (s.groups ?? []).map((g: { id: number }) => g.id);
          if (ids.length > 0) map.set(s.symbol, ids);
        }
        setWatchlistGroupMap(map);
      } catch { /* ignore */ }
    })();
  }, []);

  // ポーリングクリーンアップ
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current.interval);
        clearTimeout(pollingRef.current.timeout);
      }
    };
  }, []);

  const startPolling = useCallback((scanId: number) => {
    // 既存のポーリングをクリア
    if (pollingRef.current) {
      clearInterval(pollingRef.current.interval);
      clearTimeout(pollingRef.current.timeout);
    }

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/new-highs/status?scanId=${scanId}`);
        const data = await res.json();

        if (data.status === "completed") {
          if (pollingRef.current) {
            clearInterval(pollingRef.current.interval);
            clearTimeout(pollingRef.current.timeout);
            pollingRef.current = null;
          }
          setScanStatus(null);
          setScanProgress(null);
          setScanning(false);
          await loadData();
        } else if (data.status === "failed") {
          if (pollingRef.current) {
            clearInterval(pollingRef.current.interval);
            clearTimeout(pollingRef.current.timeout);
            pollingRef.current = null;
          }
          setScanStatus(null);
          setScanProgress(null);
          setScanning(false);
          setError(data.error_message ?? "スキャンが失敗しました");
        } else if (data.progress) {
          setScanProgress(data.progress);
        }
      } catch {
        // ネットワークエラー → 継続
      }
    }, 10_000);

    const timeout = setTimeout(() => {
      clearInterval(interval);
      pollingRef.current = null;
      setScanStatus(null);
      setScanProgress(null);
      setScanning(false);
      setError("スキャンがタイムアウトしました。ページを再読み込みしてください。");
    }, 5 * 60 * 1000);

    pollingRef.current = { interval, timeout };
  }, [loadData]);

  const handleScan = async () => {
    setScanning(true);
    setError(null);
    setScanStatus("starting");
    try {
      const res = await fetch("/api/new-highs/scan", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "スキャンに失敗しました");
        setScanning(false);
        setScanStatus(null);
        setScanProgress(null);
        return;
      }

      if (data.scanId) {
        // Vercel: GitHub Actions で非同期実行 → ポーリング開始
        setScanStatus("running");
        startPolling(data.scanId);
      } else {
        // ローカル: 同期的に完了済み
        await loadData();
        setScanning(false);
        setScanStatus(null);
        setScanProgress(null);
      }
    } catch {
      setError("スキャンの実行に失敗しました");
      setScanning(false);
      setScanStatus(null);
      setScanProgress(null);
    }
  };

  const filtered = useMemo(() => {
    let list = stocks;
    if (selectedGroupIds.size > 0) list = list.filter((s) => {
      const gids = watchlistGroupMap.get(s.symbol);
      return gids?.some((id) => selectedGroupIds.has(id));
    });
    if (breakoutOnly) list = list.filter((s) => s.isTrue52wBreakout);
    if (consolidationOnly) list = list.filter((s) => s.consolidationDays >= 10);
    if (capSizeFilter.size > 0) list = list.filter((s) => {
      const cs = getCapSize(s.marketCap);
      return cs !== null && capSizeFilter.has(cs);
    });
    if (marketFilter.size > 0) list = list.filter((s) => {
      const seg = s.market.includes("東Ｐ") ? "プライム" : s.market.includes("東Ｓ") ? "スタンダード" : s.market.includes("東Ｇ") ? "グロース" : "";
      return marketFilter.has(seg);
    });
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (s) => s.code.includes(q) || s.name.toLowerCase().includes(q) || s.symbol.toLowerCase().includes(q),
      );
    }
    // 株価フィルタ
    if (priceMin !== "" || priceMax !== "") {
      const min = priceMin !== "" ? parseFloat(priceMin) : NaN;
      const max = priceMax !== "" ? parseFloat(priceMax) : NaN;
      list = list.filter((s) => {
        if (!isNaN(min) && s.currentYfPrice < min) return false;
        if (!isNaN(max) && s.currentYfPrice > max) return false;
        return true;
      });
    }
    // もみ合い日数フィルタ
    if (consolidationMin !== "" || consolidationMax !== "") {
      const min = consolidationMin !== "" ? parseInt(consolidationMin) : NaN;
      const max = consolidationMax !== "" ? parseInt(consolidationMax) : NaN;
      list = list.filter((s) => {
        if (!isNaN(min) && s.consolidationDays < min) return false;
        if (!isNaN(max) && s.consolidationDays > max) return false;
        return true;
      });
    }
    // 流動比率フィルタ
    if (currentRatioMin !== "" || currentRatioMax !== "") {
      const min = currentRatioMin !== "" ? parseFloat(currentRatioMin) : NaN;
      const max = currentRatioMax !== "" ? parseFloat(currentRatioMax) : NaN;
      list = list.filter((s) => {
        if (s.currentRatio == null) return false;
        if (!isNaN(min) && s.currentRatio < min) return false;
        if (!isNaN(max) && s.currentRatio > max) return false;
        return true;
      });
    }
    // Sort
    list = [...list].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      return 0;
    });
    return list;
  }, [stocks, sortKey, sortDir, marketFilter, search, breakoutOnly, consolidationOnly, capSizeFilter, selectedGroupIds, watchlistGroupMap, priceMin, priceMax, consolidationMin, consolidationMax, currentRatioMin, currentRatioMax]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" || key === "code" ? "asc" : "desc");
    }
  }

  function changePctColor(v: number): string {
    if (v > 0) return "text-red-600 dark:text-red-400";
    if (v < 0) return "text-blue-600 dark:text-blue-400";
    return "";
  }

  function breakoutColor(v: number): string {
    if (v >= 0) return "text-emerald-600 dark:text-emerald-400 font-semibold";
    if (v >= -0.5) return "text-yellow-600 dark:text-yellow-400";
    return "text-gray-500 dark:text-slate-400";
  }

  // グループ編集ハンドラ
  const handleEditGroups = (symbol: string, event: React.MouseEvent) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setGroupPopup({ symbol, anchor: rect });
  };

  const handleSaveGroups = async (symbol: string, groupIds: number[]) => {
    // ウォッチリスト未登録なら先に追加
    if (!watchlistGroupMap.has(symbol)) {
      const stock = stocks.find((s) => s.symbol === symbol);
      const market = symbol.endsWith(".T") ? "JP" : "US";
      await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, name: stock?.name ?? symbol, market }),
      });
    }
    // 楽観的更新
    setWatchlistGroupMap((prev) => {
      const next = new Map(prev);
      if (groupIds.length > 0) next.set(symbol, groupIds);
      else next.delete(symbol);
      return next;
    });
    try {
      await fetch("/api/watchlist", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, groupIds }),
      });
    } catch { /* ignore */ }
  };

  const handleCreateGroup = async (name: string, color: string) => {
    try {
      const res = await fetch("/api/watchlist/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, color }),
      });
      const newGroup: WatchlistGroup = await res.json();
      setAllGroups((prev) => [...prev, newGroup]);
    } catch { /* ignore */ }
  };

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-gray-500 dark:text-slate-400">読み込み中...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            52週高値ブレイクアウト
          </h1>
          {scannedAt && (
            <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
              スキャン日時: {scannedAt}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-600 dark:text-slate-300">
            {filtered.length} / {stocks.length} 銘柄
          </span>
          <button
            onClick={handleScan}
            disabled={scanning}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              scanning
                ? "cursor-not-allowed bg-gray-200 text-gray-400 dark:bg-slate-700 dark:text-slate-500"
                : "bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
            }`}
          >
            {scanning ? (
              <>
                <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {scanProgress
                  ? scanProgress.stage === "kabutan" ? "取得中..."
                    : scanProgress.stage === "yf_check" ? "チェック中..."
                    : scanProgress.stage === "consolidation" ? "分析中..."
                    : "完了処理中..."
                  : scanStatus === "running" ? "スキャン実行中..."
                  : "スキャン中..."}
              </>
            ) : (
              <>
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
                </svg>
                スキャン更新
              </>
            )}
          </button>
        </div>
      </div>

      {/* Progress Bar */}
      {scanning && scanProgress && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-900/20">
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="font-medium text-blue-700 dark:text-blue-300">
              {scanProgress.message}
            </span>
            {scanProgress.total > 0 && (
              <span className="text-blue-500 dark:text-blue-400">
                {Math.round((scanProgress.current / scanProgress.total) * 100)}%
              </span>
            )}
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-blue-100 dark:bg-blue-900/50">
            <div
              className="h-full rounded-full bg-blue-500 transition-all duration-500 ease-out dark:bg-blue-400"
              style={{
                width: scanProgress.total > 0
                  ? `${Math.min(100, (scanProgress.current / scanProgress.total) * 100)}%`
                  : "100%",
              }}
            />
          </div>
          <div className="mt-1 text-[10px] text-blue-400 dark:text-blue-500">
            {scanProgress.stage === "kabutan" && "Kabutan年初来高値ページ取得中"}
            {scanProgress.stage === "yf_check" && "Yahoo Finance 52週高値データ取得中"}
            {scanProgress.stage === "consolidation" && "もみ合いパターン分析中"}
            {scanProgress.stage === "uploading" && "結果をアップロード中"}
          </div>
        </div>
      )}

      {error && stocks.length === 0 && (
        <div className="rounded-lg bg-yellow-50 p-4 text-sm text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-200">
          {error}
        </div>
      )}

      {/* フィルタ Row 1 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="text"
          placeholder="コード / 銘柄名で検索..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:focus:border-blue-400"
        />
        {allGroups.length > 0 && (
          <div className="relative" ref={groupDropdownRef}>
            <button
              onClick={() => setShowGroupDropdown((v) => !v)}
              className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                selectedGroupIds.size > 0
                  ? "border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/30 dark:text-blue-300"
                  : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              }`}
            >
              グループ
              {selectedGroupIds.size > 0 && (
                <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-bold text-white">
                  {selectedGroupIds.size}
                </span>
              )}
              <svg className="ml-1 inline h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
              </svg>
            </button>
            {showGroupDropdown && (
              <div className="absolute left-0 top-full z-50 mt-1 min-w-48 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-slate-600 dark:bg-slate-800">
                {allGroups.map((g) => (
                  <label
                    key={g.id}
                    className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-slate-700"
                  >
                    <input
                      type="checkbox"
                      checked={selectedGroupIds.has(g.id)}
                      onChange={() => setSelectedGroupIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(g.id)) next.delete(g.id);
                        else next.add(g.id);
                        return next;
                      })}
                      className="h-3.5 w-3.5 rounded"
                    />
                    <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: g.color }} />
                    <span className="text-gray-700 dark:text-slate-300">{g.name}</span>
                  </label>
                ))}
                {selectedGroupIds.size > 0 && (
                  <>
                    <div className="my-1 border-t border-gray-100 dark:border-slate-700" />
                    <button
                      onClick={() => setSelectedGroupIds(new Set())}
                      className="w-full px-3 py-1.5 text-left text-xs text-gray-500 hover:bg-gray-50 dark:text-slate-400 dark:hover:bg-slate-700"
                    >
                      選択解除
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
        <div className="relative" ref={marketDropdownRef}>
          <button
            onClick={() => setShowMarketDropdown((v) => !v)}
            className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
              marketFilter.size > 0
                ? "border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/30 dark:text-blue-300"
                : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            }`}
          >
            市場区分
            {marketFilter.size > 0 && (
              <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-bold text-white">
                {marketFilter.size}
              </span>
            )}
            <svg className="ml-1 inline h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
            </svg>
          </button>
          {showMarketDropdown && (
            <div className="absolute left-0 top-full z-50 mt-1 min-w-36 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-slate-600 dark:bg-slate-800">
              {(["プライム", "スタンダード", "グロース"] as const).map((seg) => (
                <label
                  key={seg}
                  className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-slate-700"
                >
                  <input
                    type="checkbox"
                    checked={marketFilter.has(seg)}
                    onChange={() => setMarketFilter((prev) => {
                      const next = new Set(prev);
                      if (next.has(seg)) next.delete(seg);
                      else next.add(seg);
                      return next;
                    })}
                    className="h-3.5 w-3.5 rounded"
                  />
                  <span className="text-gray-700 dark:text-slate-300">{seg}</span>
                </label>
              ))}
              {marketFilter.size > 0 && (
                <>
                  <div className="my-1 border-t border-gray-100 dark:border-slate-700" />
                  <button
                    onClick={() => setMarketFilter(new Set())}
                    className="w-full px-3 py-1.5 text-left text-xs text-gray-500 hover:bg-gray-50 dark:text-slate-400 dark:hover:bg-slate-700"
                  >
                    選択解除
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        <div className="relative" ref={capDropdownRef}>
          <button
            onClick={() => setShowCapDropdown((v) => !v)}
            className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
              capSizeFilter.size > 0
                ? "border-teal-500 bg-teal-50 text-teal-700 dark:border-teal-400 dark:bg-teal-900/30 dark:text-teal-300"
                : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            }`}
          >
            時価総額
            {capSizeFilter.size > 0 && (
              <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-teal-600 px-1 text-[10px] font-bold text-white">
                {capSizeFilter.size}
              </span>
            )}
            <svg className="ml-1 inline h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
            </svg>
          </button>
          {showCapDropdown && (
            <div className="absolute left-0 top-full z-50 mt-1 min-w-36 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-slate-600 dark:bg-slate-800">
              {([["small", "小型株", "500億未満"], ["mid", "中型株", "500〜3000億"], ["large", "大型株", "3000億以上"]] as const).map(([value, label, desc]) => (
                <label
                  key={value}
                  className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-slate-700"
                >
                  <input
                    type="checkbox"
                    checked={capSizeFilter.has(value)}
                    onChange={() => setCapSizeFilter((prev) => {
                      const next = new Set(prev);
                      if (next.has(value)) next.delete(value);
                      else next.add(value);
                      return next;
                    })}
                    className="h-3.5 w-3.5 rounded"
                  />
                  <span className="text-gray-700 dark:text-slate-300">{label}</span>
                  <span className="ml-auto text-[10px] text-gray-400 dark:text-slate-500">{desc}</span>
                </label>
              ))}
              {capSizeFilter.size > 0 && (
                <>
                  <div className="my-1 border-t border-gray-100 dark:border-slate-700" />
                  <button
                    onClick={() => setCapSizeFilter(new Set())}
                    className="w-full px-3 py-1.5 text-left text-xs text-gray-500 hover:bg-gray-50 dark:text-slate-400 dark:hover:bg-slate-700"
                  >
                    選択解除
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={breakoutOnly}
            onChange={(e) => setBreakoutOnly(e.target.checked)}
            className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 dark:border-slate-600 dark:bg-slate-800"
          />
          <span className="text-xs font-medium text-gray-500 dark:text-slate-400">52w突破のみ</span>
        </label>
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={consolidationOnly}
            onChange={(e) => setConsolidationOnly(e.target.checked)}
            className="rounded border-gray-300 text-amber-600 focus:ring-amber-500 dark:border-slate-600 dark:bg-slate-800"
          />
          <span className="text-xs font-medium text-gray-500 dark:text-slate-400">もみ合いあり</span>
        </label>
      </div>

      {/* フィルタ Row 2: 数値範囲フィルタ */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-1">
          <span className="text-xs font-medium text-gray-500 dark:text-slate-400">株価</span>
          <input
            type="number"
            step="100"
            value={priceMin}
            onChange={(e) => setPriceMin(e.target.value)}
            placeholder=""
            className="w-20 rounded border border-gray-300 bg-white px-2 py-1 text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
          <span className="text-xs text-gray-400">円〜</span>
          <input
            type="number"
            step="100"
            value={priceMax}
            onChange={(e) => setPriceMax(e.target.value)}
            placeholder=""
            className="w-20 rounded border border-gray-300 bg-white px-2 py-1 text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
          <span className="text-xs text-gray-400">円</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs font-medium text-gray-500 dark:text-slate-400">もみ合い</span>
          <input
            type="number"
            step="1"
            value={consolidationMin}
            onChange={(e) => setConsolidationMin(e.target.value)}
            placeholder="10"
            className="w-14 rounded border border-gray-300 bg-white px-2 py-1 text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
          <span className="text-xs text-gray-400">日〜</span>
          <input
            type="number"
            step="1"
            value={consolidationMax}
            onChange={(e) => setConsolidationMax(e.target.value)}
            placeholder=""
            className="w-14 rounded border border-gray-300 bg-white px-2 py-1 text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
          <span className="text-xs text-gray-400">日</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs font-medium text-gray-500 dark:text-slate-400">流動比率</span>
          <input
            type="number"
            step="0.1"
            value={currentRatioMin}
            onChange={(e) => setCurrentRatioMin(e.target.value)}
            placeholder="1.0"
            className="w-16 rounded border border-gray-300 bg-white px-2 py-1 text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
          <span className="text-xs text-gray-400">倍〜</span>
          <input
            type="number"
            step="0.1"
            value={currentRatioMax}
            onChange={(e) => setCurrentRatioMax(e.target.value)}
            placeholder=""
            className="w-16 rounded border border-gray-300 bg-white px-2 py-1 text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
          <span className="text-xs text-gray-400">倍</span>
        </div>
        {(priceMin || priceMax || consolidationMin || consolidationMax || currentRatioMin || currentRatioMax) && (
          <button
            onClick={() => { setPriceMin(""); setPriceMax(""); setConsolidationMin(""); setConsolidationMax(""); setCurrentRatioMin(""); setCurrentRatioMax(""); }}
            className="rounded-full px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
          >
            クリア
          </button>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 dark:border-slate-700 dark:bg-slate-900/50">
              <th className="w-8 px-1 py-2.5" />
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  className={`cursor-pointer select-none whitespace-nowrap px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-900 dark:text-slate-400 dark:hover:text-white ${
                    col.align === "right" ? "text-right" : "text-left"
                  } ${col.width ?? ""}`}
                >
                  {col.label}
                  {sortKey === col.key && (
                    <span className="ml-1">{sortDir === "asc" ? "▲" : "▼"}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-700/50">
            {filtered.map((s, idx) => (
              <tr
                key={`${s.symbol}-${idx}`}
                className="transition-colors hover:bg-blue-50/50 dark:hover:bg-slate-700/30"
              >
                <td className="px-1 py-2 text-center">
                  <button
                    onClick={(e) => handleEditGroups(s.symbol, e)}
                    className="text-lg transition-transform hover:scale-110"
                    title="グループ設定"
                  >
                    {watchlistGroupMap.has(s.symbol) ? (
                      <span className="text-yellow-400">&#9733;</span>
                    ) : (
                      <span className="text-gray-300 dark:text-slate-600 hover:text-yellow-300">&#9734;</span>
                    )}
                  </button>
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  <Link
                    href={`/stock/${s.symbol}`}
                    className="font-mono text-blue-600 hover:underline dark:text-blue-400"
                  >
                    {s.code}
                  </Link>
                </td>
                <td className="px-3 py-2 font-medium text-gray-900 dark:text-white">
                  <Link href={`/stock/${s.symbol}`} className="hover:underline">
                    {s.name}
                  </Link>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-gray-500 dark:text-slate-400">
                  {s.market}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
                  {s.currentYfPrice.toLocaleString()}
                </td>
                <td className={`whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums ${changePctColor(s.changePct)}`}>
                  {s.changePct > 0 ? "+" : ""}{s.changePct.toFixed(1)}%
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
                  {formatNum(s.per)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
                  {formatNum(s.pbr, 2)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-gray-700 dark:text-slate-300">
                  {s.marketCap ? formatMarketCap(s.marketCap) : "－"}
                </td>
                <td className={`whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums ${
                  s.simpleNcRatio != null && s.simpleNcRatio > 50 ? "text-green-600 dark:text-green-400"
                    : s.simpleNcRatio != null && s.simpleNcRatio < -50 ? "text-red-600 dark:text-red-400"
                    : ""
                }`}>
                  {s.simpleNcRatio != null ? `${s.simpleNcRatio > 0 ? "+" : ""}${s.simpleNcRatio.toFixed(1)}%` : "－"}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
                  {s.cnPer != null ? formatNum(s.cnPer) : "－"}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
                  {s.fiftyTwoWeekHigh.toLocaleString()}
                </td>
                <td className={`whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums ${breakoutColor(s.pctAbove52wHigh)}`}>
                  {s.pctAbove52wHigh >= 0 ? "+" : ""}{s.pctAbove52wHigh.toFixed(2)}%
                </td>
                <td className={`whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums ${
                  s.consolidationDays >= 20
                    ? "text-amber-600 dark:text-amber-400 font-semibold"
                    : s.consolidationDays >= 10
                      ? "text-amber-500 dark:text-amber-300"
                      : "text-gray-400 dark:text-slate-500"
                }`}>
                  {s.consolidationDays > 0 ? `${s.consolidationDays}日` : "－"}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-gray-500 dark:text-slate-400">
                  {s.consolidationDays > 0 ? `${s.consolidationRangePct.toFixed(1)}%` : "－"}
                </td>
                <td className={`whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums ${
                  s.currentRatio != null && s.currentRatio >= 2 ? "text-green-600 dark:text-green-400"
                    : s.currentRatio != null && s.currentRatio < 1 ? "text-red-600 dark:text-red-400"
                    : ""
                }`}>
                  {formatNum(s.currentRatio, 2)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-gray-500 dark:text-slate-400">
                  {formatVolume(s.volume)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="py-12 text-center text-gray-500 dark:text-slate-400">
            条件に合う銘柄がありません
          </div>
        )}
      </div>

      {groupPopup && (
        <GroupAssignPopup
          symbol={groupPopup.symbol}
          currentGroupIds={watchlistGroupMap.get(groupPopup.symbol) ?? []}
          allGroups={allGroups}
          anchor={groupPopup.anchor}
          onToggleGroup={(groupId, checked) => {
            const currentIds = watchlistGroupMap.get(groupPopup.symbol) ?? [];
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

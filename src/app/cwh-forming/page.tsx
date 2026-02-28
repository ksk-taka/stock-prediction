"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import Link from "next/link";
import GroupAssignPopup from "@/components/GroupAssignPopup";
import BatchGroupAssignPopup from "@/components/BatchGroupAssignPopup";
import CsvExportButton from "@/components/CsvExportButton";
import type { WatchlistGroup } from "@/types";

interface CwhStock {
  symbol: string;
  name: string;
  marketSegment: string;
  stage: "handle_forming" | "handle_ready";
  currentPrice: number;
  breakoutPrice: number;
  distancePct: number;
  pullbackPct: number;
  handleDays: number;
  cupDays: number;
  cupDepthPct: number;
  leftRimDate: string;
  bottomDate: string;
  rightRimDate: string;
  // 財務指標
  marketCap: number | null;
  sharpe3m: number | null;
  sharpe6m: number | null;
  sharpe1y: number | null;
  roe: number | null;
  equityRatio: number | null;
  profitGrowthRate: number | null;
  prevProfitGrowthRate: number | null;
  hasBuyback: boolean;
}

type SortKey = keyof CwhStock;
type SortDir = "asc" | "desc";

const COLUMNS: { key: SortKey; label: string; align: "left" | "right"; tooltip?: string }[] = [
  { key: "symbol", label: "コード", align: "left", tooltip: "銘柄コード" },
  { key: "name", label: "銘柄名", align: "left" },
  { key: "marketSegment", label: "市場", align: "left", tooltip: "プライム(P)/スタンダード(S)/グロース(G)" },
  { key: "hasBuyback", label: "自株買", align: "left", tooltip: "直近90日間に自社株買い実施/発表あり" },
  { key: "stage", label: "ステージ", align: "left", tooltip: "READY: BO価格まで5%以内で反発中\nFORMING: ハンドル形成中" },
  { key: "currentPrice", label: "現在値", align: "right" },
  { key: "breakoutPrice", label: "BO価格", align: "right", tooltip: "ブレイクアウト価格（右リム高値）" },
  { key: "distancePct", label: "BO距離%", align: "right", tooltip: "現在値からブレイクアウト価格までの距離\n小さいほどブレイクアウトに近い" },
  { key: "pullbackPct", label: "押し目%", align: "right", tooltip: "ハンドル部分の押し目率（右リムからの最大下落%）\n1-12%が有効なハンドル" },
  { key: "marketCap", label: "時価総額", align: "right", tooltip: "時価総額（億円）" },
  { key: "sharpe3m", label: "SR3m", align: "right", tooltip: "シャープレシオ（3ヶ月、年率化）" },
  { key: "sharpe6m", label: "SR6m", align: "right", tooltip: "シャープレシオ（6ヶ月、年率化）" },
  { key: "sharpe1y", label: "SR1y", align: "right", tooltip: "シャープレシオ（1年、年率化）" },
  { key: "roe", label: "ROE%", align: "right", tooltip: "ROE（自己資本利益率）" },
  { key: "equityRatio", label: "自己資本%", align: "right", tooltip: "自己資本比率" },
  { key: "profitGrowthRate", label: "増益率%", align: "right", tooltip: "直近期の増益率（YoY）" },
  { key: "prevProfitGrowthRate", label: "前期増益%", align: "right", tooltip: "前期の増益率（前々期→前期）" },
  { key: "handleDays", label: "ハンドル日", align: "right", tooltip: "右リムからの経過日数" },
  { key: "cupDays", label: "カップ日", align: "right", tooltip: "左リムから右リムまでの日数（15-120日）" },
  { key: "cupDepthPct", label: "深さ%", align: "right", tooltip: "カップの深さ（リムから底までの下落率%）\n8-50%が有効" },
  { key: "rightRimDate", label: "右リム日", align: "right", tooltip: "右リム（カップ完成）の日付" },
];

function formatNum(v: number, digits = 1): string {
  return v.toLocaleString("ja-JP", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function marketLabel(seg: string): string {
  if (seg.includes("プライム")) return "P";
  if (seg.includes("スタンダード")) return "S";
  if (seg.includes("グロース")) return "G";
  return seg.slice(0, 2);
}

export default function CwhFormingPage() {
  const [stocks, setStocks] = useState<CwhStock[]>([]);
  const [scannedAt, setScannedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [sortKey, setSortKey] = useState<SortKey>("distancePct");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [search, setSearch] = useState("");
  const [marketFilter, setMarketFilter] = useState<Set<string>>(new Set());
  const [stageFilter, setStageFilter] = useState<string>("all"); // "all" | "handle_ready" | "handle_forming"
  const [buybackOnly, setBuybackOnly] = useState(false);

  // 範囲フィルタ
  const [distanceMin, setDistanceMin] = useState("");
  const [distanceMax, setDistanceMax] = useState("");
  const [pullbackMin, setPullbackMin] = useState("");
  const [pullbackMax, setPullbackMax] = useState("");
  const [handleDaysMin, setHandleDaysMin] = useState("");
  const [handleDaysMax, setHandleDaysMax] = useState("");
  const [cupDaysMin, setCupDaysMin] = useState("");
  const [cupDaysMax, setCupDaysMax] = useState("");
  const [cupDepthMin, setCupDepthMin] = useState("");
  const [cupDepthMax, setCupDepthMax] = useState("");
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");
  const [mcapMin, setMcapMin] = useState("");
  const [mcapMax, setMcapMax] = useState("");
  const [sharpe3mMin, setSharpe3mMin] = useState("");
  const [sharpe3mMax, setSharpe3mMax] = useState("");
  const [sharpe6mMin, setSharpe6mMin] = useState("");
  const [sharpe6mMax, setSharpe6mMax] = useState("");
  const [sharpe1yMin, setSharpe1yMin] = useState("");
  const [sharpe1yMax, setSharpe1yMax] = useState("");
  const [roeMin, setRoeMin] = useState("");
  const [roeMax, setRoeMax] = useState("");
  const [eqRatioMin, setEqRatioMin] = useState("");
  const [eqRatioMax, setEqRatioMax] = useState("");
  const [growthMin, setGrowthMin] = useState("");
  const [growthMax, setGrowthMax] = useState("");
  const [prevGrowthMin, setPrevGrowthMin] = useState("");
  const [prevGrowthMax, setPrevGrowthMax] = useState("");

  // グループ関連
  const [allGroups, setAllGroups] = useState<WatchlistGroup[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<number>>(new Set());
  const [watchlistGroupMap, setWatchlistGroupMap] = useState<Map<string, number[]>>(new Map());
  const [groupPopup, setGroupPopup] = useState<{ symbol: string; anchor: DOMRect } | null>(null);
  const [showBatchGroupPopup, setShowBatchGroupPopup] = useState(false);
  const [showGroupDropdown, setShowGroupDropdown] = useState(false);
  const groupDropdownRef = useRef<HTMLDivElement>(null);

  // 自社株買い詳細スキャン
  const [buybackScanning, setBuybackScanning] = useState<string | null>(null); // scanning symbol or null

  // スキャン関連
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<{ stage: string; current: number; total: number; message: string } | null>(null);
  const pollingRef = useRef<{ interval: ReturnType<typeof setInterval>; timeout: ReturnType<typeof setTimeout> } | null>(null);

  // ウォッチリストグループ取得
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/watchlist");
        const data = await res.json();
        if (data.groups) setAllGroups(data.groups);
        const map = new Map<string, number[]>();
        for (const s of data.stocks ?? []) {
          const ids = (s.groups ?? []).map((g: { id: number }) => g.id);
          if (ids.length > 0) map.set(s.symbol, ids);
        }
        setWatchlistGroupMap(map);
      } catch { /* ignore */ }
    })();
  }, []);

  // グループドロップダウン: 外側クリックで閉じる
  useEffect(() => {
    if (!showGroupDropdown) return;
    function handleClick(e: MouseEvent) {
      if (groupDropdownRef.current && !groupDropdownRef.current.contains(e.target as Node)) setShowGroupDropdown(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showGroupDropdown]);

  const loadData = useCallback(async () => {
    try {
      const res = await fetch("/api/cwh-forming");
      const data = await res.json();
      setStocks(data.stocks ?? []);
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
    if (pollingRef.current) {
      clearInterval(pollingRef.current.interval);
      clearTimeout(pollingRef.current.timeout);
    }

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/cwh-forming/status?scanId=${scanId}`);
        const data = await res.json();

        if (data.status === "completed") {
          if (pollingRef.current) {
            clearInterval(pollingRef.current.interval);
            clearTimeout(pollingRef.current.timeout);
            pollingRef.current = null;
          }
          setScanProgress(null);
          setScanning(false);
          await loadData();
        } else if (data.status === "failed") {
          if (pollingRef.current) {
            clearInterval(pollingRef.current.interval);
            clearTimeout(pollingRef.current.timeout);
            pollingRef.current = null;
          }
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
      setScanProgress(null);
      setScanning(false);
      setError("スキャンがタイムアウトしました。ページを再読み込みしてください。");
    }, 10 * 60 * 1000);

    pollingRef.current = { interval, timeout };
  }, [loadData]);

  const handleScan = async () => {
    setScanning(true);
    setError(null);
    try {
      const res = await fetch("/api/cwh-forming/scan", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "スキャンに失敗しました");
        setScanning(false);
        return;
      }

      if (data.scanId) {
        // Vercel: GitHub Actions で非同期実行 → ポーリング
        startPolling(data.scanId);
      } else {
        // ローカル: 同期完了
        await loadData();
        setScanning(false);
      }
    } catch {
      setError("スキャンの実行に失敗しました");
      setScanning(false);
    }
  };

  const handleBuybackScan = async (symbol: string) => {
    setBuybackScanning(symbol);
    try {
      const res = await fetch("/api/buyback-detail/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols: [symbol] }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(`自社株買い詳細取得エラー: ${data.error}`);
      }
    } catch {
      setError("自社株買い詳細の取得に失敗しました");
    } finally {
      setBuybackScanning(null);
    }
  };

  const handleEditGroups = (symbol: string, event: React.MouseEvent) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setGroupPopup({ symbol, anchor: rect });
  };

  const handleSaveGroups = async (symbol: string, groupIds: number[]) => {
    if (!watchlistGroupMap.has(symbol)) {
      const stock = stocks.find((s) => s.symbol === symbol);
      await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, name: stock?.name ?? symbol, market: "JP" }),
      });
    }
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
      return newGroup;
    } catch {
      throw new Error("Failed to create group");
    }
  };

  const handleBatchAddToGroup = async (symbols: string[], groupId: number) => {
    setWatchlistGroupMap((prev) => {
      const next = new Map(prev);
      for (const sym of symbols) {
        const ids = next.get(sym) ?? [];
        if (!ids.includes(groupId)) next.set(sym, [...ids, groupId]);
      }
      return next;
    });
    const res = await fetch("/api/watchlist/batch-groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbols, groupId }),
    });
    if (!res.ok) throw new Error("batch group add failed");
    return (await res.json()) as { updated: number; alreadyInGroup: number };
  };

  const filtered = useMemo(() => {
    let list = stocks;

    // グループフィルタ
    if (selectedGroupIds.size > 0) {
      list = list.filter((s) => {
        const gids = watchlistGroupMap.get(s.symbol);
        return gids?.some((id) => selectedGroupIds.has(id));
      });
    }

    // テキスト検索
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((s) =>
        s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q),
      );
    }

    // 市場フィルタ
    if (marketFilter.size > 0) {
      list = list.filter((s) => marketFilter.has(s.marketSegment));
    }

    // ステージフィルタ
    if (stageFilter !== "all") {
      list = list.filter((s) => s.stage === stageFilter);
    }

    // 自社株買いフィルタ
    if (buybackOnly) {
      list = list.filter((s) => s.hasBuyback);
    }

    // 範囲フィルタ共通ヘルパー (null値はフィルタ対象外 = 通過)
    const rangeFilter = (
      items: CwhStock[],
      getter: (s: CwhStock) => number | null,
      min: string,
      max: string,
    ): CwhStock[] => {
      const lo = min !== "" ? parseFloat(min) : NaN;
      const hi = max !== "" ? parseFloat(max) : NaN;
      if (isNaN(lo) && isNaN(hi)) return items;
      return items.filter((s) => {
        const v = getter(s);
        if (v == null) return false; // フィルタ設定時、null値は除外
        if (!isNaN(lo) && v < lo) return false;
        if (!isNaN(hi) && v > hi) return false;
        return true;
      });
    };

    list = rangeFilter(list, (s) => s.distancePct, distanceMin, distanceMax);
    list = rangeFilter(list, (s) => s.pullbackPct, pullbackMin, pullbackMax);
    list = rangeFilter(list, (s) => s.handleDays, handleDaysMin, handleDaysMax);
    list = rangeFilter(list, (s) => s.cupDays, cupDaysMin, cupDaysMax);
    list = rangeFilter(list, (s) => s.cupDepthPct, cupDepthMin, cupDepthMax);
    list = rangeFilter(list, (s) => s.currentPrice, priceMin, priceMax);
    list = rangeFilter(list, (s) => s.marketCap != null ? s.marketCap / 1e8 : null, mcapMin, mcapMax); // 億円換算
    list = rangeFilter(list, (s) => s.sharpe3m, sharpe3mMin, sharpe3mMax);
    list = rangeFilter(list, (s) => s.sharpe6m, sharpe6mMin, sharpe6mMax);
    list = rangeFilter(list, (s) => s.sharpe1y, sharpe1yMin, sharpe1yMax);
    list = rangeFilter(list, (s) => s.roe, roeMin, roeMax);
    list = rangeFilter(list, (s) => s.equityRatio, eqRatioMin, eqRatioMax);
    list = rangeFilter(list, (s) => s.profitGrowthRate, growthMin, growthMax);
    list = rangeFilter(list, (s) => s.prevProfitGrowthRate, prevGrowthMin, prevGrowthMax);

    // ソート
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
  }, [stocks, search, marketFilter, stageFilter, buybackOnly, sortKey, sortDir, selectedGroupIds, watchlistGroupMap, distanceMin, distanceMax, pullbackMin, pullbackMax, handleDaysMin, handleDaysMax, cupDaysMin, cupDaysMax, cupDepthMin, cupDepthMax, priceMin, priceMax, mcapMin, mcapMax, sharpe3mMin, sharpe3mMax, sharpe6mMin, sharpe6mMax, sharpe1yMin, sharpe1yMax, roeMin, roeMax, eqRatioMin, eqRatioMax, growthMin, growthMax, prevGrowthMin, prevGrowthMax]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      const ascKeys: SortKey[] = ["name", "symbol", "stage", "marketSegment"];
      setSortDir(ascKeys.includes(key) ? "asc" : "desc");
    }
  }

  function stageColor(stage: string): string {
    return stage === "handle_ready"
      ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
      : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300";
  }

  function distanceColor(pct: number): string {
    if (pct <= 2) return "text-emerald-600 dark:text-emerald-400 font-semibold";
    if (pct <= 5) return "text-green-600 dark:text-green-400";
    if (pct <= 8) return "text-yellow-600 dark:text-yellow-400";
    return "text-gray-500 dark:text-slate-400";
  }

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-gray-500 dark:text-slate-400">読み込み中...</div>
      </div>
    );
  }

  const markets = [...new Set(stocks.map((s) => s.marketSegment).filter(Boolean))].sort();

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            CWH形成中スキャナー
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
            カップウィズハンドル形成中の銘柄 - ブレイクアウト前のハンドル部分にある銘柄を表示
          </p>
        </div>
        <div className="flex items-center gap-3">
          {scannedAt && (
            <span className="text-xs text-gray-400 dark:text-slate-500">
              {new Date(scannedAt).toLocaleString("ja-JP")}
            </span>
          )}
          <span className="rounded-full bg-blue-100 px-3 py-1 text-sm font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
            {filtered.length} / {stocks.length}
          </span>
          {filtered.length > 0 && (
            <button
              onClick={() => setShowBatchGroupPopup(true)}
              className="rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-600 hover:bg-emerald-50 dark:border-emerald-600 dark:bg-slate-800 dark:text-emerald-400 dark:hover:bg-slate-700"
            >
              グループに追加
            </button>
          )}
          <CsvExportButton
            stocks={filtered}
            allGroups={allGroups}
            watchlistGroupMap={watchlistGroupMap}
            filenamePrefix="cwh-forming"
          />
          <button
            onClick={handleScan}
            disabled={scanning}
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-600"
          >
            {scanning ? "スキャン中..." : "スキャン更新"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-700 dark:border-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300">
          {error}
        </div>
      )}

      {scanning && scanProgress && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
          {scanProgress.message}
          {scanProgress.total > 0 && (
            <div className="mt-1 h-1.5 w-full rounded-full bg-blue-200 dark:bg-blue-800">
              <div
                className="h-1.5 rounded-full bg-blue-600 transition-all"
                style={{ width: `${Math.round((scanProgress.current / scanProgress.total) * 100)}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* Filters Row 1: Search + Stage + Market */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="検索 (コード/銘柄名)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-48 rounded-lg border border-gray-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-white"
        />

        {/* Stage filter */}
        <select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-white"
        >
          <option value="all">全ステージ</option>
          <option value="handle_ready">READY のみ</option>
          <option value="handle_forming">FORMING のみ</option>
        </select>

        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={buybackOnly}
            onChange={(e) => setBuybackOnly(e.target.checked)}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800"
          />
          <span className="text-xs font-medium text-gray-500 dark:text-slate-400">自株買あり</span>
        </label>

        {/* Group filter dropdown */}
        {allGroups.length > 0 && (
          <div className="relative" ref={groupDropdownRef}>
            <button
              onClick={() => setShowGroupDropdown((v) => !v)}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                selectedGroupIds.size > 0
                  ? "bg-emerald-600 text-white dark:bg-emerald-500"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
              }`}
            >
              グループ{selectedGroupIds.size > 0 && ` (${selectedGroupIds.size})`}
            </button>
            {showGroupDropdown && (
              <div className="absolute left-0 z-50 mt-1 min-w-[160px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-slate-600 dark:bg-slate-800">
                {allGroups.map((g) => (
                  <label key={g.id} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-slate-700">
                    <input
                      type="checkbox"
                      checked={selectedGroupIds.has(g.id)}
                      onChange={() => setSelectedGroupIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(g.id)) next.delete(g.id);
                        else next.add(g.id);
                        return next;
                      })}
                      className="rounded border-gray-300 text-emerald-600 dark:border-slate-500"
                    />
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: g.color }} />
                    <span className="text-xs text-gray-700 dark:text-slate-300">{g.name}</span>
                  </label>
                ))}
                {selectedGroupIds.size > 0 && (
                  <button
                    onClick={() => { setSelectedGroupIds(new Set()); setShowGroupDropdown(false); }}
                    className="w-full border-t border-gray-100 px-3 py-1.5 text-left text-xs text-red-500 hover:bg-gray-50 dark:border-slate-700 dark:hover:bg-slate-700"
                  >
                    クリア
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Market filter buttons */}
        {markets.map((m) => (
          <button
            key={m}
            onClick={() =>
              setMarketFilter((prev) => {
                const next = new Set(prev);
                if (next.has(m)) next.delete(m);
                else next.add(m);
                return next;
              })
            }
            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
              marketFilter.has(m)
                ? "bg-blue-600 text-white dark:bg-blue-500"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
            }`}
          >
            {marketLabel(m)}
          </button>
        ))}
      </div>

      {/* Filters Row 2: Pattern range filters */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-600 dark:text-slate-400">
        <RangeInput label="BO距離%" min={distanceMin} max={distanceMax} setMin={setDistanceMin} setMax={setDistanceMax} />
        <RangeInput label="押し目%" min={pullbackMin} max={pullbackMax} setMin={setPullbackMin} setMax={setPullbackMax} />
        <RangeInput label="ハンドル日" min={handleDaysMin} max={handleDaysMax} setMin={setHandleDaysMin} setMax={setHandleDaysMax} />
        <RangeInput label="カップ日" min={cupDaysMin} max={cupDaysMax} setMin={setCupDaysMin} setMax={setCupDaysMax} />
        <RangeInput label="深さ%" min={cupDepthMin} max={cupDepthMax} setMin={setCupDepthMin} setMax={setCupDepthMax} />
      </div>

      {/* Filters Row 3: Financial range filters */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-600 dark:text-slate-400">
        <RangeInput label="株価" min={priceMin} max={priceMax} setMin={setPriceMin} setMax={setPriceMax} />
        <RangeInput label="時価総額(億)" min={mcapMin} max={mcapMax} setMin={setMcapMin} setMax={setMcapMax} />
        <RangeInput label="SR3m" min={sharpe3mMin} max={sharpe3mMax} setMin={setSharpe3mMin} setMax={setSharpe3mMax} />
        <RangeInput label="SR6m" min={sharpe6mMin} max={sharpe6mMax} setMin={setSharpe6mMin} setMax={setSharpe6mMax} />
        <RangeInput label="SR1y" min={sharpe1yMin} max={sharpe1yMax} setMin={setSharpe1yMin} setMax={setSharpe1yMax} />
        <RangeInput label="ROE%" min={roeMin} max={roeMax} setMin={setRoeMin} setMax={setRoeMax} />
        <RangeInput label="自己資本%" min={eqRatioMin} max={eqRatioMax} setMin={setEqRatioMin} setMax={setEqRatioMax} />
        <RangeInput label="増益率%" min={growthMin} max={growthMax} setMin={setGrowthMin} setMax={setGrowthMax} />
        <RangeInput label="前期増益%" min={prevGrowthMin} max={prevGrowthMax} setMin={setPrevGrowthMin} setMax={setPrevGrowthMax} />
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-slate-800">
            <tr>
              <th className="w-8 px-1 py-2" />
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  title={col.tooltip}
                  className={`cursor-pointer whitespace-nowrap px-3 py-2 font-medium text-gray-600 hover:text-gray-900 dark:text-slate-400 dark:hover:text-white ${
                    col.align === "right" ? "text-right" : "text-left"
                  }`}
                >
                  {col.label}
                  {sortKey === col.key && (sortDir === "asc" ? " ▲" : " ▼")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
            {filtered.map((s) => (
              <tr key={s.symbol} className="hover:bg-gray-50 dark:hover:bg-slate-800/50">
                <td className="px-1 py-1.5 text-center">
                  <button
                    onClick={(e) => handleEditGroups(s.symbol, e)}
                    className="text-base leading-none"
                    title="グループに追加"
                  >
                    {watchlistGroupMap.has(s.symbol) ? (
                      <span className="text-yellow-400">&#9733;</span>
                    ) : (
                      <span className="text-gray-300 dark:text-slate-600 hover:text-yellow-300">&#9734;</span>
                    )}
                  </button>
                </td>
                <td className="px-3 py-1.5 font-mono text-xs">
                  <Link
                    href={`/stock/${s.symbol}`}
                    className="text-blue-600 hover:underline dark:text-blue-400"
                  >
                    {s.symbol.replace(".T", "")}
                  </Link>
                </td>
                <td className="max-w-[150px] truncate px-3 py-1.5">{s.name}</td>
                <td className="px-3 py-1.5 text-center text-xs text-gray-500">{marketLabel(s.marketSegment)}</td>
                <td className="px-3 py-1.5 text-center">
                  {s.hasBuyback
                    ? <span className="inline-flex items-center gap-1">
                        <Link href="/buyback-detail" className="text-blue-600 dark:text-blue-400 font-bold hover:underline" title="自社株買い詳細ページへ">●</Link>
                        <button
                          onClick={() => handleBuybackScan(s.symbol)}
                          disabled={buybackScanning === s.symbol}
                          className="text-[10px] text-gray-400 hover:text-blue-500 disabled:opacity-50"
                          title="この銘柄の自社株買い詳細をEDINETから取得"
                        >
                          {buybackScanning === s.symbol ? "..." : "解析"}
                        </button>
                      </span>
                    : <span className="text-gray-300 dark:text-slate-600">－</span>}
                </td>
                <td className="px-3 py-1.5">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${stageColor(s.stage)}`}>
                    {s.stage === "handle_ready" ? "READY" : "FORMING"}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-right font-mono">{s.currentPrice.toLocaleString()}</td>
                <td className="px-3 py-1.5 text-right font-mono">{s.breakoutPrice.toLocaleString()}</td>
                <td className={`px-3 py-1.5 text-right font-mono ${distanceColor(s.distancePct)}`}>
                  {formatNum(s.distancePct)}
                </td>
                <td className="px-3 py-1.5 text-right font-mono">{formatNum(s.pullbackPct)}</td>
                <td className="px-3 py-1.5 text-right font-mono text-xs text-gray-500 dark:text-slate-400">
                  {s.marketCap != null ? `${(s.marketCap / 1e8).toLocaleString("ja-JP", { maximumFractionDigits: 0 })}` : "-"}
                </td>
                <td className={`px-3 py-1.5 text-right font-mono text-xs ${s.sharpe3m != null && s.sharpe3m > 0 ? "text-green-600 dark:text-green-400" : s.sharpe3m != null && s.sharpe3m < 0 ? "text-red-500 dark:text-red-400" : "text-gray-500 dark:text-slate-400"}`}>
                  {s.sharpe3m != null ? formatNum(s.sharpe3m, 2) : "-"}
                </td>
                <td className={`px-3 py-1.5 text-right font-mono text-xs ${s.sharpe6m != null && s.sharpe6m > 0 ? "text-green-600 dark:text-green-400" : s.sharpe6m != null && s.sharpe6m < 0 ? "text-red-500 dark:text-red-400" : "text-gray-500 dark:text-slate-400"}`}>
                  {s.sharpe6m != null ? formatNum(s.sharpe6m, 2) : "-"}
                </td>
                <td className={`px-3 py-1.5 text-right font-mono text-xs ${s.sharpe1y != null && s.sharpe1y > 0 ? "text-green-600 dark:text-green-400" : s.sharpe1y != null && s.sharpe1y < 0 ? "text-red-500 dark:text-red-400" : "text-gray-500 dark:text-slate-400"}`}>
                  {s.sharpe1y != null ? formatNum(s.sharpe1y, 2) : "-"}
                </td>
                <td className={`px-3 py-1.5 text-right font-mono text-xs ${s.roe != null && s.roe >= 15 ? "text-green-600 dark:text-green-400 font-semibold" : s.roe != null && s.roe >= 10 ? "text-green-600 dark:text-green-400" : "text-gray-500 dark:text-slate-400"}`}>
                  {s.roe != null ? formatNum(s.roe) : "-"}
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-xs text-gray-500 dark:text-slate-400">
                  {s.equityRatio != null ? formatNum(s.equityRatio) : "-"}
                </td>
                <td className={`px-3 py-1.5 text-right font-mono text-xs ${s.profitGrowthRate != null && s.profitGrowthRate > 0 ? "text-green-600 dark:text-green-400" : s.profitGrowthRate != null && s.profitGrowthRate < 0 ? "text-red-500 dark:text-red-400" : "text-gray-500 dark:text-slate-400"}`}>
                  {s.profitGrowthRate != null ? formatNum(s.profitGrowthRate) : "-"}
                </td>
                <td className={`px-3 py-1.5 text-right font-mono text-xs ${s.prevProfitGrowthRate != null && s.prevProfitGrowthRate > 0 ? "text-green-600 dark:text-green-400" : s.prevProfitGrowthRate != null && s.prevProfitGrowthRate < 0 ? "text-red-500 dark:text-red-400" : "text-gray-500 dark:text-slate-400"}`}>
                  {s.prevProfitGrowthRate != null ? formatNum(s.prevProfitGrowthRate) : "-"}
                </td>
                <td className="px-3 py-1.5 text-right font-mono">{s.handleDays}</td>
                <td className="px-3 py-1.5 text-right font-mono">{s.cupDays}</td>
                <td className="px-3 py-1.5 text-right font-mono">{formatNum(s.cupDepthPct)}</td>
                <td className="px-3 py-1.5 text-right text-xs text-gray-500 dark:text-slate-400">{s.rightRimDate}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="py-12 text-center text-gray-400 dark:text-slate-500">
            条件に一致する銘柄がありません
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

      {showBatchGroupPopup && (
        <BatchGroupAssignPopup
          stockCount={filtered.length}
          allGroups={allGroups}
          onConfirm={async (groupId) => {
            const symbols = filtered.map((s) => s.symbol);
            return handleBatchAddToGroup(symbols, groupId);
          }}
          onCreateGroup={handleCreateGroup}
          onClose={() => setShowBatchGroupPopup(false)}
        />
      )}
    </div>
  );
}

// ── Range Input Component ──

function RangeInput({
  label,
  min,
  max,
  setMin,
  setMax,
}: {
  label: string;
  min: string;
  max: string;
  setMin: (v: string) => void;
  setMax: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="min-w-[60px] text-right">{label}</span>
      <input
        type="number"
        placeholder="min"
        value={min}
        onChange={(e) => setMin(e.target.value)}
        className="w-16 rounded border border-gray-300 px-1.5 py-1 text-xs dark:border-slate-600 dark:bg-slate-700 dark:text-white"
      />
      <span>-</span>
      <input
        type="number"
        placeholder="max"
        value={max}
        onChange={(e) => setMax(e.target.value)}
        className="w-16 rounded border border-gray-300 px-1.5 py-1 text-xs dark:border-slate-600 dark:bg-slate-700 dark:text-white"
      />
    </div>
  );
}

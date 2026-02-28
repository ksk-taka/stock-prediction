"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import Link from "next/link";
import GroupAssignPopup from "@/components/GroupAssignPopup";
import BatchGroupAssignPopup from "@/components/BatchGroupAssignPopup";
import CsvExportButton from "@/components/CsvExportButton";
import type { WatchlistGroup } from "@/types";
import {
  getBuybackDetailClientCache,
  setBuybackDetailClientCache,
  clearBuybackDetailClientCache,
} from "@/lib/cache/buybackDetailClientCache";

interface BuybackReport {
  reportPeriodFrom: string | null;
  reportPeriodTo: string | null;
  resolutionDate: string | null;
  acquisitionPeriodFrom: string | null;
  acquisitionPeriodTo: string | null;
  maxShares: number | null;
  maxAmount: number | null;
  sharesAcquired: number | null;
  amountSpent: number | null;
  cumulativeShares: number | null;
  cumulativeAmount: number | null;
  progressSharesPct: number | null;
  progressAmountPct: number | null;
  docId: string;
  filingDate: string;
}

interface Stock {
  stockCode: string;
  filerName: string;
  latestReport: BuybackReport | null;
  progressShares: number | null;
  progressAmount: number | null;
  isActive: boolean;
  scannedAt: string;
  remainingShares: number | null;
  avgDailyVolume: number | null;
  impactDays: number | null;
}

type SortKey =
  | "stockCode" | "filerName" | "maxAmount" | "cumulativeAmount"
  | "progressAmount" | "maxShares" | "cumulativeShares" | "progressShares"
  | "resolutionDate" | "acquisitionPeriodTo" | "isActive" | "filingDate"
  | "remainingShares" | "avgDailyVolume" | "impactDays";

type SortDir = "asc" | "desc";

const COLUMNS: { key: SortKey; label: string; align: "left" | "right"; tooltip?: string }[] = [
  { key: "stockCode", label: "コード", align: "left" },
  { key: "filerName", label: "銘柄名", align: "left" },
  { key: "isActive", label: "状態", align: "left", tooltip: "実施中 / 完了" },
  { key: "maxAmount", label: "取得上限", align: "right", tooltip: "取得上限金額（億円）" },
  { key: "cumulativeAmount", label: "累計取得", align: "right", tooltip: "累計取得金額（億円）" },
  { key: "progressAmount", label: "金額進捗", align: "right", tooltip: "金額ベースの取得進捗率" },
  { key: "maxShares", label: "上限株数", align: "right", tooltip: "取得上限株数（万株）" },
  { key: "cumulativeShares", label: "累計株数", align: "right", tooltip: "累計取得株数（万株）" },
  { key: "progressShares", label: "株数進捗", align: "right", tooltip: "株数ベースの取得進捗率" },
  { key: "remainingShares", label: "残り株数", align: "right", tooltip: "残り取得可能株数（万株）" },
  { key: "avgDailyVolume", label: "平均出来高", align: "right", tooltip: "3ヶ月平均出来高（万株）" },
  { key: "impactDays", label: "インパクト日数", align: "right", tooltip: "25%ルールで買付完了までの営業日数 (残り株数÷平均出来高×25%)" },
  { key: "resolutionDate", label: "決議日", align: "right", tooltip: "取締役会決議日" },
  { key: "acquisitionPeriodTo", label: "取得期限", align: "right", tooltip: "取得期間の終了日" },
  { key: "filingDate", label: "報告日", align: "right", tooltip: "最新報告書の提出日" },
];

function getVal(s: Stock, key: SortKey): string | number | boolean | null {
  const r = s.latestReport;
  switch (key) {
    case "stockCode": return s.stockCode;
    case "filerName": return s.filerName;
    case "isActive": return s.isActive;
    case "maxAmount": return r?.maxAmount ?? null;
    case "cumulativeAmount": return r?.cumulativeAmount ?? null;
    case "progressAmount": return s.progressAmount;
    case "maxShares": return r?.maxShares ?? null;
    case "cumulativeShares": return r?.cumulativeShares ?? null;
    case "progressShares": return s.progressShares;
    case "remainingShares": return s.remainingShares;
    case "avgDailyVolume": return s.avgDailyVolume;
    case "impactDays": return s.impactDays;
    case "resolutionDate": return r?.resolutionDate ?? null;
    case "acquisitionPeriodTo": return r?.acquisitionPeriodTo ?? null;
    case "filingDate": return r?.filingDate ?? null;
  }
}

function fmtOku(v: number | null): string {
  if (v == null) return "－";
  const oku = v / 1e8;
  return oku >= 100
    ? `${Math.round(oku).toLocaleString()}億`
    : `${oku.toFixed(1)}億`;
}

function fmtMan(v: number | null): string {
  if (v == null) return "－";
  const man = v / 10000;
  return man >= 100
    ? `${Math.round(man).toLocaleString()}万`
    : `${man.toFixed(1)}万`;
}

function progressColor(pct: number | null): string {
  if (pct == null) return "";
  if (pct >= 80) return "text-green-600 dark:text-green-400 font-semibold";
  if (pct >= 50) return "text-blue-600 dark:text-blue-400";
  return "text-gray-600 dark:text-slate-400";
}

function impactColor(days: number | null): string {
  if (days == null) return "";
  if (days <= 20) return "text-red-600 dark:text-red-400 font-bold";
  if (days <= 60) return "text-orange-600 dark:text-orange-400 font-semibold";
  return "text-gray-600 dark:text-slate-400";
}

function daysUntil(dateStr: string): number | null {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  return Math.ceil((d.getTime() - now.getTime()) / 86400000);
}

export default function BuybackDetailPage() {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [totalBuybackCodes, setTotalBuybackCodes] = useState(0);

  const [sortKey, setSortKey] = useState<SortKey>("progressAmount");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [search, setSearch] = useState("");
  const [activeOnly, setActiveOnly] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [scanSymbols, setScanSymbols] = useState("");

  // 範囲フィルタ
  const [maxAmountMin, setMaxAmountMin] = useState("");
  const [maxAmountMax, setMaxAmountMax] = useState("");
  const [cumAmountMin, setCumAmountMin] = useState("");
  const [cumAmountMax, setCumAmountMax] = useState("");
  const [progAmountMin, setProgAmountMin] = useState("");
  const [progAmountMax, setProgAmountMax] = useState("");
  const [maxSharesMin, setMaxSharesMin] = useState("");
  const [maxSharesMax, setMaxSharesMax] = useState("");
  const [cumSharesMin, setCumSharesMin] = useState("");
  const [cumSharesMax, setCumSharesMax] = useState("");
  const [progSharesMin, setProgSharesMin] = useState("");
  const [progSharesMax, setProgSharesMax] = useState("");
  const [remSharesMin, setRemSharesMin] = useState("");
  const [remSharesMax, setRemSharesMax] = useState("");
  const [avgVolMin, setAvgVolMin] = useState("");
  const [avgVolMax, setAvgVolMax] = useState("");
  const [impactMin, setImpactMin] = useState("");
  const [impactMax, setImpactMax] = useState("");

  // グループ関連
  const [allGroups, setAllGroups] = useState<WatchlistGroup[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<number>>(new Set());
  const [watchlistGroupMap, setWatchlistGroupMap] = useState<Map<string, number[]>>(new Map());
  const [groupPopup, setGroupPopup] = useState<{ symbol: string; anchor: DOMRect } | null>(null);
  const [showBatchGroupPopup, setShowBatchGroupPopup] = useState(false);
  const [showGroupDropdown, setShowGroupDropdown] = useState(false);
  const groupDropdownRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!showGroupDropdown) return;
    function handleClick(e: MouseEvent) {
      if (groupDropdownRef.current && !groupDropdownRef.current.contains(e.target as Node)) setShowGroupDropdown(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showGroupDropdown]);

  const loadData = useCallback(async () => {
    // 1. IndexedDB キャッシュを先に表示
    try {
      const cached = await getBuybackDetailClientCache();
      if (cached && cached.stocks.length > 0) {
        setStocks(cached.stocks as Stock[]);
        setTotalBuybackCodes(cached.totalBuybackCodes);
        setLoading(false);
      }
    } catch { /* ignore */ }

    // 2. APIから最新データ取得（バックグラウンド更新）
    try {
      const res = await fetch("/api/buyback-detail");
      const data = await res.json();
      setStocks(data.stocks ?? []);
      setTotalBuybackCodes(data.totalBuybackCodes ?? 0);
      if (data.error) setError(data.error);
      else setError(null);
      // キャッシュ保存
      if (data.stocks?.length > 0) {
        setBuybackDetailClientCache(data.stocks, data.totalBuybackCodes ?? 0);
      }
    } catch {
      setError("データの取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleScan = async (symbols?: string[]) => {
    setScanning(true);
    setScanMessage(null);
    try {
      const body = symbols ? { symbols } : {};
      const res = await fetch("/api/buyback-detail/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        setScanMessage(data.message);
        // スキャン開始後はキャッシュクリア（次回リロードで最新取得）
        clearBuybackDetailClientCache();
      } else {
        setScanMessage(`エラー: ${data.error}`);
      }
    } catch {
      setScanMessage("スキャンの開始に失敗しました");
    } finally {
      setScanning(false);
    }
  };

  const handleTargetedScan = () => {
    const syms = scanSymbols
      .split(/[,\s、]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => (s.endsWith(".T") ? s : `${s}.T`));
    if (syms.length === 0) return;
    handleScan(syms);
  };

  const handleEditGroups = (symbol: string, event: React.MouseEvent) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setGroupPopup({ symbol, anchor: rect });
  };

  const handleSaveGroups = async (symbol: string, groupIds: number[]) => {
    if (!watchlistGroupMap.has(symbol)) {
      const stock = stocks.find((s) => `${s.stockCode}.T` === symbol);
      await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, name: stock?.filerName ?? symbol, market: "JP" }),
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

    if (selectedGroupIds.size > 0) {
      list = list.filter((s) => {
        const gids = watchlistGroupMap.get(`${s.stockCode}.T`);
        return gids?.some((id) => selectedGroupIds.has(id));
      });
    }

    if (search) {
      const q = search.toLowerCase();
      list = list.filter((s) =>
        s.stockCode.includes(q) || s.filerName.toLowerCase().includes(q),
      );
    }

    if (activeOnly) {
      list = list.filter((s) => s.isActive);
    }

    // 範囲フィルタ (null値はフィルタ対象外 = 通過)
    const rf = (
      items: Stock[],
      getter: (s: Stock) => number | null,
      min: string,
      max: string,
    ): Stock[] => {
      if (min === "" && max === "") return items;
      const lo = min !== "" ? parseFloat(min) : -Infinity;
      const hi = max !== "" ? parseFloat(max) : Infinity;
      return items.filter((s) => {
        const v = getter(s);
        if (v == null) return false;
        return v >= lo && v <= hi;
      });
    };

    list = rf(list, (s) => s.latestReport?.maxAmount != null ? s.latestReport.maxAmount / 1e8 : null, maxAmountMin, maxAmountMax);
    list = rf(list, (s) => s.latestReport?.cumulativeAmount != null ? s.latestReport.cumulativeAmount / 1e8 : null, cumAmountMin, cumAmountMax);
    list = rf(list, (s) => s.progressAmount, progAmountMin, progAmountMax);
    list = rf(list, (s) => s.latestReport?.maxShares != null ? s.latestReport.maxShares / 10000 : null, maxSharesMin, maxSharesMax);
    list = rf(list, (s) => s.latestReport?.cumulativeShares != null ? s.latestReport.cumulativeShares / 10000 : null, cumSharesMin, cumSharesMax);
    list = rf(list, (s) => s.progressShares, progSharesMin, progSharesMax);
    list = rf(list, (s) => s.remainingShares != null ? s.remainingShares / 10000 : null, remSharesMin, remSharesMax);
    list = rf(list, (s) => s.avgDailyVolume != null ? s.avgDailyVolume / 10000 : null, avgVolMin, avgVolMax);
    list = rf(list, (s) => s.impactDays, impactMin, impactMax);

    list = [...list].sort((a, b) => {
      const av = getVal(a, sortKey);
      const bv = getVal(b, sortKey);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "boolean" && typeof bv === "boolean") {
        return sortDir === "asc" ? (av === bv ? 0 : av ? -1 : 1) : (av === bv ? 0 : av ? 1 : -1);
      }
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      return 0;
    });

    return list;
  }, [stocks, search, activeOnly, sortKey, sortDir, selectedGroupIds, watchlistGroupMap, maxAmountMin, maxAmountMax, cumAmountMin, cumAmountMax, progAmountMin, progAmountMax, maxSharesMin, maxSharesMax, cumSharesMin, cumSharesMax, progSharesMin, progSharesMax, remSharesMin, remSharesMax, avgVolMin, avgVolMax, impactMin, impactMax]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      const ascKeys: SortKey[] = ["stockCode", "filerName"];
      setSortDir(ascKeys.includes(key) ? "asc" : "desc");
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-gray-500 dark:text-slate-400">読み込み中...</div>
      </div>
    );
  }

  const csvStocks = filtered.map((s) => ({
    symbol: `${s.stockCode}.T`,
    name: s.filerName,
  }));

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            自社株買い詳細
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
            EDINET 自己株券買付状況報告書から取得上限・累計・進捗率を抽出
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <input
              type="text"
              placeholder="7203,6758..."
              value={scanSymbols}
              onChange={(e) => setScanSymbols(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && scanSymbols.trim() && handleTargetedScan()}
              className="w-32 rounded-lg border border-gray-300 px-2 py-1.5 text-xs focus:border-blue-400 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-white"
              title="銘柄コードをカンマ区切りで入力"
            />
            <button
              onClick={handleTargetedScan}
              disabled={scanning || !scanSymbols.trim()}
              className="rounded-lg border border-blue-300 bg-white px-2 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-50 dark:border-blue-600 dark:bg-slate-800 dark:text-blue-400 dark:hover:bg-slate-700"
            >
              指定スキャン
            </button>
          </div>
          <button
            onClick={() => handleScan()}
            disabled={scanning}
            className="rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-50 dark:border-blue-600 dark:bg-slate-800 dark:text-blue-400 dark:hover:bg-slate-700"
          >
            {scanning ? "スキャン中..." : "全銘柄スキャン"}
          </button>
          <span className="rounded-full bg-blue-100 px-3 py-1 text-sm font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
            {filtered.length} / {stocks.length}
          </span>
          {totalBuybackCodes > stocks.length && (
            <span className="text-xs text-gray-400 dark:text-slate-500" title="詳細データ未取得の銘柄があります">
              (買付銘柄 {totalBuybackCodes} 中 {stocks.length} 件取得済)
            </span>
          )}
          {filtered.length > 0 && (
            <button
              onClick={() => setShowBatchGroupPopup(true)}
              className="rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-600 hover:bg-emerald-50 dark:border-emerald-600 dark:bg-slate-800 dark:text-emerald-400 dark:hover:bg-slate-700"
            >
              グループに追加
            </button>
          )}
          <CsvExportButton
            stocks={csvStocks}
            allGroups={allGroups}
            watchlistGroupMap={watchlistGroupMap}
            filenamePrefix="buyback-detail"
          />
        </div>
      </div>

      {scanMessage && (
        <div className={`rounded-lg p-3 text-sm ${scanMessage.startsWith("エラー") ? "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300" : "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300"}`}>
          {scanMessage}
        </div>
      )}
      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="コード・名前で検索..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-400 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-white"
        />
        <label className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-slate-300">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => setActiveOnly(e.target.checked)}
            className="rounded border-gray-300"
          />
          実施中のみ
        </label>

        {/* グループフィルタ */}
        {allGroups.length > 0 && (
          <div className="relative" ref={groupDropdownRef}>
            <button
              onClick={() => setShowGroupDropdown(!showGroupDropdown)}
              className={`rounded-lg border px-3 py-1.5 text-sm ${selectedGroupIds.size > 0 ? "border-blue-400 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-900/30 dark:text-blue-300" : "border-gray-300 text-gray-600 dark:border-slate-600 dark:text-slate-300"}`}
            >
              グループ {selectedGroupIds.size > 0 ? `(${selectedGroupIds.size})` : ""}
            </button>
            {showGroupDropdown && (
              <div className="absolute z-20 mt-1 rounded-lg border border-gray-200 bg-white p-2 shadow-lg dark:border-slate-600 dark:bg-slate-800">
                {allGroups.map((g) => (
                  <label key={g.id} className="flex items-center gap-2 px-2 py-1 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedGroupIds.has(g.id)}
                      onChange={(e) => {
                        setSelectedGroupIds((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(g.id);
                          else next.delete(g.id);
                          return next;
                        });
                      }}
                    />
                    <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: g.color }} />
                    {g.name}
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 範囲フィルタ */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-600 dark:text-slate-400">
        <RangeInput label="上限(億)" min={maxAmountMin} max={maxAmountMax} setMin={setMaxAmountMin} setMax={setMaxAmountMax} />
        <RangeInput label="累計(億)" min={cumAmountMin} max={cumAmountMax} setMin={setCumAmountMin} setMax={setCumAmountMax} />
        <RangeInput label="金額進捗%" min={progAmountMin} max={progAmountMax} setMin={setProgAmountMin} setMax={setProgAmountMax} />
        <RangeInput label="上限(万株)" min={maxSharesMin} max={maxSharesMax} setMin={setMaxSharesMin} setMax={setMaxSharesMax} />
        <RangeInput label="累計(万株)" min={cumSharesMin} max={cumSharesMax} setMin={setCumSharesMin} setMax={setCumSharesMax} />
        <RangeInput label="株数進捗%" min={progSharesMin} max={progSharesMax} setMin={setProgSharesMin} setMax={setProgSharesMax} />
        <RangeInput label="残り(万株)" min={remSharesMin} max={remSharesMax} setMin={setRemSharesMin} setMax={setRemSharesMax} />
        <RangeInput label="出来高(万)" min={avgVolMin} max={avgVolMax} setMin={setAvgVolMin} setMax={setAvgVolMax} />
        <RangeInput label="インパクト日" min={impactMin} max={impactMax} setMin={setImpactMin} setMax={setImpactMax} />
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 dark:bg-slate-800">
            <tr>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  title={col.tooltip}
                  className={`cursor-pointer select-none whitespace-nowrap px-3 py-2 text-xs font-medium uppercase tracking-wider text-gray-500 hover:text-gray-900 dark:text-slate-400 dark:hover:text-white ${col.align === "right" ? "text-right" : "text-left"}`}
                >
                  {col.label}
                  {sortKey === col.key && (sortDir === "asc" ? " ▲" : " ▼")}
                </th>
              ))}
              <th className="px-3 py-2 text-xs text-gray-500">G</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
            {filtered.map((s) => {
              const r = s.latestReport;
              const sym = `${s.stockCode}.T`;
              const groupIds = watchlistGroupMap.get(sym) ?? [];
              const periodTo = r?.acquisitionPeriodTo;
              const remaining = periodTo ? daysUntil(periodTo) : null;

              return (
                <tr
                  key={s.stockCode}
                  className="hover:bg-gray-50 dark:hover:bg-slate-800/50"
                >
                  {/* コード */}
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                    <Link
                      href={`/?symbol=${sym}`}
                      className="text-blue-600 hover:underline dark:text-blue-400"
                    >
                      {s.stockCode}
                    </Link>
                  </td>
                  {/* 銘柄名 */}
                  <td className="max-w-[180px] truncate px-3 py-2 text-xs" title={s.filerName}>
                    {s.filerName}
                  </td>
                  {/* 状態 */}
                  <td className="whitespace-nowrap px-3 py-2 text-xs">
                    {s.isActive ? (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-green-700 dark:bg-green-900/30 dark:text-green-300">
                        実施中
                      </span>
                    ) : (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-500 dark:bg-slate-700 dark:text-slate-400">
                        完了
                      </span>
                    )}
                  </td>
                  {/* 取得上限 */}
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs">
                    {fmtOku(r?.maxAmount ?? null)}
                  </td>
                  {/* 累計取得 */}
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs">
                    {fmtOku(r?.cumulativeAmount ?? null)}
                  </td>
                  {/* 金額進捗 */}
                  <td className={`whitespace-nowrap px-3 py-2 text-right font-mono text-xs ${progressColor(s.progressAmount)}`}>
                    {s.progressAmount != null ? `${s.progressAmount.toFixed(1)}%` : "－"}
                  </td>
                  {/* 上限株数 */}
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs">
                    {fmtMan(r?.maxShares ?? null)}
                  </td>
                  {/* 累計株数 */}
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs">
                    {fmtMan(r?.cumulativeShares ?? null)}
                  </td>
                  {/* 株数進捗 */}
                  <td className={`whitespace-nowrap px-3 py-2 text-right font-mono text-xs ${progressColor(s.progressShares)}`}>
                    {s.progressShares != null ? `${s.progressShares.toFixed(1)}%` : "－"}
                  </td>
                  {/* 残り株数 */}
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs">
                    {fmtMan(s.remainingShares)}
                  </td>
                  {/* 平均出来高 */}
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs">
                    {fmtMan(s.avgDailyVolume)}
                  </td>
                  {/* インパクト日数 */}
                  <td className={`whitespace-nowrap px-3 py-2 text-right font-mono text-xs ${impactColor(s.impactDays)}`}>
                    {s.impactDays != null ? `${s.impactDays}日` : "－"}
                  </td>
                  {/* 決議日 */}
                  <td className="whitespace-nowrap px-3 py-2 text-right text-xs text-gray-600 dark:text-slate-400">
                    {r?.resolutionDate ?? "－"}
                  </td>
                  {/* 取得期限 */}
                  <td className="whitespace-nowrap px-3 py-2 text-right text-xs">
                    {periodTo ? (
                      <span className={remaining != null && remaining >= 0 && remaining <= 30 ? "font-bold text-orange-600 dark:text-orange-400" : "text-gray-600 dark:text-slate-400"}>
                        {periodTo}
                        {remaining != null && remaining >= 0 && (
                          <span className="ml-1 text-[10px]">({remaining}日)</span>
                        )}
                      </span>
                    ) : "－"}
                  </td>
                  {/* 報告日 */}
                  <td className="whitespace-nowrap px-3 py-2 text-right text-xs text-gray-600 dark:text-slate-400">
                    {r?.filingDate ?? "－"}
                  </td>
                  {/* グループ */}
                  <td className="whitespace-nowrap px-3 py-2">
                    <button
                      onClick={(e) => handleEditGroups(sym, e)}
                      className="text-xs text-gray-400 hover:text-blue-500"
                      title="グループ編集"
                    >
                      {groupIds.length > 0
                        ? allGroups
                            .filter((g) => groupIds.includes(g.id))
                            .map((g) => (
                              <span
                                key={g.id}
                                className="mr-0.5 inline-block h-2.5 w-2.5 rounded-full"
                                style={{ backgroundColor: g.color }}
                              />
                            ))
                        : "+"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="py-12 text-center text-sm text-gray-400 dark:text-slate-500">
            {stocks.length === 0
              ? "詳細データがありません。npm run fetch:buyback:detail を実行してください。"
              : "条件に一致する銘柄がありません"}
          </div>
        )}
      </div>

      {/* Popups */}
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
            const symbols = filtered.map((s) => `${s.stockCode}.T`);
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
      <span className="min-w-[70px] text-right">{label}</span>
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

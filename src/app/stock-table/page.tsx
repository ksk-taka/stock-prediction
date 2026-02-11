"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import Link from "next/link";
import { formatMarketCap, getCapSize } from "@/lib/utils/format";
import GroupAssignPopup from "@/components/GroupAssignPopup";

// ── 型定義 ──

interface WatchlistGroup {
  id: number;
  name: string;
  color: string;
  sortOrder: number;
}

interface Stock {
  symbol: string;
  name: string;
  market: "JP" | "US";
  marketSegment?: string;
  favorite?: boolean;
  groupIds?: number[];
}

interface StockTableRow {
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
  volume: number;
  per: number | null;
  eps: number | null;
  pbr: number | null;
  simpleNcRatio: number | null;
  cnPer: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  weekHigh: number | null;
  weekLow: number | null;
  monthHigh: number | null;
  monthLow: number | null;
  yearHigh: number | null;
  yearLow: number | null;
  lastYearHigh: number | null;
  lastYearLow: number | null;
  earningsDate: string | null;
  marketCap: number | null;
}

interface MergedRow extends StockTableRow {
  code: string;
  market: string;
  marketSegment?: string;
  favorite?: boolean;
}

type SortKey = keyof MergedRow;
type SortDir = "asc" | "desc";

// ── カラム定義 ──

interface ColumnDef {
  key: SortKey;
  label: string;
  group: string;
  align: "left" | "right";
  defaultVisible: boolean;
}

const COLUMNS: ColumnDef[] = [
  { key: "code", label: "コード", group: "基本", align: "left", defaultVisible: true },
  { key: "name", label: "銘柄名", group: "基本", align: "left", defaultVisible: true },
  { key: "market", label: "市場", group: "基本", align: "left", defaultVisible: true },
  { key: "price", label: "現在値", group: "基本", align: "right", defaultVisible: true },
  { key: "changePercent", label: "前日比%", group: "基本", align: "right", defaultVisible: true },
  { key: "volume", label: "出来高", group: "基本", align: "right", defaultVisible: true },
  { key: "per", label: "PER", group: "指標", align: "right", defaultVisible: true },
  { key: "eps", label: "EPS", group: "指標", align: "right", defaultVisible: true },
  { key: "pbr", label: "PBR", group: "指標", align: "right", defaultVisible: true },
  { key: "marketCap", label: "時価総額", group: "指標", align: "right", defaultVisible: true },
  { key: "simpleNcRatio", label: "簡易NC率", group: "指標", align: "right", defaultVisible: false },
  { key: "cnPer", label: "簡易CNPER", group: "指標", align: "right", defaultVisible: true },
  { key: "earningsDate", label: "決算日", group: "指標", align: "right", defaultVisible: true },
  { key: "dayHigh", label: "日高値", group: "日", align: "right", defaultVisible: false },
  { key: "dayLow", label: "日安値", group: "日", align: "right", defaultVisible: false },
  { key: "weekHigh", label: "週高値", group: "週", align: "right", defaultVisible: false },
  { key: "weekLow", label: "週安値", group: "週", align: "right", defaultVisible: false },
  { key: "monthHigh", label: "月高値", group: "月", align: "right", defaultVisible: false },
  { key: "monthLow", label: "月安値", group: "月", align: "right", defaultVisible: false },
  { key: "yearHigh", label: "年高値", group: "年", align: "right", defaultVisible: false },
  { key: "yearLow", label: "年安値", group: "年", align: "right", defaultVisible: false },
  { key: "lastYearHigh", label: "昨年高値", group: "昨年", align: "right", defaultVisible: false },
  { key: "lastYearLow", label: "昨年安値", group: "昨年", align: "right", defaultVisible: false },
];

const MARKET_FILTERS = [
  { label: "全て", value: "" },
  { label: "プライム", value: "プライム" },
  { label: "スタンダード", value: "スタンダード" },
  { label: "グロース", value: "グロース" },
];

const BATCH_SIZE = 50;
const TABLE_DATA_CACHE_KEY = "stock-table-data";
const TABLE_DATA_CACHE_TTL = 10 * 60 * 1000; // 10分

// ── 決算日フィルタ プリセット ──

interface EarningsPreset {
  label: string;
  value: string;
  getRange: () => [string, string]; // [from, to] YYYY-MM-DD
}

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function getMonday(d: Date): Date {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(d);
  mon.setDate(d.getDate() + diff);
  return mon;
}

const EARNINGS_PRESETS: EarningsPreset[] = [
  {
    label: "今週",
    value: "this_week",
    getRange: () => {
      const now = new Date();
      const mon = getMonday(now);
      const sun = new Date(mon);
      sun.setDate(mon.getDate() + 6);
      return [toISO(mon), toISO(sun)];
    },
  },
  {
    label: "来週",
    value: "next_week",
    getRange: () => {
      const now = new Date();
      const mon = getMonday(now);
      mon.setDate(mon.getDate() + 7);
      const sun = new Date(mon);
      sun.setDate(mon.getDate() + 6);
      return [toISO(mon), toISO(sun)];
    },
  },
  {
    label: "今月",
    value: "this_month",
    getRange: () => {
      const now = new Date();
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return [toISO(first), toISO(last)];
    },
  },
  {
    label: "来月",
    value: "next_month",
    getRange: () => {
      const now = new Date();
      const first = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth() + 2, 0);
      return [toISO(first), toISO(last)];
    },
  },
];

// ── Google Calendar URL生成 ──

function googleCalendarUrl(date: string, stockName: string, code: string): string {
  // date: "YYYY-MM-DD" → all-day event (end date is exclusive, so +1 day)
  const start = date.replace(/-/g, "");
  const d = new Date(date);
  d.setDate(d.getDate() + 1);
  const end = d.toISOString().slice(0, 10).replace(/-/g, "");
  const title = encodeURIComponent(`${code} ${stockName} 決算発表`);
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${start}/${end}`;
}

// ── ヘルパー ──

function formatNum(v: number | null, digits = 1): string {
  if (v === null || v === undefined) return "－";
  return v.toLocaleString("ja-JP", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatPrice(v: number | null): string {
  if (v === null || v === undefined || v === 0) return "－";
  if (v >= 10000) return v.toLocaleString("ja-JP", { maximumFractionDigits: 0 });
  return v.toLocaleString("ja-JP", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function formatVolume(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return String(v);
}

function changePctColor(v: number): string {
  if (v > 0) return "text-red-600 dark:text-red-400";
  if (v < 0) return "text-blue-600 dark:text-blue-400";
  return "";
}

// ── メインコンポーネント ──

export default function StockTablePage() {
  // 銘柄リスト (ウォッチリストから)
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [loadingStocks, setLoadingStocks] = useState(true);

  // テーブルデータ (sessionStorageからリストア)
  const [tableData, setTableData] = useState<Map<string, StockTableRow>>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = sessionStorage.getItem(TABLE_DATA_CACHE_KEY);
        if (saved) {
          const { data, timestamp } = JSON.parse(saved);
          if (Date.now() - timestamp < TABLE_DATA_CACHE_TTL) {
            return new Map(Object.entries(data) as [string, StockTableRow][]);
          }
        }
      } catch { /* ignore */ }
    }
    return new Map();
  });
  const [loadingData, setLoadingData] = useState(false);
  const [loadedCount, setLoadedCount] = useState(0);
  const [fetchTotal, setFetchTotal] = useState(0); // 実際にフェッチする件数

  // tableData変更時にsessionStorageに保存
  useEffect(() => {
    if (tableData.size === 0) return;
    try {
      const obj: Record<string, StockTableRow> = {};
      tableData.forEach((v, k) => { obj[k] = v; });
      sessionStorage.setItem(TABLE_DATA_CACHE_KEY, JSON.stringify({
        data: obj,
        timestamp: Date.now(),
      }));
    } catch { /* ignore */ }
  }, [tableData]);

  // フィルタ・ソート
  const [allGroups, setAllGroups] = useState<WatchlistGroup[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<number>>(new Set());
  const [marketFilter, setMarketFilter] = useState("");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("code");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // 時価総額フィルタ
  const [capSizeFilter, setCapSizeFilter] = useState<Set<string>>(new Set());

  // グループポップアップ
  const [groupPopup, setGroupPopup] = useState<{ symbol: string; anchor: DOMRect } | null>(null);

  // 決算日フィルタ
  const [earningsPreset, setEarningsPreset] = useState("");
  const [earningsFrom, setEarningsFrom] = useState("");
  const [earningsTo, setEarningsTo] = useState("");

  // カラム表示 (localStorage永続化)
  const COLUMNS_STORAGE_KEY = "stock-table-visible-columns";
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(COLUMNS_STORAGE_KEY);
        if (saved) {
          const arr = JSON.parse(saved) as string[];
          if (Array.isArray(arr) && arr.length > 0) return new Set(arr);
        }
      } catch { /* ignore */ }
    }
    const s = new Set<string>();
    COLUMNS.forEach((c) => { if (c.defaultVisible) s.add(c.key); });
    return s;
  });
  const [showColumnPicker, setShowColumnPicker] = useState(false);

  // visibleColumns変更時にlocalStorageに保存
  useEffect(() => {
    try {
      localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(Array.from(visibleColumns)));
    } catch { /* ignore */ }
  }, [visibleColumns]);

  // ── ウォッチリスト読み込み ──
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/watchlist");
        const data = await res.json();
        const stockList = (data.stocks ?? []).map((s: Stock & { groups?: { id: number }[] }) => ({
          ...s,
          groupIds: s.groups?.map((g) => g.id) ?? [],
        }));
        setStocks(stockList);
        if (data.groups) setAllGroups(data.groups);
      } catch {
        // ignore
      } finally {
        setLoadingStocks(false);
      }
    })();
  }, []);

  // ── フィルタ適用済みリスト ──
  const filteredStocks = useMemo(() => {
    let list = stocks;
    if (selectedGroupIds.size > 0) list = list.filter((s) => s.groupIds?.some((id) => selectedGroupIds.has(id)));
    if (marketFilter) {
      list = list.filter((s) => s.marketSegment?.includes(marketFilter));
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (s) =>
          s.symbol.toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q),
      );
    }
    return list;
  }, [stocks, selectedGroupIds, marketFilter, search]);

  // ── データ取得 ──
  // refで既存データを参照（useEffectの依存配列に入れずに済む）
  const tableDataRef = useRef(tableData);
  tableDataRef.current = tableData;

  const fetchTableData = useCallback(
    async (symbolList: string[]) => {
      if (symbolList.length === 0) return;

      // 既にフェッチ済みのシンボルを除外
      const missing = symbolList.filter((s) => !tableDataRef.current.has(s));
      if (missing.length === 0) return; // 全てキャッシュ済み → 何もしない

      setLoadingData(true);
      setLoadedCount(0);
      setFetchTotal(missing.length);

      const existing = new Map(tableDataRef.current);

      for (let i = 0; i < missing.length; i += BATCH_SIZE) {
        const batch = missing.slice(i, i + BATCH_SIZE);
        try {
          const res = await fetch(
            `/api/stock-table?symbols=${batch.join(",")}`,
          );
          const data = await res.json();
          if (data.rows) {
            for (const row of data.rows) {
              existing.set(row.symbol, row);
            }
          }
        } catch {
          // continue with next batch
        }
        setLoadedCount(Math.min(i + BATCH_SIZE, missing.length));
        setTableData(new Map(existing));
      }

      setLoadingData(false);
    },
    [],
  );

  // フィルタが変わったらデータ取得（未取得分のみ）
  useEffect(() => {
    if (loadingStocks) return;
    const syms = filteredStocks.map((s) => s.symbol);
    fetchTableData(syms);
  }, [filteredStocks, loadingStocks, fetchTableData]);

  // ── マージ＆ソート ──
  const mergedRows = useMemo(() => {
    let rows: MergedRow[] = filteredStocks.map((s) => {
      const td = tableData.get(s.symbol);
      return {
        symbol: s.symbol,
        code: s.symbol.replace(".T", ""),
        name: td?.name ?? s.name,
        market: s.marketSegment ?? "",
        marketSegment: s.marketSegment,
        favorite: s.favorite,
        price: td?.price ?? 0,
        changePercent: td?.changePercent ?? 0,
        volume: td?.volume ?? 0,
        per: td?.per ?? null,
        eps: td?.eps ?? null,
        pbr: td?.pbr ?? null,
        simpleNcRatio: td?.simpleNcRatio ?? null,
        cnPer: (td?.per != null && td?.simpleNcRatio != null) ? td.per * (1 - td.simpleNcRatio / 100) : null,
        dayHigh: td?.dayHigh ?? null,
        dayLow: td?.dayLow ?? null,
        weekHigh: td?.weekHigh ?? null,
        weekLow: td?.weekLow ?? null,
        monthHigh: td?.monthHigh ?? null,
        monthLow: td?.monthLow ?? null,
        yearHigh: td?.yearHigh ?? null,
        yearLow: td?.yearLow ?? null,
        lastYearHigh: td?.lastYearHigh ?? null,
        lastYearLow: td?.lastYearLow ?? null,
        earningsDate: td?.earningsDate ?? null,
        marketCap: td?.marketCap ?? null,
      };
    });

    // 時価総額フィルタ
    if (capSizeFilter.size > 0) {
      rows = rows.filter((r) => {
        const cs = getCapSize(r.marketCap);
        return cs !== null && capSizeFilter.has(cs);
      });
    }

    // 決算日フィルタ
    if (earningsFrom || earningsTo) {
      rows = rows.filter((r) => {
        if (!r.earningsDate) return false;
        if (earningsFrom && r.earningsDate < earningsFrom) return false;
        if (earningsTo && r.earningsDate > earningsTo) return false;
        return true;
      });
    }

    // ソート
    rows.sort((a, b) => {
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
      if (typeof av === "boolean" && typeof bv === "boolean") {
        return sortDir === "asc"
          ? Number(av) - Number(bv)
          : Number(bv) - Number(av);
      }
      return 0;
    });

    return rows;
  }, [filteredStocks, tableData, sortKey, sortDir, capSizeFilter, earningsFrom, earningsTo]);

  // ── ソート切り替え ──
  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" || key === "code" || key === "market" ? "asc" : "desc");
    }
  }

  // ── カラムグループ一括切替 ──
  const columnGroups = useMemo(() => {
    const groups = new Map<string, ColumnDef[]>();
    COLUMNS.forEach((c) => {
      const list = groups.get(c.group) ?? [];
      list.push(c);
      groups.set(c.group, list);
    });
    return groups;
  }, []);

  function toggleColumnGroup(group: string) {
    setVisibleColumns((prev) => {
      const cols = columnGroups.get(group) ?? [];
      const allVisible = cols.every((c) => prev.has(c.key));
      const next = new Set(prev);
      cols.forEach((c) => {
        if (allVisible) next.delete(c.key);
        else next.add(c.key);
      });
      return next;
    });
  }

  // symbol → groupIds マップ
  const stockGroupMap = useMemo(() => {
    const m = new Map<string, number[]>();
    stocks.forEach((s) => m.set(s.symbol, s.groupIds ?? []));
    return m;
  }, [stocks]);

  // ── グループ操作 ──
  const handleEditGroups = useCallback((symbol: string, event: React.MouseEvent) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setGroupPopup({ symbol, anchor: rect });
  }, []);

  const handleSaveGroups = useCallback(async (symbol: string, groupIds: number[]) => {
    try {
      const res = await fetch("/api/watchlist", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, groupIds }),
      });
      if (res.ok) {
        const data = await res.json();
        setStocks((prev) =>
          prev.map((s) =>
            s.symbol === symbol
              ? { ...s, groupIds: (data.groups as WatchlistGroup[]).map((g) => g.id), favorite: (data.groups as WatchlistGroup[]).length > 0 }
              : s,
          ),
        );
      }
    } catch { /* ignore */ }
  }, []);

  const handleCreateGroup = useCallback(async (name: string) => {
    try {
      const res = await fetch("/api/watchlist/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        const group = await res.json() as WatchlistGroup;
        setAllGroups((prev) => [...prev, group]);
      }
    } catch { /* ignore */ }
  }, []);

  // ── セル描画 ──
  function renderCell(row: MergedRow, col: ColumnDef): React.ReactNode {
    const v = row[col.key];
    switch (col.key) {
      case "code":
        return (
          <Link
            href={`/stock/${row.symbol}`}
            className="font-mono text-blue-600 hover:underline dark:text-blue-400"
          >
            {row.code}
          </Link>
        );
      case "name":
        return (
          <Link href={`/stock/${row.symbol}`} className="hover:underline">
            {row.name}
          </Link>
        );
      case "market":
        return <span className="text-gray-500 dark:text-slate-400">{row.market}</span>;
      case "price":
        return formatPrice(row.price);
      case "changePercent":
        return (
          <span className={changePctColor(row.changePercent)}>
            {row.changePercent > 0 ? "+" : ""}
            {row.changePercent.toFixed(2)}%
          </span>
        );
      case "volume":
        return (
          <span className="text-gray-500 dark:text-slate-400">
            {formatVolume(row.volume)}
          </span>
        );
      case "per":
        return formatNum(row.per);
      case "eps":
        return formatNum(row.eps);
      case "pbr":
        return formatNum(row.pbr, 2);
      case "simpleNcRatio":
        if (row.simpleNcRatio == null) return "－";
        return (
          <span className={
            row.simpleNcRatio > 50 ? "text-green-600 dark:text-green-400"
              : row.simpleNcRatio < -50 ? "text-red-600 dark:text-red-400"
              : ""
          }>
            {row.simpleNcRatio > 0 ? "+" : ""}{row.simpleNcRatio.toFixed(1)}%
          </span>
        );
      case "marketCap":
        return row.marketCap ? formatMarketCap(row.marketCap) : "－";
      case "cnPer":
        if (row.cnPer == null) return "－";
        return formatNum(row.cnPer);
      case "earningsDate":
        return row.earningsDate ? (
          <span className="inline-flex items-center gap-1 text-xs">
            {row.earningsDate}
            <a
              href={googleCalendarUrl(row.earningsDate, row.name, row.code)}
              target="_blank"
              rel="noopener noreferrer"
              title="Googleカレンダーに追加"
              className="inline-flex items-center rounded p-0.5 text-gray-400 hover:bg-blue-100 hover:text-blue-600 dark:text-slate-500 dark:hover:bg-slate-600 dark:hover:text-blue-400"
              onClick={(e) => e.stopPropagation()}
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 011 1v3a1 1 0 11-2 0V8a1 1 0 011-1zm4 0a1 1 0 011 1v3a1 1 0 11-2 0V8a1 1 0 011-1zm4 0a1 1 0 011 1v3a1 1 0 11-2 0V8a1 1 0 011-1z" clipRule="evenodd" />
              </svg>
            </a>
          </span>
        ) : (
          "－"
        );
      default:
        // 高値/安値系はすべて price 形式
        return formatPrice(v as number | null);
    }
  }

  // ── 表示カラム ──
  const displayColumns = useMemo(
    () => COLUMNS.filter((c) => visibleColumns.has(c.key)),
    [visibleColumns],
  );

  // ── レンダリング ──
  if (loadingStocks) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-gray-500 dark:text-slate-400">読み込み中...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ヘッダ */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          株式テーブル
        </h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-600 dark:text-slate-300">
            {mergedRows.length} 銘柄
            {loadingData && ` (${loadedCount}/${fetchTotal} 取得中...)`}
          </span>
          {loadingData && (
            <svg
              className="h-4 w-4 animate-spin text-blue-500"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
          )}
        </div>
      </div>

      {/* フィルタ */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="text"
          placeholder="コード / 銘柄名で検索..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:focus:border-blue-400"
        />
        {allGroups.length > 0 && (
          <div className="flex gap-1">
            {allGroups.map((g) => (
              <button
                key={g.id}
                onClick={() => setSelectedGroupIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(g.id)) next.delete(g.id);
                  else next.add(g.id);
                  return next;
                })}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  selectedGroupIds.has(g.id)
                    ? "text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
                }`}
                style={selectedGroupIds.has(g.id) ? { backgroundColor: g.color } : undefined}
              >
                <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: selectedGroupIds.has(g.id) ? "#fff" : g.color }} />
                {g.name}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-1">
          {MARKET_FILTERS.map((m) => (
            <button
              key={m.value}
              onClick={() => setMarketFilter(m.value)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                marketFilter === m.value
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {([["small", "小型株"], ["mid", "中型株"], ["large", "大型株"]] as const).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setCapSizeFilter((prev) => {
                const next = new Set(prev);
                if (next.has(value)) next.delete(value);
                else next.add(value);
                return next;
              })}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                capSizeFilter.has(value)
                  ? "bg-teal-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowColumnPicker((v) => !v)}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            showColumnPicker
              ? "bg-purple-600 text-white"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
          }`}
        >
          カラム設定
        </button>
      </div>

      {/* 決算日フィルタ */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-gray-500 dark:text-slate-400">
          決算日:
        </span>
        {EARNINGS_PRESETS.map((p) => (
          <button
            key={p.value}
            onClick={() => {
              if (earningsPreset === p.value) {
                setEarningsPreset("");
                setEarningsFrom("");
                setEarningsTo("");
              } else {
                const [from, to] = p.getRange();
                setEarningsPreset(p.value);
                setEarningsFrom(from);
                setEarningsTo(to);
              }
            }}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              earningsPreset === p.value
                ? "bg-green-600 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
            }`}
          >
            {p.label}
          </button>
        ))}
        <div className="flex items-center gap-1">
          <input
            type="date"
            value={earningsFrom}
            onChange={(e) => {
              setEarningsPreset("");
              setEarningsFrom(e.target.value);
            }}
            className="rounded border border-gray-300 bg-white px-2 py-1 text-xs outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
          <span className="text-xs text-gray-400">〜</span>
          <input
            type="date"
            value={earningsTo}
            onChange={(e) => {
              setEarningsPreset("");
              setEarningsTo(e.target.value);
            }}
            className="rounded border border-gray-300 bg-white px-2 py-1 text-xs outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
        </div>
        {(earningsFrom || earningsTo) && (
          <button
            onClick={() => {
              setEarningsPreset("");
              setEarningsFrom("");
              setEarningsTo("");
            }}
            className="rounded-full px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
          >
            クリア
          </button>
        )}
      </div>

      {/* カラムピッカー */}
      {showColumnPicker && (
        <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
          <div className="flex flex-wrap gap-4">
            {Array.from(columnGroups.entries()).map(([group, cols]) => {
              const allVisible = cols.every((c) => visibleColumns.has(c.key));
              return (
                <div key={group} className="space-y-1">
                  <button
                    onClick={() => toggleColumnGroup(group)}
                    className={`text-xs font-semibold ${
                      allVisible
                        ? "text-blue-600 dark:text-blue-400"
                        : "text-gray-500 dark:text-slate-400"
                    }`}
                  >
                    {group}
                  </button>
                  <div className="flex flex-col gap-0.5">
                    {cols.map((c) => (
                      <label
                        key={c.key}
                        className="flex items-center gap-1.5 text-xs text-gray-700 dark:text-slate-300"
                      >
                        <input
                          type="checkbox"
                          checked={visibleColumns.has(c.key)}
                          onChange={() =>
                            setVisibleColumns((prev) => {
                              const next = new Set(prev);
                              if (next.has(c.key)) next.delete(c.key);
                              else next.add(c.key);
                              return next;
                            })
                          }
                          className="h-3.5 w-3.5 rounded"
                        />
                        {c.label}
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* プログレスバー */}
      {loadingData && fetchTotal > BATCH_SIZE && (
        <div className="h-1 overflow-hidden rounded-full bg-gray-200 dark:bg-slate-700">
          <div
            className="h-full rounded-full bg-blue-500 transition-all duration-300"
            style={{
              width: `${Math.min(100, fetchTotal > 0 ? (loadedCount / fetchTotal) * 100 : 0)}%`,
            }}
          />
        </div>
      )}

      {/* テーブル */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 dark:border-slate-700 dark:bg-slate-900/50">
              <th className="w-8 px-1 py-2.5" />
              {displayColumns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  className={`cursor-pointer select-none whitespace-nowrap px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-900 dark:text-slate-400 dark:hover:text-white ${
                    col.align === "right" ? "text-right" : "text-left"
                  }`}
                >
                  {col.label}
                  {sortKey === col.key && (
                    <span className="ml-1">
                      {sortDir === "asc" ? "▲" : "▼"}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-700/50">
            {mergedRows.map((row) => (
              <tr
                key={row.symbol}
                className="transition-colors hover:bg-blue-50/50 dark:hover:bg-slate-700/30"
              >
                <td className="px-1 py-2 text-center">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleEditGroups(row.symbol, e); }}
                    className={`transition-colors ${(stockGroupMap.get(row.symbol)?.length ?? 0) > 0 ? "text-yellow-400" : "text-gray-300 dark:text-slate-600 hover:text-yellow-300"}`}
                    title="グループ設定"
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill={(stockGroupMap.get(row.symbol)?.length ?? 0) > 0 ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.562.562 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
                    </svg>
                  </button>
                </td>
                {displayColumns.map((col) => (
                  <td
                    key={col.key}
                    className={`whitespace-nowrap px-3 py-2 font-mono tabular-nums ${
                      col.align === "right" ? "text-right" : ""
                    } ${
                      col.key === "name"
                        ? "font-sans font-medium text-gray-900 dark:text-white"
                        : ""
                    }`}
                  >
                    {renderCell(row, col)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {mergedRows.length === 0 && !loadingData && (
          <div className="py-12 text-center text-gray-500 dark:text-slate-400">
            {stocks.length === 0
              ? "ウォッチリストに銘柄がありません"
              : "条件に合う銘柄がありません"}
          </div>
        )}
      </div>
      {groupPopup && (
        <GroupAssignPopup
          symbol={groupPopup.symbol}
          currentGroupIds={stockGroupMap.get(groupPopup.symbol) ?? []}
          allGroups={allGroups}
          anchor={groupPopup.anchor}
          onToggleGroup={(groupId, checked) => {
            const currentIds = stockGroupMap.get(groupPopup.symbol) ?? [];
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

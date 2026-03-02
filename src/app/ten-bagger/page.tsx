"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import Link from "next/link";
import { formatMarketCap } from "@/lib/utils/format";
import { getTenBaggerCache, setTenBaggerCache } from "@/lib/cache/tenBaggerCache";
import type { TenBaggerRow } from "@/lib/cache/tenBaggerCache";
import BatchGroupAssignPopup from "@/components/BatchGroupAssignPopup";
import CsvExportButton from "@/components/CsvExportButton";
import type { WatchlistGroup as WLGroup } from "@/types";

// ── 型定義 ──

interface Stock {
  symbol: string;
  name: string;
  market: "JP" | "US";
  marketSegment?: string;
}

interface MergedRow extends TenBaggerRow {
  code: string;
  marketSegmentResolved: string;
}

type SortKey = keyof MergedRow;
type SortDir = "asc" | "desc";

// ── カラム定義 ──

interface ColumnDef {
  key: SortKey;
  label: string;
  align: "left" | "right";
}

const COLUMNS: ColumnDef[] = [
  { key: "code", label: "コード", align: "left" },
  { key: "name", label: "銘柄名", align: "left" },
  { key: "marketSegmentResolved", label: "市場", align: "left" },
  { key: "price", label: "株価", align: "right" },
  { key: "changePercent", label: "前日比%", align: "right" },
  { key: "revenueGrowth", label: "売上成長率", align: "right" },
  { key: "operatingMargins", label: "営業利益率", align: "right" },
  { key: "profitGrowthRate", label: "増益率", align: "right" },
  { key: "yearsListed", label: "上場年数", align: "right" },
  { key: "marketCap", label: "時価総額", align: "right" },
  { key: "per", label: "PER", align: "right" },
  { key: "pbr", label: "PBR", align: "right" },
  { key: "cnPer", label: "CNPER", align: "right" },
  { key: "roe", label: "ROE", align: "right" },
  { key: "sharpe3m", label: "SR 3m", align: "right" },
  { key: "sharpe6m", label: "SR 6m", align: "right" },
  { key: "sharpe1y", label: "SR 1y", align: "right" },
  { key: "volume", label: "出来高", align: "right" },
];

const BATCH_SIZE = 50;

// ── RangeInput コンポーネント ──

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
      <span className="min-w-[72px] text-right text-xs text-gray-600 dark:text-gray-400">{label}</span>
      <input
        type="number"
        step="any"
        placeholder="min"
        value={min}
        onChange={(e) => setMin(e.target.value)}
        className="w-[72px] rounded border border-gray-300 px-1.5 py-0.5 text-xs dark:border-gray-600 dark:bg-gray-800"
      />
      <span className="text-xs text-gray-400">〜</span>
      <input
        type="number"
        step="any"
        placeholder="max"
        value={max}
        onChange={(e) => setMax(e.target.value)}
        className="w-[72px] rounded border border-gray-300 px-1.5 py-0.5 text-xs dark:border-gray-600 dark:bg-gray-800"
      />
    </div>
  );
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

function sharpeColor(v: number | null): string {
  if (v === null) return "";
  if (v >= 1.0) return "text-green-700 dark:text-green-400 font-semibold";
  if (v >= 0.5) return "text-green-600 dark:text-green-500";
  if (v < 0) return "text-red-600 dark:text-red-400";
  return "";
}

// ── メインコンポーネント ──

export default function TenBaggerPage() {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [loadingStocks, setLoadingStocks] = useState(true);
  const [tableData, setTableData] = useState<Map<string, TenBaggerRow>>(new Map());
  const [cacheRestored, setCacheRestored] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [loadedCount, setLoadedCount] = useState(0);
  const [fetchTotal, setFetchTotal] = useState(0);
  const [allGroups, setAllGroups] = useState<WLGroup[]>([]);
  const [watchlistGroupMap, setWatchlistGroupMap] = useState<Map<string, number[]>>(new Map());

  // フィルタ
  const [search, setSearch] = useState("");
  const [marketFilter, setMarketFilter] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("revenueGrowth");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // 範囲フィルタ (デフォルト値: テンバガー候補条件)
  const [revenueGrowthMin, setRevenueGrowthMin] = useState("10");
  const [revenueGrowthMax, setRevenueGrowthMax] = useState("");
  const [operatingMarginsMin, setOperatingMarginsMin] = useState("5");
  const [operatingMarginsMax, setOperatingMarginsMax] = useState("");
  const [profitGrowthMin, setProfitGrowthMin] = useState("");
  const [profitGrowthMax, setProfitGrowthMax] = useState("");
  const [yearsListedMin, setYearsListedMin] = useState("");
  const [yearsListedMax, setYearsListedMax] = useState("10");
  const [marketCapMin, setMarketCapMin] = useState("50");
  const [marketCapMax, setMarketCapMax] = useState("500");
  const [perMin, setPerMin] = useState("");
  const [perMax, setPerMax] = useState("");
  const [pbrMin, setPbrMin] = useState("");
  const [pbrMax, setPbrMax] = useState("");
  const [cnPerMin, setCnPerMin] = useState("");
  const [cnPerMax, setCnPerMax] = useState("");
  const [roeMin, setRoeMin] = useState("");
  const [roeMax, setRoeMax] = useState("");
  const [sharpe3mMin, setSharpe3mMin] = useState("");
  const [sharpe3mMax, setSharpe3mMax] = useState("");
  const [sharpe6mMin, setSharpe6mMin] = useState("");
  const [sharpe6mMax, setSharpe6mMax] = useState("");
  const [sharpe1yMin, setSharpe1yMin] = useState("");
  const [sharpe1yMax, setSharpe1yMax] = useState("");
  const [volumeMin, setVolumeMin] = useState("");
  const [volumeMax, setVolumeMax] = useState("");

  // チェックボックス選択
  const [selectedSymbols, setSelectedSymbols] = useState<Set<string>>(new Set());
  const [showBatchGroupPopup, setShowBatchGroupPopup] = useState(false);

  // フィルタ表示/非表示
  const [showFilters, setShowFilters] = useState(true);

  // マウント時にIndexedDBから復元
  useEffect(() => {
    getTenBaggerCache().then((cached) => {
      if (cached) setTableData(cached);
      setCacheRestored(true);
    });
  }, []);

  // ウォッチリスト読み込み
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/watchlist");
        const data = await res.json();
        const stockList = (data.stocks ?? []).filter((s: Stock & { groups?: { id: number }[] }) => s.market === "JP");
        setStocks(stockList);
        if (data.groups) setAllGroups(data.groups);
        // グループマップ構築
        const gm = new Map<string, number[]>();
        for (const s of data.stocks ?? []) {
          const ids = (s.groups ?? []).map((g: { id: number }) => g.id);
          if (ids.length > 0) gm.set(s.symbol, ids);
        }
        setWatchlistGroupMap(gm);
      } catch { /* ignore */ }
      finally { setLoadingStocks(false); }
    })();
  }, []);

  // データ取得
  const tableDataRef = useRef(tableData);
  tableDataRef.current = tableData;
  const fetchGenRef = useRef(0);

  const fetchTableData = useCallback(
    async (symbolList: string[]) => {
      if (symbolList.length === 0) return;
      const missing = symbolList.filter((s) => !tableDataRef.current.has(s));
      if (missing.length === 0) return;

      const gen = ++fetchGenRef.current;
      setLoadingData(true);
      setLoadedCount(0);
      setFetchTotal(missing.length);
      const existing = new Map(tableDataRef.current);

      for (let i = 0; i < missing.length; i += BATCH_SIZE) {
        if (fetchGenRef.current !== gen) return;
        const batch = missing.slice(i, i + BATCH_SIZE);
        try {
          const res = await fetch(`/api/ten-bagger-screen?symbols=${batch.join(",")}`);
          const data = await res.json();
          if (data.rows) {
            for (const row of data.rows) {
              existing.set(row.symbol, row);
            }
          }
        } catch { /* continue */ }
        if (fetchGenRef.current !== gen) return;
        setLoadedCount(Math.min(i + BATCH_SIZE, missing.length));
        setTableData(new Map(existing));
      }

      if (fetchGenRef.current === gen) {
        setLoadingData(false);
        setTenBaggerCache(existing);
      }
    },
    [],
  );

  // ウォッチリスト読み込み後にデータ取得開始
  useEffect(() => {
    if (!loadingStocks && cacheRestored) {
      const allSymbols = stocks.map((s) => s.symbol);
      fetchTableData(allSymbols);
    }
  }, [loadingStocks, cacheRestored, stocks, fetchTableData]);

  // マーケットセグメント マップ
  const segmentMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of stocks) {
      if (s.marketSegment) m.set(s.symbol, s.marketSegment);
    }
    return m;
  }, [stocks]);

  // マージ + フィルタ + ソート
  const filteredAndSorted = useMemo(() => {
    const merged: MergedRow[] = [];
    for (const [, row] of tableData) {
      const seg = segmentMap.get(row.symbol) ?? row.marketSegment ?? "";
      merged.push({
        ...row,
        code: row.symbol.replace(".T", ""),
        marketSegmentResolved: seg,
      });
    }

    // フィルタ適用
    const rangeFilter = (val: number | null, min: string, max: string): boolean => {
      if (val === null || val === undefined) return min === "" && max === "";
      if (min !== "" && val < parseFloat(min)) return false;
      if (max !== "" && val > parseFloat(max)) return false;
      return true;
    };

    const filtered = merged.filter((r) => {
      // テキスト検索
      if (search) {
        const q = search.toLowerCase();
        if (!r.symbol.toLowerCase().includes(q) && !r.name.toLowerCase().includes(q) && !r.code.includes(q)) return false;
      }
      // 市場区分
      if (marketFilter.size > 0 && !marketFilter.has(r.marketSegmentResolved)) return false;
      // 範囲フィルタ
      if (!rangeFilter(r.revenueGrowth, revenueGrowthMin, revenueGrowthMax)) return false;
      if (!rangeFilter(r.operatingMargins, operatingMarginsMin, operatingMarginsMax)) return false;
      if (!rangeFilter(r.profitGrowthRate, profitGrowthMin, profitGrowthMax)) return false;
      if (!rangeFilter(r.yearsListed, yearsListedMin, yearsListedMax)) return false;
      // 時価総額 (億円単位で入力)
      if (r.marketCap !== null) {
        const mcOku = r.marketCap / 1e8;
        if (marketCapMin !== "" && mcOku < parseFloat(marketCapMin)) return false;
        if (marketCapMax !== "" && mcOku > parseFloat(marketCapMax)) return false;
      } else {
        if (marketCapMin !== "" || marketCapMax !== "") return false;
      }
      if (!rangeFilter(r.per, perMin, perMax)) return false;
      if (!rangeFilter(r.pbr, pbrMin, pbrMax)) return false;
      if (!rangeFilter(r.cnPer, cnPerMin, cnPerMax)) return false;
      if (!rangeFilter(r.roe != null ? r.roe * 100 : null, roeMin, roeMax)) return false;
      if (!rangeFilter(r.sharpe3m, sharpe3mMin, sharpe3mMax)) return false;
      if (!rangeFilter(r.sharpe6m, sharpe6mMin, sharpe6mMax)) return false;
      if (!rangeFilter(r.sharpe1y, sharpe1yMin, sharpe1yMax)) return false;
      if (!rangeFilter(r.volume, volumeMin, volumeMax)) return false;
      return true;
    });

    // ソート
    filtered.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const na = Number(av);
      const nb = Number(bv);
      return sortDir === "asc" ? na - nb : nb - na;
    });

    return filtered;
  }, [
    tableData, segmentMap, search, marketFilter, sortKey, sortDir,
    revenueGrowthMin, revenueGrowthMax, operatingMarginsMin, operatingMarginsMax,
    profitGrowthMin, profitGrowthMax,
    yearsListedMin, yearsListedMax, marketCapMin, marketCapMax,
    perMin, perMax, pbrMin, pbrMax, cnPerMin, cnPerMax,
    roeMin, roeMax, sharpe3mMin, sharpe3mMax, sharpe6mMin, sharpe6mMax,
    sharpe1yMin, sharpe1yMax, volumeMin, volumeMax,
  ]);

  // ソートハンドラ
  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  // 全選択/解除
  const allChecked = filteredAndSorted.length > 0 && filteredAndSorted.every((r) => selectedSymbols.has(r.symbol));
  const toggleAll = () => {
    if (allChecked) {
      setSelectedSymbols(new Set());
    } else {
      setSelectedSymbols(new Set(filteredAndSorted.map((r) => r.symbol)));
    }
  };

  // フィルタリセット
  const resetFilters = () => {
    setSearch("");
    setMarketFilter(new Set());
    setRevenueGrowthMin("10"); setRevenueGrowthMax("");
    setOperatingMarginsMin("5"); setOperatingMarginsMax("");
    setProfitGrowthMin(""); setProfitGrowthMax("");
    setYearsListedMin(""); setYearsListedMax("10");
    setMarketCapMin("50"); setMarketCapMax("500");
    setPerMin(""); setPerMax("");
    setPbrMin(""); setPbrMax("");
    setCnPerMin(""); setCnPerMax("");
    setRoeMin(""); setRoeMax("");
    setSharpe3mMin(""); setSharpe3mMax("");
    setSharpe6mMin(""); setSharpe6mMax("");
    setSharpe1yMin(""); setSharpe1yMax("");
    setVolumeMin(""); setVolumeMax("");
  };

  // CSV用: filteredAndSorted から { symbol, name } を抽出
  const csvStocks = filteredAndSorted.map((r) => ({ symbol: r.symbol, name: r.name }));

  // セルレンダリング
  const renderCell = (col: ColumnDef, row: MergedRow) => {
    switch (col.key) {
      case "code":
        return (
          <Link href={`/stock/${row.symbol}`} className="text-blue-600 hover:underline dark:text-blue-400">
            {row.code}
          </Link>
        );
      case "name":
        return <span className="truncate max-w-[160px] block" title={row.name}>{row.name}</span>;
      case "marketSegmentResolved":
        return <span className="text-xs">{row.marketSegmentResolved}</span>;
      case "price":
        return formatPrice(row.price);
      case "changePercent":
        return <span className={changePctColor(row.changePercent)}>{row.changePercent > 0 ? "+" : ""}{formatNum(row.changePercent)}%</span>;
      case "revenueGrowth":
        return row.revenueGrowth != null
          ? <span className={row.revenueGrowth >= 10 ? "text-green-700 dark:text-green-400 font-semibold" : ""}>{row.revenueGrowth > 0 ? "+" : ""}{formatNum(row.revenueGrowth)}%</span>
          : "－";
      case "operatingMargins":
        return row.operatingMargins != null
          ? <span className={row.operatingMargins >= 10 ? "text-green-700 dark:text-green-400 font-semibold" : ""}>{formatNum(row.operatingMargins)}%</span>
          : "－";
      case "profitGrowthRate":
        return row.profitGrowthRate != null
          ? <span className={row.profitGrowthRate > 0 ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}>{row.profitGrowthRate > 0 ? "+" : ""}{formatNum(row.profitGrowthRate)}%</span>
          : "－";
      case "yearsListed":
        return row.yearsListed != null ? formatNum(row.yearsListed) : "－";
      case "marketCap":
        return row.marketCap != null ? formatMarketCap(row.marketCap) : "－";
      case "per":
        return row.per != null ? formatNum(row.per) : "－";
      case "pbr":
        return row.pbr != null ? formatNum(row.pbr, 2) : "－";
      case "cnPer":
        return row.cnPer != null
          ? <span className={row.cnPer < 5 ? "text-green-700 dark:text-green-400 font-semibold" : ""}>{formatNum(row.cnPer, 2)}</span>
          : "－";
      case "roe":
        return row.roe != null ? `${(row.roe * 100).toFixed(1)}%` : "－";
      case "sharpe3m":
        return <span className={sharpeColor(row.sharpe3m)}>{row.sharpe3m != null ? row.sharpe3m.toFixed(2) : "－"}</span>;
      case "sharpe6m":
        return <span className={sharpeColor(row.sharpe6m)}>{row.sharpe6m != null ? row.sharpe6m.toFixed(2) : "－"}</span>;
      case "sharpe1y":
        return <span className={sharpeColor(row.sharpe1y)}>{row.sharpe1y != null ? row.sharpe1y.toFixed(2) : "－"}</span>;
      case "volume":
        return formatVolume(row.volume);
      default:
        return "－";
    }
  };

  return (
    <div className="flex h-screen flex-col">
      {/* ヘッダー */}
      <div className="flex-none border-b bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-900">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold">テンバガー候補探索</h1>
            <p className="text-xs text-gray-500">
              {loadingData
                ? `読込中... ${loadedCount}/${fetchTotal}`
                : `${filteredAndSorted.length}件 / ${tableData.size}件中`
              }
              {loadingData && (
                <span className="ml-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowFilters((v) => !v)}
              className="rounded border px-2 py-1 text-xs hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              {showFilters ? "フィルタ隠す" : "フィルタ表示"}
            </button>
            <CsvExportButton stocks={csvStocks} allGroups={allGroups} watchlistGroupMap={watchlistGroupMap} filenamePrefix="ten-bagger" />
            {selectedSymbols.size > 0 && (
              <button
                onClick={() => setShowBatchGroupPopup(true)}
                className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700"
              >
                グループ追加 ({selectedSymbols.size})
              </button>
            )}
          </div>
        </div>

        {/* プログレスバー */}
        {loadingData && fetchTotal > 0 && (
          <div className="mt-2 h-1 w-full overflow-hidden rounded bg-gray-200 dark:bg-gray-700">
            <div
              className="h-full bg-blue-500 transition-all"
              style={{ width: `${(loadedCount / fetchTotal) * 100}%` }}
            />
          </div>
        )}
      </div>

      {/* フィルタパネル */}
      {showFilters && (
        <div className="flex-none border-b bg-gray-50 px-4 py-2 dark:border-gray-700 dark:bg-gray-800/50">
          <div className="flex flex-wrap items-center gap-3">
            {/* テキスト検索 */}
            <input
              type="text"
              placeholder="コード/銘柄名"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-40 rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800"
            />
            {/* 市場区分 */}
            {["プライム", "スタンダード", "グロース"].map((seg) => (
              <label key={seg} className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={marketFilter.has(seg)}
                  onChange={() => {
                    const next = new Set(marketFilter);
                    if (next.has(seg)) next.delete(seg); else next.add(seg);
                    setMarketFilter(next);
                  }}
                />
                {seg}
              </label>
            ))}
            <button onClick={resetFilters} className="rounded border px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-700">
              リセット
            </button>
          </div>
          {/* 範囲フィルタ */}
          <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            <RangeInput label="売上成長率%" min={revenueGrowthMin} max={revenueGrowthMax} setMin={setRevenueGrowthMin} setMax={setRevenueGrowthMax} />
            <RangeInput label="営業利益率%" min={operatingMarginsMin} max={operatingMarginsMax} setMin={setOperatingMarginsMin} setMax={setOperatingMarginsMax} />
            <RangeInput label="増益率%" min={profitGrowthMin} max={profitGrowthMax} setMin={setProfitGrowthMin} setMax={setProfitGrowthMax} />
            <RangeInput label="上場年数" min={yearsListedMin} max={yearsListedMax} setMin={setYearsListedMin} setMax={setYearsListedMax} />
            <RangeInput label="時価総額(億)" min={marketCapMin} max={marketCapMax} setMin={setMarketCapMin} setMax={setMarketCapMax} />
            <RangeInput label="PER" min={perMin} max={perMax} setMin={setPerMin} setMax={setPerMax} />
            <RangeInput label="PBR" min={pbrMin} max={pbrMax} setMin={setPbrMin} setMax={setPbrMax} />
            <RangeInput label="CNPER" min={cnPerMin} max={cnPerMax} setMin={setCnPerMin} setMax={setCnPerMax} />
            <RangeInput label="ROE%" min={roeMin} max={roeMax} setMin={setRoeMin} setMax={setRoeMax} />
            <RangeInput label="SR 3m" min={sharpe3mMin} max={sharpe3mMax} setMin={setSharpe3mMin} setMax={setSharpe3mMax} />
            <RangeInput label="SR 6m" min={sharpe6mMin} max={sharpe6mMax} setMin={setSharpe6mMin} setMax={setSharpe6mMax} />
            <RangeInput label="SR 1y" min={sharpe1yMin} max={sharpe1yMax} setMin={setSharpe1yMin} setMax={setSharpe1yMax} />
            <RangeInput label="出来高" min={volumeMin} max={volumeMax} setMin={setVolumeMin} setMax={setVolumeMax} />
          </div>
        </div>
      )}

      {/* テーブル */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-gray-100 dark:bg-gray-800">
            <tr>
              <th className="w-8 px-1 py-1.5">
                <input type="checkbox" checked={allChecked} onChange={toggleAll} />
              </th>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className={`cursor-pointer whitespace-nowrap px-2 py-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 ${
                    col.align === "right" ? "text-right" : "text-left"
                  }`}
                  onClick={() => handleSort(col.key)}
                >
                  {col.label}
                  {sortKey === col.key && (
                    <span className="ml-0.5 text-blue-500">{sortDir === "asc" ? "▲" : "▼"}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredAndSorted.map((row) => (
              <tr
                key={row.symbol}
                className="border-b border-gray-100 hover:bg-blue-50 dark:border-gray-800 dark:hover:bg-gray-800/50"
              >
                <td className="px-1 py-1 text-center">
                  <input
                    type="checkbox"
                    checked={selectedSymbols.has(row.symbol)}
                    onChange={() => {
                      const next = new Set(selectedSymbols);
                      if (next.has(row.symbol)) next.delete(row.symbol); else next.add(row.symbol);
                      setSelectedSymbols(next);
                    }}
                  />
                </td>
                {COLUMNS.map((col) => (
                  <td
                    key={col.key}
                    className={`whitespace-nowrap px-2 py-1 ${col.align === "right" ? "text-right" : "text-left"}`}
                  >
                    {renderCell(col, row)}
                  </td>
                ))}
              </tr>
            ))}
            {filteredAndSorted.length === 0 && !loadingData && (
              <tr>
                <td colSpan={COLUMNS.length + 1} className="py-8 text-center text-gray-400">
                  {tableData.size === 0 ? "データ読み込み中..." : "条件に合致する銘柄がありません"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* バッチグループ追加ポップアップ */}
      {showBatchGroupPopup && (
        <BatchGroupAssignPopup
          stockCount={selectedSymbols.size}
          allGroups={allGroups}
          onConfirm={async (groupId) => {
            const symbols = Array.from(selectedSymbols);
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
            const result = (await res.json()) as { updated: number; alreadyInGroup: number };
            setSelectedSymbols(new Set());
            return result;
          }}
          onCreateGroup={async (name, color) => {
            const res = await fetch("/api/watchlist/groups", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name, color }),
            });
            const newGroup: WLGroup = await res.json();
            setAllGroups((prev) => [...prev, newGroup]);
            return newGroup;
          }}
          onClose={() => setShowBatchGroupPopup(false)}
        />
      )}
    </div>
  );
}

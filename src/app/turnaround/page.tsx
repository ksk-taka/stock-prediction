"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import Link from "next/link";
import { formatMarketCap } from "@/lib/utils/format";
import { getTurnaroundCache, setTurnaroundCache } from "@/lib/cache/turnaroundCache";
import type { TurnaroundScreenRow } from "@/app/api/turnaround-screen/route";

// ── 型定義 ──

interface Stock {
  symbol: string;
  name: string;
  market: "JP" | "US";
  marketSegment?: string;
}

interface MergedRow extends TurnaroundScreenRow {
  code: string;
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
  { key: "marketSegment", label: "市場", align: "left" },
  { key: "consecutiveLossYears", label: "連続赤字", align: "right" },
  { key: "turnaroundFiscalYear", label: "黒転FY", align: "right" },
  { key: "priorLossAmountMM", label: "OP前年(百万)", align: "right" },
  { key: "turnaroundProfitAmountMM", label: "OP黒転(百万)", align: "right" },
  { key: "revenueGrowthPct", label: "売上変化%", align: "right" },
  { key: "price", label: "株価", align: "right" },
  { key: "changePercent", label: "前日比%", align: "right" },
  { key: "marketCap", label: "時価総額", align: "right" },
  { key: "per", label: "PER", align: "right" },
  { key: "pbr", label: "PBR", align: "right" },
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
      <span className="min-w-[80px] text-right text-xs text-gray-600 dark:text-gray-400">{label}</span>
      <input
        type="number"
        step="any"
        placeholder="min"
        value={min}
        onChange={(e) => setMin(e.target.value)}
        className="w-[72px] rounded border border-gray-300 px-1.5 py-0.5 text-xs dark:border-gray-600 dark:bg-gray-800"
      />
      <span className="text-xs text-gray-400">~</span>
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
  if (v === null || v === undefined) return "-";
  return v.toLocaleString("ja-JP", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatPrice(v: number | null): string {
  if (v === null || v === undefined || v === 0) return "-";
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

// ── 営業利益ミニチャート ──

function OpIncomeSparkline({
  history,
}: {
  history: { fiscalYear: number; opIncomeMM: number }[];
}) {
  if (history.length === 0) return <span className="text-xs text-gray-400">-</span>;

  const sorted = [...history].sort((a, b) => a.fiscalYear - b.fiscalYear);
  return (
    <div className="flex items-end gap-0.5 h-6">
      {sorted.map((h) => {
        const isPositive = h.opIncomeMM > 0;
        const maxAbs = Math.max(...sorted.map((s) => Math.abs(s.opIncomeMM)), 1);
        const height = Math.max(2, Math.round((Math.abs(h.opIncomeMM) / maxAbs) * 20));
        return (
          <div
            key={h.fiscalYear}
            title={`${h.fiscalYear}: ${h.opIncomeMM.toLocaleString()}百万`}
            className={`w-2 rounded-sm ${isPositive ? "bg-green-500" : "bg-red-500"}`}
            style={{ height: `${height}px` }}
          />
        );
      })}
    </div>
  );
}

// ── メインコンポーネント ──

export default function TurnaroundPage() {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [loadingStocks, setLoadingStocks] = useState(true);
  const [tableData, setTableData] = useState<Map<string, TurnaroundScreenRow>>(new Map());
  const [cacheRestored, setCacheRestored] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [loadedCount, setLoadedCount] = useState(0);
  const [fetchTotal, setFetchTotal] = useState(0);

  // フィルタ
  const [search, setSearch] = useState("");
  const [marketFilter, setMarketFilter] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("consecutiveLossYears");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [showFilters, setShowFilters] = useState(true);

  // 範囲フィルタ
  const [lossYearsMin, setLossYearsMin] = useState("1");
  const [lossYearsMax, setLossYearsMax] = useState("");
  const [marketCapMin, setMarketCapMin] = useState("");
  const [marketCapMax, setMarketCapMax] = useState("");
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");
  const [perMin, setPerMin] = useState("");
  const [perMax, setPerMax] = useState("");
  const [pbrMin, setPbrMin] = useState("");
  const [pbrMax, setPbrMax] = useState("");
  const [revenueGrowthMin, setRevenueGrowthMin] = useState("");
  const [revenueGrowthMax, setRevenueGrowthMax] = useState("");

  // マウント時にIndexedDBから復元
  useEffect(() => {
    getTurnaroundCache().then((cached) => {
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
        const stockList = (data.stocks ?? []).filter((s: Stock) => s.market === "JP");
        setStocks(stockList);
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

      const minLoss = parseInt(lossYearsMin || "1", 10);

      for (let i = 0; i < missing.length; i += BATCH_SIZE) {
        if (fetchGenRef.current !== gen) return;
        const batch = missing.slice(i, i + BATCH_SIZE);
        try {
          const res = await fetch(
            `/api/turnaround-screen?symbols=${batch.join(",")}&minLoss=${minLoss}`
          );
          const data = await res.json();
          if (data.rows) {
            for (const row of data.rows as TurnaroundScreenRow[]) {
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
        setTurnaroundCache(existing);
      }
    },
    [lossYearsMin],
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
      merged.push({
        ...row,
        code: row.symbol.replace(".T", ""),
        marketSegment: segmentMap.get(row.symbol) ?? row.marketSegment ?? "",
      });
    }

    const rangeFilter = (val: number | null, min: string, max: string): boolean => {
      if (val === null || val === undefined) return min === "" && max === "";
      if (min !== "" && val < parseFloat(min)) return false;
      if (max !== "" && val > parseFloat(max)) return false;
      return true;
    };

    const filtered = merged.filter((r) => {
      if (search) {
        const q = search.toLowerCase();
        if (
          !r.symbol.toLowerCase().includes(q) &&
          !r.name.toLowerCase().includes(q) &&
          !r.code.includes(q)
        )
          return false;
      }
      if (marketFilter.size > 0 && !marketFilter.has(r.marketSegment)) return false;
      if (!rangeFilter(r.consecutiveLossYears, lossYearsMin, lossYearsMax)) return false;
      if (!rangeFilter(r.marketCap, marketCapMin, marketCapMax)) return false;
      if (!rangeFilter(r.price, priceMin, priceMax)) return false;
      if (!rangeFilter(r.per, perMin, perMax)) return false;
      if (!rangeFilter(r.pbr, pbrMin, pbrMax)) return false;
      if (!rangeFilter(r.revenueGrowthPct, revenueGrowthMin, revenueGrowthMax)) return false;
      return true;
    });

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
    lossYearsMin, lossYearsMax, marketCapMin, marketCapMax,
    priceMin, priceMax, perMin, perMax, pbrMin, pbrMax,
    revenueGrowthMin, revenueGrowthMax,
  ]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const resetFilters = () => {
    setSearch("");
    setMarketFilter(new Set());
    setLossYearsMin("1"); setLossYearsMax("");
    setMarketCapMin(""); setMarketCapMax("");
    setPriceMin(""); setPriceMax("");
    setPerMin(""); setPerMax("");
    setPbrMin(""); setPbrMax("");
    setRevenueGrowthMin(""); setRevenueGrowthMax("");
  };

  // CSV出力
  const exportCsv = () => {
    const headers = [
      "コード", "銘柄名", "市場", "連続赤字年数", "黒転FY",
      "OP前年(百万)", "OP黒転(百万)", "売上変化%",
      "株価", "時価総額(億)", "PER", "PBR", "出来高",
    ];
    const rows = filteredAndSorted.map((r) => [
      r.code,
      r.name,
      r.marketSegment,
      r.consecutiveLossYears,
      r.turnaroundFiscalYear,
      r.priorLossAmountMM,
      r.turnaroundProfitAmountMM,
      r.revenueGrowthPct ?? "",
      r.price,
      r.marketCap ?? "",
      r.per ?? "",
      r.pbr ?? "",
      r.volume,
    ].join(","));

    const bom = "\uFEFF";
    const csv = bom + [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `turnaround-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

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
        return (
          <div className="flex items-center gap-2">
            <span className="truncate max-w-[140px] block" title={row.name}>{row.name}</span>
            <OpIncomeSparkline history={row.incomeHistory} />
          </div>
        );
      case "marketSegment":
        return <span className="text-xs">{row.marketSegment}</span>;
      case "consecutiveLossYears":
        return (
          <span className={row.consecutiveLossYears >= 3 ? "text-red-600 dark:text-red-400 font-semibold" : ""}>
            {row.consecutiveLossYears}年
          </span>
        );
      case "turnaroundFiscalYear":
        return String(row.turnaroundFiscalYear);
      case "priorLossAmountMM":
        return <span className="text-red-600 dark:text-red-400">{row.priorLossAmountMM.toLocaleString()}</span>;
      case "turnaroundProfitAmountMM":
        return <span className="text-green-700 dark:text-green-400">{row.turnaroundProfitAmountMM.toLocaleString()}</span>;
      case "revenueGrowthPct":
        if (row.revenueGrowthPct == null) return "-";
        return (
          <span className={row.revenueGrowthPct > 0 ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
            {row.revenueGrowthPct > 0 ? "+" : ""}{formatNum(row.revenueGrowthPct)}%
          </span>
        );
      case "price":
        return formatPrice(row.price);
      case "changePercent":
        return (
          <span className={changePctColor(row.changePercent)}>
            {row.changePercent > 0 ? "+" : ""}{formatNum(row.changePercent)}%
          </span>
        );
      case "marketCap":
        return row.marketCap != null ? formatMarketCap(row.marketCap * 1e8) : "-";
      case "per":
        return row.per != null ? formatNum(row.per) : "-";
      case "pbr":
        return row.pbr != null ? formatNum(row.pbr, 2) : "-";
      case "volume":
        return formatVolume(row.volume);
      default:
        return "-";
    }
  };

  return (
    <div className="flex h-screen flex-col">
      {/* ヘッダー */}
      <div className="flex-none border-b bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-900">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold">ターンアラウンド候補探索</h1>
            <p className="text-xs text-gray-500">
              営業赤字→黒字転換銘柄を検出
              {loadingData
                ? ` (読込中... ${loadedCount}/${fetchTotal})`
                : ` (${filteredAndSorted.length}件 / スキャン${stocks.length}銘柄)`
              }
              {loadingData && (
                <span className="ml-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={exportCsv}
              disabled={filteredAndSorted.length === 0}
              className="rounded bg-green-600 px-3 py-1 text-xs text-white hover:bg-green-700 disabled:opacity-50"
            >
              CSV
            </button>
            <button
              onClick={() => setShowFilters((v) => !v)}
              className="rounded bg-gray-200 px-3 py-1 text-xs hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600"
            >
              {showFilters ? "フィルタ非表示" : "フィルタ表示"}
            </button>
            <Link href="/" className="text-xs text-blue-600 hover:underline dark:text-blue-400">
              ← 戻る
            </Link>
          </div>
        </div>
      </div>

      {/* フィルタ */}
      {showFilters && (
        <div className="flex-none border-b bg-gray-50 px-4 py-2 dark:border-gray-700 dark:bg-gray-800/50">
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="text"
              placeholder="検索 (コード/名前)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-[160px] rounded border border-gray-300 px-2 py-0.5 text-xs dark:border-gray-600 dark:bg-gray-800"
            />

            {/* 市場区分フィルタ */}
            {["プライム", "スタンダード", "グロース"].map((seg) => (
              <label key={seg} className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={marketFilter.has(seg)}
                  onChange={() => {
                    const next = new Set(marketFilter);
                    if (next.has(seg)) next.delete(seg);
                    else next.add(seg);
                    setMarketFilter(next);
                  }}
                  className="h-3 w-3"
                />
                {seg}
              </label>
            ))}

            <RangeInput label="連続赤字" min={lossYearsMin} max={lossYearsMax} setMin={setLossYearsMin} setMax={setLossYearsMax} />
            <RangeInput label="時価総額(億)" min={marketCapMin} max={marketCapMax} setMin={setMarketCapMin} setMax={setMarketCapMax} />
            <RangeInput label="株価" min={priceMin} max={priceMax} setMin={setPriceMin} setMax={setPriceMax} />
            <RangeInput label="PER" min={perMin} max={perMax} setMin={setPerMin} setMax={setPerMax} />
            <RangeInput label="PBR" min={pbrMin} max={pbrMax} setMin={setPbrMin} setMax={setPbrMax} />
            <RangeInput label="売上変化%" min={revenueGrowthMin} max={revenueGrowthMax} setMin={setRevenueGrowthMin} setMax={setRevenueGrowthMax} />

            <button
              onClick={resetFilters}
              className="rounded bg-gray-200 px-2 py-0.5 text-xs hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600"
            >
              リセット
            </button>
          </div>
        </div>
      )}

      {/* テーブル */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-gray-100 dark:bg-gray-800">
            <tr>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  className={`cursor-pointer whitespace-nowrap px-2 py-1.5 ${
                    col.align === "right" ? "text-right" : "text-left"
                  } ${sortKey === col.key ? "text-blue-600 dark:text-blue-400" : ""}`}
                >
                  {col.label}
                  {sortKey === col.key && (sortDir === "asc" ? " ▲" : " ▼")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredAndSorted.map((row) => (
              <tr
                key={row.symbol}
                className="border-b border-gray-100 hover:bg-blue-50/50 dark:border-gray-800 dark:hover:bg-gray-800/50"
              >
                {COLUMNS.map((col) => (
                  <td
                    key={col.key}
                    className={`whitespace-nowrap px-2 py-1 ${
                      col.align === "right" ? "text-right" : "text-left"
                    }`}
                  >
                    {renderCell(col, row)}
                  </td>
                ))}
              </tr>
            ))}
            {filteredAndSorted.length === 0 && !loadingData && (
              <tr>
                <td colSpan={COLUMNS.length} className="py-8 text-center text-gray-400">
                  ターンアラウンド候補が見つかりませんでした
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

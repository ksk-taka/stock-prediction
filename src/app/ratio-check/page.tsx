"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import type { ReturnType } from "@/lib/utils/indicators";
import { getRatioCache, setRatioCache, type RatioCacheEntry } from "@/lib/cache/ratioCache";

type StockRatio = RatioCacheEntry;

interface WatchlistStock {
  symbol: string;
  name: string;
  favorite: boolean;
}

type SortKey =
  | "symbol" | "name" | "price"
  | "cc_m3" | "cc_m6" | "cc_y1"
  | "oc_m3" | "oc_m6" | "oc_y1"
  | "co_m3" | "co_m6" | "co_y1";

type SortDir = "asc" | "desc";

const SHARPE_KEYS = [
  "cc_m3", "cc_m6", "cc_y1",
  "oc_m3", "oc_m6", "oc_y1",
  "co_m3", "co_m6", "co_y1",
] as const;

const COLUMNS: { key: SortKey; label: string; group: string; tooltip: string }[] = [
  { key: "symbol", label: "コード", group: "", tooltip: "" },
  { key: "name", label: "銘柄名", group: "", tooltip: "" },
  { key: "price", label: "株価", group: "", tooltip: "直近終値" },
  // close-to-close
  { key: "cc_m3", label: "3m", group: "C→C", tooltip: "Close-to-Close 3ヶ月\n(昨日終値→今日終値)" },
  { key: "cc_m6", label: "6m", group: "C→C", tooltip: "Close-to-Close 6ヶ月" },
  { key: "cc_y1", label: "1y", group: "C→C", tooltip: "Close-to-Close 1年" },
  // open-to-close
  { key: "oc_m3", label: "3m", group: "O→C", tooltip: "Open-to-Close 3ヶ月\n(日中リターン: 始値→終値)" },
  { key: "oc_m6", label: "6m", group: "O→C", tooltip: "Open-to-Close 6ヶ月" },
  { key: "oc_y1", label: "1y", group: "O→C", tooltip: "Open-to-Close 1年" },
  // close-to-open
  { key: "co_m3", label: "3m", group: "C→O", tooltip: "Close-to-Open 3ヶ月\n(オーバーナイトギャップ)" },
  { key: "co_m6", label: "6m", group: "C→O", tooltip: "Close-to-Open 6ヶ月" },
  { key: "co_y1", label: "1y", group: "C→O", tooltip: "Close-to-Open 1年" },
];

const SHARPE_MAP: Record<string, [ReturnType, "m3" | "m6" | "y1"]> = {
  cc_m3: ["close_to_close", "m3"], cc_m6: ["close_to_close", "m6"], cc_y1: ["close_to_close", "y1"],
  oc_m3: ["open_to_close", "m3"], oc_m6: ["open_to_close", "m6"], oc_y1: ["open_to_close", "y1"],
  co_m3: ["close_to_open", "m3"], co_m6: ["close_to_open", "m6"], co_y1: ["close_to_open", "y1"],
};

function getSharpeValue(stock: StockRatio, key: SortKey): number | null {
  if (!stock.sharpe) return null;
  const entry = SHARPE_MAP[key];
  if (!entry) return null;
  return stock.sharpe[entry[0]]?.[entry[1]] ?? null;
}

function getNumericValue(stock: StockRatio, key: SortKey): number | null {
  if (key === "price") return stock.price;
  return getSharpeValue(stock, key);
}

function SharpeCell({ value }: { value: number | null }) {
  if (value === null) return <td className="px-2 py-1 text-center text-gray-400">-</td>;
  const color = value > 0 ? "text-green-600" : value < 0 ? "text-red-500" : "text-gray-600";
  return (
    <td className={`px-2 py-1 text-right font-mono text-sm ${color}`}>
      {value.toFixed(2)}
    </td>
  );
}

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
      <span className="min-w-[48px] text-right text-xs">{label}</span>
      <input
        type="number"
        placeholder="min"
        value={min}
        onChange={(e) => setMin(e.target.value)}
        className="w-16 rounded border border-gray-300 px-1.5 py-1 text-xs dark:border-slate-600 dark:bg-slate-700 dark:text-white"
      />
      <span className="text-xs">-</span>
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

// フィルタキーの定義 (price + 9 sharpe keys)
const FILTER_KEYS = ["price", ...SHARPE_KEYS] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

const FILTER_LABELS: Record<FilterKey, string> = {
  price: "株価",
  cc_m3: "C→C 3m", cc_m6: "C→C 6m", cc_y1: "C→C 1y",
  oc_m3: "O→C 3m", oc_m6: "O→C 6m", oc_y1: "O→C 1y",
  co_m3: "C→O 3m", co_m6: "C→O 6m", co_y1: "C→O 1y",
};

export default function RatioCheckPage() {
  const [stocks, setStocks] = useState<StockRatio[]>([]);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<string>("");
  const [sortKey, setSortKey] = useState<SortKey>("cc_y1");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [search, setSearch] = useState("");

  // 範囲フィルタ state (min/max per filter key)
  const [filters, setFilters] = useState<Record<FilterKey, { min: string; max: string }>>(
    () => Object.fromEntries(FILTER_KEYS.map((k) => [k, { min: "", max: "" }])) as Record<FilterKey, { min: string; max: string }>,
  );

  const setFilterMin = (key: FilterKey, v: string) =>
    setFilters((prev) => ({ ...prev, [key]: { ...prev[key], min: v } }));
  const setFilterMax = (key: FilterKey, v: string) =>
    setFilters((prev) => ({ ...prev, [key]: { ...prev[key], max: v } }));

  useEffect(() => {
    (async () => {
      try {
        // IndexedDB キャッシュを確認 (6時間TTL)
        const cached = await getRatioCache();
        if (cached) {
          setStocks(cached);
          setLoading(false);
          return;
        }

        setProgress("ウォッチリスト取得中...");
        const wlRes = await fetch("/api/watchlist");
        if (!wlRes.ok) throw new Error("Failed to fetch watchlist");
        const wlData = await wlRes.json();
        const favorites: WatchlistStock[] = (wlData.stocks ?? [])
          .filter((s: WatchlistStock) => s.favorite);

        if (favorites.length === 0) {
          setProgress("お気に入り銘柄がありません");
          setLoading(false);
          return;
        }

        const BATCH = 20;
        const allResults: StockRatio[] = [];
        for (let i = 0; i < favorites.length; i += BATCH) {
          const batch = favorites.slice(i, i + BATCH);
          const symbols = batch.map((s) => s.symbol).join(",");
          setProgress(`計算中... ${Math.min(i + BATCH, favorites.length)}/${favorites.length}`);

          const res = await fetch(`/api/ratio-check?symbols=${symbols}`);
          if (!res.ok) throw new Error("ratio-check API error");
          const data = await res.json();

          for (const r of data.results) {
            const wlStock = favorites.find((s) => s.symbol === r.symbol);
            allResults.push({
              symbol: r.symbol,
              name: wlStock?.name ?? r.symbol,
              price: r.price ?? null,
              sharpe: r.sharpe,
              error: r.error,
            });
          }
        }

        setStocks(allResults);
        // IndexedDB に保存
        await setRatioCache(allResults);
      } catch (err) {
        setProgress(`エラー: ${err}`);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const sorted = useMemo(() => {
    let list = stocks;

    // テキスト検索
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (s) => s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q),
      );
    }

    // 範囲フィルタ
    for (const key of FILTER_KEYS) {
      const { min, max } = filters[key];
      const lo = min !== "" ? parseFloat(min) : NaN;
      const hi = max !== "" ? parseFloat(max) : NaN;
      if (isNaN(lo) && isNaN(hi)) continue;
      list = list.filter((s) => {
        const v = getNumericValue(s, key);
        if (v == null) return false;
        if (!isNaN(lo) && v < lo) return false;
        if (!isNaN(hi) && v > hi) return false;
        return true;
      });
    }

    // ソート
    return [...list].sort((a, b) => {
      if (sortKey === "symbol") return sortDir === "asc" ? a.symbol.localeCompare(b.symbol) : b.symbol.localeCompare(a.symbol);
      if (sortKey === "name") return sortDir === "asc" ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);

      const va = getNumericValue(a, sortKey);
      const vb = getNumericValue(b, sortKey);
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      return sortDir === "asc" ? va - vb : vb - va;
    });
  }, [stocks, sortKey, sortDir, search, filters]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "symbol" || key === "name" ? "asc" : "desc");
    }
  };

  const hasActiveFilter = FILTER_KEYS.some((k) => filters[k].min !== "" || filters[k].max !== "");
  const clearFilters = () =>
    setFilters(Object.fromEntries(FILTER_KEYS.map((k) => [k, { min: "", max: "" }])) as Record<FilterKey, { min: string; max: string }>);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900 p-4">
      <div className="mx-auto max-w-7xl">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">
            レシオ指標確認
          </h1>
          <Link href="/" className="text-sm text-blue-600 hover:underline dark:text-blue-400">
            ← ウォッチリストへ
          </Link>
        </div>

        {/* 説明 */}
        <div className="mb-4 rounded-lg bg-white p-3 text-sm text-gray-600 shadow dark:bg-slate-800 dark:text-slate-300">
          <p className="font-medium mb-1">年率化シャープレシオ = (μ / σ) × √250</p>
          <ul className="list-disc pl-5 space-y-0.5">
            <li><b>C→C</b> (Close-to-Close): 昨日終値→今日終値 ― 通常のリターン</li>
            <li><b>O→C</b> (Open-to-Close): 今日始値→今日終値 ― 日中リターン（ローソク足実体）</li>
            <li><b>C→O</b> (Close-to-Open): 昨日終値→今日始値 ― オーバーナイトギャップ</li>
          </ul>
        </div>

        {/* 検索 + フィルタ */}
        <div className="mb-3 space-y-2">
          <div className="flex items-center gap-3">
            <input
              type="text"
              placeholder="銘柄コード・名前で検索..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full max-w-xs rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200"
            />
            {hasActiveFilter && (
              <button onClick={clearFilters} className="text-xs text-red-500 hover:underline">
                フィルタクリア
              </button>
            )}
          </div>

          {/* 範囲フィルタ */}
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 rounded-lg bg-white p-2 shadow dark:bg-slate-800">
            <span className="text-xs font-medium text-gray-500 dark:text-slate-400 self-center">範囲</span>
            {FILTER_KEYS.map((key) => (
              <RangeInput
                key={key}
                label={FILTER_LABELS[key]}
                min={filters[key].min}
                max={filters[key].max}
                setMin={(v) => setFilterMin(key, v)}
                setMax={(v) => setFilterMax(key, v)}
              />
            ))}
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12 text-gray-500">{progress || "読み込み中..."}</div>
        ) : stocks.length === 0 ? (
          <div className="text-center py-12 text-gray-500">{progress || "データがありません"}</div>
        ) : (
          <div className="overflow-x-auto rounded-lg bg-white shadow dark:bg-slate-800">
            <table className="min-w-full text-sm">
              <thead>
                {/* グループヘッダー行 */}
                <tr className="border-b border-gray-200 dark:border-slate-700">
                  <th colSpan={3} className="px-2 py-1"></th>
                  <th colSpan={3} className="px-2 py-1 text-center text-xs font-bold text-blue-700 dark:text-blue-300 border-l border-gray-200 dark:border-slate-700">
                    C→C (終値→終値)
                  </th>
                  <th colSpan={3} className="px-2 py-1 text-center text-xs font-bold text-purple-700 dark:text-purple-300 border-l border-gray-200 dark:border-slate-700">
                    O→C (始値→終値)
                  </th>
                  <th colSpan={3} className="px-2 py-1 text-center text-xs font-bold text-orange-700 dark:text-orange-300 border-l border-gray-200 dark:border-slate-700">
                    C→O (終値→始値)
                  </th>
                </tr>
                {/* カラムヘッダー行 */}
                <tr className="border-b border-gray-300 bg-gray-50 dark:border-slate-600 dark:bg-slate-700">
                  {COLUMNS.map((col, i) => {
                    const isGroupBorder = i === 3 || i === 6 || i === 9;
                    return (
                      <th
                        key={col.key}
                        onClick={() => handleSort(col.key)}
                        title={col.tooltip}
                        className={`cursor-pointer whitespace-nowrap px-2 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-600 ${
                          col.key === "symbol" || col.key === "name" ? "text-left" : "text-right"
                        } ${isGroupBorder ? "border-l border-gray-200 dark:border-slate-600" : ""}`}
                      >
                        {col.label}
                        {sortKey === col.key && (sortDir === "asc" ? " ↑" : " ↓")}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sorted.map((stock) => (
                  <tr
                    key={stock.symbol}
                    className="border-b border-gray-100 hover:bg-gray-50 dark:border-slate-700 dark:hover:bg-slate-700/50"
                  >
                    <td className="px-2 py-1 font-mono text-xs">
                      <Link
                        href={`/stock/${stock.symbol}`}
                        className="text-blue-600 hover:underline dark:text-blue-400"
                      >
                        {stock.symbol.replace(".T", "")}
                      </Link>
                    </td>
                    <td className="px-2 py-1 text-xs max-w-[120px] truncate" title={stock.name}>
                      {stock.name}
                    </td>
                    <td className="px-2 py-1 text-right font-mono text-xs">
                      {stock.price != null ? stock.price.toLocaleString("ja-JP") : "-"}
                    </td>
                    {/* C→C */}
                    <SharpeCell value={getSharpeValue(stock, "cc_m3")} />
                    <SharpeCell value={getSharpeValue(stock, "cc_m6")} />
                    <SharpeCell value={getSharpeValue(stock, "cc_y1")} />
                    {/* O→C */}
                    <SharpeCell value={getSharpeValue(stock, "oc_m3")} />
                    <SharpeCell value={getSharpeValue(stock, "oc_m6")} />
                    <SharpeCell value={getSharpeValue(stock, "oc_y1")} />
                    {/* C→O */}
                    <SharpeCell value={getSharpeValue(stock, "co_m3")} />
                    <SharpeCell value={getSharpeValue(stock, "co_m6")} />
                    <SharpeCell value={getSharpeValue(stock, "co_y1")} />
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-3 py-2 text-xs text-gray-500 dark:text-slate-400">
              {sorted.length} / {stocks.length} 銘柄
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

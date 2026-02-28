"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import Link from "next/link";
import { formatMarketCap, getCapSize } from "@/lib/utils/format";
import { getTableCache, setTableCache } from "@/lib/cache/tableCache";
import type { StockTableRow } from "@/lib/cache/tableCache";
import GroupAssignPopup from "@/components/GroupAssignPopup";
import BatchGroupAssignPopup from "@/components/BatchGroupAssignPopup";
import CsvExportButton from "@/components/CsvExportButton";

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
  { key: "topixScale", label: "TOPIX", group: "基本", align: "left", defaultVisible: false },
  { key: "isNikkei225", label: "N225", group: "基本", align: "left", defaultVisible: false },
  { key: "firstTradeDate", label: "上場日", group: "基本", align: "right", defaultVisible: false },
  { key: "price", label: "現在値", group: "基本", align: "right", defaultVisible: true },
  { key: "changePercent", label: "前日比%", group: "基本", align: "right", defaultVisible: true },
  { key: "volume", label: "出来高", group: "基本", align: "right", defaultVisible: true },
  { key: "per", label: "PER", group: "指標", align: "right", defaultVisible: true },
  { key: "eps", label: "EPS", group: "指標", align: "right", defaultVisible: true },
  { key: "pbr", label: "PBR", group: "指標", align: "right", defaultVisible: true },
  { key: "marketCap", label: "時価総額", group: "指標", align: "right", defaultVisible: true },
  { key: "simpleNcRatio", label: "簡易NC率", group: "指標", align: "right", defaultVisible: false },
  { key: "cnPer", label: "簡易CNPER", group: "指標", align: "right", defaultVisible: true },
  { key: "earningsDate", label: "決算発表日", group: "指標", align: "right", defaultVisible: true },
  { key: "fiscalYearEnd", label: "決算日", group: "指標", align: "right", defaultVisible: false },
  { key: "sharpe1y", label: "Sharpe", group: "指標", align: "right", defaultVisible: false },
  { key: "roe", label: "ROE", group: "指標", align: "right", defaultVisible: false },
  { key: "currentRatio", label: "流動比率", group: "指標", align: "right", defaultVisible: false },
  { key: "psr", label: "PSR", group: "指標", align: "right", defaultVisible: false },
  { key: "pegRatio", label: "PEG", group: "指標", align: "right", defaultVisible: false },
  { key: "equityRatio", label: "自己資本比率", group: "指標", align: "right", defaultVisible: false },
  { key: "totalDebt", label: "有利子負債", group: "指標", align: "right", defaultVisible: false },
  { key: "profitGrowthRate", label: "増益率", group: "指標", align: "right", defaultVisible: false },
  { key: "revenueGrowth", label: "売上成長率", group: "指標", align: "right", defaultVisible: false },
  { key: "operatingMargins", label: "営業利益率", group: "指標", align: "right", defaultVisible: false },
  { key: "floatingRatio", label: "浮動株比率", group: "指標", align: "right", defaultVisible: false },
  { key: "floatingMarketCap", label: "浮動株時価総額", group: "指標", align: "right", defaultVisible: false },
  { key: "hasBuyback", label: "自株買", group: "自株買", align: "left", defaultVisible: false },
  { key: "buybackProgressAmount", label: "金額進捗%", group: "自株買", align: "right", defaultVisible: false },
  { key: "buybackProgressShares", label: "株数進捗%", group: "自株買", align: "right", defaultVisible: false },
  { key: "buybackImpactDays", label: "インパクト日", group: "自株買", align: "right", defaultVisible: false },
  { key: "buybackMaxAmount", label: "取得上限", group: "自株買", align: "right", defaultVisible: false },
  { key: "buybackCumulativeAmount", label: "累計取得", group: "自株買", align: "right", defaultVisible: false },
  { key: "buybackRemainingShares", label: "残り株数", group: "自株買", align: "right", defaultVisible: false },
  { key: "buybackPeriodTo", label: "取得期限", group: "自株買", align: "right", defaultVisible: false },
  { key: "buybackIsActive", label: "買付状態", group: "自株買", align: "left", defaultVisible: false },
  { key: "dividendYield", label: "配当利回り", group: "配当", align: "right", defaultVisible: true },
  { key: "latestDividend", label: "配当額", group: "配当", align: "right", defaultVisible: false },
  { key: "previousDividend", label: "前回配当", group: "配当", align: "right", defaultVisible: false },
  { key: "latestIncrease", label: "増配額", group: "配当", align: "right", defaultVisible: true },
  { key: "hasYutai", label: "優待", group: "優待", align: "left", defaultVisible: true },
  { key: "yutaiContent", label: "優待内容", group: "優待", align: "left", defaultVisible: false },
  { key: "recordDate", label: "権利付最終日", group: "優待", align: "right", defaultVisible: false },
  { key: "sellRecommendDate", label: "売り推奨日", group: "優待", align: "right", defaultVisible: true },
  { key: "daysUntilSell", label: "残日数", group: "優待", align: "right", defaultVisible: false },
  { key: "roeHistory", label: "ROE推移", group: "指標", align: "left", defaultVisible: false },
  { key: "fcfHistory", label: "FCF推移", group: "指標", align: "left", defaultVisible: false },
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

const BATCH_SIZE = 50;

// ── 決算発表日フィルタ プリセット ──

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

  // テーブルデータ (IndexedDBからリストア - タブ間・再訪問で共有)
  const [tableData, setTableData] = useState<Map<string, StockTableRow>>(new Map());
  const [cacheRestored, setCacheRestored] = useState(false);
  const [loadingData, setLoadingData] = useState(false);

  // マウント時にIndexedDBから復元
  useEffect(() => {
    getTableCache().then((cached) => {
      if (cached) setTableData(cached);
      setCacheRestored(true);
    });
  }, []);
  const [loadedCount, setLoadedCount] = useState(0);
  const [fetchTotal, setFetchTotal] = useState(0); // 実際にフェッチする件数

  // フィルタ・ソート
  const [allGroups, setAllGroups] = useState<WatchlistGroup[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<number>>(new Set());
  const [marketFilter, setMarketFilter] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("code");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // 時価総額フィルタ
  const [capSizeFilter, setCapSizeFilter] = useState<Set<string>>(new Set());

  // ドロップダウン
  const [showGroupDropdown, setShowGroupDropdown] = useState(false);
  const groupDropdownRef = useRef<HTMLDivElement>(null);
  const [showMarketDropdown, setShowMarketDropdown] = useState(false);
  const marketDropdownRef = useRef<HTMLDivElement>(null);
  const [showCapDropdown, setShowCapDropdown] = useState(false);
  const capDropdownRef = useRef<HTMLDivElement>(null);

  // グループポップアップ
  const [groupPopup, setGroupPopup] = useState<{ symbol: string; anchor: DOMRect } | null>(null);
  const [showBatchGroupPopup, setShowBatchGroupPopup] = useState(false);

  // 数値範囲フィルタ
  const [ncRatioMin, setNcRatioMin] = useState("");
  const [ncRatioMax, setNcRatioMax] = useState("");
  const [sharpeMin, setSharpeMin] = useState("");
  const [increaseMin, setIncreaseMin] = useState("");
  const [roeMin, setRoeMin] = useState("");
  const [roeMax, setRoeMax] = useState("");
  const [currentRatioMin, setCurrentRatioMin] = useState("");
  const [currentRatioMax, setCurrentRatioMax] = useState("");
  const [psrMin, setPsrMin] = useState("");
  const [psrMax, setPsrMax] = useState("");
  const [pegMin, setPegMin] = useState("");
  const [pegMax, setPegMax] = useState("");
  const [equityRatioMin, setEquityRatioMin] = useState("");
  const [equityRatioMax, setEquityRatioMax] = useState("");
  const [profitGrowthMin, setProfitGrowthMin] = useState("");
  const [revenueGrowthMin, setRevenueGrowthMin] = useState("");
  const [operatingMarginsMin, setOperatingMarginsMin] = useState("");
  const [listingYearsMax, setListingYearsMax] = useState("");
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");
  const [yutaiOnly, setYutaiOnly] = useState(false);
  const [buybackOnly, setBuybackOnly] = useState(false);

  // TOPIX / N225 / 時価総額範囲フィルタ
  const [topixFilter, setTopixFilter] = useState<Set<string>>(new Set());
  const [nikkei225Only, setNikkei225Only] = useState(false);
  const [marketCapMin, setMarketCapMin] = useState("");
  const [marketCapMax, setMarketCapMax] = useState("");
  const [showTopixDropdown, setShowTopixDropdown] = useState(false);
  const topixDropdownRef = useRef<HTMLDivElement>(null);

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

  // ドロップダウン: 外側クリックで閉じる
  useEffect(() => {
    if (!showGroupDropdown && !showMarketDropdown && !showCapDropdown && !showTopixDropdown) return;
    function handleClick(e: MouseEvent) {
      const t = e.target as Node;
      if (showGroupDropdown && groupDropdownRef.current && !groupDropdownRef.current.contains(t)) setShowGroupDropdown(false);
      if (showMarketDropdown && marketDropdownRef.current && !marketDropdownRef.current.contains(t)) setShowMarketDropdown(false);
      if (showCapDropdown && capDropdownRef.current && !capDropdownRef.current.contains(t)) setShowCapDropdown(false);
      if (showTopixDropdown && topixDropdownRef.current && !topixDropdownRef.current.contains(t)) setShowTopixDropdown(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showGroupDropdown, showMarketDropdown, showCapDropdown, showTopixDropdown]);

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
    if (marketFilter.size > 0) {
      list = list.filter((s) => s.marketSegment != null && marketFilter.has(s.marketSegment));
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

  // fetch世代カウンタ: 新しいfetchが始まったら古いfetchの状態更新を無視する
  const fetchGenRef = useRef(0);

  const fetchTableData = useCallback(
    async (symbolList: string[]) => {
      if (symbolList.length === 0) return;

      // 既にフェッチ済みのシンボルを除外
      const missing = symbolList.filter((s) => !tableDataRef.current.has(s));
      if (missing.length === 0) return; // 全てキャッシュ済み → 何もしない

      // 新しいfetch世代を開始（古い並行fetchを無効化）
      const gen = ++fetchGenRef.current;

      setLoadingData(true);
      setLoadedCount(0);
      setFetchTotal(missing.length);

      const existing = new Map(tableDataRef.current);

      for (let i = 0; i < missing.length; i += BATCH_SIZE) {
        // 新しいfetchが始まっていたら中断
        if (fetchGenRef.current !== gen) return;

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

        // 中断チェック（fetch中に新世代が始まった場合）
        if (fetchGenRef.current !== gen) return;

        setLoadedCount(Math.min(i + BATCH_SIZE, missing.length));
        setTableData(new Map(existing));
      }

      // 最終チェック: このfetchがまだ最新なら完了
      if (fetchGenRef.current === gen) {
        setLoadingData(false);
        setTableCache(existing);
      }
    },
    [],
  );

  // フィルタが変わったらデータ取得（未取得分のみ）
  // cacheRestored を待つことで、IndexedDB復元前にfetchが走るのを防ぐ
  useEffect(() => {
    if (loadingStocks || !cacheRestored) return;
    const syms = filteredStocks.map((s) => s.symbol);
    fetchTableData(syms);
  }, [filteredStocks, loadingStocks, cacheRestored, fetchTableData]);

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
        fiscalYearEnd: td?.fiscalYearEnd ?? null,
        marketCap: td?.marketCap ?? null,
        sharpe1y: td?.sharpe1y ?? null,
        roe: td?.roe ?? null,
        latestDividend: td?.latestDividend ?? null,
        previousDividend: td?.previousDividend ?? null,
        latestIncrease: td?.latestIncrease ?? null,
        hasYutai: td?.hasYutai ?? null,
        yutaiContent: td?.yutaiContent ?? null,
        recordDate: td?.recordDate ?? null,
        sellRecommendDate: td?.sellRecommendDate ?? null,
        daysUntilSell: td?.daysUntilSell ?? null,
        dividendYield: td?.dividendYield ?? null,
        roeHistory: td?.roeHistory ?? null,
        fcfHistory: td?.fcfHistory ?? null,
        currentRatio: td?.currentRatio ?? null,
        psr: td?.psr ?? null,
        pegRatio: td?.pegRatio ?? null,
        equityRatio: td?.equityRatio ?? null,
        totalDebt: td?.totalDebt ?? null,
        profitGrowthRate: td?.profitGrowthRate ?? null,
        revenueGrowth: td?.revenueGrowth ?? null,
        operatingMargins: td?.operatingMargins ?? null,
        topixScale: td?.topixScale ?? null,
        isNikkei225: td?.isNikkei225 ?? false,
        firstTradeDate: td?.firstTradeDate ?? null,
        sharesOutstanding: td?.sharesOutstanding ?? null,
        floatingRatio: td?.floatingRatio ?? null,
        floatingMarketCap: td?.floatingMarketCap ?? null,
        hasBuyback: td?.hasBuyback ?? null,
        buybackProgressAmount: td?.buybackProgressAmount ?? null,
        buybackProgressShares: td?.buybackProgressShares ?? null,
        buybackImpactDays: td?.buybackImpactDays ?? null,
        buybackMaxAmount: td?.buybackMaxAmount ?? null,
        buybackCumulativeAmount: td?.buybackCumulativeAmount ?? null,
        buybackRemainingShares: td?.buybackRemainingShares ?? null,
        buybackPeriodTo: td?.buybackPeriodTo ?? null,
        buybackIsActive: td?.buybackIsActive ?? null,
      };
    });

    // 時価総額フィルタ (カテゴリ)
    if (capSizeFilter.size > 0) {
      rows = rows.filter((r) => {
        const cs = getCapSize(r.marketCap);
        return cs !== null && capSizeFilter.has(cs);
      });
    }

    // 時価総額フィルタ (範囲, 億円)
    if (marketCapMin !== "" || marketCapMax !== "") {
      const min = marketCapMin !== "" ? parseFloat(marketCapMin) * 100_000_000 : NaN;
      const max = marketCapMax !== "" ? parseFloat(marketCapMax) * 100_000_000 : NaN;
      rows = rows.filter((r) => {
        if (r.marketCap == null) return false;
        if (!isNaN(min) && r.marketCap < min) return false;
        if (!isNaN(max) && r.marketCap > max) return false;
        return true;
      });
    }

    // TOPIXフィルタ
    if (topixFilter.size > 0) {
      rows = rows.filter((r) => r.topixScale != null && topixFilter.has(r.topixScale));
    }

    // N225フィルタ
    if (nikkei225Only) {
      rows = rows.filter((r) => r.isNikkei225 === true);
    }

    // NC率フィルタ (x以上y未満)
    if (ncRatioMin !== "" || ncRatioMax !== "") {
      const min = ncRatioMin !== "" ? parseFloat(ncRatioMin) : NaN;
      const max = ncRatioMax !== "" ? parseFloat(ncRatioMax) : NaN;
      rows = rows.filter((r) => {
        if (r.simpleNcRatio == null) return false;
        if (!isNaN(min) && r.simpleNcRatio < min) return false;
        if (!isNaN(max) && r.simpleNcRatio >= max) return false;
        return true;
      });
    }

    // シャープレシオ フィルタ
    if (sharpeMin !== "") {
      const min = parseFloat(sharpeMin);
      if (!isNaN(min)) {
        rows = rows.filter((r) => r.sharpe1y != null && r.sharpe1y >= min);
      }
    }

    // 増配額フィルタ
    if (increaseMin !== "") {
      const min = parseFloat(increaseMin);
      if (!isNaN(min)) {
        rows = rows.filter((r) => r.latestIncrease != null && r.latestIncrease >= min);
      }
    }

    // ROEフィルタ (入力は%、データは小数 e.g. 0.15 = 15%)
    if (roeMin !== "" || roeMax !== "") {
      const min = roeMin !== "" ? parseFloat(roeMin) : NaN;
      const max = roeMax !== "" ? parseFloat(roeMax) : NaN;
      rows = rows.filter((r) => {
        if (r.roe == null) return false;
        const roePct = r.roe * 100;
        if (!isNaN(min) && roePct < min) return false;
        if (!isNaN(max) && roePct >= max) return false;
        return true;
      });
    }

    // 流動比率フィルタ
    if (currentRatioMin !== "" || currentRatioMax !== "") {
      const min = currentRatioMin !== "" ? parseFloat(currentRatioMin) : NaN;
      const max = currentRatioMax !== "" ? parseFloat(currentRatioMax) : NaN;
      rows = rows.filter((r) => {
        if (r.currentRatio == null) return false;
        if (!isNaN(min) && r.currentRatio < min) return false;
        if (!isNaN(max) && r.currentRatio > max) return false;
        return true;
      });
    }

    // PSRフィルタ
    if (psrMin !== "" || psrMax !== "") {
      const min = psrMin !== "" ? parseFloat(psrMin) : NaN;
      const max = psrMax !== "" ? parseFloat(psrMax) : NaN;
      rows = rows.filter((r) => {
        if (r.psr == null) return false;
        if (!isNaN(min) && r.psr < min) return false;
        if (!isNaN(max) && r.psr > max) return false;
        return true;
      });
    }

    // PEGフィルタ
    if (pegMin !== "" || pegMax !== "") {
      const min = pegMin !== "" ? parseFloat(pegMin) : NaN;
      const max = pegMax !== "" ? parseFloat(pegMax) : NaN;
      rows = rows.filter((r) => {
        if (r.pegRatio == null) return false;
        if (!isNaN(min) && r.pegRatio < min) return false;
        if (!isNaN(max) && r.pegRatio > max) return false;
        return true;
      });
    }

    // 自己資本比率フィルタ
    if (equityRatioMin !== "" || equityRatioMax !== "") {
      const min = equityRatioMin !== "" ? parseFloat(equityRatioMin) : NaN;
      const max = equityRatioMax !== "" ? parseFloat(equityRatioMax) : NaN;
      rows = rows.filter((r) => {
        if (r.equityRatio == null) return false;
        if (!isNaN(min) && r.equityRatio < min) return false;
        if (!isNaN(max) && r.equityRatio > max) return false;
        return true;
      });
    }

    // 増益率フィルタ
    if (profitGrowthMin !== "") {
      const min = parseFloat(profitGrowthMin);
      if (!isNaN(min)) {
        rows = rows.filter((r) => r.profitGrowthRate != null && r.profitGrowthRate >= min);
      }
    }

    // 売上成長率フィルタ
    if (revenueGrowthMin !== "") {
      const min = parseFloat(revenueGrowthMin);
      if (!isNaN(min)) {
        rows = rows.filter((r) => r.revenueGrowth != null && r.revenueGrowth >= min);
      }
    }

    // 営業利益率フィルタ
    if (operatingMarginsMin !== "") {
      const min = parseFloat(operatingMarginsMin);
      if (!isNaN(min)) {
        rows = rows.filter((r) => r.operatingMargins != null && r.operatingMargins >= min);
      }
    }

    // 上場年数フィルタ
    if (listingYearsMax !== "") {
      const maxYears = parseFloat(listingYearsMax);
      if (!isNaN(maxYears)) {
        const now = Date.now();
        rows = rows.filter((r) => {
          if (!r.firstTradeDate) return false;
          const listedMs = now - new Date(r.firstTradeDate).getTime();
          const listedYears = listedMs / (365.25 * 24 * 60 * 60 * 1000);
          return listedYears < maxYears;
        });
      }
    }

    // 株価フィルタ
    if (priceMin !== "" || priceMax !== "") {
      const min = priceMin !== "" ? parseFloat(priceMin) : NaN;
      const max = priceMax !== "" ? parseFloat(priceMax) : NaN;
      rows = rows.filter((r) => {
        if (!isNaN(min) && r.price < min) return false;
        if (!isNaN(max) && r.price > max) return false;
        return true;
      });
    }

    // 優待フィルタ
    if (yutaiOnly) {
      rows = rows.filter((r) => r.hasYutai === true);
    }

    // 自社株買いフィルタ
    if (buybackOnly) {
      rows = rows.filter((r) => r.hasBuyback === true);
    }

    // 決算発表日フィルタ
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
  }, [filteredStocks, tableData, sortKey, sortDir, capSizeFilter, ncRatioMin, ncRatioMax, sharpeMin, increaseMin, roeMin, roeMax, currentRatioMin, currentRatioMax, psrMin, psrMax, pegMin, pegMax, equityRatioMin, equityRatioMax, profitGrowthMin, revenueGrowthMin, operatingMarginsMin, listingYearsMax, priceMin, priceMax, yutaiOnly, buybackOnly, earningsFrom, earningsTo, topixFilter, nikkei225Only, marketCapMin, marketCapMax]);

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

  const handleCreateGroup = useCallback(async (name: string, color?: string) => {
    const res = await fetch("/api/watchlist/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, color }),
    });
    if (!res.ok) throw new Error("Failed to create group");
    const group = await res.json() as WatchlistGroup;
    setAllGroups((prev) => [...prev, group]);
    return group;
  }, []);

  const handleBatchAddToGroup = useCallback(async (symbols: string[], groupId: number) => {
    // 楽観的更新
    setStocks((prev) =>
      prev.map((s) => {
        if (!symbols.includes(s.symbol)) return s;
        const currentIds = s.groupIds ?? [];
        if (currentIds.includes(groupId)) return s;
        return { ...s, groupIds: [...currentIds, groupId], favorite: true };
      })
    );
    const res = await fetch("/api/watchlist/batch-groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbols, groupId }),
    });
    if (!res.ok) throw new Error("batch group add failed");
    return (await res.json()) as { updated: number; alreadyInGroup: number };
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
      case "topixScale":
        if (!row.topixScale) return "－";
        {
          const label = row.topixScale.replace("TOPIX ", "");
          const color = row.topixScale === "TOPIX Core30" ? "text-red-600 dark:text-red-400 font-semibold"
            : row.topixScale === "TOPIX Large70" ? "text-orange-600 dark:text-orange-400 font-semibold"
            : row.topixScale === "TOPIX Mid400" ? "text-blue-600 dark:text-blue-400"
            : "text-gray-500 dark:text-slate-400";
          return <span className={color}>{label}</span>;
        }
      case "isNikkei225":
        return row.isNikkei225
          ? <span className="inline-block rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">N225</span>
          : "－";
      case "firstTradeDate":
        return row.firstTradeDate
          ? <span className="text-gray-500 dark:text-slate-400 text-xs">{row.firstTradeDate}</span>
          : "－";
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
      case "sharpe1y":
        if (row.sharpe1y == null) return "－";
        return (
          <span className={
            row.sharpe1y > 1 ? "text-green-600 dark:text-green-400"
              : row.sharpe1y < 0 ? "text-red-600 dark:text-red-400"
              : ""
          }>
            {row.sharpe1y > 0 ? "+" : ""}{row.sharpe1y.toFixed(2)}
          </span>
        );
      case "roe":
        if (row.roe == null) return "－";
        return (
          <span className={
            row.roe > 0.15 ? "text-green-600 dark:text-green-400"
              : row.roe < 0 ? "text-red-600 dark:text-red-400"
              : ""
          }>
            {(row.roe * 100).toFixed(1)}%
          </span>
        );
      case "currentRatio":
        if (row.currentRatio == null) return "－";
        return (
          <span className={
            row.currentRatio >= 2 ? "text-green-600 dark:text-green-400"
              : row.currentRatio < 1 ? "text-red-600 dark:text-red-400"
              : ""
          }>
            {row.currentRatio.toFixed(2)}
          </span>
        );
      case "psr":
        if (row.psr == null) return "－";
        return (
          <span className={
            row.psr < 1 ? "text-green-600 dark:text-green-400"
              : row.psr > 5 ? "text-red-600 dark:text-red-400"
              : ""
          }>
            {row.psr.toFixed(2)}
          </span>
        );
      case "pegRatio":
        if (row.pegRatio == null) return "－";
        return (
          <span className={
            row.pegRatio > 0 && row.pegRatio < 1 ? "text-green-600 dark:text-green-400"
              : row.pegRatio > 2 ? "text-red-600 dark:text-red-400"
              : ""
          }>
            {row.pegRatio.toFixed(2)}
          </span>
        );
      case "equityRatio":
        if (row.equityRatio == null) return "－";
        return (
          <span className={
            row.equityRatio >= 50 ? "text-green-600 dark:text-green-400"
              : row.equityRatio < 20 ? "text-red-600 dark:text-red-400"
              : ""
          }>
            {row.equityRatio.toFixed(1)}%
          </span>
        );
      case "totalDebt":
        if (row.totalDebt == null) return "－";
        return (
          <span title={`${row.totalDebt.toLocaleString()}円`}>
            {(row.totalDebt / 1e8).toFixed(0)}億
          </span>
        );
      case "profitGrowthRate":
        if (row.profitGrowthRate == null) return "－";
        return (
          <span className={
            row.profitGrowthRate > 20 ? "text-green-600 dark:text-green-400 font-bold"
              : row.profitGrowthRate > 0 ? "text-green-600 dark:text-green-400"
              : row.profitGrowthRate < -20 ? "text-red-600 dark:text-red-400 font-bold"
              : "text-red-600 dark:text-red-400"
          }>
            {row.profitGrowthRate > 0 ? "+" : ""}{row.profitGrowthRate.toFixed(1)}%
          </span>
        );
      case "revenueGrowth":
        if (row.revenueGrowth == null) return "－";
        return (
          <span className={
            row.revenueGrowth >= 10 ? "text-green-600 dark:text-green-400 font-bold"
              : row.revenueGrowth > 0 ? "text-green-600 dark:text-green-400"
              : row.revenueGrowth < 0 ? "text-red-600 dark:text-red-400"
              : ""
          }>
            {row.revenueGrowth > 0 ? "+" : ""}{row.revenueGrowth.toFixed(1)}%
          </span>
        );
      case "operatingMargins":
        if (row.operatingMargins == null) return "－";
        return (
          <span className={
            row.operatingMargins >= 10 ? "text-green-600 dark:text-green-400 font-bold"
              : row.operatingMargins >= 5 ? "text-green-600 dark:text-green-400"
              : row.operatingMargins < 0 ? "text-red-600 dark:text-red-400"
              : ""
          }>
            {row.operatingMargins.toFixed(1)}%
          </span>
        );
      case "floatingRatio":
        if (row.floatingRatio == null) return "－";
        return `${(row.floatingRatio * 100).toFixed(1)}%`;
      case "floatingMarketCap":
        return row.floatingMarketCap ? formatMarketCap(row.floatingMarketCap) : "－";
      case "dividendYield": {
        if (row.dividendYield == null) return "－";
        const yieldPct = Math.round(row.dividendYield * 1000) / 10; // 小数→%変換
        const CPI = 3.0; // 日本CPI（目安）
        return (
          <span className={
            yieldPct >= CPI ? "text-green-600 dark:text-green-400 font-bold"
              : yieldPct > 0 ? ""
              : "text-gray-400 dark:text-slate-500"
          } title={yieldPct >= CPI ? `CPI(${CPI}%)超` : `CPI(${CPI}%)未満`}>
            {yieldPct.toFixed(1)}%
          </span>
        );
      }
      case "latestDividend":
      case "previousDividend":
        if (v == null) return "－";
        return (v as number).toLocaleString();
      case "latestIncrease": {
        if (v == null) return "－";
        const inc = v as number;
        return (
          <span className={
            inc > 0 ? "text-green-600 dark:text-green-400"
              : inc < 0 ? "text-red-600 dark:text-red-400"
              : ""
          }>
            {inc > 0 ? "+" : ""}{inc.toLocaleString()}
          </span>
        );
      }
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
      case "fiscalYearEnd":
        return row.fiscalYearEnd ? (
          <span className="text-xs">{row.fiscalYearEnd}</span>
        ) : (
          "－"
        );
      case "hasYutai":
        if (row.hasYutai === null) return <span className="text-gray-300 dark:text-slate-600">?</span>;
        return row.hasYutai
          ? <span className="text-pink-600 dark:text-pink-400 font-bold">●</span>
          : <span className="text-gray-300 dark:text-slate-600">－</span>;
      case "hasBuyback":
        if (row.hasBuyback === null) return <span className="text-gray-300 dark:text-slate-600">?</span>;
        return row.hasBuyback
          ? <span className="text-blue-600 dark:text-blue-400 font-bold">●</span>
          : <span className="text-gray-300 dark:text-slate-600">－</span>;
      case "buybackProgressAmount":
        if (row.buybackProgressAmount == null) return "－";
        return <span className={row.buybackProgressAmount >= 80 ? "text-green-600 dark:text-green-400 font-semibold" : row.buybackProgressAmount >= 50 ? "text-blue-600 dark:text-blue-400" : ""}>{row.buybackProgressAmount.toFixed(1)}%</span>;
      case "buybackProgressShares":
        if (row.buybackProgressShares == null) return "－";
        return <span className={row.buybackProgressShares >= 80 ? "text-green-600 dark:text-green-400 font-semibold" : row.buybackProgressShares >= 50 ? "text-blue-600 dark:text-blue-400" : ""}>{row.buybackProgressShares.toFixed(1)}%</span>;
      case "buybackImpactDays":
        if (row.buybackImpactDays == null) return "－";
        return <span className={row.buybackImpactDays <= 20 ? "text-red-600 dark:text-red-400 font-bold" : row.buybackImpactDays <= 60 ? "text-orange-600 dark:text-orange-400 font-semibold" : ""}>{row.buybackImpactDays}日</span>;
      case "buybackMaxAmount":
        if (row.buybackMaxAmount == null) return "－";
        return `${(row.buybackMaxAmount / 1e8).toFixed(row.buybackMaxAmount / 1e8 >= 100 ? 0 : 1)}億`;
      case "buybackCumulativeAmount":
        if (row.buybackCumulativeAmount == null) return "－";
        return `${(row.buybackCumulativeAmount / 1e8).toFixed(row.buybackCumulativeAmount / 1e8 >= 100 ? 0 : 1)}億`;
      case "buybackRemainingShares":
        if (row.buybackRemainingShares == null) return "－";
        return `${(row.buybackRemainingShares / 10000).toFixed(row.buybackRemainingShares / 10000 >= 100 ? 0 : 1)}万`;
      case "buybackPeriodTo":
        if (!row.buybackPeriodTo) return "－";
        return <span className="text-xs">{row.buybackPeriodTo}</span>;
      case "buybackIsActive":
        if (row.buybackIsActive == null) return "－";
        return row.buybackIsActive
          ? <span className="rounded-full bg-green-100 px-2 py-0.5 text-green-700 dark:bg-green-900/30 dark:text-green-300 text-xs">実施中</span>
          : <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-500 dark:bg-slate-700 dark:text-slate-400 text-xs">完了</span>;
      case "yutaiContent":
        if (!row.yutaiContent) return "－";
        return <span className="text-xs max-w-48 truncate block" title={row.yutaiContent}>{row.yutaiContent}</span>;
      case "recordDate":
        return row.recordDate ? <span className="text-xs">{row.recordDate}</span> : "－";
      case "sellRecommendDate": {
        if (!row.sellRecommendDate) return "－";
        const isUrgent = row.daysUntilSell != null && row.daysUntilSell >= 0 && row.daysUntilSell <= 30;
        const isPast = row.daysUntilSell != null && row.daysUntilSell < 0;
        return (
          <span className={
            isPast ? "text-gray-400 dark:text-slate-500 line-through text-xs"
              : isUrgent ? "text-orange-600 dark:text-orange-400 font-bold text-xs"
              : "text-xs"
          }>
            {row.sellRecommendDate}
            {isUrgent && row.daysUntilSell != null && ` (${row.daysUntilSell}日)`}
          </span>
        );
      }
      case "daysUntilSell": {
        if (row.daysUntilSell == null) return "－";
        const urgent7 = row.daysUntilSell >= 0 && row.daysUntilSell <= 7;
        const urgent30 = row.daysUntilSell > 7 && row.daysUntilSell <= 30;
        return (
          <span className={
            urgent7 ? "text-red-600 dark:text-red-400 font-bold"
              : urgent30 ? "text-orange-600 dark:text-orange-400 font-bold"
              : row.daysUntilSell < 0 ? "text-gray-400 dark:text-slate-500"
              : ""
          }>
            {row.daysUntilSell}日
          </span>
        );
      }
      case "roeHistory": {
        if (!row.roeHistory || row.roeHistory.length === 0) return "－";
        return (
          <span className="text-xs whitespace-nowrap">
            {row.roeHistory.slice(0, 4).map((r) =>
              `${r.year}: ${(r.roe * 100).toFixed(1)}%`
            ).join(", ")}
          </span>
        );
      }
      case "fcfHistory": {
        if (!row.fcfHistory || row.fcfHistory.length === 0) return "－";
        const allPositive = row.fcfHistory.every((f) => f.fcf > 0);
        return (
          <span className="text-xs whitespace-nowrap" title={row.fcfHistory.map((f) => `${f.year}: OCF ${(f.ocf / 1e8).toFixed(0)}億 CAPEX ${(f.capex / 1e8).toFixed(0)}億 → FCF ${(f.fcf / 1e8).toFixed(0)}億`).join("\n")}>
            {row.fcfHistory.slice(0, 5).map((f, i) => (
              <span key={f.year}>
                {i > 0 && " "}
                <span className={f.fcf > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
                  {f.fcf > 0 ? "+" : ""}{(f.fcf / 1e8).toFixed(0)}
                </span>
              </span>
            ))}
            <span className="text-gray-400 dark:text-slate-500 ml-0.5">億</span>
            {allPositive && <span className="ml-1 text-green-600 dark:text-green-400" title="全年度FCFプラス">◎</span>}
          </span>
        );
      }
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
          {mergedRows.length > 0 && mergedRows.length < stocks.length && (
            <button
              onClick={() => setShowBatchGroupPopup(true)}
              className="rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-600 hover:bg-emerald-50 dark:border-emerald-600 dark:bg-slate-800 dark:text-emerald-400 dark:hover:bg-slate-700"
            >
              グループに追加
            </button>
          )}
          <CsvExportButton
            stocks={mergedRows}
            allGroups={allGroups}
            watchlistGroupMap={stockGroupMap}
            filenamePrefix="stock-table"
          />
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
        <div className="relative" ref={topixDropdownRef}>
          <button
            onClick={() => setShowTopixDropdown((v) => !v)}
            className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
              topixFilter.size > 0
                ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-900/30 dark:text-indigo-300"
                : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            }`}
          >
            TOPIX
            {topixFilter.size > 0 && (
              <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-indigo-600 px-1 text-[10px] font-bold text-white">
                {topixFilter.size}
              </span>
            )}
            <svg className="ml-1 inline h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
            </svg>
          </button>
          {showTopixDropdown && (
            <div className="absolute left-0 top-full z-50 mt-1 min-w-48 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-slate-600 dark:bg-slate-800">
              {(["TOPIX Core30", "TOPIX Large70", "TOPIX Mid400", "TOPIX Small 1", "TOPIX Small 2"] as const).map((cat) => (
                <label
                  key={cat}
                  className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-slate-700"
                >
                  <input
                    type="checkbox"
                    checked={topixFilter.has(cat)}
                    onChange={() => setTopixFilter((prev) => {
                      const next = new Set(prev);
                      if (next.has(cat)) next.delete(cat);
                      else next.add(cat);
                      return next;
                    })}
                    className="h-3.5 w-3.5 rounded"
                  />
                  <span className="text-gray-700 dark:text-slate-300">{cat.replace("TOPIX ", "")}</span>
                </label>
              ))}
              {topixFilter.size > 0 && (
                <>
                  <div className="my-1 border-t border-gray-100 dark:border-slate-700" />
                  <button
                    onClick={() => setTopixFilter(new Set())}
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
            checked={nikkei225Only}
            onChange={(e) => setNikkei225Only(e.target.checked)}
            className="rounded border-gray-300 text-orange-600 focus:ring-orange-500 dark:border-slate-600 dark:bg-slate-800"
          />
          <span className="text-xs font-medium text-gray-500 dark:text-slate-400">N225</span>
        </label>
        <div className="flex items-center gap-1">
          <span className="text-xs font-medium text-gray-500 dark:text-slate-400">時価総額</span>
          <input
            type="number"
            step="100"
            value={marketCapMin}
            onChange={(e) => setMarketCapMin(e.target.value)}
            placeholder=""
            className="w-20 rounded border border-gray-300 bg-white px-2 py-1 text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
          <span className="text-xs text-gray-400">億〜</span>
          <input
            type="number"
            step="100"
            value={marketCapMax}
            onChange={(e) => setMarketCapMax(e.target.value)}
            placeholder=""
            className="w-20 rounded border border-gray-300 bg-white px-2 py-1 text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
          <span className="text-xs text-gray-400">億</span>
        </div>
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={yutaiOnly}
            onChange={(e) => setYutaiOnly(e.target.checked)}
            className="rounded border-gray-300 text-pink-600 focus:ring-pink-500 dark:border-slate-600 dark:bg-slate-800"
          />
          <span className="text-xs font-medium text-gray-500 dark:text-slate-400">優待あり</span>
        </label>
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={buybackOnly}
            onChange={(e) => setBuybackOnly(e.target.checked)}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800"
          />
          <span className="text-xs font-medium text-gray-500 dark:text-slate-400">自株買あり</span>
        </label>
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
          <span className="text-xs font-medium text-gray-500 dark:text-slate-400">NC率</span>
          <input
            type="number"
            step="10"
            value={ncRatioMin}
            onChange={(e) => setNcRatioMin(e.target.value)}
            placeholder=""
            className="w-16 rounded border border-gray-300 bg-white px-2 py-1 text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
          <span className="text-xs text-gray-400">%以上</span>
          <span className="text-xs text-gray-400">〜</span>
          <input
            type="number"
            step="10"
            value={ncRatioMax}
            onChange={(e) => setNcRatioMax(e.target.value)}
            placeholder="100"
            className="w-16 rounded border border-gray-300 bg-white px-2 py-1 text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
          <span className="text-xs text-gray-400">%未満</span>
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

      {/* 数値範囲フィルタ */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-1">
          <span className="text-xs font-medium text-gray-500 dark:text-slate-400">Sharpe</span>
          <input
            type="number"
            step="0.1"
            value={sharpeMin}
            onChange={(e) => setSharpeMin(e.target.value)}
            placeholder="0.5"
            className="w-16 rounded border border-gray-300 bg-white px-2 py-1 text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
          <span className="text-xs text-gray-400">以上</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs font-medium text-gray-500 dark:text-slate-400">増配額</span>
          <input
            type="number"
            step="1"
            value={increaseMin}
            onChange={(e) => setIncreaseMin(e.target.value)}
            placeholder="0"
            className="w-16 rounded border border-gray-300 bg-white px-2 py-1 text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
          <span className="text-xs text-gray-400">以上</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs font-medium text-gray-500 dark:text-slate-400">ROE</span>
          <input
            type="number"
            step="1"
            value={roeMin}
            onChange={(e) => setRoeMin(e.target.value)}
            placeholder="10"
            className="w-16 rounded border border-gray-300 bg-white px-2 py-1 text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
          <span className="text-xs text-gray-400">%以上</span>
          <span className="text-xs text-gray-400">〜</span>
          <input
            type="number"
            step="1"
            value={roeMax}
            onChange={(e) => setRoeMax(e.target.value)}
            placeholder=""
            className="w-16 rounded border border-gray-300 bg-white px-2 py-1 text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
          <span className="text-xs text-gray-400">%未満</span>
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
        <div className="flex items-center gap-1">
          <span className="text-xs font-medium text-gray-500 dark:text-slate-400">PSR</span>
          <input
            type="number"
            step="0.5"
            value={psrMin}
            onChange={(e) => setPsrMin(e.target.value)}
            placeholder=""
            className="w-16 rounded border border-gray-300 bg-white px-2 py-1 text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
          <span className="text-xs text-gray-400">〜</span>
          <input
            type="number"
            step="0.5"
            value={psrMax}
            onChange={(e) => setPsrMax(e.target.value)}
            placeholder=""
            className="w-16 rounded border border-gray-300 bg-white px-2 py-1 text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs font-medium text-gray-500 dark:text-slate-400">PEG</span>
          <input
            type="number"
            step="0.1"
            value={pegMin}
            onChange={(e) => setPegMin(e.target.value)}
            placeholder=""
            className="w-16 rounded border border-gray-300 bg-white px-2 py-1 text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
          <span className="text-xs text-gray-400">〜</span>
          <input
            type="number"
            step="0.1"
            value={pegMax}
            onChange={(e) => setPegMax(e.target.value)}
            placeholder=""
            className="w-16 rounded border border-gray-300 bg-white px-2 py-1 text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs font-medium text-gray-500 dark:text-slate-400">自己資本比率</span>
          <input
            type="number"
            step="5"
            value={equityRatioMin}
            onChange={(e) => setEquityRatioMin(e.target.value)}
            placeholder="40"
            className="w-16 rounded border border-gray-300 bg-white px-2 py-1 text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
          <span className="text-xs text-gray-400">%〜</span>
          <input
            type="number"
            step="5"
            value={equityRatioMax}
            onChange={(e) => setEquityRatioMax(e.target.value)}
            placeholder=""
            className="w-16 rounded border border-gray-300 bg-white px-2 py-1 text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
          <span className="text-xs text-gray-400">%</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs font-medium text-gray-500 dark:text-slate-400">増益率</span>
          <input
            type="number"
            step="5"
            value={profitGrowthMin}
            onChange={(e) => setProfitGrowthMin(e.target.value)}
            placeholder="0"
            className="w-16 rounded border border-gray-300 bg-white px-2 py-1 text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
          <span className="text-xs text-gray-400">%以上</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs font-medium text-gray-500 dark:text-slate-400">売上成長率</span>
          <input
            type="number"
            step="5"
            value={revenueGrowthMin}
            onChange={(e) => setRevenueGrowthMin(e.target.value)}
            placeholder="10"
            className="w-16 rounded border border-gray-300 bg-white px-2 py-1 text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
          <span className="text-xs text-gray-400">%以上</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs font-medium text-gray-500 dark:text-slate-400">営業利益率</span>
          <input
            type="number"
            step="1"
            value={operatingMarginsMin}
            onChange={(e) => setOperatingMarginsMin(e.target.value)}
            placeholder="5"
            className="w-16 rounded border border-gray-300 bg-white px-2 py-1 text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
          <span className="text-xs text-gray-400">%以上</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs font-medium text-gray-500 dark:text-slate-400">上場</span>
          <input
            type="number"
            step="1"
            value={listingYearsMax}
            onChange={(e) => setListingYearsMax(e.target.value)}
            placeholder="5"
            className="w-16 rounded border border-gray-300 bg-white px-2 py-1 text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
          <span className="text-xs text-gray-400">年未満</span>
        </div>
        {(priceMin || priceMax || ncRatioMin || ncRatioMax || sharpeMin || increaseMin || roeMin || roeMax || currentRatioMin || currentRatioMax || psrMin || psrMax || pegMin || pegMax || equityRatioMin || equityRatioMax || profitGrowthMin || revenueGrowthMin || operatingMarginsMin || listingYearsMax || yutaiOnly || buybackOnly || topixFilter.size > 0 || nikkei225Only || marketCapMin || marketCapMax) && (
          <button
            onClick={() => { setPriceMin(""); setPriceMax(""); setNcRatioMin(""); setNcRatioMax(""); setSharpeMin(""); setIncreaseMin(""); setRoeMin(""); setRoeMax(""); setCurrentRatioMin(""); setCurrentRatioMax(""); setPsrMin(""); setPsrMax(""); setPegMin(""); setPegMax(""); setEquityRatioMin(""); setEquityRatioMax(""); setProfitGrowthMin(""); setRevenueGrowthMin(""); setOperatingMarginsMin(""); setListingYearsMax(""); setYutaiOnly(false); setBuybackOnly(false); setTopixFilter(new Set()); setNikkei225Only(false); setMarketCapMin(""); setMarketCapMax(""); }}
            className="rounded-full px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
          >
            クリア
          </button>
        )}
      </div>

      {/* 決算発表日フィルタ */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-gray-500 dark:text-slate-400">
          決算発表日:
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

      {showBatchGroupPopup && (
        <BatchGroupAssignPopup
          stockCount={mergedRows.length}
          allGroups={allGroups}
          onConfirm={async (groupId) => {
            const symbols = mergedRows.map((r) => r.symbol);
            return handleBatchAddToGroup(symbols, groupId);
          }}
          onCreateGroup={handleCreateGroup}
          onClose={() => setShowBatchGroupPopup(false)}
        />
      )}
    </div>
  );
}

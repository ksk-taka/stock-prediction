"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Bar,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Cell,
  ReferenceLine,
  ReferenceDot,
  ReferenceArea,
} from "recharts";
import type { PriceData } from "@/types";
import type { Period } from "@/lib/utils/date";
import { useTheme } from "@/components/ThemeProvider";
import {
  calcRSI,
  calcMACD,
  calcBollingerBands,
  type MACDPoint,
  type BollingerPoint,
} from "@/lib/utils/indicators";
import { detectBuySignals, detectCupWithHandle } from "@/lib/utils/signals";

interface PriceChartProps {
  data: PriceData[];
  period: Period;
  onPeriodChange: (period: Period) => void;
  /** コンパクトモード: 期間セレクタを非表示にし、ラベル＋閉じるボタンを表示 */
  compact?: boolean;
  /** コンパクトモード時の閉じるボタンコールバック */
  onRemove?: () => void;
  /** チャートの高さ (default: 350) */
  chartHeight?: number;
  /** EPS（PERバンド描画用） */
  eps?: number;
}

export const PERIODS: { value: Period; label: string }[] = [
  { value: "1min", label: "1分足" },
  { value: "5min", label: "5分足" },
  { value: "15min", label: "15分足" },
  { value: "daily", label: "日足" },
  { value: "weekly", label: "週足" },
  { value: "monthly", label: "月足" },
];

const PER_BAND_LEVELS = [5, 8, 10, 12, 15, 20, 25, 30, 40] as const;
const PER_BAND_COLOR = "#e879649f";

// 足ごとのデフォルト表示本数
function getWindowSize(period: Period): number {
  switch (period) {
    case "1min": return 60;
    case "5min": return 60;
    case "15min": return 40;
    case "daily": return 60;   // 約3ヶ月分
    case "weekly": return 52;  // 約1年分
    case "monthly": return 36; // 約3年分
  }
}

function calcMA(data: PriceData[], window: number): (number | null)[] {
  return data.map((_, i) => {
    if (i < window - 1) return null;
    const sum = data
      .slice(i - window + 1, i + 1)
      .reduce((acc, d) => acc + d.close, 0);
    return Math.round((sum / window) * 100) / 100;
  });
}

interface CandlestickShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  open?: number;
  close?: number;
  low?: number;
  high?: number;
  background?: { x: number; y: number; width: number; height: number };
  [key: string]: unknown;
}

function CandlestickShape(props: CandlestickShapeProps) {
  const {
    x = 0,
    y = 0,
    width = 0,
    height = 0,
    open = 0,
    close = 0,
    low = 0,
    high = 0,
  } = props;

  const fill = close >= open ? "#22c55e" : "#ef4444";
  const range = high - low;
  const cx = x + width / 2;

  if (range === 0) {
    return <line x1={x} x2={x + width} y1={y} y2={y} stroke={fill} strokeWidth={1} />;
  }

  const bodyTop = y + ((high - Math.max(open, close)) / range) * height;
  const bodyBottom = y + ((high - Math.min(open, close)) / range) * height;
  const bodyHeight = Math.max(bodyBottom - bodyTop, 1);
  const bodyWidth = Math.max(width, 6);
  const bodyX = cx - bodyWidth / 2;

  return (
    <g>
      <line x1={cx} x2={cx} y1={y} y2={y + height} stroke={fill} strokeWidth={1} />
      <rect x={bodyX} y={bodyTop} width={bodyWidth} height={bodyHeight} fill={fill} stroke={fill} />
    </g>
  );
}

function isIntraday(period: Period): boolean {
  return ["1min", "5min", "15min"].includes(period);
}

function toJSTString(isoString: string): string {
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString;
    return date.toLocaleString("ja-JP", {
      timeZone: "Asia/Tokyo",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return isoString;
  }
}

function formatTickLabel(value: string, period: Period): string {
  if (isIntraday(period)) {
    if (value.includes("T") || value.includes("Z")) {
      return toJSTString(value);
    }
    return value;
  }
  const d = value.split("-");
  if (d.length >= 3) return `${d[1]}/${d[2]}`;
  return value;
}

const PERIOD_LABELS: Record<Period, string> = {
  "1min": "1分足",
  "5min": "5分足",
  "15min": "15分足",
  daily: "日足",
  weekly: "週足",
  monthly: "月足",
};

export default function PriceChart({
  data,
  period,
  onPeriodChange,
  compact = false,
  onRemove,
  chartHeight = 350,
  eps,
}: PriceChartProps) {
  const { theme } = useTheme();
  const bbMaskFill = theme === "dark" ? "#1e293b" : "#ffffff";

  const [showMA, setShowMA] = useState({ ma5: true, ma25: true, ma75: false });
  const [showVolume, setShowVolume] = useState(false);
  const [showIndicators, setShowIndicators] = useState({ rsi: false, macd: false });
  const [showBB, setShowBB] = useState({ s1: false, s2: true, s3: false });
  const [showPERBand, setShowPERBand] = useState(false);
  const [showBuySignals, setShowBuySignals] = useState(true);
  const [showCWHSignals, setShowCWHSignals] = useState(false);
  // 描画ツール
  const [drawingMode, setDrawingMode] = useState<"none" | "hline" | "trendline">("none");
  const [hLines, setHLines] = useState<{ id: string; price: number }[]>([]);
  const [trendLines, setTrendLines] = useState<{
    id: string;
    startGlobalIdx: number;
    startPrice: number;
    endGlobalIdx: number;
    endPrice: number;
  }[]>([]);
  const [pendingTrendStart, setPendingTrendStart] = useState<{
    globalIdx: number;
    price: number;
  } | null>(null);
  const mainChartWrapRef = useRef<HTMLDivElement>(null);
  const [chartType, setChartType] = useState<"candle" | "line">("candle");
  const [viewEnd, setViewEnd] = useState(data.length);

  const windowSize = getWindowSize(period);

  useEffect(() => {
    setViewEnd(data.length);
  }, [data, period]);

  // 全データの指標を一括計算
  const allIndicators = useMemo(() => ({
    ma5: calcMA(data, 5),
    ma25: calcMA(data, 25),
    ma75: calcMA(data, 75),
    rsi: calcRSI(data),
    macd: calcMACD(data),
    bb: calcBollingerBands(data),  // 1σ,2σ,3σ一括計算
  }), [data]);

  // 買いシグナル検出（ちょる子式）
  const buySignals = useMemo(() => detectBuySignals(data), [data]);
  // カップウィズハンドル検出（田端式）
  const cwhSignals = useMemo(() => detectCupWithHandle(data), [data]);

  // 表示範囲内のシグナル（マーカー表示用）
  const visibleSignals = useMemo(() => {
    const start = Math.max(0, viewEnd - windowSize);
    return buySignals.filter((s) => s.index >= start && s.index < viewEnd);
  }, [buySignals, viewEnd, windowSize]);
  const visibleCWHSignals = useMemo(() => {
    const start = Math.max(0, viewEnd - windowSize);
    return cwhSignals.filter((s) => s.index >= start && s.index < viewEnd);
  }, [cwhSignals, viewEnd, windowSize]);

  // 直近シグナル（全データから直近5件）
  const recentSignals = useMemo(() => buySignals.slice(-5).reverse(), [buySignals]);
  const recentCWHSignals = useMemo(() => cwhSignals.slice(-5).reverse(), [cwhSignals]);

  // 表示範囲
  const viewStart = Math.max(0, viewEnd - windowSize);

  // CWHカップ可視化オーバーレイ
  const cwhOverlays = useMemo(() => {
    if (!showCWHSignals) return [];
    return cwhSignals
      .filter((s) => s.cupMeta != null)
      .filter((s) => {
        const meta = s.cupMeta!;
        return meta.leftRimIdx < viewEnd && s.index >= viewStart;
      })
      .map((s) => {
        const meta = s.cupMeta!;
        const rimLevel = Math.max(meta.leftRimHigh, meta.rightRimHigh);
        const getDate = (gi: number): string | null => {
          if (gi >= viewStart && gi < viewEnd) return data[gi]?.date ?? null;
          return null;
        };
        const cupStartDate = getDate(Math.max(meta.leftRimIdx, viewStart));
        const cupEndDate = getDate(Math.min(meta.rightRimIdx, viewEnd - 1));
        const handleEndDate = getDate(Math.min(s.index, viewEnd - 1));
        return {
          leftRimDate: getDate(meta.leftRimIdx),
          bottomDate: getDate(meta.bottomIdx),
          rightRimDate: getDate(meta.rightRimIdx),
          rimLevel,
          leftRimHigh: meta.leftRimHigh,
          bottomLow: meta.bottomLow,
          rightRimHigh: meta.rightRimHigh,
          cupStartDate,
          cupEndDate,
          handleEndDate,
        };
      });
  }, [showCWHSignals, cwhSignals, data, viewStart, viewEnd]);
  const visibleData = data.slice(viewStart, viewEnd);
  const canScrollLeft = viewStart > 0;
  const canScrollRight = viewEnd < data.length;

  const chartData = useMemo(() => {
    // トレンドラインの表示セグメントを事前計算
    const tlSegments: Record<string, { startVi: number; startPrice: number; endVi: number; endPrice: number }> = {};
    for (const line of trendLines) {
      const dx = line.endGlobalIdx - line.startGlobalIdx;
      if (dx === 0) {
        const vi = line.startGlobalIdx - viewStart;
        if (vi >= 0 && vi < visibleData.length) {
          tlSegments[line.id] = { startVi: vi, startPrice: line.startPrice, endVi: vi, endPrice: line.endPrice };
        }
      } else {
        const slope = (line.endPrice - line.startPrice) / dx;
        const intercept = line.startPrice - slope * line.startGlobalIdx;
        const segStart = Math.max(viewStart, Math.min(line.startGlobalIdx, line.endGlobalIdx));
        const segEnd = Math.min(viewEnd - 1, Math.max(line.startGlobalIdx, line.endGlobalIdx));
        if (segStart <= viewEnd - 1 && segEnd >= viewStart) {
          tlSegments[line.id] = {
            startVi: segStart - viewStart,
            startPrice: slope * segStart + intercept,
            endVi: segEnd - viewStart,
            endPrice: slope * segEnd + intercept,
          };
        }
      }
    }

    return visibleData.map((d, vi) => {
      const gi = viewStart + vi;
      const macdPt: MACDPoint = allIndicators.macd[gi] ?? { macd: null, signal: null, histogram: null };
      const bbPt: BollingerPoint = allIndicators.bb[gi] ?? {
        middle: null, upper1: null, lower1: null, upper2: null, lower2: null, upper3: null, lower3: null,
      };
      const entry: Record<string, any> = {
        date: d.date,
        close: d.close,
        open: d.open,
        high: d.high,
        low: d.low,
        volume: d.volume,
        candleWick: [d.low, d.high] as [number, number],
        ma5: allIndicators.ma5[gi],
        ma25: allIndicators.ma25[gi],
        ma75: allIndicators.ma75[gi],
        rsi: allIndicators.rsi[gi],
        macd: macdPt.macd,
        macdSignal: macdPt.signal,
        macdHist: macdPt.histogram,
        bbMiddle: bbPt.middle,
        bbUpper1: bbPt.upper1,
        bbLower1: bbPt.lower1,
        bbUpper2: bbPt.upper2,
        bbLower2: bbPt.lower2,
        bbUpper3: bbPt.upper3,
        bbLower3: bbPt.lower3,
      };
      // トレンドラインデータを付加
      for (const [id, seg] of Object.entries(tlSegments)) {
        if (vi === seg.startVi) entry[`tl_${id}`] = seg.startPrice;
        else if (vi === seg.endVi) entry[`tl_${id}`] = seg.endPrice;
        else entry[`tl_${id}`] = null;
      }
      // 買いシグナルマーカー（ちょる子式）
      const signal = buySignals.find((s) => s.index === gi);
      if (signal) {
        entry.buySignalPrice = d.low;
        entry.buySignalType = signal.type;
        entry.buySignalLabel = signal.label;
        entry.signalMarker = 0.5;
      }
      // CWHシグナルマーカー（田端式）
      const cwh = cwhSignals.find((s) => s.index === gi);
      if (cwh) {
        entry.cwhSignalPrice = d.close;
        entry.cwhSignalLabel = cwh.label;
        entry.cwhDescription = cwh.description;
        entry.cwhMarker = 0.5;
      }
      return entry;
    });
  }, [visibleData, viewStart, viewEnd, allIndicators, trendLines, buySignals, cwhSignals]);

  // 表示範囲の価格 min/max を計算して Y 軸ドメインを決定
  const priceDomain = useMemo((): [number, number] => {
    if (chartData.length === 0) return [0, 100];
    let min = Infinity;
    let max = -Infinity;
    for (const d of chartData) {
      if (d.low > 0 && d.low < min) min = d.low;
      if (d.high > max) max = d.high;
      if (d.open > 0 && d.open < min) min = d.open;
      if (d.close > 0 && d.close < min) min = d.close;
      if (d.open > max) max = d.open;
      if (d.close > max) max = d.close;
      // ボリンジャーバンドが有効な場合はバンドも考慮（最も外側のσを使用）
      if (showBB.s3) {
        if (d.bbLower3 != null && d.bbLower3 > 0 && d.bbLower3 < min) min = d.bbLower3;
        if (d.bbUpper3 != null && d.bbUpper3 > max) max = d.bbUpper3;
      } else if (showBB.s2) {
        if (d.bbLower2 != null && d.bbLower2 > 0 && d.bbLower2 < min) min = d.bbLower2;
        if (d.bbUpper2 != null && d.bbUpper2 > max) max = d.bbUpper2;
      } else if (showBB.s1) {
        if (d.bbLower1 != null && d.bbLower1 > 0 && d.bbLower1 < min) min = d.bbLower1;
        if (d.bbUpper1 != null && d.bbUpper1 > max) max = d.bbUpper1;
      }
    }
    // PERバンドが有効な場合、表示範囲内のバンドラインも考慮
    if (showPERBand && eps && eps > 0) {
      for (const m of PER_BAND_LEVELS) {
        const price = eps * m;
        if (price >= min * 0.8 && price <= max * 1.2) {
          if (price < min) min = price;
          if (price > max) max = price;
        }
      }
    }
    const range = max - min;
    const padding = range * 0.05 || max * 0.02;
    return [
      Math.floor((min - padding) * 100) / 100,
      Math.ceil((max + padding) * 100) / 100,
    ];
  }, [chartData, showBB, showPERBand, eps]);

  // チャートコンテナ ref（Shift+ホイールスクロール用）
  const chartContainerRef = useRef<HTMLDivElement>(null);

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      if (!e.shiftKey) return;
      e.preventDefault();
      // deltaY に比例した小さなステップで滑らかにスライド
      const delta = Math.abs(e.deltaY) || Math.abs(e.deltaX) || 1;
      const step = Math.max(1, Math.round(delta / 40));
      if (e.deltaY > 0 || e.deltaX > 0) {
        // 下/右スクロール → 最新方向（グラフが左にスライド）
        setViewEnd((prev) => Math.min(data.length, prev + step));
      } else {
        // 上/左スクロール → 過去方向（グラフが右にスライド）
        setViewEnd((prev) => Math.max(windowSize, prev - step));
      }
    },
    [data.length, windowSize]
  );

  useEffect(() => {
    const el = chartContainerRef.current;
    if (!el) return;
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  // チャートクリックハンドラ（描画ツール用）
  // priceDomain + チャート寸法から直接価格を逆算する
  const handleDrawingClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseY = e.clientY - rect.top;
    const mouseX = e.clientX - rect.left;

    // Recharts のプロットエリア推定値
    const plotTop = 15;
    const plotBottom = rect.height - (hasSubChart ? 8 : 25);
    const plotLeft = 10;
    const plotRight = rect.width - 50;
    if (mouseY < plotTop || mouseY > plotBottom ||
        mouseX < plotLeft || mouseX > plotRight) return;

    // Y → 価格（上=最大値、下=最小値）
    const plotH = plotBottom - plotTop;
    const priceFrac = (mouseY - plotTop) / plotH;
    const price = priceDomain[1] - priceFrac * (priceDomain[1] - priceDomain[0]);
    const roundedPrice = Math.round(price * 100) / 100;

    if (drawingMode === "hline") {
      setHLines((prev) => [...prev, { id: `h-${Date.now()}`, price: roundedPrice }]);
      setDrawingMode("none");
      return;
    }

    if (drawingMode === "trendline") {
      const plotW = plotRight - plotLeft;
      const relX = mouseX - plotLeft;
      const approxIdx = Math.round((relX / plotW) * (chartData.length - 1));
      const clampedIdx = Math.max(0, Math.min(chartData.length - 1, approxIdx));
      const globalIdx = viewStart + clampedIdx;

      if (!pendingTrendStart) {
        setPendingTrendStart({ globalIdx, price: roundedPrice });
      } else {
        setTrendLines((prev) => [
          ...prev,
          {
            id: `t-${Date.now()}`,
            startGlobalIdx: pendingTrendStart.globalIdx,
            startPrice: pendingTrendStart.price,
            endGlobalIdx: globalIdx,
            endPrice: roundedPrice,
          },
        ]);
        setPendingTrendStart(null);
        setDrawingMode("none");
      }
    }
  };

  // ESCキーで描画モードキャンセル
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && drawingMode !== "none") {
        setDrawingMode("none");
        setPendingTrendStart(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [drawingMode]);

  // サブチャートが表示されるかどうか
  const hasSubChart = showIndicators.rsi || showIndicators.macd;

  // 共通XAxis props（サブチャート用）
  const subXAxisProps = {
    dataKey: "date" as const,
    tick: { fontSize: 10 },
    tickFormatter: (v: string) => formatTickLabel(v, period),
    interval: "preserveStartEnd" as const,
  };

  if (data.length === 0) {
    return (
      <div className="flex h-80 items-center justify-center text-gray-400 dark:text-slate-500">
        データがありません
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-white dark:bg-slate-800 p-4 shadow dark:shadow-slate-900/50">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <h3 className={`font-semibold text-gray-900 dark:text-white ${compact ? "text-base" : "text-lg"}`}>
            {compact ? PERIOD_LABELS[period] : "株価チャート"}
          </h3>
          <div className="flex rounded border border-gray-200 dark:border-slate-600">
            <button
              onClick={() => setChartType("candle")}
              className={`px-2 py-1 text-xs ${
                chartType === "candle"
                  ? "bg-blue-500 text-white"
                  : "text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-700"
              }`}
            >
              ローソク
            </button>
            <button
              onClick={() => setChartType("line")}
              className={`px-2 py-1 text-xs ${
                chartType === "line"
                  ? "bg-blue-500 text-white"
                  : "text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-700"
              }`}
            >
              折れ線
            </button>
          </div>
          {compact && onRemove && (
            <button
              onClick={onRemove}
              className="rounded p-1 text-gray-300 dark:text-slate-600 hover:bg-red-50 hover:text-red-500"
              title="閉じる"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        {!compact && (
          <div className="flex flex-wrap gap-1">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                onClick={() => onPeriodChange(p.value)}
                className={`rounded px-3 py-1 text-sm ${
                  period === p.value
                    ? "bg-blue-500 text-white"
                    : "bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300 hover:bg-gray-200"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* インジケーター トグル */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-y-1">
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {/* 出来高 */}
          <label className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={showVolume}
              onChange={(e) => setShowVolume(e.target.checked)}
              className="h-3 w-3"
            />
            <span className="text-gray-500 dark:text-slate-400">出来高</span>
          </label>
          <span className="text-gray-300 dark:text-slate-600">|</span>
          {/* MA */}
          {[
            { key: "ma5" as const, label: "MA5", color: "#f59e0b" },
            { key: "ma25" as const, label: "MA25", color: "#8b5cf6" },
            { key: "ma75" as const, label: "MA75", color: "#ec4899" },
          ].map((ma) => (
            <label key={ma.key} className="flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                checked={showMA[ma.key]}
                onChange={(e) =>
                  setShowMA((prev) => ({ ...prev, [ma.key]: e.target.checked }))
                }
                className="h-3 w-3"
              />
              <span style={{ color: ma.color }}>{ma.label}</span>
            </label>
          ))}
          <span className="text-gray-300 dark:text-slate-600">|</span>
          {/* ボリンジャーバンド σ 選択 */}
          {[
            { key: "s1" as const, label: "BB 1σ", color: "#7dd3fc" },
            { key: "s2" as const, label: "BB 2σ", color: "#0ea5e9" },
            { key: "s3" as const, label: "BB 3σ", color: "#0369a1" },
          ].map((bb) => (
            <label key={bb.key} className="flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                checked={showBB[bb.key]}
                onChange={(e) =>
                  setShowBB((prev) => ({ ...prev, [bb.key]: e.target.checked }))
                }
                className="h-3 w-3"
              />
              <span style={{ color: bb.color }}>{bb.label}</span>
            </label>
          ))}
          {/* PERバンド（EPSがある場合のみ） */}
          {eps != null && eps > 0 && (
            <>
              <span className="text-gray-300 dark:text-slate-600">|</span>
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={showPERBand}
                  onChange={(e) => setShowPERBand(e.target.checked)}
                  className="h-3 w-3"
                />
                <span style={{ color: "#e87964" }}>PERバンド</span>
              </label>
            </>
          )}
          <span className="text-gray-300 dark:text-slate-600">|</span>
          {/* ちょる子式買いシグナル */}
          <label className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={showBuySignals}
              onChange={(e) => {
                setShowBuySignals(e.target.checked);
                if (e.target.checked) {
                  setShowMA((prev) => ({ ...prev, ma25: true }));
                  setShowBB((prev) => ({ ...prev, s2: true }));
                }
              }}
              className="h-3 w-3"
            />
            <span style={{ color: "#f59e0b" }}>ちょる子式</span>
            {buySignals.length > 0 && (
              <span className="rounded-full bg-amber-100 dark:bg-amber-900/30 px-1.5 text-[10px] font-bold text-amber-700 dark:text-amber-400">
                {buySignals.length}
              </span>
            )}
          </label>
          {/* 田端式CWH */}
          <label className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={showCWHSignals}
              onChange={(e) => setShowCWHSignals(e.target.checked)}
              className="h-3 w-3"
            />
            <span style={{ color: "#10b981" }}>田端式CWH</span>
            {cwhSignals.length > 0 && (
              <span className="rounded-full bg-emerald-100 dark:bg-emerald-900/30 px-1.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
                {cwhSignals.length}
              </span>
            )}
          </label>
          <span className="text-gray-300 dark:text-slate-600">|</span>
          {/* RSI / MACD */}
          {[
            { key: "rsi" as const, label: "RSI", color: "#8b5cf6" },
            { key: "macd" as const, label: "MACD", color: "#059669" },
          ].map((ind) => (
            <label key={ind.key} className="flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                checked={showIndicators[ind.key]}
                onChange={(e) =>
                  setShowIndicators((prev) => ({ ...prev, [ind.key]: e.target.checked }))
                }
                className="h-3 w-3"
              />
              <span style={{ color: ind.color }}>{ind.label}</span>
            </label>
          ))}
          {/* 描画ツール */}
          <span className="text-gray-300 dark:text-slate-600">|</span>
          <button
            onClick={() => { setDrawingMode(drawingMode === "hline" ? "none" : "hline"); setPendingTrendStart(null); }}
            className={`rounded px-1.5 py-0.5 text-xs ${drawingMode === "hline" ? "bg-red-100 dark:bg-red-900/30 text-red-600" : "text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-700"}`}
            title="水平線を描画"
          >
            ─ 水平線
          </button>
          <button
            onClick={() => { setDrawingMode(drawingMode === "trendline" ? "none" : "trendline"); setPendingTrendStart(null); }}
            className={`rounded px-1.5 py-0.5 text-xs ${drawingMode === "trendline" ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600" : "text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-700"}`}
            title="トレンドラインを描画"
          >
            ╱ ライン
          </button>
          {(hLines.length > 0 || trendLines.length > 0) && (
            <button
              onClick={() => { setHLines([]); setTrendLines([]); setPendingTrendStart(null); }}
              className="rounded px-1.5 py-0.5 text-xs text-gray-400 dark:text-slate-500 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500"
              title="全消去"
            >
              クリア
            </button>
          )}
        </div>
        <span className="text-xs text-gray-400 dark:text-slate-500">
          {viewStart + 1}-{viewEnd} / {data.length}
          {(canScrollLeft || canScrollRight) && " (Shift+ホイールでスクロール)"}
        </span>
      </div>

      {/* 描画モード時のヒント */}
      {drawingMode !== "none" && (
        <div className="mb-1 flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-500" />
          {drawingMode === "hline"
            ? "チャート上をクリックして水平線を配置"
            : pendingTrendStart
              ? "終点をクリック（ESCでキャンセル）"
              : "始点をクリック（ESCでキャンセル）"}
        </div>
      )}
      {/* チャートエリア */}
      <div ref={chartContainerRef}>
      <div ref={mainChartWrapRef} style={{ position: "relative" }}>
      <ResponsiveContainer width="100%" height={chartHeight}>
        <ComposedChart data={chartData}>
          <XAxis
            dataKey="date"
            tick={hasSubChart ? false : { fontSize: 10 }}
            tickFormatter={(v) => formatTickLabel(v, period)}
            interval="preserveStartEnd"
            height={hasSubChart ? 5 : undefined}
          />
          <YAxis
            yAxisId="price"
            orientation="right"
            domain={priceDomain}
            tick={{ fontSize: 11 }}
            allowDataOverflow
          />
          <YAxis yAxisId="volume" orientation="left" hide />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0]?.payload;
              if (!d) return null;
              return (
                <div className="rounded border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 p-2 text-xs shadow dark:shadow-slate-900/50">
                  <p className="font-medium text-gray-700">
                    {isIntraday(period) ? formatTickLabel(String(label ?? ""), period) : String(label ?? "")}
                  </p>
                  <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5">
                    <span className="text-gray-500 dark:text-slate-400">始値:</span>
                    <span className="text-right">{Number(d.open).toLocaleString()}</span>
                    <span className="text-gray-500 dark:text-slate-400">高値:</span>
                    <span className="text-right text-red-500">{Number(d.high).toLocaleString()}</span>
                    <span className="text-gray-500 dark:text-slate-400">安値:</span>
                    <span className="text-right text-blue-500">{Number(d.low).toLocaleString()}</span>
                    <span className="text-gray-500 dark:text-slate-400">終値:</span>
                    <span className={`text-right font-medium ${d.close >= d.open ? "text-green-600" : "text-red-600"}`}>
                      {Number(d.close).toLocaleString()}
                    </span>
                    <span className="text-gray-500 dark:text-slate-400">出来高:</span>
                    <span className="text-right">{Number(d.volume).toLocaleString()}</span>
                    {d.rsi != null && (
                      <>
                        <span className="text-gray-500 dark:text-slate-400">RSI:</span>
                        <span className="text-right">{d.rsi}</span>
                      </>
                    )}
                  </div>
                </div>
              );
            }}
          />
          <Legend />

          {/* 出来高 */}
          {showVolume && (
            <Bar yAxisId="volume" dataKey="volume" name="出来高" barSize={3}>
              {chartData.map((entry, index) => (
                <Cell key={index} fill={entry.close >= entry.open ? "#bbf7d0" : "#fecaca"} />
              ))}
            </Bar>
          )}

          {/* ボリンジャーバンド 3σ */}
          {showBB.s3 && (
            <>
              <Area yAxisId="price" type="monotone" dataKey="bbUpper3" stroke="none" fill="#0369a1" fillOpacity={0.05} connectNulls legendType="none" name="BB+3σ" />
              <Area yAxisId="price" type="monotone" dataKey="bbLower3" stroke="none" fill={bbMaskFill} fillOpacity={1} connectNulls legendType="none" name="BB-3σ" />
              <Line yAxisId="price" type="monotone" dataKey="bbUpper3" stroke="#0369a1" strokeWidth={1} strokeDasharray="2 2" dot={false} connectNulls name="+3σ" />
              <Line yAxisId="price" type="monotone" dataKey="bbLower3" stroke="#0369a1" strokeWidth={1} strokeDasharray="2 2" dot={false} connectNulls name="-3σ" />
            </>
          )}
          {/* ボリンジャーバンド 2σ */}
          {showBB.s2 && (
            <>
              <Area yAxisId="price" type="monotone" dataKey="bbUpper2" stroke="none" fill="#0ea5e9" fillOpacity={0.06} connectNulls legendType="none" name="BB+2σ" />
              <Area yAxisId="price" type="monotone" dataKey="bbLower2" stroke="none" fill={bbMaskFill} fillOpacity={1} connectNulls legendType="none" name="BB-2σ" />
              <Line yAxisId="price" type="monotone" dataKey="bbUpper2" stroke="#0ea5e9" strokeWidth={1} strokeDasharray="4 2" dot={false} connectNulls name="+2σ" />
              <Line yAxisId="price" type="monotone" dataKey="bbLower2" stroke="#0ea5e9" strokeWidth={1} strokeDasharray="4 2" dot={false} connectNulls name="-2σ" />
            </>
          )}
          {/* ボリンジャーバンド 1σ */}
          {showBB.s1 && (
            <>
              <Area yAxisId="price" type="monotone" dataKey="bbUpper1" stroke="none" fill="#7dd3fc" fillOpacity={0.08} connectNulls legendType="none" name="BB+1σ" />
              <Area yAxisId="price" type="monotone" dataKey="bbLower1" stroke="none" fill={bbMaskFill} fillOpacity={1} connectNulls legendType="none" name="BB-1σ" />
              <Line yAxisId="price" type="monotone" dataKey="bbUpper1" stroke="#7dd3fc" strokeWidth={1} strokeDasharray="6 2" dot={false} connectNulls name="+1σ" />
              <Line yAxisId="price" type="monotone" dataKey="bbLower1" stroke="#7dd3fc" strokeWidth={1} strokeDasharray="6 2" dot={false} connectNulls name="-1σ" />
            </>
          )}
          {/* BB 中央線（いずれかのσが有効なら表示） */}
          {(showBB.s1 || showBB.s2 || showBB.s3) && (
            <Line yAxisId="price" type="monotone" dataKey="bbMiddle" stroke="#0ea5e9" strokeWidth={1} dot={false} connectNulls name="BB中央" />
          )}

          {/* PERバンド */}
          {showPERBand && eps != null && eps > 0 &&
            PER_BAND_LEVELS.map((m) => {
              const price = eps * m;
              if (price < priceDomain[0] || price > priceDomain[1]) return null;
              return (
                <ReferenceLine
                  key={`per-${m}`}
                  yAxisId="price"
                  y={price}
                  stroke={PER_BAND_COLOR}
                  strokeDasharray="6 3"
                  strokeWidth={1}
                  label={{
                    value: `PER ${m}x`,
                    position: "right",
                    fontSize: 9,
                    fill: "#e87964",
                  }}
                />
              );
            })
          }

          {/* 水平線 */}
          {hLines.map((line) => (
            <ReferenceLine
              key={line.id}
              yAxisId="price"
              y={line.price}
              stroke="#ef4444"
              strokeWidth={1.5}
              strokeDasharray="8 4"
              label={{
                value: line.price.toLocaleString(),
                position: "left",
                fontSize: 9,
                fill: "#ef4444",
              }}
            />
          ))}

          {/* トレンドライン始点マーカー */}
          {pendingTrendStart && (() => {
            const vi = pendingTrendStart.globalIdx - viewStart;
            if (vi < 0 || vi >= chartData.length) return null;
            const date = chartData[vi]?.date;
            if (!date) return null;
            return (
              <ReferenceDot
                yAxisId="price"
                x={date}
                y={pendingTrendStart.price}
                r={5}
                fill="#3b82f6"
                stroke="#fff"
                strokeWidth={2}
                label={{
                  value: `始点 ${pendingTrendStart.price.toLocaleString()}`,
                  position: "top",
                  fontSize: 10,
                  fill: "#3b82f6",
                }}
              />
            );
          })()}

          {/* ローソク足 / 折れ線 */}
          {chartType === "candle" ? (
            <Bar
              yAxisId="price"
              dataKey="candleWick"
              barSize={8}
              name="ローソク"
              shape={<CandlestickShape />}
            >
              {chartData.map((entry, index) => (
                <Cell key={index} fill={entry.close >= entry.open ? "#22c55e" : "#ef4444"} />
              ))}
            </Bar>
          ) : (
            <Line
              yAxisId="price"
              type="monotone"
              dataKey="close"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={false}
              name="終値"
            />
          )}

          {/* 移動平均線 */}
          {showMA.ma5 && (
            <Line yAxisId="price" type="monotone" dataKey="ma5" stroke="#f59e0b" strokeWidth={1} dot={false} name="MA5" connectNulls />
          )}
          {showMA.ma25 && (
            <Line
              yAxisId="price"
              type="monotone"
              dataKey="ma25"
              stroke={showBuySignals ? "#f59e0b" : "#8b5cf6"}
              strokeWidth={showBuySignals ? 2.5 : 1}
              strokeDasharray={showBuySignals ? "none" : undefined}
              dot={false}
              name={showBuySignals ? "MA25 (ターゲット)" : "MA25"}
              connectNulls
            />
          )}
          {showMA.ma75 && (
            <Line yAxisId="price" type="monotone" dataKey="ma75" stroke="#ec4899" strokeWidth={1} dot={false} name="MA75" connectNulls />
          )}

          {/* トレンドライン */}
          {trendLines.map((line) => {
            const dataKey = `tl_${line.id}`;
            const hasData = chartData.some((d: any) => d[dataKey] != null);
            if (!hasData) return null;
            return (
              <Line
                key={line.id}
                yAxisId="price"
                type="linear"
                dataKey={dataKey}
                stroke="#3b82f6"
                strokeWidth={2}
                dot={false}
                connectNulls
                legendType="none"
                name=""
              />
            );
          })}

          {/* CWH カップ・ハンドル可視化 */}
          {showCWHSignals && cwhOverlays.map((o, i) => (
            <g key={`cwh-vis-${i}`}>
              {/* カップ領域 */}
              {o.cupStartDate && o.cupEndDate && (
                <ReferenceArea
                  yAxisId="price"
                  x1={o.cupStartDate}
                  x2={o.cupEndDate}
                  fill="#10b981"
                  fillOpacity={0.07}
                  strokeOpacity={0}
                />
              )}
              {/* ハンドル領域 */}
              {o.cupEndDate && o.handleEndDate && o.cupEndDate !== o.handleEndDate && (
                <ReferenceArea
                  yAxisId="price"
                  x1={o.cupEndDate}
                  x2={o.handleEndDate}
                  fill="#10b981"
                  fillOpacity={0.12}
                  strokeOpacity={0}
                />
              )}
              {/* 左リム */}
              {o.leftRimDate && (
                <ReferenceDot
                  yAxisId="price"
                  x={o.leftRimDate}
                  y={o.leftRimHigh}
                  r={4}
                  fill="#10b981"
                  stroke="#fff"
                  strokeWidth={1.5}
                  label={{ value: "L", position: "top", fontSize: 9, fill: "#10b981" }}
                />
              )}
              {/* カップ底 */}
              {o.bottomDate && (
                <ReferenceDot
                  yAxisId="price"
                  x={o.bottomDate}
                  y={o.bottomLow}
                  r={4}
                  fill="#10b981"
                  stroke="#fff"
                  strokeWidth={1.5}
                  label={{ value: "B", position: "bottom", fontSize: 9, fill: "#10b981" }}
                />
              )}
              {/* 右リム */}
              {o.rightRimDate && (
                <ReferenceDot
                  yAxisId="price"
                  x={o.rightRimDate}
                  y={o.rightRimHigh}
                  r={4}
                  fill="#10b981"
                  stroke="#fff"
                  strokeWidth={1.5}
                  label={{ value: "R", position: "top", fontSize: 9, fill: "#10b981" }}
                />
              )}
            </g>
          ))}

        </ComposedChart>
      </ResponsiveContainer>

      {/* 描画オーバーレイ（メインチャートのみカバー） */}
      {drawingMode !== "none" && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: chartHeight,
            cursor: "crosshair",
            zIndex: 10,
          }}
          onClick={handleDrawingClick}
        />
      )}
      </div>

      {/* シグナルストリップ（チャート外マーカー） */}
      {((showBuySignals && chartData.some((d: any) => d.signalMarker != null)) ||
        (showCWHSignals && chartData.some((d: any) => d.cwhMarker != null))) && (
        <div className="-mt-2">
          <ResponsiveContainer width="100%" height={24}>
            <ComposedChart data={chartData} margin={{ top: 0, right: 50, bottom: 0, left: 0 }}>
              <XAxis
                dataKey="date"
                tick={false}
                tickLine={false}
                axisLine={false}
                height={1}
              />
              <YAxis domain={[0, 1]} hide />
              {/* ちょる子式マーカー */}
              {showBuySignals && (
                <Line
                  type="monotone"
                  dataKey="signalMarker"
                  stroke="none"
                  isAnimationActive={false}
                  connectNulls={false}
                  legendType="none"
                  activeDot={false}
                  dot={(props: any) => {
                    const d = chartData[props.index];
                    if (!d?.signalMarker) return <circle key={props.key} r={0} />;
                    return (
                      <text
                        key={props.key}
                        x={props.cx}
                        y={12}
                        textAnchor="middle"
                        fill={d.buySignalType === "shitabanare" ? "#ef4444" : "#f59e0b"}
                        fontSize={16}
                        fontWeight="bold"
                      >
                        ▲
                      </text>
                    );
                  }}
                />
              )}
              {/* 田端式CWHマーカー */}
              {showCWHSignals && (
                <Line
                  type="monotone"
                  dataKey="cwhMarker"
                  stroke="none"
                  isAnimationActive={false}
                  connectNulls={false}
                  legendType="none"
                  activeDot={false}
                  dot={(props: any) => {
                    const d = chartData[props.index];
                    if (!d?.cwhMarker) return <circle key={props.key} r={0} />;
                    return (
                      <text
                        key={props.key}
                        x={props.cx}
                        y={d.signalMarker && showBuySignals ? 22 : 12}
                        textAnchor="middle"
                        fill="#10b981"
                        fontSize={16}
                        fontWeight="bold"
                      >
                        ◆
                      </text>
                    );
                  }}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* RSI サブチャート */}
      {showIndicators.rsi && (
        <div className="mt-1">
          <div className="text-xs font-medium text-gray-500 dark:text-slate-400 mb-0.5">RSI(14)</div>
          <ResponsiveContainer width="100%" height={120}>
            <ComposedChart data={chartData}>
                  <XAxis
                {...subXAxisProps}
                tick={showIndicators.macd ? false : { fontSize: 10 }}
                height={showIndicators.macd ? 5 : undefined}
              />
              <YAxis
                domain={[0, 100]}
                orientation="right"
                tick={{ fontSize: 10 }}
                ticks={[0, 30, 50, 70, 100]}
                width={35}
              />
              <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="3 3" strokeOpacity={0.6} />
              <ReferenceLine y={30} stroke="#22c55e" strokeDasharray="3 3" strokeOpacity={0.6} />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const val = payload[0]?.value;
                  return val != null ? (
                    <div className="rounded border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 text-xs shadow dark:shadow-slate-900/50">
                      RSI: {val}
                    </div>
                  ) : null;
                }}
              />
              <Line
                type="monotone"
                dataKey="rsi"
                stroke="#8b5cf6"
                strokeWidth={1.5}
                dot={false}
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* MACD サブチャート */}
      {showIndicators.macd && (
        <div className="mt-1">
          <div className="text-xs font-medium text-gray-500 mb-0.5">MACD(12,26,9)</div>
          <ResponsiveContainer width="100%" height={120}>
            <ComposedChart data={chartData}>
                  <XAxis {...subXAxisProps} tick={{ fontSize: 10 }} />
              <YAxis orientation="right" tick={{ fontSize: 10 }} width={35} />
              <ReferenceLine y={0} stroke="#9ca3af" strokeWidth={1} />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0]?.payload;
                  if (!d) return null;
                  return (
                    <div className="rounded border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 text-xs shadow dark:shadow-slate-900/50">
                      <div>MACD: {d.macd ?? "-"}</div>
                      <div>Signal: {d.macdSignal ?? "-"}</div>
                      <div>Hist: {d.macdHist ?? "-"}</div>
                    </div>
                  );
                }}
              />
              <Bar dataKey="macdHist" name="Histogram" barSize={3}>
                {chartData.map((entry, index) => (
                  <Cell
                    key={index}
                    fill={(entry.macdHist ?? 0) >= 0 ? "#22c55e" : "#ef4444"}
                  />
                ))}
              </Bar>
              <Line
                type="monotone"
                dataKey="macd"
                stroke="#059669"
                strokeWidth={1.5}
                dot={false}
                connectNulls
                name="MACD"
              />
              <Line
                type="monotone"
                dataKey="macdSignal"
                stroke="#f97316"
                strokeWidth={1.5}
                dot={false}
                connectNulls
                name="Signal"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* 直近ちょる子式シグナル一覧 */}
      {showBuySignals && recentSignals.length > 0 && (
        <div className="mt-3 rounded border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-900/10 p-3">
          <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-amber-800 dark:text-amber-400">
            <span>▲</span> ちょる子式・直近シグナル
          </h4>
          <div className="space-y-1.5">
            {recentSignals.map((s) => (
              <div key={`${s.date}-${s.type}`} className="flex items-start gap-2 text-xs">
                <span className={`mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full ${
                  s.type === "shitabanare" ? "bg-red-500" : "bg-amber-500"
                }`} />
                <div>
                  <span className="font-medium text-gray-800 dark:text-slate-200">{s.date}</span>
                  <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                    s.type === "shitabanare"
                      ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"
                      : "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400"
                  }`}>
                    {s.label}
                  </span>
                  <p className="mt-0.5 text-gray-500 dark:text-slate-400">{s.description}</p>
                </div>
              </div>
            ))}
          </div>
          {visibleSignals.length > 0 && (
            <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-400">
              表示範囲内に {visibleSignals.length}件
            </p>
          )}
        </div>
      )}

      {/* 直近CWHシグナル一覧 */}
      {showCWHSignals && recentCWHSignals.length > 0 && (
        <div className="mt-3 rounded border border-emerald-200 dark:border-emerald-800/50 bg-emerald-50 dark:bg-emerald-900/10 p-3">
          <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-emerald-800 dark:text-emerald-400">
            <span>◆</span> 田端式CWH・直近シグナル
          </h4>
          <div className="space-y-1.5">
            {recentCWHSignals.map((s) => (
              <div key={`cwh-${s.date}`} className="flex items-start gap-2 text-xs">
                <span className="mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                <div>
                  <span className="font-medium text-gray-800 dark:text-slate-200">{s.date}</span>
                  <span className="ml-2 rounded bg-emerald-100 dark:bg-emerald-900/30 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
                    {s.label}
                  </span>
                  <p className="mt-0.5 text-gray-500 dark:text-slate-400">{s.description}</p>
                </div>
              </div>
            ))}
          </div>
          {visibleCWHSignals.length > 0 && (
            <p className="mt-2 text-xs font-medium text-emerald-700 dark:text-emerald-400">
              表示範囲内に {visibleCWHSignals.length}件
            </p>
          )}
        </div>
      )}
      </div>
    </div>
  );
}

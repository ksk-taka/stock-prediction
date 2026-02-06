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
  CartesianGrid,
  Tooltip,
  Legend,
  Cell,
  ReferenceLine,
} from "recharts";
import type { PriceData } from "@/types";
import type { Period } from "@/lib/utils/date";
import {
  calcRSI,
  calcMACD,
  calcBollingerBands,
  type MACDPoint,
  type BollingerPoint,
} from "@/lib/utils/indicators";

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
}

export const PERIODS: { value: Period; label: string }[] = [
  { value: "1min", label: "1分足" },
  { value: "5min", label: "5分足" },
  { value: "15min", label: "15分足" },
  { value: "daily", label: "日足" },
  { value: "weekly", label: "週足" },
  { value: "monthly", label: "月足" },
];

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
}: PriceChartProps) {
  const [showMA, setShowMA] = useState({ ma5: true, ma25: false, ma75: false });
  const [showIndicators, setShowIndicators] = useState({ rsi: false, macd: false });
  const [showBB, setShowBB] = useState({ s1: false, s2: false, s3: false });
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

  // 表示範囲
  const viewStart = Math.max(0, viewEnd - windowSize);
  const visibleData = data.slice(viewStart, viewEnd);
  const canScrollLeft = viewStart > 0;
  const canScrollRight = viewEnd < data.length;

  const chartData = useMemo(() => {
    return visibleData.map((d, vi) => {
      const gi = viewStart + vi;
      const macdPt: MACDPoint = allIndicators.macd[gi] ?? { macd: null, signal: null, histogram: null };
      const bbPt: BollingerPoint = allIndicators.bb[gi] ?? {
        middle: null, upper1: null, lower1: null, upper2: null, lower2: null, upper3: null, lower3: null,
      };
      return {
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
    });
  }, [visibleData, viewStart, allIndicators]);

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
    const range = max - min;
    const padding = range * 0.05 || max * 0.02;
    return [
      Math.floor((min - padding) * 100) / 100,
      Math.ceil((max + padding) * 100) / 100,
    ];
  }, [chartData, showBB]);

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
      <div className="flex h-80 items-center justify-center text-gray-400">
        データがありません
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-white p-4 shadow">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <h3 className={`font-semibold text-gray-900 ${compact ? "text-base" : "text-lg"}`}>
            {compact ? PERIOD_LABELS[period] : "株価チャート"}
          </h3>
          <div className="flex rounded border border-gray-200">
            <button
              onClick={() => setChartType("candle")}
              className={`px-2 py-1 text-xs ${
                chartType === "candle"
                  ? "bg-blue-500 text-white"
                  : "text-gray-500 hover:bg-gray-100"
              }`}
            >
              ローソク
            </button>
            <button
              onClick={() => setChartType("line")}
              className={`px-2 py-1 text-xs ${
                chartType === "line"
                  ? "bg-blue-500 text-white"
                  : "text-gray-500 hover:bg-gray-100"
              }`}
            >
              折れ線
            </button>
          </div>
          {compact && onRemove && (
            <button
              onClick={onRemove}
              className="rounded p-1 text-gray-300 hover:bg-red-50 hover:text-red-500"
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
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
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
          <span className="text-gray-300">|</span>
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
          <span className="text-gray-300">|</span>
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
        </div>
        <span className="text-xs text-gray-400">
          {viewStart + 1}-{viewEnd} / {data.length}
          {(canScrollLeft || canScrollRight) && " (Shift+ホイールでスクロール)"}
        </span>
      </div>

      {/* チャートエリア (Shift+ホイールでスクロール) */}
      <div ref={chartContainerRef}>
      <ResponsiveContainer width="100%" height={chartHeight}>
        <ComposedChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
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
                <div className="rounded border border-gray-200 bg-white p-2 text-xs shadow">
                  <p className="font-medium text-gray-700">
                    {isIntraday(period) ? formatTickLabel(String(label ?? ""), period) : String(label ?? "")}
                  </p>
                  <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5">
                    <span className="text-gray-500">始値:</span>
                    <span className="text-right">{Number(d.open).toLocaleString()}</span>
                    <span className="text-gray-500">高値:</span>
                    <span className="text-right text-red-500">{Number(d.high).toLocaleString()}</span>
                    <span className="text-gray-500">安値:</span>
                    <span className="text-right text-blue-500">{Number(d.low).toLocaleString()}</span>
                    <span className="text-gray-500">終値:</span>
                    <span className={`text-right font-medium ${d.close >= d.open ? "text-green-600" : "text-red-600"}`}>
                      {Number(d.close).toLocaleString()}
                    </span>
                    <span className="text-gray-500">出来高:</span>
                    <span className="text-right">{Number(d.volume).toLocaleString()}</span>
                    {d.rsi != null && (
                      <>
                        <span className="text-gray-500">RSI:</span>
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
          <Bar yAxisId="volume" dataKey="volume" name="出来高" barSize={3}>
            {chartData.map((entry, index) => (
              <Cell key={index} fill={entry.close >= entry.open ? "#bbf7d0" : "#fecaca"} />
            ))}
          </Bar>

          {/* ボリンジャーバンド 3σ */}
          {showBB.s3 && (
            <>
              <Area yAxisId="price" type="monotone" dataKey="bbUpper3" stroke="none" fill="#0369a1" fillOpacity={0.05} connectNulls legendType="none" name="BB+3σ" />
              <Area yAxisId="price" type="monotone" dataKey="bbLower3" stroke="none" fill="#ffffff" fillOpacity={1} connectNulls legendType="none" name="BB-3σ" />
              <Line yAxisId="price" type="monotone" dataKey="bbUpper3" stroke="#0369a1" strokeWidth={1} strokeDasharray="2 2" dot={false} connectNulls name="+3σ" />
              <Line yAxisId="price" type="monotone" dataKey="bbLower3" stroke="#0369a1" strokeWidth={1} strokeDasharray="2 2" dot={false} connectNulls name="-3σ" />
            </>
          )}
          {/* ボリンジャーバンド 2σ */}
          {showBB.s2 && (
            <>
              <Area yAxisId="price" type="monotone" dataKey="bbUpper2" stroke="none" fill="#0ea5e9" fillOpacity={0.06} connectNulls legendType="none" name="BB+2σ" />
              <Area yAxisId="price" type="monotone" dataKey="bbLower2" stroke="none" fill="#ffffff" fillOpacity={1} connectNulls legendType="none" name="BB-2σ" />
              <Line yAxisId="price" type="monotone" dataKey="bbUpper2" stroke="#0ea5e9" strokeWidth={1} strokeDasharray="4 2" dot={false} connectNulls name="+2σ" />
              <Line yAxisId="price" type="monotone" dataKey="bbLower2" stroke="#0ea5e9" strokeWidth={1} strokeDasharray="4 2" dot={false} connectNulls name="-2σ" />
            </>
          )}
          {/* ボリンジャーバンド 1σ */}
          {showBB.s1 && (
            <>
              <Area yAxisId="price" type="monotone" dataKey="bbUpper1" stroke="none" fill="#7dd3fc" fillOpacity={0.08} connectNulls legendType="none" name="BB+1σ" />
              <Area yAxisId="price" type="monotone" dataKey="bbLower1" stroke="none" fill="#ffffff" fillOpacity={1} connectNulls legendType="none" name="BB-1σ" />
              <Line yAxisId="price" type="monotone" dataKey="bbUpper1" stroke="#7dd3fc" strokeWidth={1} strokeDasharray="6 2" dot={false} connectNulls name="+1σ" />
              <Line yAxisId="price" type="monotone" dataKey="bbLower1" stroke="#7dd3fc" strokeWidth={1} strokeDasharray="6 2" dot={false} connectNulls name="-1σ" />
            </>
          )}
          {/* BB 中央線（いずれかのσが有効なら表示） */}
          {(showBB.s1 || showBB.s2 || showBB.s3) && (
            <Line yAxisId="price" type="monotone" dataKey="bbMiddle" stroke="#0ea5e9" strokeWidth={1} dot={false} connectNulls name="BB中央" />
          )}

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
            <Line yAxisId="price" type="monotone" dataKey="ma25" stroke="#8b5cf6" strokeWidth={1} dot={false} name="MA25" connectNulls />
          )}
          {showMA.ma75 && (
            <Line yAxisId="price" type="monotone" dataKey="ma75" stroke="#ec4899" strokeWidth={1} dot={false} name="MA75" connectNulls />
          )}
        </ComposedChart>
      </ResponsiveContainer>

      {/* RSI サブチャート */}
      {showIndicators.rsi && (
        <div className="mt-1">
          <div className="text-xs font-medium text-gray-500 mb-0.5">RSI(14)</div>
          <ResponsiveContainer width="100%" height={120}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
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
                    <div className="rounded border border-gray-200 bg-white px-2 py-1 text-xs shadow">
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
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis {...subXAxisProps} tick={{ fontSize: 10 }} />
              <YAxis orientation="right" tick={{ fontSize: 10 }} width={35} />
              <ReferenceLine y={0} stroke="#9ca3af" strokeWidth={1} />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0]?.payload;
                  if (!d) return null;
                  return (
                    <div className="rounded border border-gray-200 bg-white px-2 py-1 text-xs shadow">
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
      </div>
    </div>
  );
}

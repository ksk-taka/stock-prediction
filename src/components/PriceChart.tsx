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
import {
  computeStrategySignals,
  type StrategySignalType,
  type StrategySignalPoint,
} from "@/lib/utils/strategySignals";

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
  /** 過去10年来の最高値 */
  tenYearHigh?: number | null;
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

  const fill = close >= open ? "#ef4444" : "#22c55e";
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
  tenYearHigh,
}: PriceChartProps) {
  const { theme } = useTheme();
  const bbMaskFill = theme === "dark" ? "#1e293b" : "#ffffff";

  const [showMA, setShowMA] = useState({ ma5: true, ma10: false, ma20: false, ma25: true, ma50: false, ma75: false });
  const [showVolume, setShowVolume] = useState(false);
  const [showIndicators, setShowIndicators] = useState({ rsi: false, macd: true });
  const [showBB, setShowBB] = useState({ s1: false, s2: true, s3: false });
  const [showPERBand, setShowPERBand] = useState(false);
  const [showYtdHigh, setShowYtdHigh] = useState(false);
  const [showPrevYearHigh, setShowPrevYearHigh] = useState(false);
  const [showTenYearHigh, setShowTenYearHigh] = useState(false);
  const [showBuySignals, setShowBuySignals] = useState(false);
  const [showCWHSignals, setShowCWHSignals] = useState(false);
  // 戦略シグナル表示トグル
  const [showStratSignals, setShowStratSignals] = useState<Record<StrategySignalType, boolean>>({
    rsi_reversal: false,
    ma_cross: false,
    macd_signal: false,
    macd_trail: true,
  });
  // シグナル別の利確/損切ライン表示
  const [exitLineKeys, setExitLineKeys] = useState<Set<string>>(new Set());
  const toggleExitLine = (key: string) =>
    setExitLineKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
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
    ma10: calcMA(data, 10),
    ma20: calcMA(data, 20),
    ma25: calcMA(data, 25),
    ma50: calcMA(data, 50),
    ma75: calcMA(data, 75),
    rsi: calcRSI(data),
    macd: calcMACD(data),
    bb: calcBollingerBands(data),  // 1σ,2σ,3σ一括計算
  }), [data]);

  // 買いシグナル検出（ちょる子式）
  const buySignals = useMemo(() => detectBuySignals(data), [data]);
  // カップウィズハンドル検出（CWH）
  const cwhSignals = useMemo(() => detectCupWithHandle(data), [data]);

  // 戦略シグナル計算（RSI逆張り / MAクロス / MACD）
  const periodType = (period === "daily" || period === "weekly") ? period : null;
  const stratResult = useMemo(() => {
    if (!periodType) return null;
    const anyEnabled = Object.values(showStratSignals).some(Boolean);
    if (!anyEnabled) return null;
    return computeStrategySignals(data, periodType);
  }, [data, periodType, showStratSignals]);
  const stratSignals = stratResult?.signals ?? null;
  const trailStopLevels = stratResult?.trailStopLevels ?? null;

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

  // 利確/損切ライン（チェックされたシグナル）
  // BB逆張りは水平ラインを引かず、MA25タッチポイントをドットで表示する
  const exitLines = useMemo(() => {
    const lines: { key: string; price: number; color: string; label: string }[] = [];
    for (const key of exitLineKeys) {
      // ちょる子式シグナル
      const bs = buySignals.find((s) => `${s.date}-${s.type}` === key);
      if (bs) {
        if (bs.type === "bb_reversal") {
          // BB逆張り: 損切ラインのみ水平線で描画（MA25利確はタッチポイントで表示）
          lines.push({ key: `${key}-sl`, price: bs.price, color: "#ef4444", label: `損切(安値) ${bs.price.toLocaleString()}` });
        } else if (bs.type === "shitabanare") {
          const gapUpper = bs.index >= 2 ? data[bs.index - 2]?.low : null;
          if (gapUpper != null) lines.push({ key: `${key}-tp`, price: gapUpper, color: "#22c55e", label: `利確(窓上限) ${gapUpper.toLocaleString()}` });
          lines.push({ key: `${key}-sl`, price: bs.price, color: "#ef4444", label: `損切(安値) ${bs.price.toLocaleString()}` });
        }
        continue;
      }
      // CWHシグナル
      const cs = cwhSignals.find((s) => `cwh-${s.date}` === key);
      if (cs) {
        const tp = Math.round(cs.price * 1.20);
        const sl = Math.round(cs.price * 0.93);
        lines.push({ key: `${key}-tp`, price: tp, color: "#22c55e", label: `利確(+20%) ${tp.toLocaleString()}` });
        lines.push({ key: `${key}-sl`, price: sl, color: "#ef4444", label: `損切(-7%) ${sl.toLocaleString()}` });
      }
    }
    return lines;
  }, [exitLineKeys, buySignals, cwhSignals, allIndicators, data]);

  // BB逆張りシグナル後のMA25タッチポイント検出
  const bbMa25TouchPoints = useMemo(() => {
    const points: { index: number; date: string; price: number; ma25: number; signalDate: string }[] = [];
    for (const key of exitLineKeys) {
      const bs = buySignals.find((s) => `${s.date}-${s.type}` === key);
      if (!bs || bs.type !== "bb_reversal") continue;
      // エントリー後〜次のシグナルまで、MA25に終値が到達した最初のポイントを探す
      for (let i = bs.index + 1; i < data.length; i++) {
        const ma25val = allIndicators.ma25[i];
        if (ma25val == null) continue;
        if (data[i].close >= ma25val) {
          points.push({
            index: i,
            date: data[i].date,
            price: data[i].close,
            ma25: ma25val,
            signalDate: bs.date,
          });
          break;
        }
        // 損切ラインに先に到達したら打ち切り
        if (data[i].close < bs.price) break;
      }
    }
    return points;
  }, [exitLineKeys, buySignals, data, allIndicators]);

  // 最新足がMA25にタッチ中かどうか（BB逆張りポジション保有中）
  const isLatestTouchingMA25 = useMemo(() => {
    if (data.length === 0) return false;
    const lastIdx = data.length - 1;
    const ma25val = allIndicators.ma25[lastIdx];
    if (ma25val == null) return false;
    // 現在アクティブなBB逆張りポジションがあるかチェック
    for (const key of exitLineKeys) {
      const bs = buySignals.find((s) => `${s.date}-${s.type}` === key);
      if (!bs || bs.type !== "bb_reversal") continue;
      if (bs.index >= lastIdx) continue;
      // まだ利確/損切されていない（MA25タッチポイントが見つかっていない）
      const touched = bbMa25TouchPoints.find((p) => p.signalDate === bs.date);
      if (!touched) {
        // 未決済ポジション中に最新足がMA25付近（±1.5%以内）
        const diff = Math.abs(data[lastIdx].close - ma25val) / ma25val;
        if (diff < 0.015) return true;
      }
    }
    return false;
  }, [data, allIndicators, exitLineKeys, buySignals, bbMa25TouchPoints]);

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
        ma10: allIndicators.ma10[gi],
        ma20: allIndicators.ma20[gi],
        ma25: allIndicators.ma25[gi],
        ma50: allIndicators.ma50[gi],
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
      // CWHシグナルマーカー（CWH）
      const cwh = cwhSignals.find((s) => s.index === gi);
      if (cwh) {
        entry.cwhSignalPrice = d.close;
        entry.cwhSignalLabel = cwh.label;
        entry.cwhDescription = cwh.description;
        entry.cwhMarker = 0.5;
      }
      // BB逆張りMA25タッチポイント
      const touchPt = bbMa25TouchPoints.find((p) => p.index === gi);
      if (touchPt) {
        entry.ma25TouchPrice = touchPt.price;
      }
      // 戦略シグナルマーカー（RSI/MA/MACD）
      if (stratSignals) {
        for (const [sid, points] of Object.entries(stratSignals) as [StrategySignalType, StrategySignalPoint[]][]) {
          if (!showStratSignals[sid]) continue;
          const pt = points.find((p) => p.index === gi);
          if (pt) {
            if (pt.action === "buy") {
              entry[`strat_buy_${sid}`] = d.low;
              entry[`strat_buy_label_${sid}`] = pt.label;
            } else {
              entry[`strat_sell_${sid}`] = d.high;
              entry[`strat_sell_type_${sid}`] = pt.action;
              entry[`strat_sell_label_${sid}`] = pt.label;
            }
          }
        }
      }
      // トレーリングストップレベル（MACD Trail 12%）
      if (showStratSignals.macd_trail && trailStopLevels) {
        const trailVal = trailStopLevels[gi];
        if (trailVal != null) {
          entry.trailStopLevel = trailVal;
        }
      }
      // MACD Trail 12% マーカー（ストリップ表示用）
      if (showStratSignals.macd_trail && stratSignals) {
        const pt = stratSignals["macd_trail"]?.find((p: StrategySignalPoint) => p.index === gi);
        if (pt) {
          entry.trail12Marker = 0.5;
          entry.trail12Action = pt.action;
          entry.trail12Label = pt.label;
        }
      }
      return entry;
    });
  }, [visibleData, viewStart, viewEnd, allIndicators, trendLines, buySignals, cwhSignals, bbMa25TouchPoints, stratSignals, showStratSignals, trailStopLevels]);

  // 年初来高値・昨年来高値（全データから算出）
  const { ytdHigh, prevYearHigh } = useMemo(() => {
    const now = new Date();
    const ytdStart = `${now.getFullYear()}-01-01`;
    const prevStart = `${now.getFullYear() - 1}-01-01`;
    let ytd = -Infinity, prev = -Infinity;
    for (const d of data) {
      const dateStr = d.date.slice(0, 10);
      if (dateStr >= ytdStart && d.high > ytd) ytd = d.high;
      if (dateStr >= prevStart && d.high > prev) prev = d.high;
    }
    return {
      ytdHigh: ytd === -Infinity ? null : ytd,
      prevYearHigh: prev === -Infinity ? null : prev,
    };
  }, [data]);

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
    // 年初来高値・昨年来高値が有効な場合
    if (showYtdHigh && ytdHigh != null) {
      if (ytdHigh > max) max = ytdHigh;
      if (ytdHigh < min) min = ytdHigh;
    }
    if (showPrevYearHigh && prevYearHigh != null) {
      if (prevYearHigh > max) max = prevYearHigh;
      if (prevYearHigh < min) min = prevYearHigh;
    }
    if (showTenYearHigh && tenYearHigh != null) {
      if (tenYearHigh > max) max = tenYearHigh;
      if (tenYearHigh < min) min = tenYearHigh;
    }
    const range = max - min;
    const padding = range * 0.05 || max * 0.02;
    return [
      Math.floor((min - padding) * 100) / 100,
      Math.ceil((max + padding) * 100) / 100,
    ];
  }, [chartData, showBB, showPERBand, eps, showYtdHigh, ytdHigh, showPrevYearHigh, prevYearHigh, showTenYearHigh, tenYearHigh]);

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
            { key: "ma10" as const, label: "MA10", color: "#84cc16" },
            { key: "ma20" as const, label: "MA20", color: "#06b6d4" },
            { key: "ma25" as const, label: "MA25", color: "#8b5cf6" },
            { key: "ma50" as const, label: "MA50", color: "#14b8a6" },
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
          {/* 年初来高値・昨年来高値 */}
          <label className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={showYtdHigh}
              onChange={(e) => setShowYtdHigh(e.target.checked)}
              className="h-3 w-3"
            />
            <span style={{ color: "#f97316" }}>年初来高値</span>
          </label>
          <label className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={showPrevYearHigh}
              onChange={(e) => setShowPrevYearHigh(e.target.checked)}
              className="h-3 w-3"
            />
            <span style={{ color: "#dc2626" }}>昨年来高値</span>
          </label>
          <label className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={showTenYearHigh}
              onChange={(e) => setShowTenYearHigh(e.target.checked)}
              className="h-3 w-3"
            />
            <span style={{ color: "#7c3aed" }}>10年来高値</span>
          </label>
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
          {/* CWH(TP20/SL8) */}
          <label className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={showCWHSignals}
              onChange={(e) => setShowCWHSignals(e.target.checked)}
              className="h-3 w-3"
            />
            <span style={{ color: "#10b981" }}>CWH(TP20/SL8)</span>
            {cwhSignals.length > 0 && (
              <span className="rounded-full bg-emerald-100 dark:bg-emerald-900/30 px-1.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
                {cwhSignals.length}
              </span>
            )}
          </label>
          {/* 戦略シグナル (日足/週足のみ) */}
          {periodType && (
            <>
              <span className="text-gray-300 dark:text-slate-600">|</span>
              {([
                { key: "rsi_reversal" as StrategySignalType, label: "RSI逆張り", color: "#8b5cf6" },
                { key: "ma_cross" as StrategySignalType, label: "MAクロス", color: "#3b82f6" },
                { key: "macd_signal" as StrategySignalType, label: "MACDシグナル", color: "#059669" },
                { key: "macd_trail" as StrategySignalType, label: "MACDトレーリング", color: "#f97316" },
              ] as const).map((s) => (
                <label key={s.key} className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={showStratSignals[s.key]}
                    onChange={(e) =>
                      setShowStratSignals((prev) => ({ ...prev, [s.key]: e.target.checked }))
                    }
                    className="h-3 w-3"
                  />
                  <span style={{ color: s.color }}>{s.label}</span>
                  {stratSignals && stratSignals[s.key]?.length > 0 && showStratSignals[s.key] && (
                    <span className="rounded-full bg-gray-100 dark:bg-slate-700 px-1.5 text-[10px] font-bold text-gray-600 dark:text-slate-300">
                      {stratSignals[s.key].length}
                    </span>
                  )}
                </label>
              ))}
            </>
          )}
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
                    <span className={`text-right font-medium ${d.close >= d.open ? "text-red-600" : "text-green-600"}`}>
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
                <Cell key={index} fill={entry.close >= entry.open ? "#fecaca" : "#bbf7d0"} />
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

          {/* 年初来高値 */}
          {showYtdHigh && ytdHigh != null && (
            <ReferenceLine
              yAxisId="price"
              y={ytdHigh}
              stroke="#f97316"
              strokeDasharray="8 4"
              strokeWidth={1.5}
              label={{
                value: `年初来高値 ${ytdHigh.toLocaleString()}`,
                position: "left",
                fontSize: 9,
                fill: "#f97316",
              }}
            />
          )}
          {/* 昨年来高値 */}
          {showPrevYearHigh && prevYearHigh != null && (
            <ReferenceLine
              yAxisId="price"
              y={prevYearHigh}
              stroke="#dc2626"
              strokeDasharray="8 4"
              strokeWidth={1.5}
              label={{
                value: `昨年来高値 ${prevYearHigh.toLocaleString()}`,
                position: "left",
                fontSize: 9,
                fill: "#dc2626",
              }}
            />
          )}
          {/* 10年来高値 */}
          {showTenYearHigh && tenYearHigh != null && (
            <ReferenceLine
              yAxisId="price"
              y={tenYearHigh}
              stroke="#7c3aed"
              strokeDasharray="8 4"
              strokeWidth={1.5}
              label={{
                value: `10年来高値 ${tenYearHigh.toLocaleString()}`,
                position: "left",
                fontSize: 9,
                fill: "#7c3aed",
              }}
            />
          )}

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

          {/* 利確/損切ライン（シグナル個別） */}
          {exitLines.map((line) => (
            <ReferenceLine
              key={line.key}
              yAxisId="price"
              y={line.price}
              stroke={line.color}
              strokeWidth={2}
              strokeDasharray="10 4"
              label={{
                value: line.label,
                position: "left",
                fontSize: 9,
                fill: line.color,
                fontWeight: "bold",
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
                <Cell key={index} fill={entry.close >= entry.open ? "#ef4444" : "#22c55e"} />
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
          {showMA.ma10 && (
            <Line yAxisId="price" type="monotone" dataKey="ma10" stroke="#84cc16" strokeWidth={1} dot={false} name="MA10" connectNulls />
          )}
          {showMA.ma20 && (
            <Line yAxisId="price" type="monotone" dataKey="ma20" stroke="#06b6d4" strokeWidth={1} dot={false} name="MA20" connectNulls />
          )}
          {showMA.ma25 && (
            <Line
              yAxisId="price"
              type="monotone"
              dataKey="ma25"
              stroke={isLatestTouchingMA25 ? "#22c55e" : showBuySignals ? "#f59e0b" : "#8b5cf6"}
              strokeWidth={isLatestTouchingMA25 ? 3.5 : showBuySignals ? 2.5 : 1}
              strokeDasharray={isLatestTouchingMA25 || showBuySignals ? "none" : undefined}
              dot={false}
              name={isLatestTouchingMA25 ? "MA25 (タッチ中!)" : showBuySignals ? "MA25 (ターゲット)" : "MA25"}
              connectNulls
            />
          )}
          {/* BB逆張りMA25タッチポイント（利確到達マーカー） */}
          <Line
            yAxisId="price"
            type="monotone"
            dataKey="ma25TouchPrice"
            stroke="none"
            dot={(props: any) => {
              const { cx, cy, payload } = props;
              if (payload?.ma25TouchPrice == null || cx == null || cy == null) return <g key={props.key} />;
              return (
                <g key={props.key}>
                  <circle cx={cx} cy={cy} r={7} fill="#22c55e" stroke="#fff" strokeWidth={2} />
                  <text x={cx} y={cy - 12} textAnchor="middle" fontSize={9} fontWeight="bold" fill="#22c55e">
                    利確(MA25)
                  </text>
                </g>
              );
            }}
            activeDot={false}
            legendType="none"
            connectNulls={false}
          />
          {showMA.ma50 && (
            <Line yAxisId="price" type="monotone" dataKey="ma50" stroke="#14b8a6" strokeWidth={1} dot={false} name="MA50" connectNulls />
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

          {/* 戦略シグナルマーカー（RSI逆張り / MAクロス / MACD） - Trail12はストリップ表示 */}
          {stratSignals && ([
            { key: "rsi_reversal" as StrategySignalType, color: "#8b5cf6" },
            { key: "ma_cross" as StrategySignalType, color: "#3b82f6" },
            { key: "macd_signal" as StrategySignalType, color: "#059669" },
          ] as const).map((s) => {
            if (!showStratSignals[s.key]) return null;
            const buyKey = `strat_buy_${s.key}`;
            const sellKey = `strat_sell_${s.key}`;
            return (
              <g key={`strat-${s.key}`}>
                {/* 買いシグナル ▲ */}
                <Line
                  yAxisId="price"
                  type="monotone"
                  dataKey={buyKey}
                  stroke="none"
                  isAnimationActive={false}
                  connectNulls={false}
                  legendType="none"
                  activeDot={false}
                  dot={(props: any) => {
                    const d = chartData[props.index];
                    if (!d?.[buyKey]) return <g key={props.key} />;
                    return (
                      <g key={props.key}>
                        <polygon
                          points={`${props.cx},${props.cy - 4} ${props.cx - 5},${props.cy + 5} ${props.cx + 5},${props.cy + 5}`}
                          fill={s.color}
                          stroke="#fff"
                          strokeWidth={1}
                        />
                        <text x={props.cx} y={props.cy + 16} textAnchor="middle" fontSize={8} fontWeight="bold" fill={s.color}>
                          {d[`strat_buy_label_${s.key}`]}
                        </text>
                      </g>
                    );
                  }}
                />
                {/* 売りシグナル ▼ */}
                <Line
                  yAxisId="price"
                  type="monotone"
                  dataKey={sellKey}
                  stroke="none"
                  isAnimationActive={false}
                  connectNulls={false}
                  legendType="none"
                  activeDot={false}
                  dot={(props: any) => {
                    const d = chartData[props.index];
                    if (!d?.[sellKey]) return <g key={props.key} />;
                    const sellType = d[`strat_sell_type_${s.key}`];
                    const fillColor = sellType === "take_profit" ? "#22c55e"
                      : sellType === "dead_cross" ? "#f97316" // DC=オレンジ
                      : "#ef4444";
                    return (
                      <g key={props.key}>
                        <polygon
                          points={`${props.cx},${props.cy + 4} ${props.cx - 5},${props.cy - 5} ${props.cx + 5},${props.cy - 5}`}
                          fill={fillColor}
                          stroke="#fff"
                          strokeWidth={1}
                        />
                        <text x={props.cx} y={props.cy - 10} textAnchor="middle" fontSize={8} fontWeight="bold" fill={fillColor}>
                          {d[`strat_sell_label_${s.key}`]}
                        </text>
                      </g>
                    );
                  }}
                />
              </g>
            );
          })}

          {/* トレーリングストップレベル線 (MACD Trail 12%) */}
          {showStratSignals.macd_trail && (
            <Line
              yAxisId="price"
              type="stepAfter"
              dataKey="trailStopLevel"
              stroke="#ef4444"
              strokeWidth={1.5}
              strokeDasharray="6 3"
              dot={false}
              connectNulls={false}
              name="Trail Stop"
              legendType="none"
            />
          )}

          {/* CWH カップ・ハンドル可視化 */}
          {showCWHSignals && cwhOverlays.map((o, i) => {
            const n = i + 1;
            const tag = cwhOverlays.length > 1 ? `#${n} ` : "";
            return (
            <g key={`cwh-vis-${i}`}>
              {/* カップ領域（青系） */}
              {o.cupStartDate && o.cupEndDate && (
                <ReferenceArea
                  yAxisId="price"
                  x1={o.cupStartDate}
                  x2={o.cupEndDate}
                  fill="#3b82f6"
                  fillOpacity={0.08}
                  stroke="#3b82f6"
                  strokeOpacity={0.4}
                  strokeDasharray="4 3"
                  label={{ value: `${tag}CUP`, position: "insideTopLeft", fontSize: 10, fill: "#3b82f6", fontWeight: "bold" }}
                />
              )}
              {/* ハンドル領域（オレンジ系） */}
              {o.cupEndDate && o.handleEndDate && o.cupEndDate !== o.handleEndDate && (
                <ReferenceArea
                  yAxisId="price"
                  x1={o.cupEndDate}
                  x2={o.handleEndDate}
                  fill="#f59e0b"
                  fillOpacity={0.10}
                  stroke="#f59e0b"
                  strokeOpacity={0.5}
                  strokeDasharray="4 3"
                  label={{ value: `${tag}HANDLE`, position: "insideTopLeft", fontSize: 10, fill: "#f59e0b", fontWeight: "bold" }}
                />
              )}
              {/* リムレベル水平線（カップ〜ハンドル区間） */}
              {o.cupStartDate && (o.handleEndDate ?? o.cupEndDate) && (
                <ReferenceLine
                  yAxisId="price"
                  segment={[
                    { x: o.cupStartDate, y: o.rimLevel },
                    { x: o.handleEndDate ?? o.cupEndDate!, y: o.rimLevel },
                  ] as any}
                  stroke="#10b981"
                  strokeWidth={1.5}
                  strokeDasharray="6 3"
                  label={{ value: `${tag}リム ${o.rimLevel.toLocaleString()}`, position: "right", fontSize: 9, fill: "#10b981" }}
                />
              )}
              {/* 左リム */}
              {o.leftRimDate && (
                <ReferenceDot
                  yAxisId="price"
                  x={o.leftRimDate}
                  y={o.leftRimHigh}
                  r={5}
                  fill="#3b82f6"
                  stroke="#fff"
                  strokeWidth={2}
                  label={{ value: `${tag}左リム`, position: "top", fontSize: 9, fill: "#3b82f6", fontWeight: "bold" }}
                />
              )}
              {/* カップ底 */}
              {o.bottomDate && (
                <ReferenceDot
                  yAxisId="price"
                  x={o.bottomDate}
                  y={o.bottomLow}
                  r={5}
                  fill="#ef4444"
                  stroke="#fff"
                  strokeWidth={2}
                  label={{ value: `${tag}底`, position: "bottom", fontSize: 9, fill: "#ef4444", fontWeight: "bold" }}
                />
              )}
              {/* 右リム */}
              {o.rightRimDate && (
                <ReferenceDot
                  yAxisId="price"
                  x={o.rightRimDate}
                  y={o.rightRimHigh}
                  r={5}
                  fill="#3b82f6"
                  stroke="#fff"
                  strokeWidth={2}
                  label={{ value: `${tag}右リム`, position: "top", fontSize: 9, fill: "#3b82f6", fontWeight: "bold" }}
                />
              )}
            </g>
            );
          })}

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
            <ComposedChart data={chartData} margin={{ top: 0, right: 65, bottom: 0, left: 5 }}>
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
              {/* CWH(TP20/SL8)マーカー */}
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

      {/* MACD Trail 12% シグナルストリップ */}
      {showStratSignals.macd_trail && chartData.some((d: any) => d.trail12Marker != null) && (
        <div className="-mt-1">
          <ResponsiveContainer width="100%" height={32}>
            <ComposedChart data={chartData} margin={{ top: 0, right: 65, bottom: 0, left: 5 }}>
              <XAxis
                dataKey="date"
                tick={false}
                tickLine={false}
                axisLine={false}
                height={1}
              />
              <YAxis domain={[0, 1]} hide />
              <Line
                type="monotone"
                dataKey="trail12Marker"
                stroke="none"
                isAnimationActive={false}
                connectNulls={false}
                legendType="none"
                activeDot={false}
                dot={(props: any) => {
                  const d = chartData[props.index];
                  if (!d?.trail12Marker) return <circle key={props.key} r={0} />;
                  const action = d.trail12Action as string;
                  const label = d.trail12Label as string;
                  const isBuy = action === "buy";
                  const color = isBuy ? "#f97316"
                    : action === "take_profit" ? "#22c55e"
                    : "#ef4444";
                  const marker = isBuy ? "▲" : "▼";
                  return (
                    <g key={props.key}>
                      <text
                        x={props.cx}
                        y={10}
                        textAnchor="middle"
                        fill={color}
                        fontSize={14}
                        fontWeight="bold"
                      >
                        {marker}
                      </text>
                      <text
                        x={props.cx}
                        y={24}
                        textAnchor="middle"
                        fill={color}
                        fontSize={8}
                        fontWeight="bold"
                      >
                        {label}
                      </text>
                    </g>
                  );
                }}
              />
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
                width={60}
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
              <YAxis orientation="right" tick={{ fontSize: 10 }} width={60} />
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
                    fill={(entry.macdHist ?? 0) >= 0 ? "#ef4444" : "#22c55e"}
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
          {/* ルール早見表 */}
          <div className="mb-2 rounded bg-amber-100/60 dark:bg-amber-900/20 px-2 py-1.5 text-[10px] text-amber-800 dark:text-amber-300 leading-relaxed">
            <div><b>BB逆張り:</b> 利確→終値≧MA25 ／ 損切→終値＜エントリー安値</div>
            <div><b>下放れ二本黒:</b> 利確→終値≧窓上限(前日安値) ／ 損切→終値＜直近安値</div>
          </div>
          <div className="space-y-2">
            {recentSignals.map((s) => {
              const entry = data[s.index]?.close ?? s.price;
              const stop = s.price; // エントリー時の安値
              const lineKey = `${s.date}-${s.type}`;
              const lineActive = exitLineKeys.has(lineKey);

              // BB逆張り: MA25タッチ到達状態を判定
              let bbTouchInfo: { reached: boolean; date?: string; price?: number; currentMA25?: number } | null = null;
              if (s.type === "bb_reversal") {
                const touchPt = bbMa25TouchPoints.find((p) => p.signalDate === s.date);
                if (touchPt) {
                  bbTouchInfo = { reached: true, date: touchPt.date, price: touchPt.price };
                } else {
                  // 未到達 → 現在のMA25を表示
                  const lastMA25 = allIndicators.ma25[data.length - 1];
                  bbTouchInfo = { reached: false, currentMA25: lastMA25 ?? undefined };
                }
              }

              // 下放れ: 固定値のまま
              let shitaTarget: number | null = null;
              if (s.type === "shitabanare") {
                shitaTarget = s.index >= 2 ? data[s.index - 2]?.low ?? null : null;
              }

              return (
              <div key={lineKey} className={`rounded px-2 py-1.5 text-xs ${lineActive ? "bg-amber-100/80 dark:bg-amber-900/30 ring-1 ring-amber-300 dark:ring-amber-700" : ""}`}>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={lineActive}
                    onChange={() => toggleExitLine(lineKey)}
                    className="h-3 w-3 shrink-0"
                    title={s.type === "bb_reversal" ? "損切ライン + MA25タッチポイントを表示" : "チャートに利確/損切ラインを表示"}
                  />
                  <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                    s.type === "shitabanare" ? "bg-red-500" : "bg-amber-500"
                  }`} />
                  <span className="font-medium text-gray-800 dark:text-slate-200">{s.date}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                    s.type === "shitabanare"
                      ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"
                      : "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400"
                  }`}>
                    {s.label}
                  </span>
                </div>
                <p className="mt-0.5 ml-5 text-gray-500 dark:text-slate-400">{s.description}</p>
                <div className="mt-1 ml-5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]">
                  <span className="text-gray-600 dark:text-slate-300">
                    Entry: <b>{entry.toLocaleString()}</b>
                  </span>
                  {/* BB逆張り: MA25タッチ状態 */}
                  {bbTouchInfo && (
                    bbTouchInfo.reached ? (
                      <span className="text-green-700 dark:text-green-400">
                        利確(MA25): <b>{bbTouchInfo.date}</b> @ {bbTouchInfo.price?.toLocaleString()}
                      </span>
                    ) : (
                      <span className="text-gray-400 dark:text-slate-500">
                        利確(MA25): 未到達{bbTouchInfo.currentMA25 != null && ` (現在MA25: ${bbTouchInfo.currentMA25.toLocaleString()})`}
                      </span>
                    )
                  )}
                  {/* 下放れ: 固定値 */}
                  {shitaTarget != null && (
                    <span className="text-green-700 dark:text-green-400">
                      利確(窓上限): <b>{shitaTarget.toLocaleString()}</b>
                    </span>
                  )}
                  <span className="text-red-600 dark:text-red-400">
                    損切(安値): <b>{stop.toLocaleString()}</b>
                  </span>
                </div>
              </div>
              );
            })}
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
            <span>◆</span> CWH(TP20/SL8)・直近シグナル
          </h4>
          {/* ルール早見表 */}
          <div className="mb-2 rounded bg-emerald-100/60 dark:bg-emerald-900/20 px-2 py-1.5 text-[10px] text-emerald-800 dark:text-emerald-300 leading-relaxed">
            <b>CWH:</b> 利確→買値から+20%到達 ／ 損切→買値から-8%到達
          </div>
          <div className="space-y-2">
            {recentCWHSignals.map((s) => {
              const targetPrice = Math.round(s.price * 1.20);
              const stopPrice = Math.round(s.price * 0.93);
              const lineKey = `cwh-${s.date}`;
              const lineActive = exitLineKeys.has(lineKey);
              return (
              <div key={lineKey} className={`rounded px-2 py-1.5 text-xs ${lineActive ? "bg-emerald-100/80 dark:bg-emerald-900/30 ring-1 ring-emerald-300 dark:ring-emerald-700" : ""}`}>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={lineActive}
                    onChange={() => toggleExitLine(lineKey)}
                    className="h-3 w-3 shrink-0"
                    title="チャートに利確/損切ラインを表示"
                  />
                  <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                  <span className="font-medium text-gray-800 dark:text-slate-200">{s.date}</span>
                  <span className="rounded bg-emerald-100 dark:bg-emerald-900/30 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
                    {s.label}
                  </span>
                </div>
                <p className="mt-0.5 ml-5 text-gray-500 dark:text-slate-400">{s.description}</p>
                <div className="mt-1 ml-5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]">
                  <span className="text-gray-600 dark:text-slate-300">
                    Entry: <b>{s.price.toLocaleString()}</b>
                  </span>
                  <span className="text-green-700 dark:text-green-400">
                    利確(+20%): <b>{targetPrice.toLocaleString()}</b>
                  </span>
                  <span className="text-red-600 dark:text-red-400">
                    損切(-7%): <b>{stopPrice.toLocaleString()}</b>
                  </span>
                </div>
              </div>
              );
            })}
          </div>
          {visibleCWHSignals.length > 0 && (
            <p className="mt-2 text-xs font-medium text-emerald-700 dark:text-emerald-400">
              表示範囲内に {visibleCWHSignals.length}件
            </p>
          )}
        </div>
      )}

      {/* 戦略シグナル一覧（RSI逆張り / MAクロス / MACD） */}
      {stratSignals && ([
        { key: "rsi_reversal" as StrategySignalType, label: "RSI逆張り", color: "#8b5cf6", borderColor: "border-violet-200 dark:border-violet-800/50", bgColor: "bg-violet-50 dark:bg-violet-900/10", headerColor: "text-violet-800 dark:text-violet-400", countColor: "text-violet-700 dark:text-violet-400", ruleText: "RSI売られすぎで買い、買われすぎで売り" },
        { key: "ma_cross" as StrategySignalType, label: "MAクロス(GC/DC)", color: "#3b82f6", borderColor: "border-blue-200 dark:border-blue-800/50", bgColor: "bg-blue-50 dark:bg-blue-900/10", headerColor: "text-blue-800 dark:text-blue-400", countColor: "text-blue-700 dark:text-blue-400", ruleText: "ゴールデンクロス(GC)で買い、デッドクロス(DC)で売り" },
        { key: "macd_signal" as StrategySignalType, label: "MACDシグナル", color: "#059669", borderColor: "border-teal-200 dark:border-teal-800/50", bgColor: "bg-teal-50 dark:bg-teal-900/10", headerColor: "text-teal-800 dark:text-teal-400", countColor: "text-teal-700 dark:text-teal-400", ruleText: "MACDがシグナル線を上抜けで買い、下抜けで売り" },
        { key: "macd_trail" as StrategySignalType, label: "MACDトレーリング", color: "#f97316", borderColor: "border-orange-200 dark:border-orange-800/50", bgColor: "bg-orange-50 dark:bg-orange-900/10", headerColor: "text-orange-800 dark:text-orange-400", countColor: "text-orange-700 dark:text-orange-400", ruleText: "MACD GCで買い、トレーリングストップ or 損切りで売り（赤い破線=ストップレベル）" },
      ] as const).map((s) => {
        if (!showStratSignals[s.key]) return null;
        const points = stratSignals[s.key];
        if (!points || points.length === 0) return null;
        const recent = points.slice(-10).reverse();
        return (
          <div key={`panel-${s.key}`} className={`mt-3 rounded border ${s.borderColor} ${s.bgColor} p-3`}>
            <h4 className={`mb-2 flex items-center gap-1.5 text-sm font-semibold ${s.headerColor}`}>
              <span style={{ color: s.color }}>&#9650;</span> {s.label}・直近シグナル
              <span className="rounded-full bg-white/60 dark:bg-slate-800/60 px-1.5 text-[10px] font-bold">
                {points.length}件
              </span>
            </h4>
            <div className={`mb-2 rounded px-2 py-1.5 text-[10px] ${s.headerColor} leading-relaxed opacity-80`}>
              <b>ルール:</b> {s.ruleText}（最適化プリセット使用）
            </div>
            <div className="space-y-1.5">
              {recent.map((pt, i) => (
                <div key={`${pt.date}-${pt.action}-${i}`} className="flex items-center gap-2 rounded px-2 py-1 text-xs">
                  <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                    pt.action === "buy" ? "bg-blue-500"
                    : pt.action === "take_profit" ? "bg-green-500"
                    : pt.action === "dead_cross" ? "bg-orange-500"
                    : "bg-red-500"
                  }`} />
                  <span className="font-medium text-gray-800 dark:text-slate-200">{pt.date}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                    pt.action === "buy"
                      ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400"
                      : pt.action === "take_profit"
                        ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                        : pt.action === "dead_cross"
                          ? "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400"
                          : "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"
                  }`}>
                    {pt.label}
                  </span>
                  <span className="text-gray-500 dark:text-slate-400">
                    @{pt.price.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
}

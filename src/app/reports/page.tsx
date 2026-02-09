"use client";

import { useState, useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  Legend,
  Cell,
} from "recharts";
import { wfReportData, type WFStrategyResult } from "@/lib/reports/wfReportData";
import { fullBacktestData, type FullBacktestStrategy, type ComparisonRow } from "@/lib/reports/backtestAllData";
import { cwh52wComparison, type Cwh52wMode } from "@/lib/reports/cwh52wData";

// ============================================================
// Constants
// ============================================================

const COLORS = [
  "#22c55e", // green-500
  "#3b82f6", // blue-500
  "#f59e0b", // amber-500
  "#8b5cf6", // violet-500
  "#ef4444", // red-500
  "#06b6d4", // cyan-500
  "#ec4899", // pink-500
];

const TOOLTIP_STYLE = {
  backgroundColor: "rgba(30,41,59,0.95)",
  border: "none",
  borderRadius: 8,
  fontSize: 12,
  color: "#fff",
};

const WINDOW_ANNOTATIONS: Record<string, string> = {
  "2019": "",
  "2020": "COVID暴落",
  "2021": "回復相場",
  "2022": "下落相場",
  "2023": "",
  "2024": "",
  "2025": "",
};

type SortKey = "score" | "return" | "winRate" | "overfit";

// ============================================================
// Helper functions
// ============================================================

function getVerdict(s: WFStrategyResult): { label: string; color: string; bg: string } {
  if (s.stabilityScore >= 0.85 && s.testReturnMedian > 0)
    return { label: "推奨", color: "text-green-700 dark:text-green-300", bg: "bg-green-100 dark:bg-green-900/40" };
  if (s.stabilityScore >= 0.75 && s.testReturnMedian > 0)
    return { label: "有用", color: "text-blue-700 dark:text-blue-300", bg: "bg-blue-100 dark:bg-blue-900/40" };
  if (s.testReturnMedian <= 0 && s.testReturnStd < 1)
    return { label: "取引なし", color: "text-gray-500 dark:text-gray-400", bg: "bg-gray-100 dark:bg-gray-700" };
  if (s.stabilityScore < 0.6)
    return { label: "非推奨", color: "text-red-700 dark:text-red-300", bg: "bg-red-100 dark:bg-red-900/40" };
  return { label: "注意", color: "text-amber-700 dark:text-amber-300", bg: "bg-amber-100 dark:bg-amber-900/40" };
}

function heatmapColor(value: number): string {
  if (value >= 20) return "bg-green-600 text-white";
  if (value >= 10) return "bg-green-500 text-white";
  if (value > 1) return "bg-green-300 dark:bg-green-700 text-green-900 dark:text-green-100";
  if (value > -1) return "bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200";
  if (value >= -10) return "bg-red-300 dark:bg-red-700 text-red-900 dark:text-red-100";
  return "bg-red-500 text-white";
}

function fmtPct(v: number): string {
  return (v >= 0 ? "+" : "") + v.toFixed(1) + "%";
}

// ============================================================
// Component: Section wrapper
// ============================================================

function Section({
  title,
  subtitle,
  children,
  collapsible = false,
  defaultOpen = true,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-lg bg-white p-4 shadow dark:bg-slate-800 dark:shadow-slate-900/50 sm:p-6">
      <div
        className={`flex items-center justify-between ${collapsible ? "cursor-pointer" : ""}`}
        onClick={collapsible ? () => setOpen((v) => !v) : undefined}
      >
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-gray-500 dark:text-slate-400">{subtitle}</p>}
        </div>
        {collapsible && (
          <svg
            className={`h-5 w-5 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        )}
      </div>
      {(!collapsible || open) && <div className="mt-4">{children}</div>}
    </div>
  );
}

// ============================================================
// Component: Key Findings
// ============================================================

function KeyFindings({ strategies }: { strategies: WFStrategyResult[] }) {
  const recommended = strategies.filter((s) => getVerdict(s).label === "推奨");
  const useful = strategies.filter((s) => getVerdict(s).label === "有用");
  const noTrade = strategies.filter((s) => getVerdict(s).label === "取引なし");

  // データ駆動で上位戦略を抽出
  const sorted = [...strategies].sort((a, b) => b.stabilityScore - a.stabilityScore);
  const top3 = sorted.slice(0, 3);
  const bestReturn = [...strategies].sort((a, b) => b.testReturnMedian - a.testReturnMedian)[0];
  const noTradeStrats = strategies.filter((s) => s.testReturnMedian === 0 && s.testReturnStd < 1);

  const positiveStrats = sorted.filter((s) => s.testReturnMedian > 0);
  const negativeStrats = sorted.filter((s) => s.testReturnMedian <= 0);

  const findings = [
    {
      type: "success" as const,
      text: `WF安定性上位: ${top3.map((s) => `${s.strategyName} (${s.stabilityScore.toFixed(3)})`).join(", ")}`,
    },
    {
      type: "success" as const,
      text: `テスト期間で安定してプラスリターンの戦略: ${positiveStrats.map((s) => `${s.strategyName} (${fmtPct(s.testReturnMedian)})`).join(", ")}`,
    },
    {
      type: "info" as const,
      text: `${bestReturn.strategyName}はテスト中央値${fmtPct(bestReturn.testReturnMedian)}と最高リターンだが、標準偏差${bestReturn.testReturnStd.toFixed(1)}%でバラツキが大きい`,
    },
    ...(negativeStrats.length > 0 ? [{
      type: "warning" as const,
      text: `WF検証でマイナスリターン: ${negativeStrats.map((s) => `${s.strategyName} (${fmtPct(s.testReturnMedian)})`).join(", ")}。実運用パラメータはWF最適値と異なる`,
    }] : []),
    {
      type: "info" as const,
      text: `In-sample結果とWF結果の乖離が大きい戦略は過学習の兆候。過学習度(=訓練中央値−テスト中央値)が小さいほど安定`,
    },
  ];

  const colors = {
    success: "border-l-green-500 bg-green-50 dark:bg-green-900/20",
    info: "border-l-blue-500 bg-blue-50 dark:bg-blue-900/20",
    warning: "border-l-amber-500 bg-amber-50 dark:bg-amber-900/20",
  };

  return (
    <div className="space-y-2">
      {findings.map((f, i) => (
        <div
          key={i}
          className={`rounded-r-lg border-l-4 p-3 text-sm text-gray-800 dark:text-gray-200 ${colors[f.type]}`}
        >
          {f.text}
        </div>
      ))}
    </div>
  );
}

// ============================================================
// Component: Stability Bar Chart
// ============================================================

function StabilityBarChart({ strategies }: { strategies: WFStrategyResult[] }) {
  const data = strategies.map((s) => ({
    name: s.strategyName,
    score: s.stabilityScore,
    testReturn: s.testReturnMedian,
  }));

  return (
    <ResponsiveContainer width="100%" height={strategies.length * 48 + 40}>
      <BarChart data={data} layout="vertical" margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
        <XAxis type="number" domain={[0, 1]} tickCount={6} tick={{ fontSize: 10, fill: "#9ca3af" }} />
        <YAxis
          type="category"
          dataKey="name"
          width={130}
          tick={{ fontSize: 11, fill: "#9ca3af" }}
        />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v, name) => {
          const val = typeof v === "number" ? v : 0;
          return name === "score" ? [val.toFixed(3), "安定性スコア"] : [fmtPct(val), "テストリターン"];
        }} />
        <Bar dataKey="score" name="score" radius={[0, 4, 4, 0]}>
          {data.map((entry, i) => (
            <Cell
              key={i}
              fill={entry.score >= 0.85 ? "#22c55e" : entry.score >= 0.75 ? "#3b82f6" : entry.score >= 0.6 ? "#f59e0b" : "#ef4444"}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ============================================================
// Component: Strategy Ranking Table
// ============================================================

function RankingTable({ strategies, sortKey, onSort }: {
  strategies: WFStrategyResult[];
  sortKey: SortKey;
  onSort: (key: SortKey) => void;
}) {
  const sortArrow = (key: SortKey) => (sortKey === key ? " ▼" : "");

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-gray-200 dark:border-slate-700">
            <th className="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">
              #
            </th>
            <th className="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">
              戦略
            </th>
            <th
              className="cursor-pointer px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200"
              onClick={() => onSort("score")}
            >
              安定性{sortArrow("score")}
            </th>
            <th
              className="cursor-pointer px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200"
              onClick={() => onSort("return")}
            >
              テスト中央値{sortArrow("return")}
            </th>
            <th
              className="cursor-pointer px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200"
              onClick={() => onSort("winRate")}
            >
              勝率{sortArrow("winRate")}
            </th>
            <th
              className="cursor-pointer px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200"
              onClick={() => onSort("overfit")}
            >
              過学習度{sortArrow("overfit")}
            </th>
            <th className="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">
              推奨パラメータ
            </th>
            <th className="px-2 py-2 text-center text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">
              判定
            </th>
          </tr>
        </thead>
        <tbody>
          {strategies.map((s, i) => {
            const verdict = getVerdict(s);
            const isNoTrade = verdict.label === "取引なし";
            return (
              <tr
                key={s.strategyId}
                className={`border-b border-gray-100 dark:border-slate-700/50 ${isNoTrade ? "opacity-50" : ""}`}
              >
                <td className="px-2 py-2.5 font-medium text-gray-700 dark:text-slate-300">{i + 1}</td>
                <td className="px-2 py-2.5 font-medium text-gray-900 dark:text-white">{s.strategyName}</td>
                <td className="px-2 py-2.5 text-right font-mono text-sm">
                  <span className={s.stabilityScore >= 0.85 ? "text-green-600 dark:text-green-400" : s.stabilityScore >= 0.75 ? "text-blue-600 dark:text-blue-400" : "text-gray-600 dark:text-gray-400"}>
                    {s.stabilityScore.toFixed(3)}
                  </span>
                </td>
                <td className={`px-2 py-2.5 text-right font-mono text-sm ${s.testReturnMedian > 0 ? "text-green-600 dark:text-green-400" : s.testReturnMedian < 0 ? "text-red-600 dark:text-red-400" : "text-gray-500"}`}>
                  {fmtPct(s.testReturnMedian)}
                </td>
                <td className="px-2 py-2.5 text-right font-mono text-sm text-gray-700 dark:text-slate-300">
                  {s.testWinRate > 0 ? s.testWinRate.toFixed(1) + "%" : "-"}
                </td>
                <td className={`px-2 py-2.5 text-right font-mono text-sm ${s.overfitDegree > 5 ? "text-red-600 dark:text-red-400" : "text-gray-600 dark:text-gray-400"}`}>
                  {fmtPct(s.overfitDegree)}
                </td>
                <td className="px-2 py-2.5 text-xs text-gray-600 dark:text-slate-400">
                  {s.bestParamLabel}
                </td>
                <td className="px-2 py-2.5 text-center">
                  <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${verdict.bg} ${verdict.color}`}>
                    {verdict.label}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================
// Component: Radar Chart
// ============================================================

function StrategyRadar({
  strategies,
  selectedIds,
  onToggle,
}: {
  strategies: WFStrategyResult[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
}) {
  // 正規化用の範囲を計算
  const allReturns = strategies.map((s) => s.testReturnMedian);
  const allStd = strategies.map((s) => s.testReturnStd);
  const allOverfit = strategies.map((s) => s.overfitDegree);
  const maxReturn = Math.max(...allReturns, 1);
  const maxStd = Math.max(...allStd, 1);
  const maxOverfit = Math.max(...allOverfit.map(Math.abs), 1);

  const selected = strategies.filter((s) => selectedIds.has(s.strategyId));

  const axes = ["安定性", "リターン", "勝率", "低過学習", "一貫性"];
  const data = axes.map((axis) => {
    const point: Record<string, number | string> = { axis };
    for (const s of selected) {
      let val = 0;
      switch (axis) {
        case "安定性": val = s.stabilityScore; break;
        case "リターン": val = Math.max(0, s.testReturnMedian / maxReturn); break;
        case "勝率": val = s.testWinRate / 100; break;
        case "低過学習": val = Math.max(0, 1 - Math.abs(s.overfitDegree) / maxOverfit); break;
        case "一貫性": val = Math.max(0, 1 - s.testReturnStd / maxStd); break;
      }
      point[s.strategyId] = Math.round(val * 100) / 100;
    }
    return point;
  });

  // 上位7戦略を表示候補に
  const candidates = strategies.filter((s) => s.testReturnMedian > 0 || s.stabilityScore >= 0.75);

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        {candidates.map((s, i) => (
          <button
            key={s.strategyId}
            onClick={() => onToggle(s.strategyId)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              selectedIds.has(s.strategyId)
                ? "text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
            }`}
            style={selectedIds.has(s.strategyId) ? { backgroundColor: COLORS[i % COLORS.length] } : undefined}
          >
            {s.strategyName}
          </button>
        ))}
      </div>
      {selected.length > 0 && (
        <ResponsiveContainer width="100%" height={360}>
          <RadarChart data={data}>
            <PolarGrid stroke="#374151" />
            <PolarAngleAxis dataKey="axis" tick={{ fontSize: 11, fill: "#9ca3af" }} />
            <PolarRadiusAxis domain={[0, 1]} tick={false} axisLine={false} />
            {selected.map((s, i) => (
              <Radar
                key={s.strategyId}
                name={s.strategyName}
                dataKey={s.strategyId}
                stroke={COLORS[candidates.findIndex((c) => c.strategyId === s.strategyId) % COLORS.length]}
                fill={COLORS[candidates.findIndex((c) => c.strategyId === s.strategyId) % COLORS.length]}
                fillOpacity={0.15}
                strokeWidth={2}
              />
            ))}
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
          </RadarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ============================================================
// Component: Window Heatmap
// ============================================================

function WindowHeatmap({ strategies }: { strategies: WFStrategyResult[] }) {
  const { windows } = wfReportData;

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[600px]">
        {/* Header */}
        <div className="mb-1 grid gap-1" style={{ gridTemplateColumns: `140px repeat(${windows.length}, 1fr)` }}>
          <div className="text-xs font-semibold text-gray-500 dark:text-slate-400" />
          {windows.map((w) => (
            <div key={w.id} className="text-center text-xs font-semibold text-gray-600 dark:text-slate-300">
              <div>{w.testLabel}</div>
              {WINDOW_ANNOTATIONS[w.testLabel] && (
                <div className="text-[10px] text-gray-400 dark:text-slate-500">{WINDOW_ANNOTATIONS[w.testLabel]}</div>
              )}
            </div>
          ))}
        </div>
        {/* Rows */}
        {strategies.map((s) => (
          <div
            key={s.strategyId}
            className="mb-1 grid gap-1"
            style={{ gridTemplateColumns: `140px repeat(${windows.length}, 1fr)` }}
          >
            <div className="flex items-center text-xs font-medium text-gray-700 dark:text-slate-300 truncate pr-1">
              {s.strategyName}
            </div>
            {s.windowReturns.map((ret, wi) => (
              <div
                key={wi}
                className={`flex items-center justify-center rounded px-1 py-2 text-xs font-mono font-medium ${heatmapColor(ret)}`}
              >
                {ret === 0 ? "-" : fmtPct(ret)}
              </div>
            ))}
          </div>
        ))}
      </div>
      {/* Legend */}
      <div className="mt-3 flex items-center justify-center gap-2 text-[10px] text-gray-500 dark:text-slate-400">
        <span className="inline-block h-3 w-6 rounded bg-red-500" /> &lt;-10%
        <span className="inline-block h-3 w-6 rounded bg-red-300 dark:bg-red-700" /> -10〜-1%
        <span className="inline-block h-3 w-6 rounded bg-gray-200 dark:bg-gray-600" /> -1〜+1%
        <span className="inline-block h-3 w-6 rounded bg-green-300 dark:bg-green-700" /> +1〜+10%
        <span className="inline-block h-3 w-6 rounded bg-green-500" /> +10〜+20%
        <span className="inline-block h-3 w-6 rounded bg-green-600" /> &gt;+20%
      </div>
    </div>
  );
}

// ============================================================
// Component: Strategy Detail Cards
// ============================================================

function StrategyDetailCard({ strategy, rank }: { strategy: WFStrategyResult; rank: number }) {
  const [expanded, setExpanded] = useState(false);
  const verdict = getVerdict(strategy);
  const { windows } = wfReportData;

  return (
    <div className="rounded-lg border border-gray-200 dark:border-slate-700">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className="text-sm font-medium text-gray-500 dark:text-slate-400">#{rank}</span>
        <span className="flex-1 font-medium text-gray-900 dark:text-white">{strategy.strategyName}</span>
        {/* Score bar */}
        <div className="hidden sm:flex w-24 items-center gap-2">
          <div className="h-2 flex-1 rounded-full bg-gray-200 dark:bg-slate-700">
            <div
              className="h-2 rounded-full bg-green-500"
              style={{ width: `${strategy.stabilityScore * 100}%` }}
            />
          </div>
          <span className="text-xs font-mono text-gray-600 dark:text-slate-400">{strategy.stabilityScore.toFixed(3)}</span>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${verdict.bg} ${verdict.color}`}>
          {verdict.label}
        </span>
        <svg
          className={`h-4 w-4 text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {expanded && (
        <div className="border-t border-gray-100 px-4 py-3 dark:border-slate-700">
          {/* Metrics grid */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricBox label="テスト中央値" value={fmtPct(strategy.testReturnMedian)} positive={strategy.testReturnMedian > 0} />
            <MetricBox label="テスト最小値" value={fmtPct(strategy.testReturnMin)} positive={strategy.testReturnMin > 0} />
            <MetricBox label="標準偏差" value={strategy.testReturnStd.toFixed(1) + "%"} />
            <MetricBox label="過学習度" value={fmtPct(strategy.overfitDegree)} warning={Math.abs(strategy.overfitDegree) > 5} />
          </div>
          {/* Params */}
          <div className="mt-3">
            <span className="text-xs font-semibold text-gray-500 dark:text-slate-400">推奨パラメータ: </span>
            <span className="text-xs font-mono text-gray-700 dark:text-slate-300">{strategy.bestParamLabel}</span>
            {Object.keys(strategy.bestParams).length > 0 && (
              <span className="ml-2 text-xs text-gray-400">
                ({Object.entries(strategy.bestParams).map(([k, v]) => `${k}=${v}`).join(", ")})
              </span>
            )}
          </div>
          {/* Window returns */}
          <div className="mt-3">
            <span className="text-xs font-semibold text-gray-500 dark:text-slate-400">ウィンドウ別テストリターン:</span>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {windows.map((w, wi) => {
                const ret = strategy.windowReturns[wi];
                return (
                  <div key={w.id} className="text-center">
                    <div className="text-[10px] text-gray-400">{w.testLabel}</div>
                    <div className={`text-xs font-mono font-medium ${ret > 0 ? "text-green-600 dark:text-green-400" : ret < 0 ? "text-red-600 dark:text-red-400" : "text-gray-400"}`}>
                      {ret === 0 ? "-" : fmtPct(ret)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricBox({ label, value, positive, warning }: {
  label: string;
  value: string;
  positive?: boolean;
  warning?: boolean;
}) {
  return (
    <div className="rounded bg-gray-50 px-3 py-2 dark:bg-slate-700/50">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500">{label}</div>
      <div className={`mt-0.5 text-sm font-mono font-semibold ${warning ? "text-red-600 dark:text-red-400" : positive === true ? "text-green-600 dark:text-green-400" : positive === false ? "text-red-600 dark:text-red-400" : "text-gray-700 dark:text-slate-300"}`}>
        {value}
      </div>
    </div>
  );
}

// ============================================================
// Component: Strategy Parameter Reference
// ============================================================

interface ParamDef {
  name: string;
  range?: string;
  description: string;
  category: "entry" | "profit" | "stoploss";
}

interface StrategyParamInfo {
  id: string;
  name: string;
  description: string;
  params: ParamDef[];
}

const STRATEGY_PARAMS: StrategyParamInfo[] = [
  {
    id: "ma_cross",
    name: "MAクロス",
    description: "短期MAが長期MAを上抜けで買い(ゴールデンクロス)、下抜けで売り(デッドクロス)",
    params: [
      { name: "shortPeriod", range: "2-50", description: "短期移動平均の期間", category: "entry" },
      { name: "longPeriod", range: "5-200", description: "長期移動平均の期間", category: "entry" },
    ],
  },
  {
    id: "rsi_reversal",
    name: "RSI逆張り",
    description: "RSI売られすぎで買い、買われすぎで利確、ATRベースの損切り",
    params: [
      { name: "period", range: "5-30", description: "RSI計算期間", category: "entry" },
      { name: "oversold", range: "10-50", description: "この値を下回ったら「売られすぎ」→ 買い", category: "entry" },
      { name: "overbought", range: "50-90", description: "この値を上回ったら「買われすぎ」→ 利確", category: "profit" },
      { name: "atrPeriod", range: "5-30", description: "ATR(平均真の値幅)の計算期間", category: "stoploss" },
      { name: "atrMultiple", range: "1-5", description: "ATR × この倍率が損切ライン", category: "stoploss" },
      { name: "stopLossPct", range: "5-20", description: "損切上限%。ATR損切とこの%の厳しい方を採用", category: "stoploss" },
    ],
  },
  {
    id: "macd_signal",
    name: "MACDシグナル",
    description: "MACDがシグナル線を上抜けで買い、下抜けで売り",
    params: [
      { name: "shortPeriod", range: "5-30", description: "MACD短期EMA期間", category: "entry" },
      { name: "longPeriod", range: "10-50", description: "MACD長期EMA期間", category: "entry" },
      { name: "signalPeriod", range: "3-20", description: "シグナル線の期間", category: "entry" },
    ],
  },
  {
    id: "macd_trail",
    name: "MACDトレイル",
    description: "MACDゴールデンクロスで買い、トレーリングストップで利益を伸ばしつつ撤退",
    params: [
      { name: "shortPeriod", range: "5-30", description: "MACD短期EMA期間", category: "entry" },
      { name: "longPeriod", range: "10-50", description: "MACD長期EMA期間", category: "entry" },
      { name: "signalPeriod", range: "3-20", description: "シグナル線の期間", category: "entry" },
      { name: "trailPct", range: "5-25", description: "保有中の最高値からこの%下落で売り", category: "profit" },
      { name: "stopLossPct", range: "2-15", description: "エントリー価格からこの%下落で即損切", category: "stoploss" },
    ],
  },
  {
    id: "dip_buy",
    name: "急落買い",
    description: "直近高値から急落したら買い、回復で利確",
    params: [
      { name: "dipPct", range: "3-30", description: "直近高値からこの%下落で買い", category: "entry" },
      { name: "recoveryPct", range: "5-50", description: "エントリーからこの%上昇で利確", category: "profit" },
      { name: "stopLossPct", range: "5-30", description: "エントリーからこの%下落で損切", category: "stoploss" },
    ],
  },
  {
    id: "tabata_cwh",
    name: "CWH (Cup with Handle)",
    description: "カップウィズハンドルのブレイクアウトで買い、固定%で利確/損切り",
    params: [
      { name: "takeProfitPct", range: "5-50", description: "エントリーからこの%上昇で利確", category: "profit" },
      { name: "stopLossPct", range: "2-20", description: "エントリーからこの%下落で損切", category: "stoploss" },
    ],
  },
];

const CATEGORY_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  entry: { bg: "bg-blue-100 dark:bg-blue-900/40", text: "text-blue-700 dark:text-blue-300", label: "エントリー" },
  profit: { bg: "bg-green-100 dark:bg-green-900/40", text: "text-green-700 dark:text-green-300", label: "利確" },
  stoploss: { bg: "bg-red-100 dark:bg-red-900/40", text: "text-red-700 dark:text-red-300", label: "損切" },
};

function StrategyParamReference() {
  return (
    <div className="space-y-4">
      {STRATEGY_PARAMS.map((strat) => (
        <div key={strat.id} className="rounded-lg border border-gray-200 dark:border-slate-700">
          <div className="px-4 py-3">
            <h3 className="font-semibold text-gray-900 dark:text-white">{strat.name}</h3>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">{strat.description}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-t border-gray-100 bg-gray-50 dark:border-slate-700 dark:bg-slate-700/50">
                  <th className="px-4 py-1.5 text-left text-xs font-semibold text-gray-500 dark:text-slate-400">パラメータ</th>
                  <th className="px-4 py-1.5 text-left text-xs font-semibold text-gray-500 dark:text-slate-400">範囲</th>
                  <th className="px-4 py-1.5 text-left text-xs font-semibold text-gray-500 dark:text-slate-400">分類</th>
                  <th className="px-4 py-1.5 text-left text-xs font-semibold text-gray-500 dark:text-slate-400">説明</th>
                </tr>
              </thead>
              <tbody>
                {strat.params.map((p) => {
                  const cat = CATEGORY_COLORS[p.category];
                  return (
                    <tr key={p.name} className="border-t border-gray-100 dark:border-slate-700/50">
                      <td className="px-4 py-1.5 font-mono text-xs text-gray-700 dark:text-slate-300">{p.name}</td>
                      <td className="px-4 py-1.5 font-mono text-xs text-gray-500 dark:text-slate-400">{p.range || "-"}</td>
                      <td className="px-4 py-1.5">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${cat.bg} ${cat.text}`}>
                          {cat.label}
                        </span>
                      </td>
                      <td className="px-4 py-1.5 text-xs text-gray-600 dark:text-slate-400">{p.description}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {/* Category Legend */}
      <div className="rounded-lg bg-gray-50 p-4 dark:bg-slate-700/30">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">パラメータ分類</h3>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 inline-block rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
              エントリー
            </span>
            <span className="text-xs text-gray-600 dark:text-slate-400">いつ買うか</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="mt-0.5 inline-block rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-900/40 dark:text-green-300">
              利確
            </span>
            <span className="text-xs text-gray-600 dark:text-slate-400">いつ利益確定するか</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="mt-0.5 inline-block rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-900/40 dark:text-red-300">
              損切
            </span>
            <span className="text-xs text-gray-600 dark:text-slate-400">いつ撤退するか</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Component: Current Presets Table (Daily + Weekly)
// ============================================================

interface PresetRow {
  strategyName: string;
  daily: string;
  weekly: string | null;  // null = weekly設定なし
  source: "wf" | "grid" | "fixed";  // パラメータ決定方法
}

const PRESET_DATA: PresetRow[] = [
  { strategyName: "MAクロス", daily: "short=5, long=25", weekly: "short=10, long=20", source: "wf" },
  { strategyName: "RSI逆張り", daily: "period=5, oversold=37, overbought=70, atrPeriod=14, atrMultiple=2, stopLoss=5%", weekly: "period=10, oversold=40, overbought=75, atrPeriod=14, atrMultiple=2, stopLoss=10%", source: "wf" },
  { strategyName: "MACDシグナル", daily: "short=5, long=10, signal=12", weekly: "short=10, long=30, signal=12", source: "wf" },
  { strategyName: "急落買い", daily: "dip=3%, recovery=39%, stopLoss=5%", weekly: "dip=3%, recovery=30%, stopLoss=15%", source: "wf" },
  { strategyName: "BB逆張り", daily: "パラメータなし（BB25固定）", weekly: null, source: "fixed" },
  { strategyName: "下放れ二本黒", daily: "パラメータなし（BB25固定）", weekly: null, source: "fixed" },
  { strategyName: "急落買い(乖離率)", daily: "entry=-30%, exit=-15%, stopLoss=3%, timeStop=2日", weekly: "entry=-8%, exit=-5%, stopLoss=7%, timeStop=5日", source: "grid" },
  { strategyName: "急落買い(RSI+出来高)", daily: "rsi=30, volume=2倍, rsiExit=55, takeProfit=6%", weekly: "rsi=35, volume=1.2倍, rsiExit=35, takeProfit=3%", source: "grid" },
  { strategyName: "急落買い(BB-3σ)", daily: "stopLoss=3%", weekly: "stopLoss=5%", source: "grid" },
  { strategyName: "MACDトレーリング", daily: "short=5, long=23, signal=3, trail=12%, stopLoss=15%", weekly: "short=12, long=26, signal=9, trail=12%, stopLoss=5%", source: "wf" },
  { strategyName: "CWH(固定)", daily: "takeProfit=20%, stopLoss=8%", weekly: "takeProfit=20%, stopLoss=8%", source: "wf" },
  { strategyName: "CWHトレーリング", daily: "trail=8%, stopLoss=6%", weekly: "trail=12%, stopLoss=5%", source: "grid" },
];

function CurrentPresetsTable() {
  const sourceLabel = { wf: "WF安定性", grid: "グリッドサーチ", fixed: "固定" };
  const sourceColor = {
    wf: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
    grid: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    fixed: "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400",
  };

  return (
    <div className="space-y-6">
      {/* Daily */}
      <div>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
          <span className="inline-block rounded bg-blue-500 px-2 py-0.5 text-[10px] font-bold text-white">日足</span>
          daily — WF安定性ベース
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-slate-700">
                <th className="px-3 py-1.5 text-left text-xs font-semibold text-gray-500 dark:text-slate-400">戦略</th>
                <th className="px-3 py-1.5 text-left text-xs font-semibold text-gray-500 dark:text-slate-400">パラメータ値</th>
                <th className="px-3 py-1.5 text-left text-xs font-semibold text-gray-500 dark:text-slate-400">決定方法</th>
              </tr>
            </thead>
            <tbody>
              {PRESET_DATA.map((r) => (
                <tr key={r.strategyName} className="border-b border-gray-100 dark:border-slate-700/50">
                  <td className="px-3 py-1.5 font-medium text-gray-900 dark:text-white whitespace-nowrap">{r.strategyName}</td>
                  <td className="px-3 py-1.5 font-mono text-xs text-gray-600 dark:text-slate-400">{r.daily}</td>
                  <td className="px-3 py-1.5">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${sourceColor[r.source]}`}>
                      {sourceLabel[r.source]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Weekly */}
      <div>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
          <span className="inline-block rounded bg-purple-500 px-2 py-0.5 text-[10px] font-bold text-white">週足</span>
          weekly — グリッドサーチ in-sample
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-slate-700">
                <th className="px-3 py-1.5 text-left text-xs font-semibold text-gray-500 dark:text-slate-400">戦略</th>
                <th className="px-3 py-1.5 text-left text-xs font-semibold text-gray-500 dark:text-slate-400">パラメータ値</th>
              </tr>
            </thead>
            <tbody>
              {PRESET_DATA.filter((r) => r.weekly !== null).map((r) => (
                <tr key={r.strategyName} className="border-b border-gray-100 dark:border-slate-700/50">
                  <td className="px-3 py-1.5 font-medium text-gray-900 dark:text-white whitespace-nowrap">{r.strategyName}</td>
                  <td className="px-3 py-1.5 font-mono text-xs text-gray-600 dark:text-slate-400">{r.weekly}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Legend */}
      <div className="rounded-lg bg-gray-50 p-3 dark:bg-slate-700/30">
        <h3 className="text-xs font-semibold text-gray-900 dark:text-white">決定方法</h3>
        <div className="mt-1.5 flex flex-wrap gap-3">
          <div className="flex items-center gap-1.5">
            <span className="inline-block rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-900/40 dark:text-green-300">WF安定性</span>
            <span className="text-[11px] text-gray-500 dark:text-slate-400">ウォークフォワード分析で選定</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">グリッドサーチ</span>
            <span className="text-[11px] text-gray-500 dark:text-slate-400">in-sample最適化で選定</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-gray-700 dark:text-gray-400">固定</span>
            <span className="text-[11px] text-gray-500 dark:text-slate-400">パラメータなし</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Component: Slack Notification Config
// ============================================================

interface SlackStrategyRow {
  strategyName: string;
  strategyId: string;
  params: string;
  entryLogic: string;
  takeProfitLogic: string;
  stopLossLogic: string;
}

const SLACK_STRATEGIES: SlackStrategyRow[] = [
  {
    strategyName: "RSI逆張り",
    strategyId: "rsi_reversal",
    params: "period=5, oversold=37, overbought=70, atrPeriod=14, atrMultiple=2, stopLoss=5%",
    entryLogic: "RSI(5) < 37 で売られすぎ → 買い",
    takeProfitLogic: "RSI > 70 で利確",
    stopLossLogic: "ATR(14)×2 or -5% の厳しい方",
  },
  {
    strategyName: "MACDトレーリング",
    strategyId: "macd_trail",
    params: "short=5, long=23, signal=3, trail=12%, stopLoss=15%",
    entryLogic: "MACD(5,23,3) ゴールデンクロス → 買い",
    takeProfitLogic: "トレーリングストップ 12%（高値追従）",
    stopLossLogic: "-15%（初期損切）",
  },
  {
    strategyName: "急落買い",
    strategyId: "dip_buy",
    params: "dip=3%, recovery=39%, stopLoss=5%",
    entryLogic: "直近高値から -3% 下落 → 買い",
    takeProfitLogic: "+39% 回復で利確",
    stopLossLogic: "-5%",
  },
  {
    strategyName: "田端式CWH",
    strategyId: "tabata_cwh",
    params: "takeProfit=20%, stopLoss=8%",
    entryLogic: "Cup with Handle ブレイクアウト → 買い",
    takeProfitLogic: "+20%",
    stopLossLogic: "-8%",
  },
];

function SlackNotificationConfig() {
  return (
    <div className="space-y-4">
      {/* Strategy cards */}
      <div className="grid gap-3 sm:grid-cols-2">
        {SLACK_STRATEGIES.map((s) => (
          <div key={s.strategyId} className="rounded-lg border border-gray-200 dark:border-slate-700">
            <div className="border-b border-gray-100 px-4 py-2.5 dark:border-slate-700">
              <h3 className="font-semibold text-gray-900 dark:text-white">{s.strategyName}</h3>
              <p className="mt-0.5 font-mono text-[11px] text-gray-500 dark:text-slate-400">{s.params}</p>
            </div>
            <div className="space-y-1.5 px-4 py-3">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 inline-block rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                  買い
                </span>
                <span className="text-xs text-gray-700 dark:text-slate-300">{s.entryLogic}</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-0.5 inline-block rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-900/40 dark:text-green-300">
                  利確
                </span>
                <span className="text-xs text-gray-700 dark:text-slate-300">{s.takeProfitLogic}</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-0.5 inline-block rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-900/40 dark:text-red-300">
                  損切
                </span>
                <span className="text-xs text-gray-700 dark:text-slate-300">{s.stopLossLogic}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* General settings */}
      <div className="rounded-lg bg-gray-50 p-4 dark:bg-slate-700/30">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">通知条件</h3>
        <div className="mt-2 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-700 dark:text-slate-300">対象銘柄:</span>
            <span className="text-gray-600 dark:text-slate-400">お気に入りのみ</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-700 dark:text-slate-300">時間軸:</span>
            <span className="inline-block rounded bg-blue-500 px-1.5 py-0.5 text-[10px] font-bold text-white">日足</span>
            <span className="text-gray-600 dark:text-slate-400">のみ</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-700 dark:text-slate-300">検出期間:</span>
            <span className="text-gray-600 dark:text-slate-400">直近7日間</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-700 dark:text-slate-300">通知条件:</span>
            <span className="text-gray-600 dark:text-slate-400">いずれかの戦略でシグナル発生 (OR)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-700 dark:text-slate-300">ポジションサイズ:</span>
            <span className="text-gray-600 dark:text-slate-400">10万円 / 100株単位</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-700 dark:text-slate-300">分析パイプライン:</span>
            <span className="text-gray-600 dark:text-slate-400">ニュース → ファンダ → Go/NoGo判定</span>
          </div>
        </div>
      </div>

      {/* Selection rationale */}
      <div className="rounded-r-lg border-l-4 border-l-violet-500 bg-violet-50 p-3 text-sm text-gray-800 dark:bg-violet-900/20 dark:text-gray-200">
        日足でのWF安定性・全銘柄バックテスト成績の上位4戦略を選定。
        RSI逆張り(安定性0.859, 全銘柄+61.5%)、MACDトレーリング(+42.0%)、急落買い(+36.5%)はリターン上位。
        田端式CWH(勝率79.5%)は勝率の高さで採用。
      </div>
    </div>
  );
}

// ============================================================
// Component: Full Backtest Ranking Table
// ============================================================

const FULL_BT_YEARS = ["2016", "2017", "2018", "2019", "2020", "2021", "2022", "2023", "2024", "2025"];

function FullBacktestRanking({ rankings }: { rankings: FullBacktestStrategy[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] text-sm">
        <thead>
          <tr className="border-b border-gray-200 dark:border-slate-700">
            <th className="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">#</th>
            <th className="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">戦略</th>
            <th className="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">パラメータ</th>
            <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">取引数</th>
            <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">勝率</th>
            <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">中央値Return</th>
            <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">Sharpe</th>
            <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">MaxDD</th>
            <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">プラス率</th>
          </tr>
        </thead>
        <tbody>
          {rankings.map((s) => (
            <tr key={s.strategyId} className={`border-b border-gray-100 dark:border-slate-700/50 ${s.medianReturn < 0 ? "opacity-60" : ""}`}>
              <td className="px-2 py-2 font-medium text-gray-700 dark:text-slate-300">{s.rank}</td>
              <td className="px-2 py-2 font-medium text-gray-900 dark:text-white whitespace-nowrap">{s.strategyName}</td>
              <td className="px-2 py-2 text-xs font-mono text-gray-600 dark:text-slate-400 whitespace-nowrap">{s.params}</td>
              <td className="px-2 py-2 text-right font-mono text-xs text-gray-600 dark:text-slate-400">{s.trades}</td>
              <td className="px-2 py-2 text-right font-mono text-xs text-gray-700 dark:text-slate-300">{s.winRate}%</td>
              <td className={`px-2 py-2 text-right font-mono text-sm font-semibold ${s.medianReturn > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                {fmtPct(s.medianReturn)}
              </td>
              <td className="px-2 py-2 text-right font-mono text-xs text-gray-700 dark:text-slate-300">{s.sharpeMedian.toFixed(3)}</td>
              <td className="px-2 py-2 text-right font-mono text-xs text-red-600 dark:text-red-400">{s.maxDDMedian}%</td>
              <td className="px-2 py-2 text-right font-mono text-xs text-gray-700 dark:text-slate-300">{s.positiveRate}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================
// Component: Yearly Return Heatmap (10yr)
// ============================================================

function YearlyHeatmap() {
  const { yearlyReturns } = fullBacktestData;

  function yearColor(v: number): string {
    if (v >= 30) return "bg-green-600 text-white";
    if (v >= 10) return "bg-green-500 text-white";
    if (v > 1) return "bg-green-300 dark:bg-green-700 text-green-900 dark:text-green-100";
    if (v > -1) return "bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200";
    if (v >= -10) return "bg-red-300 dark:bg-red-700 text-red-900 dark:text-red-100";
    return "bg-red-500 text-white";
  }

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[700px]">
        {/* Header */}
        <div className="mb-1 grid gap-1" style={{ gridTemplateColumns: `130px repeat(${FULL_BT_YEARS.length}, 1fr)` }}>
          <div />
          {FULL_BT_YEARS.map((y) => (
            <div key={y} className="text-center text-xs font-semibold text-gray-600 dark:text-slate-300">
              {`'${y.slice(2)}`}
            </div>
          ))}
        </div>
        {/* Rows */}
        {yearlyReturns.map((s) => (
          <div
            key={s.strategyId}
            className="mb-1 grid gap-1"
            style={{ gridTemplateColumns: `130px repeat(${FULL_BT_YEARS.length}, 1fr)` }}
          >
            <div className="flex items-center text-xs font-medium text-gray-700 dark:text-slate-300 truncate pr-1">
              {s.strategyName}
            </div>
            {FULL_BT_YEARS.map((year) => {
              const v = s.returns[year] ?? 0;
              // 急落買い2023年の外れ値を特別表示
              const isOutlier = v > 100;
              return (
                <div
                  key={year}
                  className={`flex items-center justify-center rounded px-1 py-2 text-xs font-mono font-medium ${isOutlier ? "bg-green-700 text-white" : yearColor(v)}`}
                  title={isOutlier ? `${v}% (外れ値)` : undefined}
                >
                  {isOutlier ? `${v}*` : v === 0 ? "0" : (v > 0 ? "+" : "") + v}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10px] text-gray-400 dark:text-slate-500">
        * 急落買い2023年の+651%は少数銘柄の外れ値。単位: 年間リターン%（銘柄平均）
      </p>
    </div>
  );
}

// ============================================================
// Component: Full Backtest Insights
// ============================================================

function FullBacktestInsights() {
  const { insights } = fullBacktestData;
  return (
    <div className="space-y-2">
      {insights.map((text, i) => (
        <div
          key={i}
          className={`rounded-r-lg border-l-4 p-3 text-sm text-gray-800 dark:text-gray-200 ${
            i === 0 ? "border-l-green-500 bg-green-50 dark:bg-green-900/20" :
            i <= 1 ? "border-l-blue-500 bg-blue-50 dark:bg-blue-900/20" :
            "border-l-amber-500 bg-amber-50 dark:bg-amber-900/20"
          }`}
        >
          {text}
        </div>
      ))}
    </div>
  );
}

// ============================================================
// Component: Favorites vs All Comparison Table
// ============================================================

function ComparisonTable({ rows }: { rows: ComparisonRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[700px] text-sm">
        <thead>
          <tr className="border-b border-gray-200 dark:border-slate-700">
            <th className="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">#</th>
            <th className="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">戦略</th>
            <th className="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">パラメータ</th>
            <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">
              <span className="text-amber-600 dark:text-amber-400">24銘柄</span>
            </th>
            <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">
              <span className="text-blue-600 dark:text-blue-400">全銘柄</span>
            </th>
            <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">差</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.strategyId} className="border-b border-gray-100 dark:border-slate-700/50">
              <td className="px-2 py-2 font-medium text-gray-700 dark:text-slate-300">{r.rank}</td>
              <td className="px-2 py-2 font-medium text-gray-900 dark:text-white whitespace-nowrap">{r.strategyName}</td>
              <td className="px-2 py-2 text-xs font-mono text-gray-600 dark:text-slate-400 whitespace-nowrap">{r.params}</td>
              <td className={`px-2 py-2 text-right font-mono text-sm font-semibold ${r.favReturn > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                {fmtPct(r.favReturn)}
              </td>
              <td className={`px-2 py-2 text-right font-mono text-sm ${r.allReturn > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                {fmtPct(r.allReturn)}
              </td>
              <td className="px-2 py-2 text-right font-mono text-xs text-amber-600 dark:text-amber-400">
                +{r.diff}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================
// Component: Favorites Yearly Heatmap
// ============================================================

function FavoritesYearlyHeatmap() {
  const { yearlyReturns } = fullBacktestData.favorites;

  function yearColor(v: number): string {
    if (v >= 30) return "bg-green-600 text-white";
    if (v >= 10) return "bg-green-500 text-white";
    if (v > 1) return "bg-green-300 dark:bg-green-700 text-green-900 dark:text-green-100";
    if (v > -1) return "bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200";
    if (v >= -10) return "bg-red-300 dark:bg-red-700 text-red-900 dark:text-red-100";
    return "bg-red-500 text-white";
  }

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[700px]">
        {/* Header */}
        <div className="mb-1 grid gap-1" style={{ gridTemplateColumns: `130px repeat(${FULL_BT_YEARS.length}, 1fr)` }}>
          <div />
          {FULL_BT_YEARS.map((y) => (
            <div key={y} className="text-center text-xs font-semibold text-gray-600 dark:text-slate-300">
              {`'${y.slice(2)}`}
            </div>
          ))}
        </div>
        {/* Rows */}
        {yearlyReturns.map((s) => (
          <div
            key={s.strategyId}
            className="mb-1 grid gap-1"
            style={{ gridTemplateColumns: `130px repeat(${FULL_BT_YEARS.length}, 1fr)` }}
          >
            <div className="flex items-center text-xs font-medium text-gray-700 dark:text-slate-300 truncate pr-1">
              {s.strategyName}
            </div>
            {FULL_BT_YEARS.map((year) => {
              const v = s.returns[year] ?? 0;
              return (
                <div
                  key={year}
                  className={`flex items-center justify-center rounded px-1 py-2 text-xs font-mono font-medium ${yearColor(v)}`}
                >
                  {v === 0 ? "0" : (v > 0 ? "+" : "") + v}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// Component: CWH × 52週高値フィルタ分析
// ============================================================

const CWH52W_GROUP_COLORS: Record<string, string> = {
  "全CWHシグナル": "#94a3b8",     // gray
  "52週高値付近のみ": "#22c55e",  // green
  "52週高値以外": "#ef4444",      // red
};

function Cwh52wComparisonTable({ modes }: { modes: Cwh52wMode[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[800px] text-sm">
        <thead>
          <tr className="border-b border-gray-200 dark:border-slate-700">
            <th className="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">モード</th>
            <th className="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">グループ</th>
            <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">件数</th>
            <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">勝率</th>
            <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">平均リターン</th>
            <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">平均勝ち</th>
            <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">平均負け</th>
            <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">PF</th>
          </tr>
        </thead>
        <tbody>
          {modes.map((mode) =>
            mode.groups.map((g, gi) => {
              const is52w = g.label === "52週高値付近のみ";
              const isNon52w = g.label === "52週高値以外";
              return (
                <tr
                  key={`${mode.modeShort}-${gi}`}
                  className={`border-b border-gray-100 dark:border-slate-700/50 ${is52w ? "bg-green-50/50 dark:bg-green-900/10" : ""} ${isNon52w && g.pf < 1 ? "opacity-60" : ""}`}
                >
                  {gi === 0 && (
                    <td className="px-2 py-2 font-medium text-gray-900 dark:text-white whitespace-nowrap" rowSpan={3}>
                      <div>{mode.modeShort}</div>
                      <div className="text-[10px] text-gray-400 dark:text-slate-500">{mode.description}</div>
                    </td>
                  )}
                  <td className={`px-2 py-2 whitespace-nowrap ${is52w ? "font-semibold text-green-700 dark:text-green-400" : "text-gray-700 dark:text-slate-300"}`}>
                    {g.label}
                  </td>
                  <td className="px-2 py-2 text-right font-mono text-xs text-gray-600 dark:text-slate-400">
                    {g.trades.toLocaleString()}
                  </td>
                  <td className={`px-2 py-2 text-right font-mono text-sm ${is52w ? "font-semibold text-green-600 dark:text-green-400" : "text-gray-700 dark:text-slate-300"}`}>
                    {g.winRate.toFixed(1)}%
                  </td>
                  <td className={`px-2 py-2 text-right font-mono text-sm font-semibold ${g.avgReturn > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                    {fmtPct(g.avgReturn)}
                  </td>
                  <td className="px-2 py-2 text-right font-mono text-xs text-green-600 dark:text-green-400">
                    +{g.avgWin.toFixed(1)}%
                  </td>
                  <td className="px-2 py-2 text-right font-mono text-xs text-red-600 dark:text-red-400">
                    {g.avgLoss.toFixed(1)}%
                  </td>
                  <td className={`px-2 py-2 text-right font-mono text-sm ${is52w ? "font-bold" : "font-semibold"} ${g.pf >= 1.5 ? "text-green-600 dark:text-green-400" : g.pf >= 1.0 ? "text-gray-700 dark:text-slate-300" : "text-red-600 dark:text-red-400"}`}>
                    {g.pf.toFixed(2)}
                  </td>
                </tr>
              );
            }),
          )}
        </tbody>
      </table>
    </div>
  );
}

function Cwh52wPfChart({ modes }: { modes: Cwh52wMode[] }) {
  const data = modes.map((m) => ({
    name: m.modeShort,
    全CWH: m.groups[0].pf,
    "52w高値付近": m.groups[1].pf,
    "52w以外": m.groups[2].pf,
  }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ left: 10, right: 10, top: 5, bottom: 5 }}>
        <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#9ca3af" }} />
        <YAxis domain={[0, 2.2]} tickCount={6} tick={{ fontSize: 10, fill: "#9ca3af" }} />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [typeof v === "number" ? v.toFixed(2) : v, "PF"]} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="全CWH" fill="#94a3b8" radius={[2, 2, 0, 0]} />
        <Bar dataKey="52w高値付近" fill="#22c55e" radius={[2, 2, 0, 0]} />
        <Bar dataKey="52w以外" fill="#ef4444" radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function Cwh52wPortfolioCards({ modes }: { modes: Cwh52wMode[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {modes.map((m) => {
        const p = m.portfolio;
        const isPositive = p.annualReturn > 0;
        return (
          <div key={m.modeShort} className="rounded-lg border border-gray-200 dark:border-slate-700">
            <div className="border-b border-gray-100 px-4 py-2.5 dark:border-slate-700">
              <h3 className="font-semibold text-gray-900 dark:text-white">{m.modeShort}</h3>
              <p className="text-[10px] text-gray-400 dark:text-slate-500">
                初期{p.initialCapital}万 → {p.finalCapital}万 ({p.multiplier}倍)
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 px-4 py-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500">年率リターン</div>
                <div className={`mt-0.5 text-lg font-mono font-bold ${isPositive ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                  {fmtPct(p.annualReturn)}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500">最大DD</div>
                <div className="mt-0.5 text-lg font-mono font-bold text-red-600 dark:text-red-400">
                  {p.maxDD.toFixed(1)}%
                </div>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500">勝率</div>
                <div className="mt-0.5 font-mono text-sm font-semibold text-gray-700 dark:text-slate-300">
                  {p.winRate.toFixed(1)}%
                </div>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500">実行/見送り</div>
                <div className="mt-0.5 font-mono text-sm text-gray-600 dark:text-slate-400">
                  {p.executedTrades}/{p.skippedSignals}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// Main Page
// ============================================================

export default function ReportsPage() {
  const { config, strategies, windows } = wfReportData;
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [radarIds, setRadarIds] = useState<Set<string>>(
    new Set(strategies.slice(0, 3).map((s) => s.strategyId)),
  );

  const sortedStrategies = useMemo(() => {
    const arr = [...strategies];
    switch (sortKey) {
      case "score": arr.sort((a, b) => b.stabilityScore - a.stabilityScore); break;
      case "return": arr.sort((a, b) => b.testReturnMedian - a.testReturnMedian); break;
      case "winRate": arr.sort((a, b) => b.testWinRate - a.testWinRate); break;
      case "overfit": arr.sort((a, b) => Math.abs(a.overfitDegree) - Math.abs(b.overfitDegree)); break;
    }
    return arr;
  }, [strategies, sortKey]);

  const toggleRadar = (id: string) => {
    setRadarIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          バックテスト分析レポート
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
          10年間 (2016-2025) のバックテスト結果を統合分析
        </p>
      </div>

      {/* ======== Full Backtest Section ======== */}
      <div className="rounded-lg border-2 border-blue-200 bg-blue-50/50 px-4 py-3 dark:border-blue-800 dark:bg-blue-900/20">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">
          全銘柄バックテスト (3,757銘柄 × 10年間)
        </h2>
        <p className="text-sm text-gray-500 dark:text-slate-400">
          WF推奨パラメータで全東証上場銘柄に適用した結果
        </p>
      </div>

      {/* Full Backtest Ranking */}
      <Section title="戦略別パフォーマンス" subtitle="中央値リターン降順 | 全3,757銘柄 × 12戦略">
        <FullBacktestRanking rankings={fullBacktestData.rankings} />
      </Section>

      {/* Yearly Returns Heatmap */}
      <Section title="年別平均リターン" subtitle="主要戦略の年次パフォーマンス推移">
        <YearlyHeatmap />
      </Section>

      {/* Full Backtest Insights */}
      <Section title="全銘柄バックテストの知見">
        <FullBacktestInsights />
      </Section>

      {/* ======== Favorites vs All Comparison ======== */}
      <div className="rounded-lg border-2 border-amber-200 bg-amber-50/50 px-4 py-3 dark:border-amber-800 dark:bg-amber-900/20">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">
          お気に入り{fullBacktestData.favorites.stocks}銘柄 vs 全銘柄 比較
        </h2>
        <p className="text-sm text-gray-500 dark:text-slate-400">
          銘柄選定の効果を検証 — 同一パラメータでのリターン差
        </p>
      </div>

      {/* Comparison Table */}
      <Section title="10年間パフォーマンス比較" subtitle={`お気に入り${fullBacktestData.favorites.stocks}銘柄 vs 全3,757銘柄 — 中央値Return%`}>
        <ComparisonTable rows={fullBacktestData.favorites.comparison} />
        <div className="mt-3 rounded-r-lg border-l-4 border-l-amber-500 bg-amber-50 p-3 text-sm text-gray-800 dark:bg-amber-900/20 dark:text-gray-200">
          全戦略でお気に入り銘柄が全銘柄を上回る。銘柄選定の効果は上位戦略ほど顕著（MACDトレーリング: +282pt差）
        </div>
      </Section>

      {/* Favorites Yearly Returns */}
      <Section title={`お気に入り${fullBacktestData.favorites.stocks}銘柄の年別リターン`} subtitle="上位5戦略の年次パフォーマンス">
        <FavoritesYearlyHeatmap />
      </Section>

      {/* ======== Slack Notification Section ======== */}
      <div className="rounded-lg border-2 border-violet-200 bg-violet-50/50 px-4 py-3 dark:border-violet-800 dark:bg-violet-900/20">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">
          Slack通知設定 (実運用)
        </h2>
        <p className="text-sm text-gray-500 dark:text-slate-400">
          シグナル検出 → 分析パイプライン → Slack通知の対象戦略とパラメータ
        </p>
      </div>

      {/* Slack Notification Config */}
      <Section title="通知対象の4戦略" subtitle="日足シグナル × お気に入り銘柄 | エントリー・利確・損切ロジック">
        <SlackNotificationConfig />
      </Section>

      {/* ======== CWH × 52週高値フィルタ Section ======== */}
      <div className="rounded-lg border-2 border-teal-200 bg-teal-50/50 px-4 py-3 dark:border-teal-800 dark:bg-teal-900/20">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">
          CWH × 52週高値フィルタ分析
        </h2>
        <p className="text-sm text-gray-500 dark:text-slate-400">
          CWHブレイクアウト時に52週高値付近かどうかでフィルタリングした成績比較 | 全3,775銘柄 × 3年間
        </p>
      </div>

      {/* CWH 52w Insights */}
      <Section title="フィルタ効果サマリー">
        <div className="space-y-2">
          <div className="rounded-r-lg border-l-4 border-l-green-500 bg-green-50 p-3 text-sm text-gray-800 dark:bg-green-900/20 dark:text-gray-200">
            52週高値付近のCWHは全モードで勝率+7〜13pt、PF 1.75〜1.91に改善。1トレード平均リターンは+2.4〜4.8%（全CWH比 2〜3倍）
          </div>
          <div className="rounded-r-lg border-l-4 border-l-blue-500 bg-blue-50 p-3 text-sm text-gray-800 dark:bg-blue-900/20 dark:text-gray-200">
            建値撤退モードでは52週高値以外がPF 0.96（負け越し）に対し、52週高値付近のみPF 1.91。フィルタなしでは使えない戦略がフィルタで有効に
          </div>
          <div className="rounded-r-lg border-l-4 border-l-amber-500 bg-amber-50 p-3 text-sm text-gray-800 dark:bg-amber-900/20 dark:text-gray-200">
            ポートフォリオシム（5ポジション制限・100万/ポジション）ではTP20/SL8が年率19.8%で最も安定。トレーリング8%は年率8.2%
          </div>
        </div>
      </Section>

      {/* CWH 52w Comparison Table */}
      <Section title="52週高値フィルタ比較" subtitle="3つのイグジットモード × 全CWH / 52w付近 / 52w以外">
        <Cwh52wComparisonTable modes={cwh52wComparison} />
      </Section>

      {/* CWH 52w PF Chart */}
      <Section title="プロフィットファクター比較" subtitle="52週高値フィルタの有無によるPFの差">
        <Cwh52wPfChart modes={cwh52wComparison} />
      </Section>

      {/* CWH 52w Portfolio Sim */}
      <Section title="ポートフォリオシミュレーション" subtitle="初期500万・1ポジション100万・最大5同時保有 | 52週高値フィルタ適用">
        <Cwh52wPortfolioCards modes={cwh52wComparison} />
        <div className="mt-3 rounded-lg bg-gray-50 p-3 dark:bg-slate-700/30">
          <h3 className="text-xs font-semibold text-gray-900 dark:text-white">シミュレーション条件</h3>
          <div className="mt-1.5 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <div><span className="font-medium text-gray-700 dark:text-slate-300">初期資金:</span> <span className="text-gray-600 dark:text-slate-400">500万円</span></div>
            <div><span className="font-medium text-gray-700 dark:text-slate-300">1ポジション:</span> <span className="text-gray-600 dark:text-slate-400">100万円</span></div>
            <div><span className="font-medium text-gray-700 dark:text-slate-300">最大同時保有:</span> <span className="text-gray-600 dark:text-slate-400">5</span></div>
            <div><span className="font-medium text-gray-700 dark:text-slate-300">52w高値判定:</span> <span className="text-gray-600 dark:text-slate-400">0.5%許容</span></div>
          </div>
        </div>
      </Section>

      {/* ======== Walk-Forward Section ======== */}
      <div className="rounded-lg border-2 border-green-200 bg-green-50/50 px-4 py-3 dark:border-green-800 dark:bg-green-900/20">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">
          ウォークフォワード分析 (22銘柄 × 7窓)
        </h2>
        <p className="text-sm text-gray-500 dark:text-slate-400">
          {config.trainYears}年訓練 → {config.testYears}年検証 | {config.paramCombos.toLocaleString()} パラメータ組合せ
        </p>
      </div>

      {/* Key Findings */}
      <Section title="主要な発見 (WF分析)">
        <KeyFindings strategies={strategies} />
      </Section>

      {/* Strategy Ranking */}
      <Section title="戦略ランキング" subtitle="WF安定性スコアに基づく戦略評価">
        <StabilityBarChart strategies={sortedStrategies} />
        <div className="mt-4">
          <RankingTable strategies={sortedStrategies} sortKey={sortKey} onSort={setSortKey} />
        </div>
      </Section>

      {/* Radar Chart */}
      <Section title="多角的比較" subtitle="安定性・リターン・勝率・過学習・一貫性の5軸で比較">
        <StrategyRadar strategies={strategies} selectedIds={radarIds} onToggle={toggleRadar} />
      </Section>

      {/* Window Heatmap */}
      <Section
        title="ウィンドウ別テストリターン"
        subtitle="各検証期間での推奨パラメータによるリターン（銘柄中央値）"
      >
        <WindowHeatmap strategies={strategies} />
      </Section>

      {/* Strategy Details */}
      <Section title="戦略詳細" subtitle="各戦略の推奨パラメータとウィンドウ別リターン">
        <div className="space-y-2">
          {strategies.map((s, i) => (
            <StrategyDetailCard key={s.strategyId} strategy={s} rank={i + 1} />
          ))}
        </div>
      </Section>

      {/* Current Presets */}
      <Section title="運用パラメータ一覧" subtitle="現在使用中のパラメータ値（日足: WF安定性ベース / 週足: グリッドサーチ in-sample）" collapsible defaultOpen={false}>
        <CurrentPresetsTable />
      </Section>

      {/* Strategy Parameter Reference */}
      <Section title="戦略パラメータ詳細" subtitle="各戦略のパラメータ定義とエントリー/利確/損切ロジック" collapsible defaultOpen={false}>
        <StrategyParamReference />
      </Section>

      {/* Methodology */}
      <Section title="分析方法論" collapsible defaultOpen={false}>
        <div className="space-y-3 text-sm text-gray-700 dark:text-slate-300">
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white">ウォークフォワード分析とは</h3>
            <p className="mt-1">
              過去データの一部(訓練期間)でパラメータを最適化し、残りの未知データ(検証期間)で性能を検証する手法。
              訓練期間と検証期間をスライドさせながら繰り返すことで、パラメータの堅牢性を評価する。
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white">複合スコア計算式</h3>
            <div className="mt-1 rounded bg-gray-50 px-3 py-2 font-mono text-xs dark:bg-slate-700">
              Score = 0.4 × テスト中央値(正規化) + 0.3 × テスト最小値(正規化) + 0.2 × (1 - 標準偏差正規化) + 0.1 × (1 - 過学習度正規化)
            </div>
            <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
              各指標は戦略内のパラメータ組合せ間でmin-max正規化。スコアが高いほど安定したパラメータ。
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white">注意事項</h3>
            <ul className="mt-1 list-inside list-disc space-y-1 text-xs text-gray-500 dark:text-slate-400">
              <li>安定性スコアは戦略内の相対評価。異なる戦略間での直接比較には注意が必要</li>
              <li>22銘柄(お気に入り, 主に大型株)での評価。中小型株では異なる結果になる可能性</li>
              <li>取引コスト(手数料・スリッページ)は含まれていない</li>
            </ul>
          </div>
        </div>
      </Section>
    </div>
  );
}

"use client";

import { useState, useMemo, useCallback } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ReferenceDot,
} from "recharts";
import type { PriceData } from "@/types";
import { strategies } from "@/lib/backtest/strategies";
import { runBacktest } from "@/lib/backtest/engine";
import type { BacktestResult, StrategyDef } from "@/lib/backtest/types";

interface BacktestPanelProps {
  data: PriceData[];
  symbol: string;
}

export default function BacktestPanel({ data, symbol }: BacktestPanelProps) {
  const [selectedStrategyId, setSelectedStrategyId] = useState(strategies[0].id);
  const [paramValues, setParamValues] = useState<Record<string, number>>({});
  const [capital, setCapital] = useState(1000000);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [showTrades, setShowTrades] = useState(false);

  // データの日付範囲
  const dataRange = useMemo(() => {
    if (data.length === 0) return { first: "", last: "" };
    return { first: data[0].date, last: data[data.length - 1].date };
  }, [data]);

  // 期間フィルタ適用後のデータ
  const filteredData = useMemo(() => {
    let d = data;
    if (startDate) d = d.filter((p) => p.date >= startDate);
    if (endDate) d = d.filter((p) => p.date <= endDate);
    return d;
  }, [data, startDate, endDate]);

  const strategy = useMemo(
    () => strategies.find((s) => s.id === selectedStrategyId) ?? strategies[0],
    [selectedStrategyId]
  );

  // 戦略変更時にデフォルトパラメータをセット
  const handleStrategyChange = useCallback(
    (id: string) => {
      setSelectedStrategyId(id);
      setResult(null);
      const strat = strategies.find((s) => s.id === id);
      if (strat) {
        const defaults: Record<string, number> = {};
        strat.params.forEach((p) => {
          defaults[p.key] = p.default;
        });
        setParamValues(defaults);
      }
    },
    []
  );

  // 初回マウント時にデフォルト値をセット
  useMemo(() => {
    const defaults: Record<string, number> = {};
    strategy.params.forEach((p) => {
      defaults[p.key] = p.default;
    });
    setParamValues(defaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRun = () => {
    if (filteredData.length === 0) return;
    const r = runBacktest(filteredData, strategy, paramValues, capital);
    setResult(r);
  };

  // Buy & Hold比較用
  const buyHoldReturn = useMemo(() => {
    if (filteredData.length < 2) return 0;
    return ((filteredData[filteredData.length - 1].close - filteredData[0].close) / filteredData[0].close) * 100;
  }, [filteredData]);

  return (
    <div className="space-y-4">
      {/* 戦略選択・パラメータ設定 */}
      <div className="rounded-lg bg-white dark:bg-slate-800 p-4 shadow dark:shadow-slate-900/50">
        <h3 className="mb-3 text-lg font-semibold text-gray-900 dark:text-white">
          バックテスト設定
        </h3>

        {/* 戦略選択 */}
        <div className="mb-3">
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-slate-300">
            戦略
          </label>
          <select
            value={selectedStrategyId}
            onChange={(e) => handleStrategyChange(e.target.value)}
            className="w-full rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
          >
            {strategies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
            {strategy.description}
          </p>
        </div>

        {/* パラメータ */}
        <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {strategy.params.map((p) => (
            <div key={p.key}>
              <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">
                {p.label}
              </label>
              <input
                type="number"
                min={p.min}
                max={p.max}
                step={p.step ?? 1}
                value={paramValues[p.key] ?? p.default}
                onChange={(e) =>
                  setParamValues((prev) => ({
                    ...prev,
                    [p.key]: Number(e.target.value),
                  }))
                }
                className="w-full rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-2 py-1.5 text-sm text-gray-900 dark:text-white"
              />
            </div>
          ))}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">
              初期資金
            </label>
            <input
              type="number"
              min={100000}
              step={100000}
              value={capital}
              onChange={(e) => setCapital(Number(e.target.value))}
              className="w-full rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-2 py-1.5 text-sm text-gray-900 dark:text-white"
            />
          </div>
        </div>

        {/* 期間指定 */}
        <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">
              開始日
            </label>
            <input
              type="date"
              value={startDate}
              min={dataRange.first}
              max={endDate || dataRange.last}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-2 py-1.5 text-sm text-gray-900 dark:text-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">
              終了日
            </label>
            <input
              type="date"
              value={endDate}
              min={startDate || dataRange.first}
              max={dataRange.last}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-2 py-1.5 text-sm text-gray-900 dark:text-white"
            />
          </div>
          <div className="col-span-2 flex items-end gap-2">
            {(startDate || endDate) && (
              <button
                onClick={() => { setStartDate(""); setEndDate(""); }}
                className="rounded px-2 py-1.5 text-xs text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-700"
              >
                期間リセット
              </button>
            )}
            <span className="py-1.5 text-xs text-gray-400 dark:text-slate-500">
              {dataRange.first && `${dataRange.first} 〜 ${dataRange.last}`}
            </span>
          </div>
        </div>

        {/* 実行ボタン */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleRun}
            disabled={filteredData.length === 0}
            className="rounded-lg bg-emerald-500 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50 transition"
          >
            バックテスト実行
          </button>
          <span className="text-xs text-gray-400 dark:text-slate-500">
            データ: {filteredData.length}本{filteredData.length !== data.length && ` (全${data.length}本中)`}
          </span>
        </div>
      </div>

      {/* 結果表示 */}
      {result && (
        <>
          {/* サマリーカード */}
          <StatsGrid result={result} buyHoldReturn={buyHoldReturn} />

          {/* エクイティカーブ */}
          <EquityCurve result={result} />

          {/* 取引履歴 */}
          <div className="rounded-lg bg-white dark:bg-slate-800 p-4 shadow dark:shadow-slate-900/50">
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
                取引履歴 ({result.trades.length}件)
              </h4>
              <button
                onClick={() => setShowTrades((v) => !v)}
                className="text-xs text-blue-500 hover:underline"
              >
                {showTrades ? "閉じる" : "展開"}
              </button>
            </div>
            {showTrades && <TradeTable trades={result.trades} />}
          </div>
        </>
      )}
    </div>
  );
}

/* ─── サマリーグリッド ─── */
function StatsGrid({
  result,
  buyHoldReturn,
}: {
  result: BacktestResult;
  buyHoldReturn: number;
}) {
  const s = result.stats;
  const items: { label: string; value: string; color?: string }[] = [
    {
      label: "総損益",
      value: `${s.totalReturn >= 0 ? "+" : ""}${Math.round(s.totalReturn).toLocaleString()}円`,
      color: s.totalReturn >= 0 ? "text-green-600" : "text-red-600",
    },
    {
      label: "リターン",
      value: `${s.totalReturnPct >= 0 ? "+" : ""}${s.totalReturnPct.toFixed(2)}%`,
      color: s.totalReturnPct >= 0 ? "text-green-600" : "text-red-600",
    },
    {
      label: "B&Hリターン",
      value: `${buyHoldReturn >= 0 ? "+" : ""}${buyHoldReturn.toFixed(2)}%`,
      color: buyHoldReturn >= 0 ? "text-green-600" : "text-red-600",
    },
    {
      label: "勝率",
      value: `${s.winRate.toFixed(1)}%`,
      color: s.winRate >= 50 ? "text-green-600" : "text-amber-600",
    },
    {
      label: "取引回数",
      value: `${s.numTrades}回 (${s.numWins}勝${s.numLosses}敗)`,
    },
    {
      label: "最大DD",
      value: `-${s.maxDrawdownPct.toFixed(2)}%`,
      color: "text-red-600",
    },
    {
      label: "シャープレシオ",
      value: s.sharpeRatio === 0 ? "-" : s.sharpeRatio.toFixed(2),
      color: s.sharpeRatio >= 1 ? "text-green-600" : s.sharpeRatio >= 0 ? "text-amber-600" : "text-red-600",
    },
    {
      label: "PF",
      value: s.profitFactor === Infinity ? "∞" : s.profitFactor.toFixed(2),
      color: s.profitFactor >= 1.5 ? "text-green-600" : s.profitFactor >= 1 ? "text-amber-600" : "text-red-600",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-lg bg-white dark:bg-slate-800 p-3 shadow dark:shadow-slate-900/50"
        >
          <div className="text-xs text-gray-500 dark:text-slate-400">
            {item.label}
          </div>
          <div
            className={`mt-1 text-sm font-bold ${
              item.color ?? "text-gray-900 dark:text-white"
            }`}
          >
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── エクイティカーブ ─── */
function EquityCurve({ result }: { result: BacktestResult }) {
  const chartData = useMemo(() => {
    // 間引き（300点以下にする）
    const eq = result.equity;
    const step = Math.max(1, Math.floor(eq.length / 300));
    const points = eq.filter((_, i) => i % step === 0 || i === eq.length - 1);

    // Buy & Holdライン
    const firstPrice = result.equity[0]?.equity ?? result.initialCapital;
    return points.map((e) => ({
      date: e.date,
      equity: Math.round(e.equity),
      buyHold: Math.round(
        (result.initialCapital * (e.equity / firstPrice))
      ),
      drawdown: Math.round(e.drawdown * 10000) / 100,
    }));
  }, [result]);

  // 売買ポイント
  const buyPoints = result.trades
    .filter((t) => t.type === "buy")
    .map((t) => t.date);
  const sellPoints = result.trades
    .filter((t) => t.type === "sell")
    .map((t) => t.date);

  return (
    <div className="rounded-lg bg-white dark:bg-slate-800 p-4 shadow dark:shadow-slate-900/50">
      <h4 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">
        エクイティカーブ
      </h4>
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={chartData}>
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: "#9ca3af" }}
            tickFormatter={(v: string) => v.slice(5)}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 10, fill: "#9ca3af" }}
            tickFormatter={(v: number) =>
              v >= 1000000
                ? `${(v / 1000000).toFixed(1)}M`
                : `${(v / 1000).toFixed(0)}K`
            }
            width={55}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "rgba(30,41,59,0.95)",
              border: "none",
              borderRadius: 8,
              fontSize: 12,
              color: "#fff",
            }}
            formatter={(value: number | undefined, name: string | undefined) => [
              `${(value ?? 0).toLocaleString()}円`,
              name === "equity" ? "戦略" : "B&H",
            ]}
            labelFormatter={(label) => String(label)}
          />
          <Legend
            verticalAlign="top"
            height={30}
            formatter={(value: string) =>
              value === "equity" ? "戦略" : "Buy & Hold"
            }
          />
          <Area
            type="monotone"
            dataKey="equity"
            stroke="#10b981"
            fill="#10b98122"
            strokeWidth={2}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="buyHold"
            stroke="#6b7280"
            strokeDasharray="4 4"
            strokeWidth={1.5}
            dot={false}
          />
          {/* 売買ポイント */}
          {chartData.map((d) => {
            if (buyPoints.includes(d.date)) {
              return (
                <ReferenceDot
                  key={`b-${d.date}`}
                  x={d.date}
                  y={d.equity}
                  r={4}
                  fill="#3b82f6"
                  stroke="#fff"
                  strokeWidth={1}
                />
              );
            }
            if (sellPoints.includes(d.date)) {
              return (
                <ReferenceDot
                  key={`s-${d.date}`}
                  x={d.date}
                  y={d.equity}
                  r={4}
                  fill="#ef4444"
                  stroke="#fff"
                  strokeWidth={1}
                />
              );
            }
            return null;
          })}
        </ComposedChart>
      </ResponsiveContainer>
      <div className="mt-1 flex items-center gap-4 text-xs text-gray-400 dark:text-slate-500">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-blue-500" />
          買い
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
          売り
        </span>
      </div>
    </div>
  );
}

/* ─── 取引テーブル ─── */
function TradeTable({ trades }: { trades: BacktestResult["trades"] }) {
  if (trades.length === 0) {
    return (
      <p className="text-sm text-gray-400 dark:text-slate-500">
        取引なし
      </p>
    );
  }

  return (
    <div className="max-h-64 overflow-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-white dark:bg-slate-800">
          <tr className="border-b text-left text-gray-500 dark:text-slate-400">
            <th className="px-2 py-1.5">日付</th>
            <th className="px-2 py-1.5">種別</th>
            <th className="px-2 py-1.5 text-right">価格</th>
            <th className="px-2 py-1.5 text-right">株数</th>
            <th className="px-2 py-1.5 text-right">金額</th>
            <th className="px-2 py-1.5">理由</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t, i) => (
            <tr
              key={`${t.date}-${i}`}
              className="border-b border-gray-50 dark:border-slate-700"
            >
              <td className="px-2 py-1 text-gray-700 dark:text-slate-300">
                {t.date}
              </td>
              <td className="px-2 py-1">
                <span
                  className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${
                    t.type === "buy"
                      ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                      : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                  }`}
                >
                  {t.type === "buy" ? "買" : "売"}
                </span>
              </td>
              <td className="px-2 py-1 text-right text-gray-700 dark:text-slate-300">
                {t.price.toLocaleString()}
              </td>
              <td className="px-2 py-1 text-right text-gray-700 dark:text-slate-300">
                {t.shares.toLocaleString()}
              </td>
              <td className="px-2 py-1 text-right text-gray-700 dark:text-slate-300">
                {t.value.toLocaleString()}
              </td>
              <td className="px-2 py-1 text-gray-500 dark:text-slate-400">
                {t.reason}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

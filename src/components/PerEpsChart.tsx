"use client";

import { useState, useEffect, useCallback } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

interface PerEpsChartProps {
  symbol: string;
}

interface PerPoint {
  date: string;
  per: number | null;
}

interface EpsPoint {
  quarter: string;
  epsActual: number | null;
  epsEstimate: number | null;
}

interface ChartDataPoint {
  date: string;
  per: number | null;
  epsActual?: number | null;
  epsEstimate?: number | null;
}

export default function PerEpsChart({ symbol }: PerEpsChartProps) {
  const [perSeries, setPerSeries] = useState<PerPoint[]>([]);
  const [epsSeries, setEpsSeries] = useState<EpsPoint[]>([]);
  const [ttmEps, setTtmEps] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/per-history?symbol=${encodeURIComponent(symbol)}`
      );
      if (!res.ok) throw new Error("fetch failed");
      const data = await res.json();
      setPerSeries(data.perSeries ?? []);
      setEpsSeries(data.epsSeries ?? []);
      setTtmEps(data.ttmEps ?? null);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="rounded-lg bg-white dark:bg-slate-800 p-4 shadow dark:shadow-slate-900/50">
        <h3 className="mb-4 text-sm font-semibold text-gray-700 dark:text-slate-300">
          PER / EPS 推移
        </h3>
        <div className="flex h-48 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-500" />
        </div>
      </div>
    );
  }

  if (error || perSeries.length === 0) {
    return (
      <div className="rounded-lg bg-white dark:bg-slate-800 p-4 shadow dark:shadow-slate-900/50">
        <h3 className="mb-4 text-sm font-semibold text-gray-700 dark:text-slate-300">
          PER / EPS 推移
        </h3>
        <p className="text-sm text-gray-400 dark:text-slate-500">
          PER/EPSデータを取得できませんでした。
        </p>
      </div>
    );
  }

  // EPS四半期データを日次系列にforward-fill（階段チャート用）
  // 各四半期の値が次の四半期まで継続する
  const sortedEps = [...epsSeries].sort((a, b) => a.quarter.localeCompare(b.quarter));

  const chartData: ChartDataPoint[] = perSeries.map((p) => {
    // この日付以前で最新のEPSを探す
    let currentEps: EpsPoint | null = null;
    for (const e of sortedEps) {
      if (e.quarter <= p.date) {
        currentEps = e;
      } else {
        break;
      }
    }
    return {
      date: p.date,
      per: p.per,
      epsActual: currentEps?.epsActual ?? null,
      epsEstimate: currentEps?.epsEstimate ?? null,
    };
  });

  // PER軸の範囲計算
  const perValues = chartData.map((d) => d.per).filter((v): v is number => v != null);
  const perMin = Math.max(0, Math.floor(Math.min(...perValues) * 0.9));
  const perMax = Math.ceil(Math.max(...perValues) * 1.1);

  // EPS軸の範囲計算
  const epsValues = [
    ...epsSeries.map((e) => e.epsActual),
    ...epsSeries.map((e) => e.epsEstimate),
  ].filter((v): v is number => v != null);
  const epsMin = epsValues.length > 0 ? Math.floor(Math.min(...epsValues) * 0.8) : 0;
  const epsMax = epsValues.length > 0 ? Math.ceil(Math.max(...epsValues) * 1.2) : 100;

  return (
    <div className="rounded-lg bg-white dark:bg-slate-800 p-4 shadow dark:shadow-slate-900/50">
      <div className="mb-4 flex items-center gap-3">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300">
          PER / EPS 推移
        </h3>
        {ttmEps != null && (
          <span className="text-xs text-gray-400 dark:text-slate-500">
            TTM EPS: {ttmEps.toFixed(1)}円
          </span>
        )}
      </div>

      <ResponsiveContainer width="100%" height={250}>
        <ComposedChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10 }}
            tickFormatter={(v) => {
              const d = v.split("-");
              return `${d[1]}/${d[2]}`;
            }}
            interval="preserveStartEnd"
            minTickGap={40}
          />
          <YAxis
            yAxisId="per"
            orientation="left"
            domain={[perMin, perMax]}
            tick={{ fontSize: 10 }}
            tickFormatter={(v) => `${v}`}
            width={40}
            label={{
              value: "PER",
              angle: -90,
              position: "insideLeft",
              style: { fontSize: 10, fill: "#6366f1" },
            }}
          />
          <YAxis
            yAxisId="eps"
            orientation="right"
            domain={[epsMin, epsMax]}
            tick={{ fontSize: 10 }}
            tickFormatter={(v) => `${v}`}
            width={50}
            label={{
              value: "EPS (円)",
              angle: 90,
              position: "insideRight",
              style: { fontSize: 10, fill: "#22c55e" },
            }}
          />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const perVal = payload.find((p) => p.dataKey === "per");
              const epsAct = payload.find((p) => p.dataKey === "epsActual");
              const epsEst = payload.find((p) => p.dataKey === "epsEstimate");
              return (
                <div className="rounded border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-xs shadow dark:shadow-slate-900/50">
                  <p className="font-medium text-gray-700 dark:text-slate-300">
                    {label}
                  </p>
                  {perVal?.value != null && (
                    <p className="text-indigo-500">
                      PER: <b>{Number(perVal.value).toFixed(1)}</b>倍
                    </p>
                  )}
                  {epsAct?.value != null && (
                    <p className="text-green-600">
                      EPS実績: <b>{Number(epsAct.value).toFixed(1)}</b>円
                    </p>
                  )}
                  {epsEst?.value != null && (
                    <p className="text-gray-400">
                      EPS予想: {Number(epsEst.value).toFixed(1)}円
                    </p>
                  )}
                </div>
              );
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: 11 }}
            formatter={(value: string) => {
              if (value === "per") return "PER (左軸)";
              if (value === "epsActual") return "EPS実績 (右軸)";
              if (value === "epsEstimate") return "EPS予想 (右軸)";
              return value;
            }}
          />
          <Line
            yAxisId="per"
            type="monotone"
            dataKey="per"
            stroke="#6366f1"
            strokeWidth={2}
            dot={false}
            connectNulls
          />
          <Line
            yAxisId="eps"
            type="stepAfter"
            dataKey="epsActual"
            stroke="#22c55e"
            strokeWidth={2}
            dot={false}
            connectNulls
          />
          <Line
            yAxisId="eps"
            type="stepAfter"
            dataKey="epsEstimate"
            stroke="#9ca3af"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            dot={false}
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

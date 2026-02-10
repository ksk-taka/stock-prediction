"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import Link from "next/link";

interface DetectedSignal {
  id: number;
  scan_id: number;
  symbol: string;
  stock_name: string;
  sectors: string[] | null;
  market_segment: string | null;
  strategy_id: string;
  strategy_name: string;
  timeframe: string;
  signal_date: string;
  buy_price: number;
  current_price: number;
  exit_levels: {
    takeProfitPrice?: number;
    takeProfitLabel?: string;
    stopLossPrice?: number;
    stopLossLabel?: string;
  } | null;
  analysis: {
    decision: "entry" | "wait" | "avoid";
    summary: string;
    signalEvaluation: string;
    riskFactor: string;
    catalyst: string;
  } | null;
  analyzed_at: string | null;
  slack_notified: boolean;
  created_at: string;
}

interface ScanInfo {
  id: number;
  status: string;
  total_stocks: number;
  processed_stocks: number;
  new_signals_count: number;
  scan_date: string;
  started_at: string;
  completed_at: string;
}

interface ScanProgress {
  stage: string;
  current: number;
  total: number;
  message: string;
}

type SortKey = "symbol" | "strategy_name" | "timeframe" | "signal_date" | "buy_price" | "current_price" | "pnl";
type SortDir = "asc" | "desc";

const TF_FILTERS = [
  { label: "全て", value: "" },
  { label: "日足", value: "daily" },
  { label: "週足", value: "weekly" },
];

const DECISION_BADGE: Record<string, { label: string; cls: string }> = {
  entry: { label: "Go", cls: "bg-green-100 text-green-700" },
  wait: { label: "様子見", cls: "bg-yellow-100 text-yellow-700" },
  avoid: { label: "No Go", cls: "bg-red-100 text-red-700" },
};

export default function SignalsPage() {
  const [signals, setSignals] = useState<DetectedSignal[]>([]);
  const [scan, setScan] = useState<ScanInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [sortKey, setSortKey] = useState<SortKey>("signal_date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [tfFilter, setTfFilter] = useState("");
  const [strategyFilter, setStrategyFilter] = useState("");
  const [search, setSearch] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const pollingRef = useRef<{ interval: ReturnType<typeof setInterval>; timeout: ReturnType<typeof setTimeout> } | null>(null);

  // ── チェックボックス選択 ──
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // ── バッチアクション設定 ──
  const [batchAnalysis, setBatchAnalysis] = useState(true);
  const [batchSlack, setBatchSlack] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number; currentName: string } | null>(null);

  // ── データ読み込み ──

  const loadData = useCallback(async () => {
    try {
      const res = await fetch("/api/signals/detected");
      const data = await res.json();
      setSignals(data.signals ?? []);
      setScan(data.scan ?? null);
      setError(null);
    } catch {
      setError("データの取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── ポーリング ──

  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current.interval);
        clearTimeout(pollingRef.current.timeout);
      }
    };
  }, []);

  const startPolling = useCallback((scanId: number) => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current.interval);
      clearTimeout(pollingRef.current.timeout);
    }

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/signals/scan/status?scanId=${scanId}`);
        const data = await res.json();

        if (data.status === "completed") {
          if (pollingRef.current) {
            clearInterval(pollingRef.current.interval);
            clearTimeout(pollingRef.current.timeout);
            pollingRef.current = null;
          }
          setScanProgress(null);
          setScanning(false);
          await loadData();
        } else if (data.status === "failed") {
          if (pollingRef.current) {
            clearInterval(pollingRef.current.interval);
            clearTimeout(pollingRef.current.timeout);
            pollingRef.current = null;
          }
          setScanProgress(null);
          setScanning(false);
          setError(data.error_message ?? "スキャンが失敗しました");
        } else if (data.progress) {
          setScanProgress(data.progress);
        }
      } catch {
        // ネットワークエラー → 継続
      }
    }, 10_000);

    const timeout = setTimeout(() => {
      clearInterval(interval);
      pollingRef.current = null;
      setScanProgress(null);
      setScanning(false);
      setError("スキャンがタイムアウトしました。ページを再読み込みしてください。");
    }, 70 * 60 * 1000);

    pollingRef.current = { interval, timeout };
  }, [loadData]);

  // ── スキャン実行 ──

  const handleScan = async () => {
    setScanning(true);
    setError(null);
    try {
      const res = await fetch("/api/signals/scan", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "スキャンに失敗しました");
        setScanning(false);
        return;
      }

      if (data.scanId) {
        startPolling(data.scanId);
      } else {
        await loadData();
        setScanning(false);
      }
    } catch {
      setError("スキャンの実行に失敗しました");
      setScanning(false);
    }
  };

  // ── 単体分析 (Go/NoGo) ──

  const analyzeOne = async (sig: DetectedSignal): Promise<boolean> => {
    try {
      const pnlPct = ((sig.current_price - sig.buy_price) / sig.buy_price * 100).toFixed(1);
      const signalDesc = `${sig.strategy_name} (${sig.timeframe === "daily" ? "日足" : "週足"}): ${sig.signal_date}にエントリー (買値:${sig.buy_price}円, 現在値:${sig.current_price}円, 損益:${Number(pnlPct) > 0 ? "+" : ""}${pnlPct}%)`;

      const params = new URLSearchParams({
        symbol: sig.symbol,
        signalDesc,
        signalStrategy: sig.strategy_name,
        signalStrategyId: `${sig.strategy_id}_${sig.timeframe}_${sig.signal_date}`,
        step: "validation",
      });

      const res = await fetch(`/api/fundamental?${params}`);
      if (!res.ok) return false;

      const result = await res.json();
      const analysis = result.validation ?? result;

      await fetch("/api/signals/detected", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sig.id, analysis }),
      });

      setSignals((prev) =>
        prev.map((s) =>
          s.id === sig.id
            ? { ...s, analysis, analyzed_at: new Date().toISOString() }
            : s,
        ),
      );
      return true;
    } catch {
      return false;
    }
  };

  // ── 単体Slack通知 ──

  const slackNotifyOne = async (sig: DetectedSignal): Promise<boolean> => {
    try {
      const res = await fetch("/api/signals/detected", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sig.id, slack_notified: true }),
      });
      if (!res.ok) return false;

      setSignals((prev) =>
        prev.map((s) => (s.id === sig.id ? { ...s, slack_notified: true } : s)),
      );
      return true;
    } catch {
      return false;
    }
  };

  // ── バッチ実行 ──

  const handleBatchExecute = async () => {
    if (!batchAnalysis && !batchSlack) return;

    const targets = filtered.filter((s) => selectedIds.has(s.id));
    if (targets.length === 0) return;

    setBatchRunning(true);
    setError(null);
    let errors = 0;

    for (let i = 0; i < targets.length; i++) {
      const sig = targets[i];
      setBatchProgress({ current: i + 1, total: targets.length, currentName: `${sig.stock_name} (${sig.strategy_name})` });

      if (batchAnalysis) {
        const ok = await analyzeOne(sig);
        if (!ok) errors++;
      }

      if (batchSlack && !sig.slack_notified) {
        await slackNotifyOne(sig);
      }
    }

    setBatchRunning(false);
    setBatchProgress(null);
    if (errors > 0) {
      setError(`${errors}件の分析が失敗しました`);
    }
  };

  // ── チェックボックス操作 ──

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const filteredIds = filtered.map((s) => s.id);
    const allSelected = filteredIds.every((id) => selectedIds.has(id));
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredIds.forEach((id) => next.add(id));
        return next;
      });
    }
  };

  // ── 戦略一覧 (フィルタ用) ──

  const strategyOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of signals) {
      if (!map.has(s.strategy_id)) map.set(s.strategy_id, s.strategy_name);
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [signals]);

  // ── フィルタ & ソート ──

  const filtered = useMemo(() => {
    let list = signals;
    if (tfFilter) list = list.filter((s) => s.timeframe === tfFilter);
    if (strategyFilter) list = list.filter((s) => s.strategy_id === strategyFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (s) =>
          s.symbol.toLowerCase().includes(q) ||
          s.stock_name.toLowerCase().includes(q) ||
          s.strategy_name.toLowerCase().includes(q),
      );
    }

    const getPnl = (s: DetectedSignal) =>
      s.buy_price > 0 ? ((s.current_price - s.buy_price) / s.buy_price) * 100 : 0;

    list = [...list].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "pnl":
          cmp = getPnl(a) - getPnl(b);
          break;
        case "buy_price":
        case "current_price":
          cmp = a[sortKey] - b[sortKey];
          break;
        case "signal_date":
          cmp = a.signal_date.localeCompare(b.signal_date);
          break;
        default:
          cmp = String(a[sortKey] ?? "").localeCompare(String(b[sortKey] ?? ""));
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return list;
  }, [signals, tfFilter, search, sortKey, sortDir]);

  const selectedCount = filtered.filter((s) => selectedIds.has(s.id)).length;
  const allFilteredSelected = filtered.length > 0 && filtered.every((s) => selectedIds.has(s.id));

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sortIcon = (key: SortKey) => {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? " ▲" : " ▼";
  };

  // ── レンダリング ──

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-gray-500">読み込み中...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6">
      <div className="mx-auto max-w-7xl">
        {/* ヘッダー */}
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-800">シグナル監視</h1>
            {scan && (
              <p className="mt-0.5 text-xs text-gray-500">
                最終スキャン: {new Date(scan.completed_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
                ({scan.total_stocks}銘柄 → {scan.new_signals_count}シグナル)
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100"
            >
              ← ウォッチリスト
            </Link>
            <button
              onClick={handleScan}
              disabled={scanning}
              className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {scanning ? "スキャン中..." : "スキャン実行"}
            </button>
          </div>
        </div>

        {/* プログレスバー */}
        {scanning && scanProgress && (
          <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3">
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="font-medium text-blue-700">{scanProgress.message}</span>
              {scanProgress.total > 0 && (
                <span className="text-blue-500">
                  {Math.round((scanProgress.current / scanProgress.total) * 100)}%
                </span>
              )}
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-blue-100">
              <div
                className="h-full rounded-full bg-blue-500 transition-all duration-500"
                style={{
                  width: scanProgress.total > 0
                    ? `${Math.min(100, (scanProgress.current / scanProgress.total) * 100)}%`
                    : "100%",
                }}
              />
            </div>
            <div className="mt-1 text-[10px] text-blue-400">
              {scanProgress.stage === "fetching" && "価格データ取得 + シグナル計算中"}
              {scanProgress.stage === "uploading" && "結果をアップロード中"}
            </div>
          </div>
        )}

        {scanning && !scanProgress && (
          <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3">
            <div className="text-xs font-medium text-blue-700">
              スキャンを開始しています... (GitHub Actions で実行中)
            </div>
          </div>
        )}

        {/* エラー */}
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            {error}
          </div>
        )}

        {/* フィルタ */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            type="text"
            placeholder="銘柄名・コード・戦略で検索"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs focus:border-blue-400 focus:outline-none"
          />
          <div className="flex gap-1">
            {TF_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setTfFilter(f.value)}
                className={`rounded-full px-3 py-1 text-xs ${
                  tfFilter === f.value
                    ? "bg-blue-600 text-white"
                    : "bg-gray-200 text-gray-600 hover:bg-gray-300"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          {strategyOptions.length > 0 && (
            <select
              value={strategyFilter}
              onChange={(e) => setStrategyFilter(e.target.value)}
              className="rounded-lg border border-gray-300 px-2 py-1 text-xs focus:border-blue-400 focus:outline-none"
            >
              <option value="">全戦略</option>
              {strategyOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          <span className="ml-auto text-xs text-gray-500">
            {filtered.length}件
          </span>
        </div>

        {/* ── バッチアクションバー ── */}
        {selectedCount > 0 && (
          <div className="mb-3 rounded-lg border border-indigo-200 bg-indigo-50 p-3">
            <div className="flex flex-wrap items-center gap-4">
              <span className="text-xs font-medium text-indigo-700">
                {selectedCount}件選択中
              </span>

              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs text-gray-700">
                  <input
                    type="checkbox"
                    checked={batchAnalysis}
                    onChange={(e) => setBatchAnalysis(e.target.checked)}
                    className="rounded border-gray-300"
                    disabled={batchRunning}
                  />
                  Go/NoGo分析
                </label>
                <label className="flex items-center gap-1.5 text-xs text-gray-700">
                  <input
                    type="checkbox"
                    checked={batchSlack}
                    onChange={(e) => setBatchSlack(e.target.checked)}
                    className="rounded border-gray-300"
                    disabled={batchRunning}
                  />
                  Slack通知
                </label>
              </div>

              <button
                onClick={handleBatchExecute}
                disabled={batchRunning || (!batchAnalysis && !batchSlack)}
                className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {batchRunning ? "実行中..." : "実行"}
              </button>

              <button
                onClick={() => setSelectedIds(new Set())}
                disabled={batchRunning}
                className="text-xs text-gray-500 hover:text-gray-700"
              >
                選択解除
              </button>
            </div>

            {/* バッチ進捗 */}
            {batchProgress && (
              <div className="mt-2">
                <div className="mb-1 flex items-center justify-between text-[11px]">
                  <span className="text-indigo-600">{batchProgress.currentName}</span>
                  <span className="text-indigo-500">
                    {batchProgress.current}/{batchProgress.total}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-indigo-100">
                  <div
                    className="h-full rounded-full bg-indigo-500 transition-all duration-300"
                    style={{
                      width: `${(batchProgress.current / batchProgress.total) * 100}%`,
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* テーブル */}
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
            {signals.length === 0
              ? "シグナルデータがありません。スキャンを実行してください。"
              : "フィルタ条件に一致するシグナルがありません。"}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-gray-50 text-gray-600">
                  <th className="px-2 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={toggleSelectAll}
                      className="rounded border-gray-300"
                      title="全選択/解除"
                    />
                  </th>
                  <th className="cursor-pointer px-3 py-2 text-left" onClick={() => handleSort("symbol")}>
                    銘柄{sortIcon("symbol")}
                  </th>
                  <th className="cursor-pointer px-3 py-2 text-left" onClick={() => handleSort("strategy_name")}>
                    戦略{sortIcon("strategy_name")}
                  </th>
                  <th className="cursor-pointer px-3 py-2 text-center" onClick={() => handleSort("timeframe")}>
                    TF{sortIcon("timeframe")}
                  </th>
                  <th className="cursor-pointer px-3 py-2 text-right" onClick={() => handleSort("signal_date")}>
                    日付{sortIcon("signal_date")}
                  </th>
                  <th className="cursor-pointer px-3 py-2 text-right" onClick={() => handleSort("buy_price")}>
                    買値{sortIcon("buy_price")}
                  </th>
                  <th className="cursor-pointer px-3 py-2 text-right" onClick={() => handleSort("current_price")}>
                    現在値{sortIcon("current_price")}
                  </th>
                  <th className="cursor-pointer px-3 py-2 text-right" onClick={() => handleSort("pnl")}>
                    損益%{sortIcon("pnl")}
                  </th>
                  <th className="px-3 py-2 text-center">利確/損切</th>
                  <th className="px-3 py-2 text-center">判定</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((sig) => {
                  const pnl = sig.buy_price > 0
                    ? ((sig.current_price - sig.buy_price) / sig.buy_price) * 100
                    : 0;
                  const pnlColor = pnl > 0 ? "text-red-600" : pnl < 0 ? "text-blue-600" : "text-gray-600";
                  const decision = sig.analysis?.decision;
                  const badge = decision ? DECISION_BADGE[decision] : null;
                  const isSelected = selectedIds.has(sig.id);

                  return (
                    <tr
                      key={sig.id}
                      className={`border-b last:border-b-0 hover:bg-gray-50 ${isSelected ? "bg-indigo-50/50" : ""}`}
                    >
                      <td className="px-2 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(sig.id)}
                          className="rounded border-gray-300"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Link
                          href={`/stock/${sig.symbol}`}
                          className="font-medium text-blue-600 hover:underline"
                        >
                          {sig.stock_name}
                        </Link>
                        <div className="text-[10px] text-gray-400">{sig.symbol}</div>
                      </td>
                      <td className="px-3 py-2 text-gray-700">{sig.strategy_name}</td>
                      <td className="px-3 py-2 text-center">
                        <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] ${
                          sig.timeframe === "daily"
                            ? "bg-orange-100 text-orange-700"
                            : "bg-purple-100 text-purple-700"
                        }`}>
                          {sig.timeframe === "daily" ? "日足" : "週足"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right text-gray-700">{sig.signal_date}</td>
                      <td className="px-3 py-2 text-right">¥{sig.buy_price.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right">¥{sig.current_price.toLocaleString()}</td>
                      <td className={`px-3 py-2 text-right font-medium ${pnlColor}`}>
                        {pnl > 0 ? "+" : ""}{pnl.toFixed(1)}%
                      </td>
                      <td className="px-3 py-2 text-center text-[10px] text-gray-500">
                        {sig.exit_levels?.takeProfitLabel && (
                          <div className="text-green-600">
                            利確: {sig.exit_levels.takeProfitPrice
                              ? `¥${sig.exit_levels.takeProfitPrice.toLocaleString()}`
                              : sig.exit_levels.takeProfitLabel}
                          </div>
                        )}
                        {sig.exit_levels?.stopLossLabel && (
                          <div className="text-red-600">
                            損切: {sig.exit_levels.stopLossPrice
                              ? `¥${sig.exit_levels.stopLossPrice.toLocaleString()}`
                              : sig.exit_levels.stopLossLabel}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {badge ? (
                          <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${badge.cls}`}>
                            {badge.label}
                          </span>
                        ) : (
                          <span className="text-[10px] text-gray-400">未分析</span>
                        )}
                        {sig.slack_notified && (
                          <div className="mt-0.5 text-[9px] text-gray-400">Slack済</div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* 分析結果詳細 (サマリー表示) */}
        {filtered.some((s) => s.analysis) && (
          <div className="mt-4 space-y-2">
            <h2 className="text-sm font-bold text-gray-700">分析結果サマリー</h2>
            {filtered
              .filter((s) => s.analysis)
              .map((sig) => (
                <div
                  key={`analysis-${sig.id}`}
                  className="rounded-lg border border-gray-200 bg-white p-3"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-gray-800">
                      {sig.stock_name} ({sig.symbol})
                    </span>
                    <span className="text-[10px] text-gray-500">{sig.strategy_name}</span>
                    {sig.analysis && (
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        DECISION_BADGE[sig.analysis.decision]?.cls ?? ""
                      }`}>
                        {DECISION_BADGE[sig.analysis.decision]?.label}
                      </span>
                    )}
                  </div>
                  {sig.analysis && (
                    <div className="mt-1 space-y-0.5 text-[11px] text-gray-600">
                      <p>{sig.analysis.summary}</p>
                      {sig.analysis.signalEvaluation && (
                        <p className="text-gray-500">評価: {sig.analysis.signalEvaluation}</p>
                      )}
                      {sig.analysis.riskFactor && (
                        <p className="text-gray-500">リスク: {sig.analysis.riskFactor}</p>
                      )}
                      {sig.analysis.catalyst && (
                        <p className="text-gray-500">材料: {sig.analysis.catalyst}</p>
                      )}
                    </div>
                  )}
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

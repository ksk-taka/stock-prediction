"use client";

import { useState, useRef, useCallback } from "react";
import Link from "next/link";

// ---------- 型定義 ----------

interface AnalysisResult {
  symbol: string;
  companyName?: string;
  decision?: "entry" | "wait" | "avoid";
  confidence?: string;
  shortTerm?: string;
  midTerm?: string;
  longTerm?: string;
  buyPrice?: number;
  takeProfitPrice?: number;
  stopLossPrice?: number;
  summary?: string;
  catalyst?: string;
  riskFactor?: string;
  signalEvaluation?: string;
  notionUrl?: string;
  model?: string;
  pdfCount?: number;
  totalTokens?: number;
  elapsedSec: number;
  status: "done" | "skipped" | "error";
  error?: string;
  message?: string;
}

const DECISION_BADGE: Record<string, { label: string; cls: string }> = {
  entry: { label: "GO", cls: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300" },
  wait: { label: "WAIT", cls: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300" },
  avoid: { label: "AVOID", cls: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300" },
};

const CONFIDENCE_BADGE: Record<string, { label: string; cls: string }> = {
  high: { label: "High", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" },
  medium: { label: "Medium", cls: "bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300" },
  low: { label: "Low", cls: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300" },
};

function DecisionBadge({ value }: { value?: string }) {
  if (!value) return <span className="text-gray-300 dark:text-slate-600">-</span>;
  const badge = DECISION_BADGE[value];
  if (!badge) return <span className="text-xs">{value}</span>;
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold ${badge.cls}`}>
      {badge.label}
    </span>
  );
}

function PriceDisplay({ label, value, className }: { label: string; value?: number; className?: string }) {
  if (value == null) return null;
  return (
    <span className={`text-[11px] ${className ?? "text-gray-500 dark:text-slate-400"}`}>
      {label}: {value.toLocaleString()}
    </span>
  );
}

// ---------- ページ ----------

export default function AnalyzePage() {
  const [symbolsInput, setSymbolsInput] = useState("");
  const [model, setModel] = useState<"flash" | "pro">("flash");
  const [skipDownload, setSkipDownload] = useState(true);
  const [allDocs, setAllDocs] = useState(false);
  const [force, setForce] = useState(false);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{
    current: number;
    total: number;
    currentSymbol: string;
  } | null>(null);
  const [results, setResults] = useState<AnalysisResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef(false);

  // ── シンボルリスト解析 ──
  const parseSymbols = useCallback((input: string): string[] => {
    return input
      .split(/[,\s、\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => (s.includes(".T") ? s : /^\d{4}$/.test(s) ? `${s}.T` : s));
  }, []);

  // ── 分析実行 ──
  const handleStart = async () => {
    const symbols = parseSymbols(symbolsInput);
    if (symbols.length === 0) {
      setError("銘柄コードを入力してください");
      return;
    }

    setRunning(true);
    setError(null);
    setResults([]);
    abortRef.current = false;

    for (let i = 0; i < symbols.length; i++) {
      if (abortRef.current) break;

      const sym = symbols[i];
      setProgress({ current: i + 1, total: symbols.length, currentSymbol: sym });

      try {
        const res = await fetch("/api/analyze-full", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol: sym, model, skipDownload, allDocs, force }),
        });

        if (res.status === 403) {
          setError("この機能は許可されたユーザーのみ使用できます");
          break;
        }

        const data: AnalysisResult = await res.json();
        setResults((prev) => [...prev, data]);
      } catch (err) {
        setResults((prev) => [
          ...prev,
          {
            symbol: sym,
            status: "error",
            error: err instanceof Error ? err.message : "通信エラー",
            elapsedSec: 0,
          },
        ]);
      }

      // レート制限対策: 3秒待機
      if (i < symbols.length - 1 && !abortRef.current) {
        await new Promise((r) => setTimeout(r, 3000));
      }
    }

    setRunning(false);
    setProgress(null);
  };

  // ── 中止 ──
  const handleAbort = () => {
    abortRef.current = true;
  };

  // ── サマリー ──
  const doneCount = results.filter((r) => r.status === "done").length;
  const skippedCount = results.filter((r) => r.status === "skipped").length;
  const errorCount = results.filter((r) => r.status === "error").length;

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="mb-4 text-xl font-bold text-gray-800 dark:text-slate-100">
        銘柄分析 (Gemini PDF)
      </h1>

      {/* ── 入力フォーム ── */}
      <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">
          銘柄コード (カンマ区切り)
        </label>
        <textarea
          value={symbolsInput}
          onChange={(e) => setSymbolsInput(e.target.value)}
          placeholder="4415, 7203, 6503"
          rows={2}
          disabled={running}
          className="mb-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none disabled:opacity-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200"
        />

        <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-gray-600 dark:text-slate-400">
          {/* モデル選択 */}
          <label className="flex items-center gap-1.5">
            モデル:
            <select
              value={model}
              onChange={(e) => setModel(e.target.value as "flash" | "pro")}
              disabled={running}
              className="rounded border border-gray-300 px-2 py-1 text-xs focus:border-blue-400 focus:outline-none dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200"
            >
              <option value="flash">Gemini 2.5 Flash</option>
              <option value="pro">Gemini 2.5 Pro</option>
            </select>
          </label>

          {/* PDFダウンロードスキップ */}
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={skipDownload}
              onChange={(e) => setSkipDownload(e.target.checked)}
              disabled={running}
              className="rounded border-gray-300"
            />
            PDFダウンロードスキップ
          </label>

          {/* 全資料 */}
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={allDocs}
              onChange={(e) => setAllDocs(e.target.checked)}
              disabled={running}
              className="rounded border-gray-300"
            />
            有報・半期報も含める
          </label>

          {/* 強制再分析 */}
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={force}
              onChange={(e) => setForce(e.target.checked)}
              disabled={running}
              className="rounded border-gray-300"
            />
            強制再分析
          </label>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleStart}
            disabled={running || symbolsInput.trim().length === 0}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 dark:bg-blue-700 dark:hover:bg-blue-600"
          >
            分析開始
          </button>
          {running && (
            <button
              onClick={handleAbort}
              className="rounded-lg border border-red-300 px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/30"
            >
              中止
            </button>
          )}
        </div>
      </div>

      {/* ── エラー ── */}
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      )}

      {/* ── プログレスバー ── */}
      {progress && (
        <div className="mb-4 rounded-lg border border-indigo-200 bg-indigo-50 p-3 dark:border-indigo-800 dark:bg-indigo-900/20">
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="font-medium text-indigo-700 dark:text-indigo-300">
              分析中: {progress.currentSymbol}
            </span>
            <span className="text-indigo-500 dark:text-indigo-400">
              {progress.current}/{progress.total}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-indigo-100 dark:bg-indigo-900/40">
            <div
              className="h-full rounded-full bg-indigo-500 transition-all duration-500"
              style={{
                width: `${((progress.current - 1) / progress.total) * 100}%`,
              }}
            />
          </div>
          <p className="mt-1.5 text-[11px] text-indigo-500 dark:text-indigo-400">
            Gemini API 応答を待機中... (1銘柄あたり30秒〜2分)
          </p>
        </div>
      )}

      {/* ── 結果サマリー ── */}
      {results.length > 0 && (
        <div className="mb-3 flex items-center gap-3 text-xs text-gray-500 dark:text-slate-400">
          <span>完了: {doneCount}</span>
          {skippedCount > 0 && <span>スキップ: {skippedCount}</span>}
          {errorCount > 0 && (
            <span className="text-red-500">エラー: {errorCount}</span>
          )}
        </div>
      )}

      {/* ── 結果テーブル ── */}
      {results.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-gray-50 text-left text-gray-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
                <th className="px-3 py-2 font-medium">銘柄</th>
                <th className="px-2 py-2 font-medium text-center">短期</th>
                <th className="px-2 py-2 font-medium text-center">中期</th>
                <th className="px-2 py-2 font-medium text-center">長期</th>
                <th className="px-2 py-2 font-medium text-center">確信度</th>
                <th className="px-3 py-2 font-medium">推奨価格</th>
                <th className="px-3 py-2 font-medium min-w-[180px]">概要</th>
                <th className="px-2 py-2 font-medium text-center">PDF</th>
                <th className="px-2 py-2 font-medium text-right">時間</th>
                <th className="px-2 py-2 font-medium text-center">Notion</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <ResultRow key={`${r.symbol}-${i}`} r={r} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── 使い方ヒント ── */}
      {results.length === 0 && !running && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-xs text-gray-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
          <p className="mb-2 font-medium text-gray-700 dark:text-slate-300">使い方</p>
          <ul className="ml-4 list-disc space-y-1">
            <li>銘柄コードをカンマ区切りで入力 (例: <code>4415, 7203, 6503</code>)</li>
            <li>4桁コードは自動的に <code>.T</code> が付与されます</li>
            <li>決算資料PDFがある銘柄は PDF も含めて分析されます</li>
            <li>
              PDFがない場合は{" "}
              <code className="rounded bg-gray-200 px-1 dark:bg-slate-700">
                npm run fetch:earnings -- --symbol 7203.T
              </code>{" "}
              で事前にダウンロード
            </li>
            <li>Notion連携は環境変数 <code>NOTION_API_KEY</code> と <code>NOTION_DATABASE_ID</code> を設定</li>
            <li>1銘柄あたり 30秒〜2分 かかります (Gemini API)</li>
            <li>「強制再分析」にチェックすると、同日分析済みでもスキップしません</li>
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------- 結果行コンポーネント ----------

function ResultRow({ r }: { r: AnalysisResult }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr
        onClick={() => r.status === "done" && setExpanded(!expanded)}
        className={`border-b border-gray-100 dark:border-slate-700/50 ${
          r.status === "done" ? "cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700/30" : ""
        }`}
      >
        {/* 銘柄 */}
        <td className="px-3 py-2">
          <Link
            href={`/stock/${r.symbol}`}
            onClick={(e) => e.stopPropagation()}
            className="font-medium text-blue-600 hover:underline dark:text-blue-400"
          >
            {r.symbol.replace(".T", "")}
          </Link>
          {r.companyName && (
            <span className="ml-1.5 text-gray-500 dark:text-slate-400">
              {r.companyName}
            </span>
          )}
        </td>

        {/* 短期 / 中期 / 長期 判定 */}
        <td className="px-2 py-2 text-center">
          {r.status === "error" ? (
            <span className="inline-block rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-600 dark:bg-red-900/30 dark:text-red-400">
              Err
            </span>
          ) : r.status === "skipped" ? (
            <span className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500 dark:bg-slate-700 dark:text-slate-400">
              Skip
            </span>
          ) : (
            <DecisionBadge value={r.shortTerm} />
          )}
        </td>
        <td className="px-2 py-2 text-center">
          {r.status === "done" && <DecisionBadge value={r.midTerm} />}
        </td>
        <td className="px-2 py-2 text-center">
          {r.status === "done" && <DecisionBadge value={r.longTerm} />}
        </td>

        {/* 確信度 */}
        <td className="px-2 py-2 text-center">
          {r.confidence && CONFIDENCE_BADGE[r.confidence] && (
            <span
              className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${CONFIDENCE_BADGE[r.confidence].cls}`}
            >
              {CONFIDENCE_BADGE[r.confidence].label}
            </span>
          )}
        </td>

        {/* 推奨価格 */}
        <td className="px-3 py-2">
          {r.status === "done" && r.buyPrice != null && (
            <div className="flex flex-col gap-0.5">
              <PriceDisplay label="買" value={r.buyPrice} className="text-blue-600 dark:text-blue-400" />
              <PriceDisplay label="利確" value={r.takeProfitPrice} className="text-green-600 dark:text-green-400" />
              <PriceDisplay label="損切" value={r.stopLossPrice} className="text-red-500 dark:text-red-400" />
            </div>
          )}
        </td>

        {/* 概要 */}
        <td className="px-3 py-2 max-w-xs">
          {r.status === "error" ? (
            <span className="text-red-500 dark:text-red-400">{r.error}</span>
          ) : r.status === "skipped" ? (
            <span className="text-gray-400">{r.message}</span>
          ) : (
            <p className="text-gray-700 line-clamp-2 dark:text-slate-300">
              {r.summary}
            </p>
          )}
        </td>

        {/* PDF数 */}
        <td className="px-2 py-2 text-center text-gray-500 dark:text-slate-400">
          {r.pdfCount != null ? r.pdfCount : "-"}
        </td>

        {/* 時間 */}
        <td className="px-2 py-2 text-right text-gray-500 dark:text-slate-400">
          {r.elapsedSec > 0 ? `${r.elapsedSec}s` : "-"}
        </td>

        {/* Notion */}
        <td className="px-2 py-2 text-center">
          {r.notionUrl ? (
            <a
              href={r.notionUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-blue-600 hover:underline dark:text-blue-400"
            >
              Open
            </a>
          ) : (
            <span className="text-gray-300 dark:text-slate-600">-</span>
          )}
        </td>
      </tr>

      {/* ── 展開行 ── */}
      {expanded && r.status === "done" && (
        <tr className="border-b border-gray-100 bg-gray-50/50 dark:border-slate-700/50 dark:bg-slate-800/30">
          <td colSpan={10} className="px-4 py-3">
            <div className="grid gap-2 text-xs sm:grid-cols-2">
              {r.signalEvaluation && (
                <div>
                  <span className="font-medium text-gray-600 dark:text-slate-400">
                    テクニカル/ファンダ整合性:
                  </span>{" "}
                  <span className="text-gray-700 dark:text-slate-300">{r.signalEvaluation}</span>
                </div>
              )}
              {r.catalyst && (
                <div>
                  <span className="font-medium text-green-600 dark:text-green-400">
                    カタリスト:
                  </span>{" "}
                  <span className="text-gray-700 dark:text-slate-300">{r.catalyst}</span>
                </div>
              )}
              {r.riskFactor && (
                <div>
                  <span className="font-medium text-red-500 dark:text-red-400">
                    リスク:
                  </span>{" "}
                  <span className="text-gray-700 dark:text-slate-300">{r.riskFactor}</span>
                </div>
              )}
              <div className="text-gray-400 dark:text-slate-500">
                モデル: {r.model} | トークン: {r.totalTokens?.toLocaleString() ?? "-"}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

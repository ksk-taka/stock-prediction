"use client";

import { useState } from "react";
import type { FundamentalResearchData, FundamentalAnalysis } from "@/types";

type FundamentalStep = "idle" | "research" | "research_done" | "analysis" | "complete" | "error";

interface FundamentalPanelProps {
  analysis: FundamentalAnalysis | null;
  research: FundamentalResearchData | null;
  loading?: boolean;
  step?: FundamentalStep;
  onRefresh?: () => void;
  onRunAnalysis?: () => void;
}

const judgmentConfig = {
  bullish: {
    label: "強気",
    bg: "bg-green-100 dark:bg-green-900/30",
    text: "text-green-700 dark:text-green-400",
    border: "border-green-200 dark:border-green-800",
    icon: "▲",
  },
  neutral: {
    label: "中立",
    bg: "bg-yellow-100 dark:bg-yellow-900/30",
    text: "text-yellow-700 dark:text-yellow-400",
    border: "border-yellow-200 dark:border-yellow-800",
    icon: "◆",
  },
  bearish: {
    label: "弱気",
    bg: "bg-red-100 dark:bg-red-900/30",
    text: "text-red-700 dark:text-red-400",
    border: "border-red-200 dark:border-red-800",
    icon: "▼",
  },
};

export default function FundamentalPanel({
  analysis,
  research,
  loading,
  step = "idle",
  onRefresh,
  onRunAnalysis,
}: FundamentalPanelProps) {
  const [showRawText, setShowRawText] = useState(false);

  // ローディング中: ステップ進行状況を表示
  if (loading) {
    return (
      <div className="rounded-lg bg-white dark:bg-slate-800 p-4 shadow dark:shadow-slate-900/50">
        <h3 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
          ファンダメンタルズ分析
        </h3>
        <div className="space-y-3">
          {/* Step 1: Perplexity */}
          <StepIndicator
            label="Perplexity ファンダ調査"
            status={
              step === "research" ? "running"
              : step === "research_done" || step === "analysis" || step === "complete" ? "done"
              : step === "error" ? "error"
              : "pending"
            }
          />
          {/* Step 2: Ollama */}
          <StepIndicator
            label="Ollama PBR=PER×ROE 分解分析"
            status={
              step === "analysis" ? "running"
              : step === "complete" ? "done"
              : step === "error" && (step as string) !== "research" ? "error"
              : "pending"
            }
          />
        </div>
        {step === "error" && (
          <p className="mt-3 text-sm text-red-500">
            処理中にエラーが発生しました。Ollamaが起動しているか確認してください。
          </p>
        )}
      </div>
    );
  }

  // まだ分析実行前
  if (!analysis && !research) {
    return (
      <div className="rounded-lg bg-white dark:bg-slate-800 p-4 shadow dark:shadow-slate-900/50">
        <h3 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
          ファンダメンタルズ分析
        </h3>
        <p className="mb-4 text-sm text-gray-500 dark:text-slate-400">
          Perplexity APIでファンダメンタルズ情報を収集し、OllamaでPBR=PER×ROE分解分析を行います。
        </p>
        {onRunAnalysis && (
          <button
            onClick={onRunAnalysis}
            className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-600"
          >
            ファンダ分析を実行
          </button>
        )}
      </div>
    );
  }

  const jc = analysis ? judgmentConfig[analysis.judgment] : null;

  return (
    <div className="rounded-lg bg-white dark:bg-slate-800 p-4 shadow dark:shadow-slate-900/50">
      {/* ヘッダー + 更新ボタン */}
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          ファンダメンタルズ分析
        </h3>
        <div className="flex items-center gap-2">
          {analysis && (
            <span className="text-xs text-gray-400 dark:text-slate-500">
              {new Date(analysis.analyzedAt).toLocaleString("ja-JP")}
            </span>
          )}
          {onRefresh && (
            <button
              onClick={onRefresh}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
              </svg>
              更新
            </button>
          )}
        </div>
      </div>

      {/* ファンダメンタルズ判定バッジ */}
      {jc && (
        <div className={`mb-4 flex items-center gap-2 rounded-lg border px-4 py-3 ${jc.bg} ${jc.border}`}>
          <span className={`text-2xl font-bold ${jc.text}`}>{jc.icon}</span>
          <div>
            <span className={`text-lg font-bold ${jc.text}`}>
              ファンダメンタルズ判定: {jc.label}
            </span>
          </div>
        </div>
      )}

      {/* サマリー */}
      {analysis?.summary && (
        <div className="mb-4 rounded-lg bg-gray-50 dark:bg-slate-700/50 p-3">
          <p className="text-sm text-gray-700 dark:text-slate-300">{analysis.summary}</p>
        </div>
      )}

      {/* 分析ロジック */}
      {analysis?.analysisLogic && (
        <div className="mb-4 space-y-3">
          <AnalysisSection
            title="割安性の正体"
            content={analysis.analysisLogic.valuationReason}
            icon="$"
          />
          <AnalysisSection
            title="ROE・資本政策"
            content={analysis.analysisLogic.roeCapitalPolicy}
            icon="R"
          />
          <AnalysisSection
            title="成長ドライバー"
            content={analysis.analysisLogic.growthDriver}
            icon="G"
          />
        </div>
      )}

      {/* リスクシナリオ */}
      {analysis?.riskScenario && (
        <div className="mb-4 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-3">
          <h4 className="mb-1 text-sm font-semibold text-red-700 dark:text-red-400">
            リスクシナリオ
          </h4>
          <p className="text-sm text-red-600 dark:text-red-300">{analysis.riskScenario}</p>
        </div>
      )}

      {/* Perplexity調査結果（折りたたみ） */}
      {research && (
        <div className="border-t border-gray-100 dark:border-slate-700 pt-3">
          <button
            onClick={() => setShowRawText(!showRawText)}
            className="flex w-full items-center justify-between text-sm font-medium text-gray-600 dark:text-slate-400 hover:text-gray-800 dark:hover:text-slate-300"
          >
            <span>Perplexity調査結果</span>
            <svg
              className={`h-4 w-4 transition-transform ${showRawText ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
            </svg>
          </button>
          {showRawText && (
            <div className="mt-2 space-y-2">
              {research.valuationReason && (
                <ResearchSection title="割安/割高の理由" content={research.valuationReason} />
              )}
              {research.capitalPolicy && (
                <ResearchSection title="資本政策・是正アクション" content={research.capitalPolicy} />
              )}
              {research.earningsTrend && (
                <ResearchSection title="直近の業績トレンド" content={research.earningsTrend} />
              )}
              {research.catalystAndRisk && (
                <ResearchSection title="カタリスト・リスク" content={research.catalystAndRisk} />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StepIndicator({ label, status }: { label: string; status: "pending" | "running" | "done" | "error" }) {
  return (
    <div className="flex items-center gap-3">
      {status === "running" && (
        <div className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-500" />
      )}
      {status === "done" && (
        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
          <svg className="h-3 w-3 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
          </svg>
        </div>
      )}
      {status === "error" && (
        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
          <svg className="h-3 w-3 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </div>
      )}
      {status === "pending" && (
        <div className="h-5 w-5 shrink-0 rounded-full border-2 border-gray-200 dark:border-slate-600" />
      )}
      <span className={`text-sm ${
        status === "running" ? "font-medium text-indigo-600 dark:text-indigo-400"
        : status === "done" ? "text-green-600 dark:text-green-400"
        : status === "error" ? "text-red-500 dark:text-red-400"
        : "text-gray-400 dark:text-slate-500"
      }`}>
        {label}
        {status === "running" && <span className="ml-1 animate-pulse">...</span>}
      </span>
    </div>
  );
}

function AnalysisSection({
  title,
  content,
  icon,
}: {
  title: string;
  content: string;
  icon: string;
}) {
  if (!content) return null;
  return (
    <div className="flex gap-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-xs font-bold text-indigo-600 dark:text-indigo-400">
        {icon}
      </div>
      <div>
        <h4 className="text-sm font-semibold text-gray-800 dark:text-slate-200">{title}</h4>
        <p className="text-sm text-gray-600 dark:text-slate-400">{content}</p>
      </div>
    </div>
  );
}

function ResearchSection({ title, content }: { title: string; content: string }) {
  return (
    <div className="rounded bg-gray-50 dark:bg-slate-700/30 p-2">
      <h5 className="mb-1 text-xs font-semibold text-gray-500 dark:text-slate-400">{title}</h5>
      <p className="whitespace-pre-wrap text-xs text-gray-600 dark:text-slate-400">{content}</p>
    </div>
  );
}

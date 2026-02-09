import { NextRequest, NextResponse } from "next/server";
import { fetchFundamentalResearch } from "@/lib/api/webResearch";
import { runFundamentalAnalysis, validateSignal } from "@/lib/api/llm";
import { getQuote, getFinancialData } from "@/lib/api/yahooFinance";
import {
  getCachedResearch,
  setCachedResearch,
  getCachedFundamentalAnalysis,
  setCachedFundamentalAnalysis,
  getFundamentalHistory,
  getCachedValidation,
  setCachedValidation,
  getAllCachedValidations,
} from "@/lib/cache/fundamentalCache";
import { getCachedNews } from "@/lib/cache/newsCache";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const symbol = searchParams.get("symbol");
  const name = searchParams.get("name") ?? symbol ?? "";
  const refresh = searchParams.get("refresh") === "true";
  const step = searchParams.get("step"); // "research" | "analysis" | null(全実行)
  // シグナル検証モード
  const signalDesc = searchParams.get("signalDesc");
  const signalStrategy = searchParams.get("signalStrategy");
  const signalStrategyId = searchParams.get("signalStrategyId");

  if (!symbol) {
    return NextResponse.json(
      { error: "symbol parameter is required" },
      { status: 400 }
    );
  }

  // 履歴取得モード（軽量: キャッシュファイル読むだけ）
  if (step === "history") {
    const history = getFundamentalHistory(symbol);
    return NextResponse.json({ step: "history", history });
  }

  // 検証キャッシュ一括取得モード
  if (step === "validations") {
    const validations = getAllCachedValidations(symbol);
    return NextResponse.json({ step: "validations", validations });
  }

  try {
    // 1. 定量データ取得（Yahoo Finance）
    const [quote, financial] = await Promise.all([
      getQuote(symbol),
      getFinancialData(symbol),
    ]);

    const stats = {
      per: quote.per,
      pbr: quote.pbr,
      roe: financial.roe,
      dividendYield: quote.dividendYield,
      equityRatio: financial.equityRatio,
    };

    const ticker = symbol.replace(".T", "");

    // 2. Perplexityファンダ調査（キャッシュ確認）
    let research = !refresh ? getCachedResearch(symbol) : null;
    let researchCached = !!research;

    if (!research) {
      research = await fetchFundamentalResearch(symbol, name, ticker, {
        pbr: stats.pbr ?? 0,
        per: stats.per ?? 0,
      });
      setCachedResearch(symbol, research);
      researchCached = false;
    }

    // step=research の場合、Perplexity結果のみ返す
    if (step === "research") {
      return NextResponse.json({
        step: "research",
        stats,
        research,
        researchCached,
      });
    }

    // 3. シグナル検証モードの場合
    if (signalDesc && signalStrategy) {
      // キャッシュ確認
      if (signalStrategyId && !refresh) {
        const cached = getCachedValidation(symbol, signalStrategyId);
        if (cached) {
          return NextResponse.json({
            step: "validation",
            stats,
            research,
            validation: cached,
            researchCached,
            validationCached: true,
          });
        }
      }

      const validation = await validateSignal(
        symbol,
        name,
        { description: signalDesc, strategyName: signalStrategy },
        stats,
        research.rawText
      );

      // キャッシュ保存
      if (signalStrategyId && validation.summary) {
        setCachedValidation(symbol, signalStrategyId, validation);
      }

      return NextResponse.json({
        step: "validation",
        stats,
        research,
        validation,
        researchCached,
        validationCached: false,
      });
    }

    // 4. ファンダメンタルズ分析（Ollama、キャッシュ確認）
    let analysis = !refresh ? getCachedFundamentalAnalysis(symbol) : null;
    let analysisCached = !!analysis;

    if (!analysis) {
      // ニュースキャッシュがあれば追加情報として渡す
      const newsData = getCachedNews(symbol);
      const newsSummary = newsData
        ? newsData.news
            .slice(0, 10)
            .map((n) => `[${n.sentiment ?? "neutral"}] ${n.title} (${n.source})`)
            .join("\n")
        : undefined;

      analysis = await runFundamentalAnalysis(symbol, name, stats, research.rawText, newsSummary);
      // エラー結果（analysisLogicが空）はキャッシュしない
      if (analysis.analysisLogic.valuationReason) {
        setCachedFundamentalAnalysis(symbol, analysis);
      }
      analysisCached = false;
    }

    return NextResponse.json({
      step: "complete",
      stats,
      research,
      analysis,
      researchCached,
      analysisCached,
    });
  } catch (error) {
    console.error("Fundamental API error:", error);
    return NextResponse.json(
      { error: "Failed to run fundamental analysis" },
      { status: 500 }
    );
  }
}

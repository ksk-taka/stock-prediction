import { NextRequest, NextResponse } from "next/server";
import { getHistoricalPrices } from "@/lib/api/yahooFinance";
import { detectBuySignals, detectCupWithHandle } from "@/lib/utils/signals";
import { strategies, getStrategyParams } from "@/lib/backtest/strategies";
import { calcMACD, calcBollingerBands } from "@/lib/utils/indicators";
import { getCachedSignals, setCachedSignals } from "@/lib/cache/signalsCache";
import type { PriceData } from "@/types";
import type { Signal } from "@/lib/backtest/types";
import type { PeriodType } from "@/lib/backtest/presets";

/** アクティブ（未決済）ポジションを検出 */
function findActivePosition(
  data: PriceData[],
  signals: Signal[]
): { buyDate: string; buyPrice: number; buyIndex: number } | null {
  let lastBuyIdx = -1;
  let inPosition = false;

  for (let i = 0; i < signals.length; i++) {
    if (signals[i] === "buy" && !inPosition) {
      inPosition = true;
      lastBuyIdx = i;
    } else if (signals[i] === "sell" && inPosition) {
      inPosition = false;
    }
  }

  if (inPosition && lastBuyIdx >= 0) {
    return {
      buyDate: data[lastBuyIdx].date,
      buyPrice: data[lastBuyIdx].close,
      buyIndex: lastBuyIdx,
    };
  }
  return null;
}

/** MACD Trail 12% のアクティブポジション検出 */
function findMacdTrail12Active(
  data: PriceData[],
  periodKey: PeriodType,
): { buyDate: string; buyPrice: number; trailStopLevel: number; peakPrice: number } | null {
  const params = getStrategyParams("macd_signal", "optimized", periodKey);
  const macd = calcMACD(data, params.shortPeriod, params.longPeriod, params.signalPeriod);

  let inPosition = false;
  let buyDate = "";
  let buyPrice = 0;
  let peakSinceBuy = 0;

  for (let i = 1; i < data.length; i++) {
    const prev = macd[i - 1];
    const cur = macd[i];

    if (!inPosition) {
      if (prev.macd != null && prev.signal != null && cur.macd != null && cur.signal != null) {
        if (prev.macd <= prev.signal && cur.macd > cur.signal) {
          inPosition = true;
          buyPrice = data[i].close;
          buyDate = data[i].date;
          peakSinceBuy = data[i].close;
        }
      }
    } else {
      if (data[i].close > peakSinceBuy) peakSinceBuy = data[i].close;
      if (data[i].close <= peakSinceBuy * 0.88) {
        inPosition = false;
      }
    }
  }

  if (inPosition) {
    return {
      buyDate,
      buyPrice: Math.round(buyPrice * 100) / 100,
      trailStopLevel: Math.round(peakSinceBuy * 0.88 * 100) / 100,
      peakPrice: Math.round(peakSinceBuy * 100) / 100,
    };
  }
  return null;
}

/** 戦略ごとの利確/損切レベルを算出 */
function getExitLevels(
  strategyId: string,
  data: PriceData[],
  buyIndex: number,
  buyPrice: number,
  params: Record<string, number>,
): { takeProfitPrice?: number; takeProfitLabel?: string; stopLossPrice?: number; stopLossLabel?: string } {
  switch (strategyId) {
    case "choruko_bb": {
      const bb = calcBollingerBands(data, 25);
      const currentMA25 = bb[data.length - 1]?.middle;
      return {
        takeProfitPrice: currentMA25 ? Math.round(currentMA25 * 100) / 100 : undefined,
        takeProfitLabel: "MA25タッチ",
        stopLossPrice: Math.round(data[buyIndex].low * 100) / 100,
        stopLossLabel: "エントリー安値割れ",
      };
    }
    case "choruko_shitabanare": {
      const gapUpper = buyIndex >= 2 ? data[buyIndex - 2]?.low : undefined;
      return {
        takeProfitPrice: gapUpper ? Math.round(gapUpper * 100) / 100 : undefined,
        takeProfitLabel: "窓上限到達",
        stopLossPrice: Math.round(data[buyIndex].low * 100) / 100,
        stopLossLabel: "エントリー安値割れ",
      };
    }
    case "tabata_cwh": {
      const tp = params.takeProfitPct ?? 20;
      const sl = params.stopLossPct ?? 7;
      return {
        takeProfitPrice: Math.round(buyPrice * (1 + tp / 100) * 100) / 100,
        takeProfitLabel: `+${tp}%`,
        stopLossPrice: Math.round(buyPrice * (1 - sl / 100) * 100) / 100,
        stopLossLabel: `-${sl}%`,
      };
    }
    case "ma_cross": {
      const short = params.shortPeriod ?? 5;
      const long = params.longPeriod ?? 25;
      return {
        stopLossLabel: `MA${short}/MA${long} デッドクロスで売却`,
      };
    }
    case "macd_signal": {
      const sp = params.shortPeriod ?? 12;
      const lp = params.longPeriod ?? 26;
      const sig = params.signalPeriod ?? 9;
      return {
        stopLossLabel: `MACD(${sp},${lp},${sig}) デッドクロスで売却`,
      };
    }
    case "rsi_reversal": {
      const rsiPeriod = params.period ?? 14;
      const oversold = params.oversold ?? 30;
      const overbought = params.overbought ?? 70;
      return {
        stopLossLabel: `RSI(${rsiPeriod}) >${overbought}で売却 (買い: <${oversold})`,
      };
    }
    default:
      return {};
  }
}

// アクティブシグナル検出対象の戦略ID
const ACTIVE_STRATEGY_IDS = [
  "choruko_bb", "choruko_shitabanare", "tabata_cwh",
  "rsi_reversal", "ma_cross", "macd_signal",
];

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const symbol = searchParams.get("symbol");

  if (!symbol) {
    return NextResponse.json(
      { error: "symbol parameter is required" },
      { status: 400 }
    );
  }

  // キャッシュチェック（1時間TTL）
  const cached = getCachedSignals(symbol);
  if (cached) {
    return NextResponse.json(cached);
  }

  try {
    // 日足(1年分)と週足(3年分)を並列取得
    const [dailyData, weeklyData] = await Promise.all([
      getHistoricalPrices(symbol, "daily"),
      getHistoricalPrices(symbol, "weekly"),
    ]);

    // フィルタ期間
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    // 全データで検出 → 対象期間のみ抽出
    const dailyChoruko = detectBuySignals(dailyData).filter(
      (s) => new Date(s.date) >= threeMonthsAgo
    );
    const weeklyChoruko = detectBuySignals(weeklyData).filter(
      (s) => new Date(s.date) >= oneYearAgo
    );
    const dailyCWH = detectCupWithHandle(dailyData).filter(
      (s) => new Date(s.date) >= threeMonthsAgo
    );
    const weeklyCWH = detectCupWithHandle(weeklyData).filter(
      (s) => new Date(s.date) >= oneYearAgo
    );

    const summarize = (signals: { date: string }[]) => ({
      count: signals.length,
      latest: signals.length > 0 ? signals[signals.length - 1].date : null,
    });

    // アクティブシグナル検出
    interface ActiveSignalInfo {
      strategyId: string;
      strategyName: string;
      buyDate: string;
      buyPrice: number;
      currentPrice: number;
      pnlPct: number;
      takeProfitPrice?: number;
      takeProfitLabel?: string;
      stopLossPrice?: number;
      stopLossLabel?: string;
    }

    const detectActive = (data: PriceData[], periodKey: PeriodType): ActiveSignalInfo[] => {
      if (data.length === 0) return [];
      const currentPrice = data[data.length - 1].close;
      const result: ActiveSignalInfo[] = [];

      for (const stratId of ACTIVE_STRATEGY_IDS) {
        const strat = strategies.find((s) => s.id === stratId);
        if (!strat) continue;

        const params = getStrategyParams(stratId, "optimized", periodKey);
        const signals = strat.compute(data, params);
        const active = findActivePosition(data, signals);

        if (active) {
          const pnlPct =
            ((currentPrice - active.buyPrice) / active.buyPrice) * 100;
          const exits = getExitLevels(stratId, data, active.buyIndex, active.buyPrice, params);
          result.push({
            strategyId: stratId,
            strategyName: strat.name,
            buyDate: active.buyDate,
            buyPrice: Math.round(active.buyPrice * 100) / 100,
            currentPrice: Math.round(currentPrice * 100) / 100,
            pnlPct: Math.round(pnlPct * 100) / 100,
            ...exits,
          });
        }
      }

      // MACD Trail 12% (custom detection)
      const trail12 = findMacdTrail12Active(data, periodKey);
      if (trail12) {
        const pnlPct = ((currentPrice - trail12.buyPrice) / trail12.buyPrice) * 100;
        result.push({
          strategyId: "macd_trail12",
          strategyName: "MACD Trail 12%",
          buyDate: trail12.buyDate,
          buyPrice: trail12.buyPrice,
          currentPrice: Math.round(currentPrice * 100) / 100,
          pnlPct: Math.round(pnlPct * 100) / 100,
          stopLossPrice: trail12.trailStopLevel,
          stopLossLabel: `Trail Stop (高値${trail12.peakPrice.toLocaleString()}の-12%)`,
        });
      }

      return result;
    };

    const dailyActive = detectActive(dailyData, "daily");
    const weeklyActive = detectActive(weeklyData, "weekly");

    const result = {
      daily: {
        choruko: summarize(dailyChoruko),
        cwh: summarize(dailyCWH),
      },
      weekly: {
        choruko: summarize(weeklyChoruko),
        cwh: summarize(weeklyCWH),
      },
      activeSignals: {
        daily: dailyActive,
        weekly: weeklyActive,
      },
    };

    // キャッシュ保存
    setCachedSignals(symbol, result);

    return NextResponse.json(result);
  } catch (error) {
    console.error("Signals API error:", error);
    return NextResponse.json(
      { error: "Failed to detect signals" },
      { status: 500 }
    );
  }
}

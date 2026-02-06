/**
 * 全銘柄シグナル一括スキャン
 *
 * 全上場銘柄のシグナル検出を実行し、結果をキャッシュに保存する。
 * 1日1回実行することで、ウォッチリストのシグナルフィルタが全銘柄で即座に利用可能になる。
 *
 * Usage:
 *   npm run scan:signals          # 全銘柄スキャン
 *   npm run scan:signals:quick    # キャッシュ未取得分のみ
 */

import * as fs from "fs";
import * as path from "path";
import { getHistoricalPrices } from "../src/lib/api/yahooFinance";
import { detectBuySignals, detectCupWithHandle } from "../src/lib/utils/signals";
import { strategies, getStrategyParams } from "../src/lib/backtest/strategies";
import { calcMACD } from "../src/lib/utils/indicators";
import { getExitLevels } from "../src/lib/utils/exitLevels";
import { getCacheBaseDir } from "../src/lib/cache/cacheDir";
import type { PriceData } from "../src/types";
import type { Signal } from "../src/lib/backtest/types";
import type { PeriodType } from "../src/lib/backtest/presets";

const WATCHLIST_PATH = path.join(process.cwd(), "data", "watchlist.json");
const CACHE_DIR = path.join(getCacheBaseDir(), "signals");
const CONCURRENCY = 10;
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24時間（quickモード用）

// --quick フラグ: キャッシュ済みをスキップ
const quickMode = process.argv.includes("--quick");

// ─── シグナル検出ロジック (signals/route.ts と同一) ───

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

function findMacdTrail12Active(
  data: PriceData[],
  periodKey: PeriodType
): {
  buyDate: string;
  buyPrice: number;
  trailStopLevel: number;
  peakPrice: number;
} | null {
  const params = getStrategyParams("macd_signal", "optimized", periodKey);
  const macd = calcMACD(
    data,
    params.shortPeriod,
    params.longPeriod,
    params.signalPeriod
  );

  let inPosition = false;
  let buyDate = "";
  let buyPrice = 0;
  let peakSinceBuy = 0;

  for (let i = 1; i < data.length; i++) {
    const prev = macd[i - 1];
    const cur = macd[i];

    if (!inPosition) {
      if (
        prev.macd != null &&
        prev.signal != null &&
        cur.macd != null &&
        cur.signal != null
      ) {
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

const ACTIVE_STRATEGY_IDS = [
  "choruko_bb",
  "choruko_shitabanare",
  "tabata_cwh",
  "rsi_reversal",
  "ma_cross",
  "macd_signal",
];

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

function detectActive(
  data: PriceData[],
  periodKey: PeriodType
): ActiveSignalInfo[] {
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
      const exits = getExitLevels(
        stratId,
        data,
        active.buyIndex,
        active.buyPrice,
        params
      );
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

  // MACD Trail 12%
  const trail12 = findMacdTrail12Active(data, periodKey);
  if (trail12) {
    const pnlPct =
      ((currentPrice - trail12.buyPrice) / trail12.buyPrice) * 100;
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
}

// ─── キャッシュ ───

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function cacheFile(symbol: string): string {
  return path.join(CACHE_DIR, `${symbol.replace(".", "_")}.json`);
}

function isCached(symbol: string): boolean {
  const file = cacheFile(symbol);
  if (!fs.existsSync(file)) return false;
  try {
    const entry = JSON.parse(fs.readFileSync(file, "utf-8"));
    return Date.now() - entry.cachedAt < CACHE_TTL;
  } catch {
    return false;
  }
}

function saveCache(symbol: string, data: unknown): void {
  ensureCacheDir();
  const file = cacheFile(symbol);
  fs.writeFileSync(
    file,
    JSON.stringify({ data, cachedAt: Date.now() }),
    "utf-8"
  );
}

// ─── スキャン ───

async function scanSymbol(symbol: string): Promise<{
  hasActiveSignals: boolean;
  error?: string;
}> {
  try {
    const [dailyData, weeklyData] = await Promise.all([
      getHistoricalPrices(symbol, "daily"),
      getHistoricalPrices(symbol, "weekly"),
    ]);

    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

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

    const dailyActive = detectActive(dailyData, "daily");
    const weeklyActive = detectActive(weeklyData, "weekly");

    const result = {
      daily: { choruko: summarize(dailyChoruko), cwh: summarize(dailyCWH) },
      weekly: {
        choruko: summarize(weeklyChoruko),
        cwh: summarize(weeklyCWH),
      },
      activeSignals: { daily: dailyActive, weekly: weeklyActive },
    };

    saveCache(symbol, result);

    return {
      hasActiveSignals: dailyActive.length > 0 || weeklyActive.length > 0,
    };
  } catch (err) {
    return {
      hasActiveSignals: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── メイン ───

async function main() {
  const watchlist = JSON.parse(fs.readFileSync(WATCHLIST_PATH, "utf-8"));
  const jpStocks: { symbol: string; name: string }[] = watchlist.stocks.filter(
    (s: { market: string }) => s.market === "JP"
  );

  console.log(`=== 全銘柄シグナルスキャン ===`);
  console.log(`対象: ${jpStocks.length} 銘柄`);
  console.log(`モード: ${quickMode ? "Quick（未キャッシュのみ）" : "Full（全件）"}`);
  console.log(`同時実行: ${CONCURRENCY}\n`);

  let targets = jpStocks;
  if (quickMode) {
    ensureCacheDir();
    targets = jpStocks.filter((s) => !isCached(s.symbol));
    console.log(`未キャッシュ: ${targets.length} 銘柄（${jpStocks.length - targets.length} 件はスキップ）\n`);
  }

  if (targets.length === 0) {
    console.log("全銘柄キャッシュ済み。スキャン不要。");
    return;
  }

  let done = 0;
  let errors = 0;
  let withSignals = 0;
  const startTime = Date.now();

  // バッチ処理
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((s) => scanSymbol(s.symbol))
    );

    for (const r of results) {
      done++;
      if (r.status === "fulfilled") {
        if (r.value.error) errors++;
        if (r.value.hasActiveSignals) withSignals++;
      } else {
        errors++;
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const remaining = targets.length - done;
    const rate = done / ((Date.now() - startTime) / 1000);
    const eta = remaining > 0 ? Math.ceil(remaining / rate) : 0;
    const etaMin = Math.floor(eta / 60);
    const etaSec = eta % 60;

    process.stdout.write(
      `\r  ${done}/${targets.length} (${((done / targets.length) * 100).toFixed(1)}%) ` +
        `| シグナルあり: ${withSignals} | エラー: ${errors} ` +
        `| 経過: ${elapsed}s | 残り: ${etaMin}m${etaSec}s  `
    );
  }

  console.log("\n");
  console.log("=== 完了 ===");
  console.log(`  スキャン: ${done} 銘柄`);
  console.log(`  シグナルあり: ${withSignals} 銘柄`);
  console.log(`  エラー: ${errors} 銘柄`);
  console.log(
    `  所要時間: ${((Date.now() - startTime) / 1000 / 60).toFixed(1)} 分`
  );
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});

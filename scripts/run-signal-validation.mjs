/**
 * シグナル検証バッチスクリプト（並列版）
 * 1. 全銘柄のアクティブシグナルを検出 (並列10)
 * 2. 各シグナルに対してGo/No Go判定を実行 (並列5)
 *
 * Usage: node scripts/run-signal-validation.mjs [--resume] [--detect-only] [--filtered]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = "http://localhost:3000";
const WATCHLIST_PATH = path.join(__dirname, "..", "data", "watchlist.json");
const PROGRESS_PATH = path.join(__dirname, "..", "data", "signal-validation-progress.json");

const REQUEST_TIMEOUT_MS = 180000;
const MAX_RETRIES = 2;
const PHASE1_CONCURRENCY = 10;  // シグナル検出の並列数
const PHASE2_CONCURRENCY = 5;   // LLM検証の並列数

const args = process.argv.slice(2);
const resumeMode = args.includes("--resume");
const detectOnly = args.includes("--detect-only");
const filteredMode = args.includes("--filtered");

// シグナルレベルフィルタ (--filtered 使用時: MACD Trail 12% + 1ヶ月以内)
function passesSignalFilter(signal) {
  if (!filteredMode) return true;
  if (signal.strategyId !== "macd_trail12") return false;
  const oneMonthAgo = new Date();
  oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
  if (new Date(signal.buyDate) < oneMonthAgo) return false;
  return true;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function formatDuration(ms) {
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  if (hr > 0) return `${hr}h${min % 60}m`;
  if (min > 0) return `${min}m${sec % 60}s`;
  return `${sec}s`;
}

async function fetchWithRetry(url, retries = MAX_RETRIES) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 100)}`);
      }
      return await res.json();
    } catch (err) {
      if (attempt < retries) {
        const wait = (attempt + 1) * 5000;
        await sleep(wait);
      } else {
        throw err;
      }
    }
  }
}

function loadProgress() {
  try {
    if (resumeMode && fs.existsSync(PROGRESS_PATH)) {
      return JSON.parse(fs.readFileSync(PROGRESS_PATH, "utf-8"));
    }
  } catch { /* ignore */ }
  return { detected: {}, validated: {}, startedAt: new Date().toISOString() };
}

function saveProgress(progress) {
  progress.updatedAt = new Date().toISOString();
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 2), "utf-8");
}

/**
 * 並列実行ワーカー: タスクキューから取り出して並列処理
 */
async function runParallel(tasks, concurrency, onResult) {
  let idx = 0;
  let completed = 0;
  const total = tasks.length;

  async function worker() {
    while (idx < total) {
      const i = idx++;
      try {
        const result = await tasks[i]();
        onResult(i, result, null);
      } catch (err) {
        onResult(i, null, err);
      }
      completed++;
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, total) }, () => worker());
  await Promise.all(workers);
  return completed;
}

async function main() {
  const watchlist = JSON.parse(fs.readFileSync(WATCHLIST_PATH, "utf-8"));
  const stocks = watchlist.stocks;
  const total = stocks.length;
  const progress = loadProgress();

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  🎯 シグナル検証バッチ (並列版) ${filteredMode ? "(フィルタ済み)" : ""}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  対象: ${total}銘柄`);
  console.log(`  モード: ${detectOnly ? "検出のみ" : "検出 + Go/No Go検証"}`);
  if (filteredMode) console.log(`  シグナルフィルタ: MACD Trail 12% (1ヶ月以内)`);
  console.log(`  並列数: Phase1=${PHASE1_CONCURRENCY} / Phase2=${PHASE2_CONCURRENCY}`);
  console.log(`  レジューム: ${resumeMode ? "ON" : "OFF"}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // ═══ Phase 1: アクティブシグナル検出 (並列) ═══
  console.log("═══ Phase 1: アクティブシグナル検出 (並列) ═══\n");

  const allActiveSignals = [];
  const detectStart = Date.now();
  let detectSuccess = 0;
  let detectError = 0;
  let detectSkip = 0;

  // キャッシュ済みをまず処理
  const uncachedStocks = [];
  for (const stock of stocks) {
    const { symbol, name } = stock;
    if (resumeMode && progress.detected[symbol]) {
      const cached = progress.detected[symbol];
      if (cached.signals) {
        for (const sig of cached.signals) {
          if (passesSignalFilter(sig)) {
            allActiveSignals.push({ symbol, name, signal: sig });
          }
        }
      }
      detectSkip++;
    } else {
      uncachedStocks.push(stock);
    }
  }

  if (detectSkip > 0) {
    console.log(`  キャッシュ済み: ${detectSkip}銘柄 (シグナル: ${allActiveSignals.length}件ヒット)`);
  }

  if (uncachedStocks.length > 0) {
    console.log(`  新規検出: ${uncachedStocks.length}銘柄 (並列${PHASE1_CONCURRENCY})\n`);

    let lastSaveCount = 0;
    const tasks = uncachedStocks.map((stock) => async () => {
      const { symbol, name } = stock;
      const url = `${BASE_URL}/api/signals?symbol=${encodeURIComponent(symbol)}`;
      const res = await fetchWithRetry(url);
      return { symbol, name, res };
    });

    await runParallel(tasks, PHASE1_CONCURRENCY, (i, result, err) => {
      const done = detectSuccess + detectError;
      const stock = uncachedStocks[i];
      const { symbol, name } = stock;

      if (err) {
        detectError++;
        progress.detected[symbol] = { error: err.message };
        if ((done + 1) % 100 === 0) {
          console.log(`  [${done + 1}/${uncachedStocks.length}] ${symbol} ✗`);
        }
        return;
      }

      const { res } = result;
      const activeDaily = res.activeSignals?.daily ?? [];
      const activeWeekly = res.activeSignals?.weekly ?? [];
      const combined = [
        ...activeDaily.map((s) => ({ ...s, period: "daily" })),
        ...activeWeekly.map((s) => ({ ...s, period: "weekly" })),
      ];

      progress.detected[symbol] = {
        signals: combined,
        dailyCount: activeDaily.length,
        weeklyCount: activeWeekly.length,
      };

      const filtered = combined.filter(passesSignalFilter);
      if (filtered.length > 0) {
        console.log(`  [${done + 1}/${uncachedStocks.length}] ${symbol} ${name}: ${filtered.length}件ヒット`);
        for (const sig of filtered) {
          allActiveSignals.push({ symbol, name, signal: sig });
        }
      }

      detectSuccess++;

      // 100件ごとに進捗保存
      if (done - lastSaveCount >= 100) {
        lastSaveCount = done;
        saveProgress(progress);
        const elapsed = Date.now() - detectStart;
        const pct = Math.round(((done + 1) / uncachedStocks.length) * 100);
        console.log(`\n  ── 検出進捗: ${done + 1}/${uncachedStocks.length} (${pct}%, ${formatDuration(elapsed)}) ──\n`);
      }
    });
  }

  saveProgress(progress);

  const detectElapsed = Date.now() - detectStart;
  console.log(`\n  Phase 1 完了 (${formatDuration(detectElapsed)})`);
  console.log(`  検出: ✓${detectSuccess} ✗${detectError} ⏭${detectSkip}`);
  console.log(`  フィルタ後シグナル合計: ${allActiveSignals.length}件\n`);

  if (detectOnly || allActiveSignals.length === 0) {
    if (allActiveSignals.length === 0) {
      console.log("  アクティブシグナルなし。検証不要。");
    }
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    return;
  }

  // ═══ Phase 2: Go/No Go 検証 (並列) ═══
  console.log(`═══ Phase 2: Go/No Go 検証 (並列${PHASE2_CONCURRENCY}) ═══\n`);

  const validationStart = Date.now();
  let validSuccess = 0;
  let validError = 0;
  let validSkip = 0;

  // キャッシュ済みスキップ
  const uncachedSignals = [];
  for (const entry of allActiveSignals) {
    const { symbol, signal } = entry;
    const strategyId = `${signal.strategyId}_${signal.period}_${signal.buyDate}`;
    if (resumeMode && progress.validated[`${symbol}:${strategyId}`] === "ok") {
      validSkip++;
    } else {
      uncachedSignals.push(entry);
    }
  }

  if (validSkip > 0) {
    console.log(`  検証キャッシュ済み: ${validSkip}件スキップ`);
  }

  if (uncachedSignals.length > 0) {
    console.log(`  新規検証: ${uncachedSignals.length}件 (並列${PHASE2_CONCURRENCY})\n`);

    const tasks = uncachedSignals.map((entry) => async () => {
      const { symbol, name, signal } = entry;
      const strategyId = `${signal.strategyId}_${signal.period}_${signal.buyDate}`;
      const signalDesc = `${signal.strategyName} (${signal.period === "daily" ? "日足" : "週足"}): ${signal.buyDate}にエントリー (買値:${signal.buyPrice}円, 現在価格:${signal.currentPrice}円, 損益:${signal.pnlPct > 0 ? "+" : ""}${signal.pnlPct}%)`;

      const params = new URLSearchParams({
        symbol, name, signalDesc,
        signalStrategy: signal.strategyName,
        signalStrategyId: strategyId,
      });
      const url = `${BASE_URL}/api/fundamental?${params.toString()}`;
      const res = await fetchWithRetry(url);
      return { symbol, name, signal, strategyId, res };
    });

    await runParallel(tasks, PHASE2_CONCURRENCY, (i, result, err) => {
      const entry = uncachedSignals[i];
      const { symbol, signal } = entry;
      const strategyId = `${signal.strategyId}_${signal.period}_${signal.buyDate}`;
      const done = validSuccess + validError;

      if (err) {
        validError++;
        progress.validated[`${symbol}:${strategyId}`] = `error: ${err.message}`;
        console.log(`  [${done + 1}/${uncachedSignals.length}] ${symbol} ✗ ${err.message.slice(0, 60)}`);
        return;
      }

      const { res, name: stockName } = result;
      const decision = res.validation?.decision ?? "?";
      const summary = res.validation?.summary ?? "";
      const cached = res.validationCached ? " (cached)" : "";
      console.log(`  [${done + 1}/${uncachedSignals.length}] ${symbol} ${stockName} | ${signal.strategyName} (${signal.period === "daily" ? "日" : "週"}) → ${decision}${cached}`);
      if (summary) {
        const s = typeof summary === "string" ? summary : JSON.stringify(summary);
        console.log(`    ${s.slice(0, 100)}`);
      }

      progress.validated[`${symbol}:${strategyId}`] = "ok";
      validSuccess++;

      // 10件ごとに進捗保存
      if ((done + 1) % 10 === 0) {
        saveProgress(progress);
        const elapsed = Date.now() - validationStart;
        const remaining = ((elapsed / (done + 1)) * (uncachedSignals.length - done - 1));
        console.log(`\n  ── 検証進捗: ${done + 1}/${uncachedSignals.length} (${formatDuration(elapsed)}経過, 残り約${formatDuration(remaining)}) ──\n`);
      }
    });
  }

  saveProgress(progress);

  const totalElapsed = Date.now() - detectStart;

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  🎯 シグナル検証 完了");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  所要時間: ${formatDuration(totalElapsed)}`);
  console.log(`  検出: ✓${detectSuccess} ✗${detectError} ⏭${detectSkip}`);
  console.log(`  検証: ✓${validSuccess} ✗${validError} ⏭${validSkip}`);
  console.log(`  アクティブシグナル合計: ${allActiveSignals.length}件`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

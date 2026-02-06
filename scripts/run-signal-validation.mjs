/**
 * シグナル検証バッチスクリプト
 * 1. 全銘柄のアクティブシグナルを検出
 * 2. 各シグナルに対してGo/No Go判定を実行（Ollama使用）
 *
 * Usage: node scripts/run-signal-validation.mjs [--resume] [--detect-only]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = "http://localhost:3000";
const WATCHLIST_PATH = path.join(__dirname, "..", "data", "watchlist.json");
const PROGRESS_PATH = path.join(__dirname, "..", "data", "signal-validation-progress.json");

const REQUEST_TIMEOUT_MS = 180000; // 3分（検証は重い）
const MAX_RETRIES = 2;
const DELAY_BETWEEN_STOCKS_MS = 300;
const DELAY_BETWEEN_VALIDATIONS_MS = 500;

const args = process.argv.slice(2);
const resumeMode = args.includes("--resume");
const detectOnly = args.includes("--detect-only");
const filteredMode = args.includes("--filtered");

// フィルタ対象銘柄 (65銘柄)
const FILTERED_SYMBOLS = new Set([
  "7203.T","7011.T","6701.T","6503.T","8035.T","8306.T","1605.T","6501.T","6526.T","6723.T",
  "285A.T","3993.T","3778.T","9613.T","7012.T","6965.T","7013.T","186A.T","5765.T","5020.T",
  "4204.T","9531.T","9532.T","9519.T","7711.T","4026.T","5310.T","7701.T","7721.T","2768.T",
  "3436.T","5831.T","6146.T","6762.T","6857.T","6920.T","6963.T","6971.T","6976.T","6981.T",
  "7186.T","7735.T","8001.T","8002.T","8015.T","8031.T","8053.T","8058.T","8253.T","8304.T",
  "8308.T","8309.T","8316.T","8331.T","8354.T","8411.T","8591.T","8601.T","8604.T","8630.T",
  "8697.T","8725.T","8750.T","8766.T","8795.T",
]);

// フィルタ対象戦略
const FILTERED_STRATEGIES = new Set([
  "tabata_cwh", "ma_cross", "macd_signal", "macd_trail12",
]);

// シグナルレベルフィルタ (--filtered 使用時)
function passesSignalFilter(signal) {
  if (!filteredMode) return true;
  // 戦略フィルタ
  if (!FILTERED_STRATEGIES.has(signal.strategyId)) return false;
  // 1ヶ月以内
  const oneMonthAgo = new Date();
  oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
  if (new Date(signal.buyDate) < oneMonthAgo) return false;
  // 損益±10%以内
  if (Math.abs(signal.pnlPct) > 10) return false;
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
        console.log(`    ⟳ リトライ ${attempt + 1}/${retries} (${wait / 1000}s待機)...`);
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

async function main() {
  const watchlist = JSON.parse(fs.readFileSync(WATCHLIST_PATH, "utf-8"));
  const allStocksRaw = watchlist.stocks;
  const stocks = filteredMode
    ? allStocksRaw.filter((s) => FILTERED_SYMBOLS.has(s.symbol))
    : allStocksRaw;
  const total = stocks.length;
  const progress = loadProgress();

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  🎯 シグナル検証バッチ ${filteredMode ? "(フィルタ済み)" : ""}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  対象: ${total}銘柄${filteredMode ? " (フィルタ済み)" : ""}`);
  console.log(`  モード: ${detectOnly ? "検出のみ" : "検出 + Go/No Go検証"}`);
  console.log(`  レジューム: ${resumeMode ? "ON" : "OFF"}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // ═══ Phase 1: アクティブシグナル検出 ═══
  console.log("═══ Phase 1: アクティブシグナル検出 ═══\n");

  const allActiveSignals = []; // { symbol, name, signal }
  const detectStart = Date.now();
  let detectSuccess = 0;
  let detectError = 0;
  let detectSkip = 0;

  for (let i = 0; i < total; i++) {
    const stock = stocks[i];
    const { symbol, name } = stock;

    if (resumeMode && progress.detected[symbol]) {
      // 既にキャッシュされたシグナル結果を利用
      const cached = progress.detected[symbol];
      if (cached.signals) {
        for (const sig of cached.signals) {
          if (passesSignalFilter(sig)) {
            allActiveSignals.push({ symbol, name, signal: sig });
          }
        }
      }
      detectSkip++;
      continue;
    }

    try {
      const url = `${BASE_URL}/api/signals?symbol=${encodeURIComponent(symbol)}`;
      const res = await fetchWithRetry(url);

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
        console.log(`[${i + 1}/${total}] ${symbol} ${name}: ${filtered.length}件${filteredMode ? ` (全${combined.length}件中)` : ""} (日足${activeDaily.length}/週足${activeWeekly.length})`);
        for (const sig of filtered) {
          console.log(`    ${sig.period === "daily" ? "日" : "週"} ${sig.strategyName} (${sig.buyDate}) → ${sig.pnlPct > 0 ? "+" : ""}${sig.pnlPct}%`);
          allActiveSignals.push({ symbol, name, signal: sig });
        }
      }
      detectSuccess++;
    } catch (err) {
      console.log(`[${i + 1}/${total}] ${symbol} ${name}: ✗ ${err.message}`);
      progress.detected[symbol] = { error: err.message };
      detectError++;
    }

    await sleep(DELAY_BETWEEN_STOCKS_MS);

    if ((i + 1) % 50 === 0) {
      saveProgress(progress);
      const elapsed = Date.now() - detectStart;
      console.log(`\n  ── 検出進捗: ${i + 1}/${total} (${formatDuration(elapsed)}) ──\n`);
    }
  }

  saveProgress(progress);

  console.log(`\n  検出完了: ✓${detectSuccess} ✗${detectError} ⏭${detectSkip}`);
  console.log(`  アクティブシグナル合計: ${allActiveSignals.length}件\n`);

  if (detectOnly || allActiveSignals.length === 0) {
    if (allActiveSignals.length === 0) {
      console.log("  アクティブシグナルなし。検証不要。");
    }
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    return;
  }

  // ═══ Phase 2: Go/No Go 検証 ═══
  console.log("═══ Phase 2: Go/No Go 検証 (Ollama) ═══\n");

  const validationStart = Date.now();
  let validSuccess = 0;
  let validError = 0;
  let validSkip = 0;

  for (let i = 0; i < allActiveSignals.length; i++) {
    const { symbol, name, signal } = allActiveSignals[i];
    const strategyId = `${signal.strategyId}_${signal.period}_${signal.buyDate}`;

    if (resumeMode && progress.validated[`${symbol}:${strategyId}`] === "ok") {
      validSkip++;
      continue;
    }

    const signalDesc = `${signal.strategyName} (${signal.period === "daily" ? "日足" : "週足"}): ${signal.buyDate}にエントリー (買値:${signal.buyPrice}円, 現在価格:${signal.currentPrice}円, 損益:${signal.pnlPct > 0 ? "+" : ""}${signal.pnlPct}%)`;

    console.log(`[${i + 1}/${allActiveSignals.length}] ${symbol} ${name}`);
    console.log(`  シグナル: ${signal.strategyName} (${signal.period === "daily" ? "日足" : "週足"}) ${signal.pnlPct > 0 ? "+" : ""}${signal.pnlPct}%`);

    try {
      const params = new URLSearchParams({
        symbol,
        name,
        signalDesc,
        signalStrategy: signal.strategyName,
        signalStrategyId: strategyId,
      });
      const url = `${BASE_URL}/api/fundamental?${params.toString()}`;
      const res = await fetchWithRetry(url);

      const decision = res.validation?.decision ?? "?";
      const summary = res.validation?.summary ?? "";
      const cached = res.validationCached ? " (cached)" : "";
      console.log(`  判定: ${decision}${cached}`);
      if (summary) console.log(`  要約: ${typeof summary === "string" ? summary.slice(0, 100) : JSON.stringify(summary).slice(0, 100)}`);

      progress.validated[`${symbol}:${strategyId}`] = "ok";
      validSuccess++;
    } catch (err) {
      console.log(`  検証: ✗ ${err.message}`);
      progress.validated[`${symbol}:${strategyId}`] = `error: ${err.message}`;
      validError++;
    }

    await sleep(DELAY_BETWEEN_VALIDATIONS_MS);

    if ((i + 1) % 10 === 0) {
      saveProgress(progress);
      const elapsed = Date.now() - validationStart;
      const remaining = ((elapsed / (i + 1)) * (allActiveSignals.length - i - 1));
      console.log(`\n  ── 検証進捗: ${i + 1}/${allActiveSignals.length} (${formatDuration(elapsed)}経過, 残り約${formatDuration(remaining)}) ──\n`);
    }
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

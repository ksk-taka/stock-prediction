/**
 * 全銘柄バッチ分析スクリプト
 * ニュース → AI分析 → ファンダメンタルズ分析 を全銘柄に実行
 *
 * Usage: node scripts/run-batch-analysis.mjs [--resume] [--news-only] [--analyze-only] [--fundamental-only]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = "http://localhost:3000";
const WATCHLIST_PATH = path.join(__dirname, "..", "data", "watchlist.json");
const PROGRESS_PATH = path.join(__dirname, "..", "data", "batch-progress.json");

// 設定
const DELAY_BETWEEN_STOCKS_MS = 500;  // 銘柄間の待機時間
const DELAY_BETWEEN_APIS_MS = 300;    // API間の待機時間
const REQUEST_TIMEOUT_MS = 120000;     // 各APIのタイムアウト (2分)
const MAX_RETRIES = 2;

const args = process.argv.slice(2);
const resumeMode = args.includes("--resume");
const newsOnly = args.includes("--news-only");
const analyzeOnly = args.includes("--analyze-only");
const fundamentalOnly = args.includes("--fundamental-only");
const filteredMode = args.includes("--filtered");
const allSteps = !newsOnly && !analyzeOnly && !fundamentalOnly;

// フィルタ対象銘柄 (65銘柄: 防衛・航空宇宙, AI・半導体, エネルギー・GX・核融合, 金融・商社)
const FILTERED_SYMBOLS = new Set([
  "7203.T","7011.T","6701.T","6503.T","8035.T","8306.T","1605.T","6501.T","6526.T","6723.T",
  "285A.T","3993.T","3778.T","9613.T","7012.T","6965.T","7013.T","186A.T","5765.T","5020.T",
  "4204.T","9531.T","9532.T","9519.T","7711.T","4026.T","5310.T","7701.T","7721.T","2768.T",
  "3436.T","5831.T","6146.T","6762.T","6857.T","6920.T","6963.T","6971.T","6976.T","6981.T",
  "7186.T","7735.T","8001.T","8002.T","8015.T","8031.T","8053.T","8058.T","8253.T","8304.T",
  "8308.T","8309.T","8316.T","8331.T","8354.T","8411.T","8591.T","8601.T","8604.T","8630.T",
  "8697.T","8725.T","8750.T","8766.T","8795.T",
]);

// 進捗管理
function loadProgress() {
  try {
    if (resumeMode && fs.existsSync(PROGRESS_PATH)) {
      return JSON.parse(fs.readFileSync(PROGRESS_PATH, "utf-8"));
    }
  } catch { /* ignore */ }
  return { news: {}, analyze: {}, fundamental: {}, startedAt: new Date().toISOString() };
}

function saveProgress(progress) {
  progress.updatedAt = new Date().toISOString();
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 2), "utf-8");
}

// HTTP fetch with timeout and retry
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
        const wait = (attempt + 1) * 3000;
        console.log(`    ⟳ リトライ ${attempt + 1}/${retries} (${wait / 1000}s待機)...`);
        await sleep(wait);
      } else {
        throw err;
      }
    }
  }
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

async function main() {
  const watchlist = JSON.parse(fs.readFileSync(WATCHLIST_PATH, "utf-8"));
  const allStocksRaw = watchlist.stocks;
  const stocks = filteredMode
    ? allStocksRaw.filter((s) => FILTERED_SYMBOLS.has(s.symbol))
    : allStocksRaw;
  const total = stocks.length;
  const progress = loadProgress();

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  📊 バッチ分析 ${filteredMode ? "- フィルタ済み" : "- 全銘柄"}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  対象: ${total}銘柄${filteredMode ? " (フィルタ済み)" : ""}`);
  console.log(`  モード: ${allSteps ? "全ステップ" : [newsOnly && "ニュース", analyzeOnly && "AI分析", fundamentalOnly && "ファンダ"].filter(Boolean).join(", ")}`);
  console.log(`  レジューム: ${resumeMode ? "ON" : "OFF"}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const globalStart = Date.now();
  let successCount = { news: 0, analyze: 0, fundamental: 0 };
  let errorCount = { news: 0, analyze: 0, fundamental: 0 };
  let skipCount = { news: 0, analyze: 0, fundamental: 0 };

  for (let i = 0; i < total; i++) {
    const stock = stocks[i];
    const { symbol, name } = stock;
    const num = `[${i + 1}/${total}]`;

    console.log(`${num} ${symbol} ${name}`);

    // ── Step 1: ニュース ──
    if (allSteps || newsOnly) {
      if (resumeMode && progress.news[symbol] === "ok") {
        skipCount.news++;
        console.log("  ニュース: スキップ (完了済)");
      } else {
        try {
          const url = `${BASE_URL}/api/news?symbol=${encodeURIComponent(symbol)}&name=${encodeURIComponent(name)}`;
          const res = await fetchWithRetry(url);
          const count = res.news?.length ?? 0;
          console.log(`  ニュース: ✓ ${count}件${res.cached ? " (cached)" : ""}`);
          progress.news[symbol] = "ok";
          successCount.news++;
        } catch (err) {
          console.log(`  ニュース: ✗ ${err.message}`);
          progress.news[symbol] = `error: ${err.message}`;
          errorCount.news++;
        }
        await sleep(DELAY_BETWEEN_APIS_MS);
      }
    }

    // ── Step 2: AI分析 ──
    if (allSteps || analyzeOnly) {
      if (resumeMode && progress.analyze[symbol] === "ok") {
        skipCount.analyze++;
        console.log("  AI分析:   スキップ (完了済)");
      } else {
        try {
          const url = `${BASE_URL}/api/analyze?symbol=${encodeURIComponent(symbol)}&name=${encodeURIComponent(name)}`;
          const res = await fetchWithRetry(url);
          const outlook = res.analysis?.outlook ?? "?";
          console.log(`  AI分析:   ✓ ${outlook}${res.cached ? " (cached)" : ""}`);
          progress.analyze[symbol] = "ok";
          successCount.analyze++;
        } catch (err) {
          console.log(`  AI分析:   ✗ ${err.message}`);
          progress.analyze[symbol] = `error: ${err.message}`;
          errorCount.analyze++;
        }
        await sleep(DELAY_BETWEEN_APIS_MS);
      }
    }

    // ── Step 3: ファンダメンタルズ分析 ──
    if (allSteps || fundamentalOnly) {
      if (resumeMode && progress.fundamental[symbol] === "ok") {
        skipCount.fundamental++;
        console.log("  ファンダ: スキップ (完了済)");
      } else {
        try {
          const url = `${BASE_URL}/api/fundamental?symbol=${encodeURIComponent(symbol)}&name=${encodeURIComponent(name)}`;
          const res = await fetchWithRetry(url);
          const judgment = res.analysis?.judgment ?? "?";
          console.log(`  ファンダ: ✓ ${judgment}${res.analysisCached ? " (cached)" : ""}`);
          progress.fundamental[symbol] = "ok";
          successCount.fundamental++;

          // watchlistのfundamentalを更新
          if (res.analysis?.judgment && res.analysis?.summary) {
            stock.fundamental = {
              judgment: res.analysis.judgment,
              memo: res.analysis.summary,
              analyzedAt: new Date().toISOString(),
            };
          }
        } catch (err) {
          console.log(`  ファンダ: ✗ ${err.message}`);
          progress.fundamental[symbol] = `error: ${err.message}`;
          errorCount.fundamental++;
        }
        await sleep(DELAY_BETWEEN_APIS_MS);
      }
    }

    // 進捗保存 (10銘柄ごと + watchlist更新)
    if ((i + 1) % 10 === 0 || i === total - 1) {
      saveProgress(progress);
      // watchlistも保存（fundamental結果反映）
      if (allSteps || fundamentalOnly) {
        watchlist.updatedAt = new Date().toISOString();
        fs.writeFileSync(WATCHLIST_PATH, JSON.stringify(watchlist, null, 2), "utf-8");
      }

      const elapsed = Date.now() - globalStart;
      const remaining = ((elapsed / (i + 1)) * (total - i - 1));
      console.log(`\n  ── 進捗: ${i + 1}/${total} (${formatDuration(elapsed)}経過, 残り約${formatDuration(remaining)}) ──\n`);
    }

    await sleep(DELAY_BETWEEN_STOCKS_MS);
  }

  // 最終保存
  saveProgress(progress);
  if (allSteps || fundamentalOnly) {
    watchlist.updatedAt = new Date().toISOString();
    fs.writeFileSync(WATCHLIST_PATH, JSON.stringify(watchlist, null, 2), "utf-8");
  }

  const totalElapsed = Date.now() - globalStart;

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  📊 バッチ分析 完了");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  所要時間: ${formatDuration(totalElapsed)}`);
  if (allSteps || newsOnly)
    console.log(`  ニュース: ✓${successCount.news} ✗${errorCount.news} ⏭${skipCount.news}`);
  if (allSteps || analyzeOnly)
    console.log(`  AI分析:   ✓${successCount.analyze} ✗${errorCount.analyze} ⏭${skipCount.analyze}`);
  if (allSteps || fundamentalOnly)
    console.log(`  ファンダ: ✓${successCount.fundamental} ✗${errorCount.fundamental} ⏭${skipCount.fundamental}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

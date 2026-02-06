/**
 * ファンダメンタルズ分析 並列実行スクリプト
 * Perplexity researchキャッシュ済みの銘柄のみ対象（Perplexity APIを叩かない）
 *
 * Usage: node scripts/run-fundamental-parallel.mjs [--resume]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = "http://localhost:3000";
const WATCHLIST_PATH = path.join(__dirname, "..", "data", "watchlist.json");
const PROGRESS_PATH = path.join(__dirname, "..", "data", "batch-progress.json");

const REQUEST_TIMEOUT_MS = 120000;
const MAX_RETRIES = 2;
const CONCURRENCY = 5;

const args = process.argv.slice(2);
const resumeMode = args.includes("--resume");

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
        await sleep((attempt + 1) * 3000);
      } else {
        throw err;
      }
    }
  }
}

async function runParallel(tasks, concurrency, onResult) {
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      try {
        const result = await tasks[i]();
        onResult(i, result, null);
      } catch (err) {
        onResult(i, null, err);
      }
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
}

// researchキャッシュ済みの銘柄リストを取得
function getResearchCachedSymbols() {
  const cacheDir = path.join(__dirname, "..", ".cache", "fundamental");
  if (!fs.existsSync(cacheDir)) return new Set();

  const RESEARCH_TTL = 12 * 60 * 60 * 1000;
  const now = Date.now();
  const symbols = new Set();

  for (const f of fs.readdirSync(cacheDir)) {
    if (!f.endsWith("_research.json")) continue;
    try {
      const entry = JSON.parse(fs.readFileSync(path.join(cacheDir, f), "utf-8"));
      if (now - entry.cachedAt <= RESEARCH_TTL) {
        const symbol = f.replace("_research.json", "").replace(/_/g, ".");
        symbols.add(symbol);
      }
    } catch { /* skip */ }
  }
  return symbols;
}

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

async function main() {
  const watchlist = JSON.parse(fs.readFileSync(WATCHLIST_PATH, "utf-8"));
  const stocks = watchlist.stocks;
  const progress = loadProgress();
  const researchCached = getResearchCachedSymbols();

  // researchキャッシュ済み かつ fundamental未完了 の銘柄
  const targets = stocks.filter((s) => {
    if (!researchCached.has(s.symbol)) return false;
    if (resumeMode && progress.fundamental[s.symbol] === "ok") return false;
    return true;
  });

  const alreadyDone = stocks.filter(
    (s) => researchCached.has(s.symbol) && progress.fundamental[s.symbol] === "ok"
  ).length;

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  📊 ファンダメンタルズ分析 (並列版)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  Perplexity research済み: ${researchCached.size}銘柄`);
  console.log(`  分析済みスキップ: ${alreadyDone}銘柄`);
  console.log(`  新規分析対象: ${targets.length}銘柄`);
  console.log(`  並列数: ${CONCURRENCY}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  if (targets.length === 0) {
    console.log("  分析対象なし。完了。");
    return;
  }

  const startTime = Date.now();
  let success = 0;
  let errors = 0;

  // watchlistのstock参照マップ
  const stockMap = new Map(stocks.map((s) => [s.symbol, s]));

  const tasks = targets.map((stock) => async () => {
    const { symbol, name } = stock;
    const url = `${BASE_URL}/api/fundamental?symbol=${encodeURIComponent(symbol)}&name=${encodeURIComponent(name)}`;
    const res = await fetchWithRetry(url);
    return { symbol, name, res };
  });

  await runParallel(tasks, CONCURRENCY, (i, result, err) => {
    const done = success + errors;
    const stock = targets[i];
    const { symbol } = stock;

    if (err) {
      errors++;
      progress.fundamental[symbol] = `error: ${err.message}`;
      console.log(`  [${done + 1}/${targets.length}] ${symbol} ✗ ${err.message.slice(0, 60)}`);
      return;
    }

    const { res, name } = result;
    const judgment = res.analysis?.judgment ?? "?";
    const cached = res.analysisCached ? " (cached)" : "";
    console.log(`  [${done + 1}/${targets.length}] ${symbol} ${name} → ${judgment}${cached}`);

    progress.fundamental[symbol] = "ok";
    success++;

    // watchlistのfundamentalを更新
    if (res.analysis?.judgment && res.analysis?.summary) {
      const s = stockMap.get(symbol);
      if (s) {
        s.fundamental = {
          judgment: res.analysis.judgment,
          memo: res.analysis.summary,
          analyzedAt: new Date().toISOString(),
        };
      }
    }

    // 50件ごとに進捗保存
    if ((done + 1) % 50 === 0) {
      saveProgress(progress);
      watchlist.updatedAt = new Date().toISOString();
      fs.writeFileSync(WATCHLIST_PATH, JSON.stringify(watchlist, null, 2), "utf-8");
      const elapsed = Date.now() - startTime;
      const remaining = (elapsed / (done + 1)) * (targets.length - done - 1);
      console.log(`\n  ── 進捗: ${done + 1}/${targets.length} (${formatDuration(elapsed)}経過, 残り約${formatDuration(remaining)}) ──\n`);
    }
  });

  // 最終保存
  saveProgress(progress);
  watchlist.updatedAt = new Date().toISOString();
  fs.writeFileSync(WATCHLIST_PATH, JSON.stringify(watchlist, null, 2), "utf-8");

  const elapsed = Date.now() - startTime;
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  📊 ファンダメンタルズ分析 完了");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  所要時間: ${formatDuration(elapsed)}`);
  console.log(`  成功: ${success} / エラー: ${errors} / スキップ: ${alreadyDone}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

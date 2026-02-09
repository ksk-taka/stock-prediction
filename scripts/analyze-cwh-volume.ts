#!/usr/bin/env npx tsx
// ============================================================
// CWH出来高分析
// ウォークフォワードのトレード明細CSVを読み込み、
// ブレイクアウト日の出来高倍率と勝敗の関係を分析する。
//
// 使い方:
//   npx tsx scripts/analyze-cwh-volume.ts data/wf-trades-2026-02-07T11-11-58.csv
// ============================================================

import { readFileSync } from "fs";
import { join } from "path";
import { getHistoricalPrices } from "@/lib/api/yahooFinance";
import type { PriceData } from "@/types";

// ── CSV読み込み ──

interface TradeRow {
  window: string;
  strategyId: string;
  symbol: string;
  entryDate: string;
  exitDate: string;
  entryPrice: number;
  exitPrice: number;
  returnPct: number;
  win: boolean;
}

function loadTrades(csvPath: string): TradeRow[] {
  const raw = readFileSync(csvPath, "utf-8");
  const lines = raw.trim().split("\n");
  const header = lines[0].split(",");
  const rows: TradeRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const get = (key: string) => cols[header.indexOf(key)] ?? "";
    rows.push({
      window: get("window"),
      strategyId: get("strategyId"),
      symbol: get("symbol"),
      entryDate: get("entryDate"),
      exitDate: get("exitDate"),
      entryPrice: parseFloat(get("entryPrice")),
      exitPrice: parseFloat(get("exitPrice")),
      returnPct: parseFloat(get("returnPct")),
      win: get("win") === "1",
    });
  }

  return rows.filter((r) => r.strategyId === "tabata_cwh" || r.strategyId === "cwh_trail");
}

// ── 出来高倍率算出 ──

interface VolumeAnalysis {
  symbol: string;
  entryDate: string;
  strategyId: string;
  win: boolean;
  returnPct: number;
  entryVolume: number;
  avgVolume20: number;
  volumeRatio: number;
}

async function analyzeVolume(trades: TradeRow[]): Promise<VolumeAnalysis[]> {
  // 銘柄ごとにグループ化
  const symbolSet = new Set(trades.map((t) => t.symbol));
  const symbols = [...symbolSet];

  console.log(`[Phase 1] ${symbols.length}銘柄の10年日足データ取得中...`);

  // 銘柄→日足データのマップ
  const dataMap = new Map<string, PriceData[]>();
  const BATCH = 10;
  let fetched = 0;

  for (let i = 0; i < symbols.length; i += BATCH) {
    const batch = symbols.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map(async (sym) => {
        // 10年分取得するため、startDateを手動で設定
        const data = await getHistoricalPrices(sym, "daily");
        return { sym, data };
      }),
    );

    for (const r of results) {
      fetched++;
      if (r.status === "fulfilled" && r.value.data.length > 0) {
        dataMap.set(r.value.sym, r.value.data);
      }
    }
    process.stdout.write(`\r  [${fetched}/${symbols.length}]`);
  }
  console.log(`\n  ${dataMap.size}銘柄のデータ取得完了\n`);

  // ── 各トレードの出来高倍率を算出 ──
  console.log("[Phase 2] 出来高倍率算出中...");
  const results: VolumeAnalysis[] = [];
  let skipped = 0;

  for (const trade of trades) {
    const data = dataMap.get(trade.symbol);
    if (!data) { skipped++; continue; }

    // エントリー日のインデックスを探す
    const entryIdx = data.findIndex((d) => d.date.startsWith(trade.entryDate));
    if (entryIdx < 0) {
      // 日付が完全一致しない場合、最も近い日を探す
      const entryTime = new Date(trade.entryDate).getTime();
      let closest = -1;
      let minDiff = Infinity;
      for (let j = 0; j < data.length; j++) {
        const diff = Math.abs(new Date(data[j].date).getTime() - entryTime);
        if (diff < minDiff) { minDiff = diff; closest = j; }
      }
      if (closest < 0 || minDiff > 5 * 24 * 60 * 60 * 1000) {
        skipped++;
        continue;
      }
      // closestを使用
      const idx = closest;
      if (idx < 20) { skipped++; continue; }

      const entryVolume = data[idx].volume;
      const avgVolume20 = data
        .slice(idx - 20, idx)
        .reduce((s, d) => s + d.volume, 0) / 20;

      if (avgVolume20 === 0) { skipped++; continue; }

      results.push({
        symbol: trade.symbol,
        entryDate: trade.entryDate,
        strategyId: trade.strategyId,
        win: trade.win,
        returnPct: trade.returnPct,
        entryVolume,
        avgVolume20,
        volumeRatio: entryVolume / avgVolume20,
      });
      continue;
    }

    if (entryIdx < 20) { skipped++; continue; }

    const entryVolume = data[entryIdx].volume;
    const avgVolume20 = data
      .slice(entryIdx - 20, entryIdx)
      .reduce((s, d) => s + d.volume, 0) / 20;

    if (avgVolume20 === 0) { skipped++; continue; }

    results.push({
      symbol: trade.symbol,
      entryDate: trade.entryDate,
      strategyId: trade.strategyId,
      win: trade.win,
      returnPct: trade.returnPct,
      entryVolume,
      avgVolume20,
      volumeRatio: entryVolume / avgVolume20,
    });
  }

  console.log(`  ${results.length}トレード分析完了 (スキップ: ${skipped}件)\n`);
  return results;
}

// ── 統計ヘルパー ──

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function mean(arr: number[]): number {
  return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;
}

function fmtPct(v: number): string {
  return (v >= 0 ? "+" : "") + v.toFixed(1);
}

// ── メイン ──

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error("Usage: npx tsx scripts/analyze-cwh-volume.ts <csv-path>");
    process.exit(1);
  }

  const fullPath = csvPath.startsWith("/") || csvPath.includes(":")
    ? csvPath
    : join(process.cwd(), csvPath);

  const trades = loadTrades(fullPath);
  console.log("=".repeat(70));
  console.log("CWH出来高分析");
  console.log(`  CSV: ${csvPath}`);
  console.log(`  CWHトレード数: ${trades.length} (tabata_cwh: ${trades.filter((t) => t.strategyId === "tabata_cwh").length}, cwh_trail: ${trades.filter((t) => t.strategyId === "cwh_trail").length})`);
  console.log("=".repeat(70));

  const results = await analyzeVolume(trades);

  // ── 戦略別分析 ──
  for (const stratId of ["tabata_cwh", "cwh_trail"] as const) {
    const stratTrades = results.filter((r) => r.strategyId === stratId);
    if (stratTrades.length === 0) continue;

    const wins = stratTrades.filter((r) => r.win);
    const losses = stratTrades.filter((r) => !r.win);

    const stratName = stratId === "tabata_cwh" ? "田端式CWH" : "CWHトレーリング";
    console.log("\n" + "=".repeat(70));
    console.log(`【${stratName}】 ${stratTrades.length}トレード (勝${wins.length} / 負${losses.length})`);
    console.log("=".repeat(70));

    // ── 勝ち vs 負け の出来高倍率比較 ──
    console.log("\n■ 出来高倍率の分布 (エントリー日 volume / 過去20日平均)");
    console.log("-".repeat(50));
    console.log(`  勝ちトレード: 中央値 ${median(wins.map((r) => r.volumeRatio)).toFixed(2)}x  平均 ${mean(wins.map((r) => r.volumeRatio)).toFixed(2)}x  (n=${wins.length})`);
    console.log(`  負けトレード: 中央値 ${median(losses.map((r) => r.volumeRatio)).toFixed(2)}x  平均 ${mean(losses.map((r) => r.volumeRatio)).toFixed(2)}x  (n=${losses.length})`);
    console.log(`  全トレード:   中央値 ${median(stratTrades.map((r) => r.volumeRatio)).toFixed(2)}x  平均 ${mean(stratTrades.map((r) => r.volumeRatio)).toFixed(2)}x`);

    // ── 出来高倍率別の勝率・リターン ──
    console.log("\n■ 出来高倍率フィルタ別の成績");
    console.log("-".repeat(70));
    console.log(
      "閾値".padEnd(10) +
      "トレード".padEnd(10) +
      "勝ち".padEnd(8) +
      "負け".padEnd(8) +
      "勝率%".padEnd(10) +
      "平均Ret%".padEnd(12) +
      "中央Ret%".padEnd(12) +
      "除外数".padEnd(8),
    );
    console.log("-".repeat(70));

    const thresholds = [0.0, 0.5, 0.8, 1.0, 1.2, 1.5, 2.0, 2.5, 3.0];
    for (const th of thresholds) {
      const filtered = stratTrades.filter((r) => r.volumeRatio >= th);
      const fWins = filtered.filter((r) => r.win).length;
      const fLosses = filtered.filter((r) => !r.win).length;
      const fTotal = fWins + fLosses;
      const winRate = fTotal > 0 ? (fWins / fTotal) * 100 : 0;
      const avgRet = mean(filtered.map((r) => r.returnPct));
      const medRet = median(filtered.map((r) => r.returnPct));
      const excluded = stratTrades.length - filtered.length;

      const label = th === 0 ? "(全件)" : `>= ${th.toFixed(1)}x`;
      console.log(
        label.padEnd(10) +
        fTotal.toString().padEnd(10) +
        fWins.toString().padEnd(8) +
        fLosses.toString().padEnd(8) +
        winRate.toFixed(1).padEnd(10) +
        fmtPct(avgRet).padEnd(12) +
        fmtPct(medRet).padEnd(12) +
        excluded.toString().padEnd(8),
      );
    }

    // ── 出来高倍率のパーセンタイル ──
    const ratios = stratTrades.map((r) => r.volumeRatio).sort((a, b) => a - b);
    console.log("\n■ 出来高倍率のパーセンタイル");
    console.log("-".repeat(40));
    const pcts = [0, 10, 25, 50, 75, 90, 100];
    for (const p of pcts) {
      const idx = Math.min(Math.floor((ratios.length - 1) * p / 100), ratios.length - 1);
      console.log(`  P${p.toString().padStart(3)}: ${ratios[idx].toFixed(2)}x`);
    }

    // ── 負けトレードの出来高特徴 ──
    if (losses.length > 0) {
      console.log("\n■ 負けトレード詳細 (出来高倍率順)");
      console.log("-".repeat(80));
      console.log(
        "銘柄".padEnd(10) +
        "エントリー".padEnd(14) +
        "Ret%".padEnd(10) +
        "出来高倍率".padEnd(12) +
        "Window".padEnd(20),
      );
      console.log("-".repeat(80));
      const sortedLosses = [...losses].sort((a, b) => a.volumeRatio - b.volumeRatio);
      for (const t of sortedLosses) {
        const window = trades.find(
          (tr) => tr.symbol === t.symbol && tr.entryDate === t.entryDate && tr.strategyId === t.strategyId,
        )?.window ?? "";
        console.log(
          t.symbol.padEnd(10) +
          t.entryDate.padEnd(14) +
          fmtPct(t.returnPct).padEnd(10) +
          t.volumeRatio.toFixed(2).padEnd(12) +
          window.padEnd(20),
        );
      }
    }
  }

  // ── 結論サマリー ──
  console.log("\n" + "=".repeat(70));
  console.log("結論サマリー");
  console.log("=".repeat(70));

  for (const stratId of ["tabata_cwh", "cwh_trail"] as const) {
    const stratTrades = results.filter((r) => r.strategyId === stratId);
    if (stratTrades.length === 0) continue;

    const stratName = stratId === "tabata_cwh" ? "田端式CWH" : "CWHトレーリング";
    const wins = stratTrades.filter((r) => r.win);
    const losses = stratTrades.filter((r) => !r.win);

    const winVolMedian = median(wins.map((r) => r.volumeRatio));
    const lossVolMedian = median(losses.map((r) => r.volumeRatio));
    const diff = winVolMedian - lossVolMedian;

    console.log(`\n${stratName}:`);
    console.log(`  勝ちの出来高中央値: ${winVolMedian.toFixed(2)}x`);
    console.log(`  負けの出来高中央値: ${lossVolMedian.toFixed(2)}x`);
    console.log(`  差: ${diff >= 0 ? "+" : ""}${diff.toFixed(2)}x`);

    if (Math.abs(diff) < 0.2) {
      console.log(`  → 出来高と勝敗の相関は弱い。フィルタ効果は限定的の可能性`);
    } else if (diff > 0) {
      console.log(`  → 勝ちトレードの方が出来高が多い。フィルタ効果あり`);
    } else {
      console.log(`  → 負けトレードの方が出来高が多い。出来高が多い=良いとは限らない`);
    }

    // 最も勝率が改善する閾値を探す
    const baseWR = stratTrades.length > 0
      ? (wins.length / stratTrades.length) * 100
      : 0;

    let bestTh = 0;
    let bestWR = baseWR;
    let bestN = stratTrades.length;
    for (const th of [0.5, 0.8, 1.0, 1.2, 1.5, 2.0, 2.5, 3.0]) {
      const filtered = stratTrades.filter((r) => r.volumeRatio >= th);
      if (filtered.length < 5) break; // サンプル少なすぎ
      const wr = (filtered.filter((r) => r.win).length / filtered.length) * 100;
      if (wr > bestWR) {
        bestWR = wr;
        bestTh = th;
        bestN = filtered.length;
      }
    }

    if (bestTh > 0) {
      console.log(`  最適閾値: >= ${bestTh.toFixed(1)}x → 勝率 ${baseWR.toFixed(1)}% → ${bestWR.toFixed(1)}% (n=${bestN})`);
    } else {
      console.log(`  出来高フィルタで勝率改善なし`);
    }
  }

  console.log("\n" + "=".repeat(70));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
import type { PriceData } from "@/types";
import { calcBollingerBands } from "./indicators";

export interface CupMeta {
  leftRimIdx: number;
  bottomIdx: number;
  rightRimIdx: number;
  leftRimHigh: number;
  bottomLow: number;
  rightRimHigh: number;
}

export interface BuySignal {
  index: number;
  date: string;
  price: number;
  type: "bb_reversal" | "shitabanare" | "cup_with_handle";
  label: string;
  description: string;
  cupMeta?: CupMeta;
}

/**
 * 条件A: ボリンジャーバンド逆張り（売られすぎ）
 * - 終値がBB -2σを下回った
 * - その後、陽線出現（回復の兆し）でシグナル発火
 */
function detectBBReversal(data: PriceData[], bb: ReturnType<typeof calcBollingerBands>): BuySignal[] {
  const signals: BuySignal[] = [];
  let belowBand = false;

  for (let i = 1; i < data.length; i++) {
    const lower2 = bb[i]?.lower2;
    if (lower2 == null) continue;

    // -2σを下回った状態を記録
    if (data[i].close < lower2) {
      belowBand = true;
      continue;
    }

    // -2σを下回っていた後に陽線（回復の兆し）
    if (belowBand && data[i].close > data[i].open) {
      signals.push({
        index: i,
        date: data[i].date,
        price: data[i].low,
        type: "bb_reversal",
        label: "BB逆張り",
        description: `BB -2σ割れ後の反転陽線 (終値: ${data[i].close.toLocaleString()})`,
      });
      belowBand = false;
    }

    // -2σより上に戻ったらリセット
    if (data[i].close > lower2) {
      belowBand = false;
    }
  }

  return signals;
}

/**
 * 条件B: 下放れ二本黒風パターン（ちょる子流解釈）
 * 1. ギャップダウン（窓開け）: 当日始値 < 前日安値
 * 2. 陰線の連続: ギャップダウン後に陰線が2本以上連続
 * 3. 位置: BB -2σ付近にある
 */
function detectShitabanare(data: PriceData[], bb: ReturnType<typeof calcBollingerBands>): BuySignal[] {
  const signals: BuySignal[] = [];

  for (let i = 2; i < data.length; i++) {
    const lower2 = bb[i]?.lower2;
    if (lower2 == null) continue;

    // i-2日目: ギャップダウンの起点チェック
    const gapDown = data[i - 1].open < data[i - 2].low;
    if (!gapDown) continue;

    // i-1日目とi-2日目(ギャップ後)が陰線
    const bearish1 = data[i - 1].close < data[i - 1].open;
    const bearish2 = data[i].close < data[i].open;

    if (!bearish1) continue;

    // 位置チェック: 直近足がBB -2σ付近以下
    // -2σの110%以内（少しバッファを持たせる）
    const nearLowerBand = data[i].close <= lower2 * 1.10;
    if (!nearLowerBand) continue;

    if (bearish2) {
      // 陰線2本連続 + ギャップダウン + BB -2σ付近 = セリングクライマックス
      signals.push({
        index: i,
        date: data[i].date,
        price: data[i].low,
        type: "shitabanare",
        label: "下放れ二本黒",
        description: `ギャップダウン + 陰線連続 @ BB -2σ付近 (終値: ${data[i].close.toLocaleString()})`,
      });
    }
  }

  return signals;
}

/**
 * 全買いシグナルを検出
 */
export function detectBuySignals(data: PriceData[]): BuySignal[] {
  if (data.length < 25) return []; // 最低限のデータが必要

  const bb = calcBollingerBands(data, 20);

  const bbSignals = detectBBReversal(data, bb);
  const shitabanareSignals = detectShitabanare(data, bb);

  // 日付順にソートし、同じ日のシグナルは重複排除
  const all = [...bbSignals, ...shitabanareSignals];
  all.sort((a, b) => a.index - b.index);

  // 同日の重複排除（shitabanareを優先）
  const seen = new Set<string>();
  return all.filter((s) => {
    if (seen.has(s.date)) return false;
    seen.add(s.date);
    return true;
  });
}

/**
 * カップ・ウィズ・ハンドル検出（田端式）
 *
 * 1. カップ: 大きな下落→U字回復で直前高値（左リム）付近まで戻る
 * 2. ハンドル: 抵抗線付近で「やれやれ売り」による小さな押し目
 * 3. ブレイクアウト: ハンドル後に陽線でカップ右リムを上抜け → 買いシグナル
 */
export function detectCupWithHandle(data: PriceData[]): BuySignal[] {
  const signals: BuySignal[] = [];
  if (data.length < 30) return signals;

  const CUP_MIN_DAYS = 15;
  const CUP_MAX_DAYS = 120;
  const CUP_MIN_DEPTH = 0.08;
  const CUP_MAX_DEPTH = 0.50;
  const RIM_TOLERANCE = 0.06;
  const HANDLE_MIN_DAYS = 3;
  const HANDLE_MAX_DAYS = 25;
  const HANDLE_MAX_PULLBACK = 0.12;

  // ローカルピーク検出（前後5本で最高値）
  const PEAK_W = 5;
  const peaks: number[] = [];
  for (let i = PEAK_W; i < data.length - 1; i++) {
    let isPeak = true;
    for (let j = Math.max(0, i - PEAK_W); j <= Math.min(data.length - 1, i + PEAK_W); j++) {
      if (j !== i && data[j].high > data[i].high) { isPeak = false; break; }
    }
    if (isPeak) peaks.push(i);
  }

  // ピークペア（左リム・右リム）でカップを探索
  for (let p1 = 0; p1 < peaks.length; p1++) {
    for (let p2 = p1 + 1; p2 < peaks.length; p2++) {
      const leftIdx = peaks[p1];
      const rightIdx = peaks[p2];
      const cupDays = rightIdx - leftIdx;
      if (cupDays < CUP_MIN_DAYS || cupDays > CUP_MAX_DAYS) continue;

      const leftHigh = data[leftIdx].high;
      const rightHigh = data[rightIdx].high;

      // リム高さの類似チェック
      const rimDiff = Math.abs(leftHigh - rightHigh) / Math.max(leftHigh, rightHigh);
      if (rimDiff > RIM_TOLERANCE) continue;

      // カップ底を探す
      let bottomLow = Infinity;
      let bottomIdx = leftIdx + 1;
      for (let j = leftIdx + 1; j < rightIdx; j++) {
        if (data[j].low < bottomLow) { bottomLow = data[j].low; bottomIdx = j; }
      }

      // カップ深さ
      const rimLevel = Math.max(leftHigh, rightHigh);
      const depth = (rimLevel - bottomLow) / rimLevel;
      if (depth < CUP_MIN_DEPTH || depth > CUP_MAX_DEPTH) continue;

      // 底の位置（両端に偏りすぎていないか）
      const bottomPos = (bottomIdx - leftIdx) / cupDays;
      if (bottomPos < 0.15 || bottomPos > 0.85) continue;

      // ハンドル探索: 右リム後の小さな押し目 → ブレイクアウト
      const searchEnd = Math.min(rightIdx + HANDLE_MAX_DAYS, data.length - 1);
      let handleLow = Infinity;

      for (let h = rightIdx + 1; h <= searchEnd; h++) {
        if (data[h].low < handleLow) handleLow = data[h].low;
        if (h - rightIdx < HANDLE_MIN_DAYS) continue;

        const pullback = (rightHigh - handleLow) / rightHigh;
        if (pullback > HANDLE_MAX_PULLBACK) break;   // 押し目が深すぎ
        if (pullback < 0.01) continue;                // 押し目が浅すぎ

        // ブレイクアウト: 陽線で右リムを上抜け
        if (data[h].close > rightHigh && data[h].close > data[h].open) {
          signals.push({
            index: h,
            date: data[h].date,
            price: data[h].close,
            type: "cup_with_handle",
            label: "CWH",
            description: `カップ${cupDays}日 深さ${(depth * 100).toFixed(0)}% ハンドル${(pullback * 100).toFixed(1)}%`,
            cupMeta: {
              leftRimIdx: leftIdx,
              bottomIdx,
              rightRimIdx: rightIdx,
              leftRimHigh: leftHigh,
              bottomLow,
              rightRimHigh: rightHigh,
            },
          });
          break;
        }
      }
    }
  }

  // 近接シグナルの重複排除（3日以内は1つに）
  const deduped: BuySignal[] = [];
  for (const s of signals) {
    if (deduped.length === 0 || s.index - deduped[deduped.length - 1].index > 3) {
      deduped.push(s);
    }
  }
  return deduped;
}

/**
 * 地合い判定: 現在価格 vs 25日MA
 */
export function detectMarketSentiment(data: PriceData[]): {
  sentiment: "bullish" | "bearish" | "neutral";
  price: number;
  ma25: number;
  diff: number;
  diffPct: number;
} | null {
  if (data.length < 25) return null;

  const last = data[data.length - 1];
  const sum = data.slice(-25).reduce((acc, d) => acc + d.close, 0);
  const ma25 = sum / 25;
  const diff = last.close - ma25;
  const diffPct = (diff / ma25) * 100;

  return {
    sentiment: diffPct > 1 ? "bullish" : diffPct < -1 ? "bearish" : "neutral",
    price: last.close,
    ma25: Math.round(ma25 * 100) / 100,
    diff: Math.round(diff * 100) / 100,
    diffPct: Math.round(diffPct * 100) / 100,
  };
}

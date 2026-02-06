/**
 * 最適化済みパラメータプリセット
 *
 * グリッドサーチにより全9銘柄×3年分のバックテストで
 * 勝率最大化を基準に探索した結果（2026-02-06実施）
 */

export type PresetType = "default" | "optimized";
export type PeriodType = "daily" | "weekly";

export interface OptimizedPreset {
  params: Record<string, number>;
  /** 探索時の全銘柄合算勝率 */
  winRate: number;
  /** 探索時の全銘柄合算収益(%) */
  totalReturnPct: number;
  /** 探索時の全銘柄合算取引数 */
  trades: number;
}

export interface StrategyPresets {
  daily: OptimizedPreset;
  weekly: OptimizedPreset;
}

/**
 * 戦略ID → 日足/週足別の最適化済みパラメータ
 * パラメータ固定戦略(choruko_bb, choruko_shitabanare, dca)は含まない
 */
export const optimizedPresets: Record<string, StrategyPresets> = {
  ma_cross: {
    daily: {
      params: { shortPeriod: 20, longPeriod: 50 },
      winRate: 59.3,
      totalReturnPct: 486.0,
      trades: 54,
    },
    weekly: {
      params: { shortPeriod: 10, longPeriod: 20 },
      winRate: 66.7,
      totalReturnPct: 183.5,
      trades: 18,
    },
  },
  rsi_reversal: {
    daily: {
      params: { period: 10, oversold: 20, overbought: 80 },
      winRate: 100,
      totalReturnPct: 635.9,
      trades: 16,
    },
    weekly: {
      params: { period: 10, oversold: 40, overbought: 75 },
      winRate: 100,
      totalReturnPct: 376.0,
      trades: 10,
    },
  },
  macd_signal: {
    daily: {
      params: { shortPeriod: 10, longPeriod: 20, signalPeriod: 9 },
      winRate: 46.7,
      totalReturnPct: 684.9,
      trades: 285,
    },
    weekly: {
      params: { shortPeriod: 10, longPeriod: 30, signalPeriod: 12 },
      winRate: 47.2,
      totalReturnPct: 253.4,
      trades: 36,
    },
  },
  dip_buy: {
    daily: {
      params: { dipPct: 3, recoveryPct: 15 },
      winRate: 100,
      totalReturnPct: 1153.9,
      trades: 68,
    },
    weekly: {
      params: { dipPct: 3, recoveryPct: 30 },
      winRate: 100,
      totalReturnPct: 1206.6,
      trades: 35,
    },
  },
  dip_kairi: {
    daily: {
      params: { entryKairi: -8, exitKairi: -3, stopLossPct: 10, timeStopDays: 10 },
      winRate: 73.7,
      totalReturnPct: 97.4,
      trades: 95,
    },
    weekly: {
      params: { entryKairi: -8, exitKairi: -5, stopLossPct: 7, timeStopDays: 5 },
      winRate: 80.6,
      totalReturnPct: 140.2,
      trades: 36,
    },
  },
  dip_rsi_volume: {
    daily: {
      params: { rsiThreshold: 25, volumeMultiple: 1.2, rsiExit: 35, takeProfitPct: 3 },
      winRate: 81.3,
      totalReturnPct: 104.3,
      trades: 16,
    },
    weekly: {
      params: { rsiThreshold: 35, volumeMultiple: 1.2, rsiExit: 35, takeProfitPct: 3 },
      winRate: 75.0,
      totalReturnPct: 12.0,
      trades: 4,
    },
  },
  dip_bb3sigma: {
    daily: {
      params: { stopLossPct: 7 },
      winRate: 69.2,
      totalReturnPct: 65.7,
      trades: 26,
    },
    weekly: {
      // 週足はサンプル1件のみ、デフォルト維持
      params: { stopLossPct: 5 },
      winRate: 100,
      totalReturnPct: 11.3,
      trades: 1,
    },
  },
  tabata_cwh: {
    daily: {
      params: { takeProfitPct: 5, stopLossPct: 15 },
      winRate: 91.3,
      totalReturnPct: 326.2,
      trades: 69,
    },
    weekly: {
      params: { takeProfitPct: 20, stopLossPct: 5 },
      winRate: 75.0,
      totalReturnPct: 57.4,
      trades: 4,
    },
  },
};

/**
 * 指定戦略の指定プリセット・期間のパラメータを取得
 * @param strategyId 戦略ID
 * @param preset "default" | "optimized"
 * @param period "daily" | "weekly"
 * @param defaultParams 戦略定義のデフォルトパラメータ（params配列から構築）
 */
export function getPresetParams(
  strategyId: string,
  preset: PresetType,
  period: PeriodType,
  defaultParams: Record<string, number>
): Record<string, number> {
  if (preset === "default") return defaultParams;

  const stratPresets = optimizedPresets[strategyId];
  if (!stratPresets) return defaultParams;

  return stratPresets[period]?.params ?? defaultParams;
}

/**
 * 指定戦略の最適化情報を取得（UI表示用）
 */
export function getPresetInfo(
  strategyId: string,
  period: PeriodType
): OptimizedPreset | null {
  return optimizedPresets[strategyId]?.[period] ?? null;
}

/**
 * 最適化済みパラメータプリセット
 *
 * daily: ウォークフォワード分析（訓練3年→検証1年 × 7窓, 22銘柄）の
 *        パラメータ安定性評価に基づく推奨値（2026-02-07実施）
 * weekly: グリッドサーチ in-sample 最適化（2026-02-06実施）
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
      // WF安定性スコア: 0.784, 検証中央値: +6.9%
      params: { shortPeriod: 2, longPeriod: 5 },
      winRate: 0,
      totalReturnPct: 6.9,
      trades: 0,
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
      // WF安定性スコア: 0.859, 検証中央値: +16.6%
      params: { period: 5, oversold: 37, overbought: 70, atrPeriod: 14, atrMultiple: 2, stopLossPct: 5 },
      winRate: 0,
      totalReturnPct: 16.6,
      trades: 0,
    },
    weekly: {
      params: { period: 10, oversold: 40, overbought: 75, atrPeriod: 14, atrMultiple: 2, stopLossPct: 10 },
      winRate: 100,
      totalReturnPct: 376.0,
      trades: 10,
    },
  },
  macd_signal: {
    daily: {
      // WF安定性スコア: 0.852, 検証中央値: +13.5%
      params: { shortPeriod: 5, longPeriod: 10, signalPeriod: 12 },
      winRate: 0,
      totalReturnPct: 13.5,
      trades: 0,
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
      // WF安定性スコア: 0.781, 検証中央値: +17.4%
      params: { dipPct: 3, recoveryPct: 39, stopLossPct: 5 },
      winRate: 0,
      totalReturnPct: 17.4,
      trades: 0,
    },
    weekly: {
      params: { dipPct: 3, recoveryPct: 30, stopLossPct: 15 },
      winRate: 100,
      totalReturnPct: 1206.6,
      trades: 35,
    },
  },
  dip_kairi: {
    daily: {
      // WF安定性スコア: 0.633, 検証中央値: +0.0% (取引機会なし)
      params: { entryKairi: -30, exitKairi: -15, stopLossPct: 3, timeStopDays: 2 },
      winRate: 0,
      totalReturnPct: 0.0,
      trades: 0,
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
      // WF安定性スコア: 0.533, 検証中央値: +0.0% (取引機会なし)
      params: { rsiThreshold: 30, volumeMultiple: 2, rsiExit: 55, takeProfitPct: 6 },
      winRate: 0,
      totalReturnPct: 0.0,
      trades: 0,
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
      // WF安定性スコア: 0.616, 検証中央値: +0.0% (取引機会なし)
      params: { stopLossPct: 3 },
      winRate: 0,
      totalReturnPct: 0.0,
      trades: 0,
    },
    weekly: {
      // 週足はサンプル1件のみ、デフォルト維持
      params: { stopLossPct: 5 },
      winRate: 100,
      totalReturnPct: 11.3,
      trades: 1,
    },
  },
  macd_trail: {
    daily: {
      // WF安定性スコア: 0.785, 検証中央値: +18.9%
      params: { shortPeriod: 5, longPeriod: 23, signalPeriod: 3, trailPct: 12, stopLossPct: 15 },
      winRate: 0,
      totalReturnPct: 18.9,
      trades: 0,
    },
    weekly: {
      params: { shortPeriod: 12, longPeriod: 26, signalPeriod: 9, trailPct: 12, stopLossPct: 5 },
      winRate: 0,
      totalReturnPct: 0,
      trades: 0,
    },
  },
  tabata_cwh: {
    daily: {
      // 全銘柄ポートフォリオシム: 52w高値+CWH, PF1.75, 年率19.8%
      params: { takeProfitPct: 20, stopLossPct: 8 },
      winRate: 43.8,
      totalReturnPct: 19.8,
      trades: 1241,
    },
    weekly: {
      params: { takeProfitPct: 20, stopLossPct: 8 },
      winRate: 75.0,
      totalReturnPct: 57.4,
      trades: 4,
    },
  },
  cwh_trail: {
    daily: {
      // WF安定性スコア: 0.874, 検証中央値: +0.0%
      params: { trailPct: 8, stopLossPct: 6 },
      winRate: 28.8,
      totalReturnPct: 0.0,
      trades: 243,
    },
    weekly: {
      // 週足はCWHシグナル少数のためデフォルト維持
      params: { trailPct: 12, stopLossPct: 5 },
      winRate: 0,
      totalReturnPct: 0,
      trades: 0,
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

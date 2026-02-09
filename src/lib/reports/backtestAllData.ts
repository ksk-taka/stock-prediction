// ============================================================
// 全銘柄10年バックテスト結果データ (静的埋め込み)
//
// scripts/backtest-10yr.ts の結果をまとめたもの
// 対象: 3,757銘柄 × 12戦略 (WF推奨パラメータ)
// 期間: 2016-2025 (10年間)
// ============================================================

export interface FullBacktestStrategy {
  rank: number;
  strategyId: string;
  strategyName: string;
  params: string;
  trades: string;        // "407k" etc.
  winRate: number;        // %
  medianReturn: number;   // %
  sharpeMedian: number;
  maxDDMedian: number;    // %
  positiveRate: number;   // % (プラス率)
}

export interface YearlyReturn {
  strategyId: string;
  strategyName: string;
  returns: Record<string, number>;  // year -> return%
}

export interface ComparisonRow {
  rank: number;
  strategyId: string;
  strategyName: string;
  params: string;
  favReturn: number;      // お気に入り24銘柄の中央値Return%
  allReturn: number;      // 全銘柄の中央値Return%
  diff: number;           // 差
}

export interface FullBacktestData {
  stocks: number;
  strategies: number;
  period: string;
  rankings: FullBacktestStrategy[];
  yearlyReturns: YearlyReturn[];
  insights: string[];
  // お気に入り24銘柄 vs 全銘柄 比較
  favorites: {
    stocks: number;
    comparison: ComparisonRow[];
    yearlyReturns: YearlyReturn[];
  };
}

export const fullBacktestData: FullBacktestData = {
  stocks: 3757,
  strategies: 12,
  period: "2016-2025",
  rankings: [
    {
      rank: 1,
      strategyId: "rsi_reversal",
      strategyName: "RSI逆張り",
      params: "P5/OS37/OB70/ATR14×2/SL5",
      trades: "407k",
      winRate: 53.4,
      medianReturn: 61.5,
      sharpeMedian: 0.365,
      maxDDMedian: 48.3,
      positiveRate: 75.5,
    },
    {
      rank: 2,
      strategyId: "macd_trail",
      strategyName: "MACDトレーリング",
      params: "S5/L23/Sig3/Tr12/SL15",
      trades: "116k",
      winRate: 37.9,
      medianReturn: 42.0,
      sharpeMedian: 0.300,
      maxDDMedian: 57.2,
      positiveRate: 68.1,
    },
    {
      rank: 3,
      strategyId: "dip_buy",
      strategyName: "急落買い",
      params: "Dip3/Rec39/SL5",
      trades: "139k",
      winRate: 18.7,
      medianReturn: 36.5,
      sharpeMedian: 0.280,
      maxDDMedian: 60.0,
      positiveRate: 65.6,
    },
    {
      rank: 4,
      strategyId: "ma_cross",
      strategyName: "MAクロス",
      params: "S5/L25",
      trades: "897k",
      winRate: 35.4,
      medianReturn: 19.4,
      sharpeMedian: 0.230,
      maxDDMedian: 51.4,
      positiveRate: 59.4,
    },
    {
      rank: 5,
      strategyId: "macd_signal",
      strategyName: "MACDシグナル",
      params: "S5/L10/Sig12",
      trades: "518k",
      winRate: 34.1,
      medianReturn: 15.1,
      sharpeMedian: 0.210,
      maxDDMedian: 50.7,
      positiveRate: 57.7,
    },
    {
      rank: 6,
      strategyId: "choruko_shitabanare",
      strategyName: "下放れ二本黒",
      params: "固定",
      trades: "165k",
      winRate: 35.0,
      medianReturn: 14.4,
      sharpeMedian: 0.220,
      maxDDMedian: 22.3,
      positiveRate: 68.8,
    },
    {
      rank: 7,
      strategyId: "choruko_bb",
      strategyName: "BB逆張り",
      params: "固定",
      trades: "121k",
      winRate: 44.9,
      medianReturn: 9.1,
      sharpeMedian: 0.170,
      maxDDMedian: 24.3,
      positiveRate: 63.2,
    },
    {
      rank: 8,
      strategyId: "tabata_cwh",
      strategyName: "田端式CWH",
      params: "TP20/SL8",
      trades: "50k",
      winRate: 79.5,
      medianReturn: 7.0,
      sharpeMedian: 0.140,
      maxDDMedian: 40.6,
      positiveRate: 56.3,
    },
    {
      rank: 9,
      strategyId: "dip_kairi",
      strategyName: "急落買い乖離率",
      params: "-30/-15/SL3/2日",
      trades: "5k",
      winRate: 46.9,
      medianReturn: 6.6,
      sharpeMedian: 0.230,
      maxDDMedian: 7.1,
      positiveRate: 64.6,
    },
    {
      rank: 10,
      strategyId: "dip_rsi_volume",
      strategyName: "急落買いRSI+出来高",
      params: "RSI30/Vol2/Exit55/TP6",
      trades: "39k",
      winRate: 36.3,
      medianReturn: 4.0,
      sharpeMedian: 0.120,
      maxDDMedian: 14.2,
      positiveRate: 58.4,
    },
    {
      rank: 11,
      strategyId: "dip_bb3sigma",
      strategyName: "急落買いBB-3σ",
      params: "SL3",
      trades: "41k",
      winRate: 50.0,
      medianReturn: 1.0,
      sharpeMedian: 0.060,
      maxDDMedian: 13.6,
      positiveRate: 52.5,
    },
    {
      rank: 12,
      strategyId: "cwh_trail",
      strategyName: "CWHトレーリング",
      params: "Tr8/SL6",
      trades: "59k",
      winRate: 32.5,
      medianReturn: -1.4,
      sharpeMedian: 0.070,
      maxDDMedian: 39.7,
      positiveRate: 48.6,
    },
  ],
  yearlyReturns: [
    {
      strategyId: "rsi_reversal",
      strategyName: "RSI逆張り",
      returns: { "2016": 17, "2017": 15, "2018": -14, "2019": 10, "2020": 0, "2021": 5, "2022": 4, "2023": 10, "2024": 11, "2025": 16 },
    },
    {
      strategyId: "macd_trail",
      strategyName: "MACDトレーリング",
      returns: { "2016": 11, "2017": 31, "2018": -17, "2019": 11, "2020": 14, "2021": -1, "2022": 2, "2023": 8, "2024": -1, "2025": 20 },
    },
    {
      strategyId: "dip_buy",
      strategyName: "急落買い",
      returns: { "2016": 15, "2017": 34, "2018": -22, "2019": 16, "2020": 4, "2021": 1, "2022": -1, "2023": 651, "2024": 1, "2025": 22 },
    },
    {
      strategyId: "ma_cross",
      strategyName: "MAクロス",
      returns: { "2016": 10, "2017": 20, "2018": -6, "2019": 5, "2020": 6, "2021": -1, "2022": -3, "2023": 7, "2024": 2, "2025": 14 },
    },
    {
      strategyId: "tabata_cwh",
      strategyName: "田端式CWH",
      returns: { "2016": 7, "2017": 10, "2018": -9, "2019": 5, "2020": 6, "2021": 0, "2022": 3, "2023": 4, "2024": -5, "2025": 7 },
    },
    {
      strategyId: "cwh_trail",
      strategyName: "CWHトレーリング",
      returns: { "2016": 1, "2017": 9, "2018": -6, "2019": 1, "2020": 1, "2021": -3, "2022": -2, "2023": 2, "2024": -5, "2025": 6 },
    },
  ],
  insights: [
    "RSI逆張りが圧倒的に安定: 中央値+61.5%、Return/DD比1.27、10年中9年プラス",
    "2018年は全戦略マイナス（米中摩擦）→ システマティックリスクは回避不可",
    "CWHトレーリングは中央値マイナス → WF安定性スコア0.874は高かったが、全銘柄に広げると機能しない",
    "田端式CWH: 勝率79.5%は最高だが中央値リターン+7.0%と控えめ。WFでの好成績はお気に入り銘柄限定の可能性",
    "急落系3戦略: 取引機会が少なく実用性が低い",
    "WF分析（22銘柄）と全銘柄（3,757銘柄）で結果が違うのは、銘柄選定の重要性を示唆",
  ],
  favorites: {
    stocks: 24,
    comparison: [
      { rank: 1, strategyId: "macd_trail", strategyName: "MACDトレーリング", params: "S5/L23/Sig3/Tr12/SL15", favReturn: 324, allReturn: 42, diff: 282 },
      { rank: 2, strategyId: "dip_buy", strategyName: "急落買い", params: "Dip3/Rec39/SL5", favReturn: 288, allReturn: 37, diff: 251 },
      { rank: 3, strategyId: "rsi_reversal", strategyName: "RSI逆張り", params: "P5/OS37/OB70/ATR14×2/SL5", favReturn: 158, allReturn: 62, diff: 96 },
      { rank: 4, strategyId: "macd_signal", strategyName: "MACDシグナル", params: "S5/L10/Sig12", favReturn: 156, allReturn: 15, diff: 141 },
      { rank: 5, strategyId: "ma_cross", strategyName: "MAクロス", params: "S5/L25", favReturn: 136, allReturn: 19, diff: 117 },
      { rank: 6, strategyId: "tabata_cwh", strategyName: "田端式CWH", params: "TP20/SL8", favReturn: 40, allReturn: 7, diff: 33 },
      { rank: 7, strategyId: "choruko_bb", strategyName: "BB逆張り", params: "固定", favReturn: 29, allReturn: 9, diff: 20 },
      { rank: 8, strategyId: "cwh_trail", strategyName: "CWHトレーリング", params: "Tr8/SL6", favReturn: 28, allReturn: -1, diff: 29 },
      { rank: 9, strategyId: "choruko_shitabanare", strategyName: "下放れ二本黒", params: "固定", favReturn: 23, allReturn: 14, diff: 9 },
      { rank: 10, strategyId: "dip_kairi", strategyName: "急落買い乖離率", params: "-30/-15/SL3/2日", favReturn: 16, allReturn: 7, diff: 9 },
      { rank: 11, strategyId: "dip_rsi_volume", strategyName: "急落買いRSI+出来高", params: "RSI30/Vol2", favReturn: 8, allReturn: 4, diff: 4 },
      { rank: 12, strategyId: "dip_bb3sigma", strategyName: "急落買いBB-3σ", params: "SL3", favReturn: 5, allReturn: 1, diff: 4 },
    ],
    yearlyReturns: [
      {
        strategyId: "macd_trail",
        strategyName: "MACDトレーリング",
        returns: { "2016": 10, "2017": 23, "2018": -19, "2019": 8, "2020": 29, "2021": 3, "2022": 6, "2023": 20, "2024": 24, "2025": 61 },
      },
      {
        strategyId: "dip_buy",
        strategyName: "急落買い",
        returns: { "2016": 14, "2017": 28, "2018": -24, "2019": 7, "2020": 13, "2021": 2, "2022": 7, "2023": 26, "2024": 39, "2025": 66 },
      },
      {
        strategyId: "rsi_reversal",
        strategyName: "RSI逆張り",
        returns: { "2016": 28, "2017": 11, "2018": -13, "2019": 9, "2020": 6, "2021": 12, "2022": 5, "2023": 16, "2024": 28, "2025": 23 },
      },
      {
        strategyId: "macd_signal",
        strategyName: "MACDシグナル",
        returns: { "2016": -3, "2017": 20, "2018": -10, "2019": 9, "2020": 14, "2021": 3, "2022": 2, "2023": 10, "2024": 18, "2025": 41 },
      },
      {
        strategyId: "ma_cross",
        strategyName: "MAクロス",
        returns: { "2016": 7, "2017": 14, "2018": -5, "2019": 7, "2020": 10, "2021": -2, "2022": 1, "2023": 11, "2024": 22, "2025": 28 },
      },
    ],
  },
};

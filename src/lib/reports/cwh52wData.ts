// ============================================================
// CWH × 52週高値フィルタ バックテスト比較データ
//
// 出典: scripts/sim-portfolio.ts 実行結果
// 対象: 全3,775銘柄 × 3年間 (daily)
// CWHパターン検出 → エントリー時点で過去252営業日の高値付近かを判定
// ============================================================

export interface Cwh52wGroup {
  label: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgReturn: number;
  avgWin: number;
  avgLoss: number;
  pf: number;
  totalReturn: number;
}

export interface Cwh52wPortfolio {
  initialCapital: number;
  finalCapital: number;
  returnPct: number;
  annualReturn: number;
  multiplier: number;
  winRate: number;
  maxDD: number;
  maxDDMonth: string;
  executedTrades: number;
  skippedSignals: number;
}

export interface Cwh52wMode {
  mode: string;
  modeShort: string;
  description: string;
  groups: Cwh52wGroup[];
  portfolio: Cwh52wPortfolio;
}

export const cwh52wComparison: Cwh52wMode[] = [
  {
    mode: "固定 TP20% / SL8%",
    modeShort: "TP20/SL8",
    description: "+20%で利確、-8%で損切り",
    groups: [
      {
        label: "全CWHシグナル",
        trades: 14579,
        wins: 5277,
        losses: 9302,
        winRate: 36.2,
        avgReturn: 1.75,
        avgWin: 23.1,
        avgLoss: -10.4,
        pf: 1.26,
        totalReturn: 25464.5,
      },
      {
        label: "52週高値付近のみ",
        trades: 1241,
        wins: 544,
        losses: 697,
        winRate: 43.8,
        avgReturn: 4.24,
        avgWin: 22.6,
        avgLoss: -10.1,
        pf: 1.75,
        totalReturn: 5260.2,
      },
      {
        label: "52週高値以外",
        trades: 13338,
        wins: 4733,
        losses: 8605,
        winRate: 35.5,
        avgReturn: 1.51,
        avgWin: 23.1,
        avgLoss: -10.4,
        pf: 1.23,
        totalReturn: 20204.3,
      },
    ],
    portfolio: {
      initialCapital: 500,
      finalCapital: 796.3,
      returnPct: 59.3,
      annualReturn: 19.8,
      multiplier: 1.59,
      winRate: 43.1,
      maxDD: -17.7,
      maxDDMonth: "2025-04",
      executedTrades: 562,
      skippedSignals: 679,
    },
  },
  {
    mode: "トレーリングストップ 8%",
    modeShort: "Trail 8%",
    description: "高値から-8%下落で撤退",
    groups: [
      {
        label: "全CWHシグナル",
        trades: 19157,
        wins: 7127,
        losses: 12030,
        winRate: 37.2,
        avgReturn: 0.87,
        avgWin: 12.8,
        avgLoss: -6.2,
        pf: 1.22,
        totalReturn: 16636.0,
      },
      {
        label: "52週高値付近のみ",
        trades: 1407,
        wins: 613,
        losses: 794,
        winRate: 43.6,
        avgReturn: 2.39,
        avgWin: 12.7,
        avgLoss: -5.6,
        pf: 1.76,
        totalReturn: 3357.7,
      },
      {
        label: "52週高値以外",
        trades: 17750,
        wins: 6514,
        losses: 11236,
        winRate: 36.7,
        avgReturn: 0.75,
        avgWin: 12.8,
        avgLoss: -6.3,
        pf: 1.19,
        totalReturn: 13278.4,
      },
    ],
    portfolio: {
      initialCapital: 500,
      finalCapital: 622.7,
      returnPct: 24.5,
      annualReturn: 8.2,
      multiplier: 1.25,
      winRate: 41.3,
      maxDD: -18.8,
      maxDDMonth: "2025-05",
      executedTrades: 65,
      skippedSignals: 1176,
    },
  },
  {
    mode: "SL8% → +20%後 Trail15%",
    modeShort: "建値撤退",
    description: "-8%損切り、+20%到達後は高値-15%トレーリング",
    groups: [
      {
        label: "全CWHシグナル",
        trades: 12315,
        wins: 3832,
        losses: 8483,
        winRate: 31.1,
        avgReturn: 0.08,
        avgWin: 22.5,
        avgLoss: -10.0,
        pf: 1.01,
        totalReturn: 993.3,
      },
      {
        label: "52週高値付近のみ",
        trades: 814,
        wins: 361,
        losses: 453,
        winRate: 44.3,
        avgReturn: 4.80,
        avgWin: 22.7,
        avgLoss: -9.5,
        pf: 1.91,
        totalReturn: 3903.7,
      },
      {
        label: "52週高値以外",
        trades: 11501,
        wins: 3471,
        losses: 8030,
        winRate: 30.2,
        avgReturn: -0.25,
        avgWin: 22.4,
        avgLoss: -10.1,
        pf: 0.96,
        totalReturn: -2910.5,
      },
    ],
    portfolio: {
      initialCapital: 500,
      finalCapital: 483.7,
      returnPct: -3.3,
      annualReturn: -1.1,
      multiplier: 0.97,
      winRate: 33.3,
      maxDD: -20.9,
      maxDDMonth: "2025-04",
      executedTrades: 65,
      skippedSignals: 749,
    },
  },
];

// ============================================================
// ウォークフォワード分析レポートデータ (自動生成)
//
// 生成元: walkforward-results-2026-02-07T11-08-21.csv
// 生成日: 2026-02-09
//
// scripts/generate-wf-report.ts で再生成可能
// ============================================================

export interface WFStrategyResult {
  strategyId: string;
  strategyName: string;
  stabilityScore: number;
  bestParams: Record<string, number>;
  bestParamLabel: string;
  testReturnMedian: number;
  testReturnMin: number;
  testReturnStd: number;
  trainReturnMedian: number;
  overfitDegree: number;
  testWinRate: number;
  windowReturns: number[];
  windowWinRates: number[];
}

export interface WFWindowInfo {
  id: number;
  trainLabel: string;
  testLabel: string;
}

export interface WFReportData {
  generatedAt: string;
  config: {
    trainYears: number;
    testYears: number;
    windows: number;
    stocks: number;
    strategies: number;
    paramCombos: number;
  };
  windows: WFWindowInfo[];
  strategies: WFStrategyResult[];
}

export const wfReportData: WFReportData = {
  "generatedAt": "2026-02-09",
  "config": {
    "trainYears": 3,
    "testYears": 1,
    "windows": 7,
    "stocks": 22,
    "strategies": 6,
    "paramCombos": 14500
  },
  "windows": [
    {
      "id": 1,
      "trainLabel": "2016-2018",
      "testLabel": "2019"
    },
    {
      "id": 2,
      "trainLabel": "2017-2019",
      "testLabel": "2020"
    },
    {
      "id": 3,
      "trainLabel": "2018-2020",
      "testLabel": "2021"
    },
    {
      "id": 4,
      "trainLabel": "2019-2021",
      "testLabel": "2022"
    },
    {
      "id": 5,
      "trainLabel": "2020-2022",
      "testLabel": "2023"
    },
    {
      "id": 6,
      "trainLabel": "2021-2023",
      "testLabel": "2024"
    },
    {
      "id": 7,
      "trainLabel": "2022-2024",
      "testLabel": "2025"
    }
  ],
  "strategies": [
    {
      "strategyId": "rsi_reversal",
      "strategyName": "RSI逆張り",
      "stabilityScore": 0.859,
      "bestParams": {
        "period": 5,
        "oversold": 37,
        "overbought": 70,
        "atrPeriod": 14,
        "atrMultiple": 2,
        "stopLossPct": 5
      },
      "bestParamLabel": "period5/OS37/OB70/ATR14/ATR2/SL5",
      "testReturnMedian": 16.6,
      "testReturnMin": 7.7,
      "testReturnStd": 7.7,
      "trainReturnMedian": 19.9,
      "overfitDegree": 3.3,
      "testWinRate": 59.2,
      "windowReturns": [
        7.7,
        9.4,
        16.7,
        7.8,
        16.6,
        26.4,
        24.2
      ],
      "windowWinRates": [
        59.2,
        47.1,
        56.7,
        50,
        64.1,
        59.2,
        59.9
      ]
    },
    {
      "strategyId": "macd_signal",
      "strategyName": "MACDシグナル",
      "stabilityScore": 0.852,
      "bestParams": {
        "shortPeriod": 5,
        "longPeriod": 10,
        "signalPeriod": 12
      },
      "bestParamLabel": "S5/L10/Sig12",
      "testReturnMedian": 13.5,
      "testReturnMin": 3.9,
      "testReturnStd": 8.4,
      "trainReturnMedian": 22.1,
      "overfitDegree": 8.7,
      "testWinRate": 39.2,
      "windowReturns": [
        11.4,
        13.5,
        3.9,
        4.8,
        14.9,
        15.7,
        29.2
      ],
      "windowWinRates": [
        43.8,
        39.2,
        35.7,
        34.8,
        38,
        45.5,
        46.2
      ]
    },
    {
      "strategyId": "macd_trail",
      "strategyName": "MACDトレイル12%",
      "stabilityScore": 0.785,
      "bestParams": {
        "shortPeriod": 5,
        "longPeriod": 23,
        "signalPeriod": 3,
        "trailPct": 12,
        "stopLossPct": 15
      },
      "bestParamLabel": "S5/L23/Sig3/Tr12/SL15",
      "testReturnMedian": 18.9,
      "testReturnMin": 5.1,
      "testReturnStd": 11.7,
      "trainReturnMedian": 14.4,
      "overfitDegree": -4.5,
      "testWinRate": 50,
      "windowReturns": [
        5.4,
        20.6,
        5.1,
        8.5,
        18.9,
        22.7,
        37.7
      ],
      "windowWinRates": [
        0,
        46.4,
        33.3,
        50,
        50,
        50,
        50
      ]
    },
    {
      "strategyId": "dip_buy",
      "strategyName": "急落買い",
      "stabilityScore": 0.781,
      "bestParams": {
        "dipPct": 3,
        "recoveryPct": 39,
        "stopLossPct": 5
      },
      "bestParamLabel": "Dip3/Rec39/SL5",
      "testReturnMedian": 17.5,
      "testReturnMin": 1.8,
      "testReturnStd": 17,
      "trainReturnMedian": 15.3,
      "overfitDegree": -2.2,
      "testWinRate": 16.7,
      "windowReturns": [
        13.7,
        17.5,
        1.8,
        7.2,
        24,
        35.8,
        50.9
      ],
      "windowWinRates": [
        0,
        16.7,
        0,
        7.1,
        25,
        33.3,
        34.3
      ]
    },
    {
      "strategyId": "ma_cross",
      "strategyName": "MAクロス(MA5/MA25)",
      "stabilityScore": 0.341,
      "bestParams": {
        "shortPeriod": 5,
        "longPeriod": 25
      },
      "bestParamLabel": "S5/L25",
      "testReturnMedian": -0.3,
      "testReturnMin": -4.9,
      "testReturnStd": 12.7,
      "trainReturnMedian": 5,
      "overfitDegree": 5.3,
      "testWinRate": 36.7,
      "windowReturns": [
        -0.8,
        17.1,
        -0.3,
        -4.2,
        9.2,
        -4.9,
        28.8
      ],
      "windowWinRates": [
        36.7,
        50,
        28.6,
        36.7,
        28.6,
        31,
        50
      ]
    },
    {
      "strategyId": "tabata_cwh",
      "strategyName": "CWH(TP20/SL8)",
      "stabilityScore": 0.322,
      "bestParams": {
        "takeProfitPct": 20,
        "stopLossPct": 7
      },
      "bestParamLabel": "TP20/SL7",
      "testReturnMedian": -3.7,
      "testReturnMin": -7.7,
      "testReturnStd": 8.8,
      "trainReturnMedian": -4.1,
      "overfitDegree": -0.5,
      "testWinRate": 0,
      "windowReturns": [
        -3.7,
        9,
        -4.9,
        -7.7,
        2.2,
        -4.8,
        16.5
      ],
      "windowWinRates": [
        0,
        0,
        0,
        0,
        10,
        0,
        50
      ]
    }
  ]
};

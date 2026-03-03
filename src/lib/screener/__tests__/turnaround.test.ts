import { describe, it, expect } from "vitest";
import {
  detectTurnaround,
  DEFAULT_OPTIONS,
  type IncomeStatementYear,
} from "../turnaround";

// ── テストデータ ──

/** 3期連続赤字→黒字転換の典型パターン */
const HISTORY_TURNAROUND_3Y: IncomeStatementYear[] = [
  { endDate: "2021-03-31", fiscalYear: 2021, operatingIncome: -500_000_000, totalRevenue: 10_000_000_000, netIncome: -400_000_000 },
  { endDate: "2022-03-31", fiscalYear: 2022, operatingIncome: -300_000_000, totalRevenue: 9_500_000_000, netIncome: -250_000_000 },
  { endDate: "2023-03-31", fiscalYear: 2023, operatingIncome: -100_000_000, totalRevenue: 9_000_000_000, netIncome: -80_000_000 },
  { endDate: "2024-03-31", fiscalYear: 2024, operatingIncome: 200_000_000, totalRevenue: 11_000_000_000, netIncome: 150_000_000 },
];

/** 黒字→赤字→黒字（1期赤字のみ） */
const HISTORY_1Y_LOSS: IncomeStatementYear[] = [
  { endDate: "2021-03-31", fiscalYear: 2021, operatingIncome: 500_000_000, totalRevenue: 10_000_000_000, netIncome: 400_000_000 },
  { endDate: "2022-03-31", fiscalYear: 2022, operatingIncome: 300_000_000, totalRevenue: 11_000_000_000, netIncome: 200_000_000 },
  { endDate: "2023-03-31", fiscalYear: 2023, operatingIncome: -100_000_000, totalRevenue: 9_000_000_000, netIncome: -80_000_000 },
  { endDate: "2024-03-31", fiscalYear: 2024, operatingIncome: 200_000_000, totalRevenue: 10_500_000_000, netIncome: 150_000_000 },
];

/** 全期黒字（転換なし） */
const HISTORY_ALL_PROFIT: IncomeStatementYear[] = [
  { endDate: "2021-03-31", fiscalYear: 2021, operatingIncome: 500_000_000, totalRevenue: 10_000_000_000, netIncome: 400_000_000 },
  { endDate: "2022-03-31", fiscalYear: 2022, operatingIncome: 600_000_000, totalRevenue: 11_000_000_000, netIncome: 500_000_000 },
  { endDate: "2023-03-31", fiscalYear: 2023, operatingIncome: 700_000_000, totalRevenue: 12_000_000_000, netIncome: 600_000_000 },
  { endDate: "2024-03-31", fiscalYear: 2024, operatingIncome: 800_000_000, totalRevenue: 13_000_000_000, netIncome: 700_000_000 },
];

/** 全期赤字（転換なし） */
const HISTORY_ALL_LOSS: IncomeStatementYear[] = [
  { endDate: "2021-03-31", fiscalYear: 2021, operatingIncome: -500_000_000, totalRevenue: 10_000_000_000, netIncome: -400_000_000 },
  { endDate: "2022-03-31", fiscalYear: 2022, operatingIncome: -300_000_000, totalRevenue: 9_500_000_000, netIncome: -250_000_000 },
  { endDate: "2023-03-31", fiscalYear: 2023, operatingIncome: -100_000_000, totalRevenue: 9_000_000_000, netIncome: -80_000_000 },
  { endDate: "2024-03-31", fiscalYear: 2024, operatingIncome: -50_000_000, totalRevenue: 8_500_000_000, netIncome: -30_000_000 },
];

/** 交互パターン（赤→黒→赤→黒） */
const HISTORY_ALTERNATING: IncomeStatementYear[] = [
  { endDate: "2021-03-31", fiscalYear: 2021, operatingIncome: -200_000_000, totalRevenue: 10_000_000_000, netIncome: -150_000_000 },
  { endDate: "2022-03-31", fiscalYear: 2022, operatingIncome: 100_000_000, totalRevenue: 10_500_000_000, netIncome: 80_000_000 },
  { endDate: "2023-03-31", fiscalYear: 2023, operatingIncome: -50_000_000, totalRevenue: 10_200_000_000, netIncome: -30_000_000 },
  { endDate: "2024-03-31", fiscalYear: 2024, operatingIncome: 150_000_000, totalRevenue: 11_000_000_000, netIncome: 120_000_000 },
];

/** 黒字転換 + 増収パターン */
const HISTORY_TURNAROUND_REVENUE_GROWTH: IncomeStatementYear[] = [
  { endDate: "2022-03-31", fiscalYear: 2022, operatingIncome: -300_000_000, totalRevenue: 8_000_000_000, netIncome: -250_000_000 },
  { endDate: "2023-03-31", fiscalYear: 2023, operatingIncome: -100_000_000, totalRevenue: 9_000_000_000, netIncome: -80_000_000 },
  { endDate: "2024-03-31", fiscalYear: 2024, operatingIncome: 200_000_000, totalRevenue: 10_000_000_000, netIncome: 150_000_000 },
];

/** 黒字転換 + 減収パターン */
const HISTORY_TURNAROUND_REVENUE_DECLINE: IncomeStatementYear[] = [
  { endDate: "2022-03-31", fiscalYear: 2022, operatingIncome: -300_000_000, totalRevenue: 12_000_000_000, netIncome: -250_000_000 },
  { endDate: "2023-03-31", fiscalYear: 2023, operatingIncome: -100_000_000, totalRevenue: 11_000_000_000, netIncome: -80_000_000 },
  { endDate: "2024-03-31", fiscalYear: 2024, operatingIncome: 200_000_000, totalRevenue: 10_000_000_000, netIncome: 150_000_000 },
];

// ── テスト ──

describe("detectTurnaround", () => {
  it("3期連続赤字→黒字転換を検出する", () => {
    const result = detectTurnaround(HISTORY_TURNAROUND_3Y, {
      ...DEFAULT_OPTIONS,
      minConsecutiveLoss: 1,
    });
    expect(result).not.toBeNull();
    expect(result!.turnaroundFiscalYear).toBe(2024);
    expect(result!.consecutiveLossYears).toBe(3);
    expect(result!.priorLossAmount).toBe(-100_000_000);
    expect(result!.turnaroundProfitAmount).toBe(200_000_000);
    expect(result!.turnaroundDate).toBe("2024-03-31");
  });

  it("1期赤字→黒字転換を検出する", () => {
    const result = detectTurnaround(HISTORY_1Y_LOSS, {
      ...DEFAULT_OPTIONS,
      minConsecutiveLoss: 1,
    });
    expect(result).not.toBeNull();
    expect(result!.turnaroundFiscalYear).toBe(2024);
    expect(result!.consecutiveLossYears).toBe(1);
  });

  it("全期黒字の場合は null を返す", () => {
    const result = detectTurnaround(HISTORY_ALL_PROFIT, DEFAULT_OPTIONS);
    expect(result).toBeNull();
  });

  it("全期赤字の場合は null を返す", () => {
    const result = detectTurnaround(HISTORY_ALL_LOSS, DEFAULT_OPTIONS);
    expect(result).toBeNull();
  });

  it("交互パターンでは最新の転換を検出する", () => {
    const result = detectTurnaround(HISTORY_ALTERNATING, {
      ...DEFAULT_OPTIONS,
      minConsecutiveLoss: 1,
    });
    expect(result).not.toBeNull();
    expect(result!.turnaroundFiscalYear).toBe(2024);
    expect(result!.consecutiveLossYears).toBe(1); // 2023のみ赤字
  });

  it("minConsecutiveLoss=2 で1期赤字をフィルタする", () => {
    const result = detectTurnaround(HISTORY_1Y_LOSS, {
      ...DEFAULT_OPTIONS,
      minConsecutiveLoss: 2,
    });
    expect(result).toBeNull();
  });

  it("minConsecutiveLoss=3 で3期赤字を検出する", () => {
    const result = detectTurnaround(HISTORY_TURNAROUND_3Y, {
      ...DEFAULT_OPTIONS,
      minConsecutiveLoss: 3,
    });
    expect(result).not.toBeNull();
    expect(result!.consecutiveLossYears).toBe(3);
  });

  it("minConsecutiveLoss=4 で3期赤字をフィルタする", () => {
    const result = detectTurnaround(HISTORY_TURNAROUND_3Y, {
      ...DEFAULT_OPTIONS,
      minConsecutiveLoss: 4,
    });
    expect(result).toBeNull();
  });

  it("maxConsecutiveLoss でフィルタする", () => {
    const result = detectTurnaround(HISTORY_TURNAROUND_3Y, {
      ...DEFAULT_OPTIONS,
      minConsecutiveLoss: 1,
      maxConsecutiveLoss: 2,
    });
    expect(result).toBeNull();
  });

  it("requireRevenueGrowth=true で増収転換を検出する", () => {
    const result = detectTurnaround(HISTORY_TURNAROUND_REVENUE_GROWTH, {
      ...DEFAULT_OPTIONS,
      minConsecutiveLoss: 1,
      requireRevenueGrowth: true,
    });
    expect(result).not.toBeNull();
    expect(result!.revenueGrowthPct).toBeGreaterThan(0);
  });

  it("requireRevenueGrowth=true で減収転換をフィルタする", () => {
    const result = detectTurnaround(HISTORY_TURNAROUND_REVENUE_DECLINE, {
      ...DEFAULT_OPTIONS,
      minConsecutiveLoss: 1,
      requireRevenueGrowth: true,
    });
    expect(result).toBeNull();
  });

  it("売上成長率を正しく計算する", () => {
    const result = detectTurnaround(HISTORY_TURNAROUND_REVENUE_GROWTH, {
      ...DEFAULT_OPTIONS,
      minConsecutiveLoss: 1,
    });
    expect(result).not.toBeNull();
    // 9B → 10B = +11.1%
    expect(result!.revenueGrowthPct).toBeCloseTo(11.1, 0);
  });

  it("データが1年分しかない場合は null を返す", () => {
    const result = detectTurnaround(
      [HISTORY_TURNAROUND_3Y[0]],
      { ...DEFAULT_OPTIONS, minConsecutiveLoss: 1 }
    );
    expect(result).toBeNull();
  });

  it("空配列の場合は null を返す", () => {
    const result = detectTurnaround([], DEFAULT_OPTIONS);
    expect(result).toBeNull();
  });

  it("交互パターンで minConsecutiveLoss=2 だと1期ずつの赤字はフィルタされる", () => {
    const result = detectTurnaround(HISTORY_ALTERNATING, {
      ...DEFAULT_OPTIONS,
      minConsecutiveLoss: 2,
    });
    expect(result).toBeNull();
  });
});

import type { PriceData } from "@/types";

export type Signal = "buy" | "sell" | "hold";

export interface StrategyParam {
  key: string;
  label: string;
  default: number;
  min?: number;
  max?: number;
  step?: number;
}

export interface StrategyDef {
  id: string;
  name: string;
  description: string;
  /** all_in_out: 全額売買, fixed_amount: 固定額買付(売りなし) */
  mode: "all_in_out" | "fixed_amount";
  params: StrategyParam[];
  compute: (data: PriceData[], params: Record<string, number>) => Signal[];
}

export interface Trade {
  date: string;
  type: "buy" | "sell";
  price: number;
  shares: number;
  value: number;
  reason: string;
}

export interface EquityPoint {
  date: string;
  equity: number;
  cash: number;
  position: number;
  drawdown: number;
}

export interface BacktestStats {
  totalReturn: number;
  totalReturnPct: number;
  winRate: number;
  numTrades: number;
  numWins: number;
  numLosses: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  avgDrawdownPct: number;
  sharpeRatio: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  maxTradeReturnPct: number;
  recoveryFactor: number;
  avgHoldingDays: number;
  holdingDaysMin: number;
  holdingDaysQ1: number;
  holdingDaysMedian: number;
  holdingDaysQ3: number;
  holdingDaysMax: number;
}

export interface BacktestResult {
  trades: Trade[];
  equity: EquityPoint[];
  stats: BacktestStats;
  initialCapital: number;
  finalEquity: number;
}

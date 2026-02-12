import StockCard from "../StockCard";
import type { Stock } from "@/types";
import type { StockQuote, StockStats, SignalSummary } from "@/types/watchlist";

interface StockGridProps {
  displayedStocks: Stock[];
  sortedStocks: Stock[];
  quotes: Record<string, StockQuote>;
  stats: Record<string, StockStats>;
  signals: Record<string, SignalSummary>;
  signalPeriodFilter: string;
  hasAnyFilter: boolean;
  hasMore: boolean;
  displayCount: number;
  onLoadMore: () => void;
  onDeleteStock: (symbol: string) => void;
  onEditGroups: (symbol: string, event: React.MouseEvent) => void;
  onCardVisible: (symbol: string, isVisible: boolean) => void;
  onOpenModal: () => void;
}

export function StockGrid({
  displayedStocks,
  sortedStocks,
  quotes,
  stats,
  signals,
  signalPeriodFilter,
  hasAnyFilter,
  hasMore,
  displayCount,
  onLoadMore,
  onDeleteStock,
  onEditGroups,
  onCardVisible,
  onOpenModal,
}: StockGridProps) {
  if (sortedStocks.length === 0) {
    return (
      <div className="rounded-lg border-2 border-dashed border-gray-300 dark:border-slate-600 p-12 text-center">
        <p className="text-gray-500 dark:text-slate-400">
          ウォッチリストに銘柄がありません
        </p>
        <button
          onClick={onOpenModal}
          className="mt-4 text-blue-500 hover:text-blue-600"
        >
          銘柄を追加する
        </button>
      </div>
    );
  }

  return (
    <>
      {/* 件数表示 */}
      {!hasAnyFilter && (
        <p className="mb-2 text-xs text-gray-400 dark:text-slate-500">
          {Math.min(displayCount, sortedStocks.length)}/{sortedStocks.length}件表示中
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {displayedStocks.length === 0 ? (
          <div className="col-span-full rounded-lg border border-dashed border-gray-300 dark:border-slate-600 p-8 text-center">
            <p className="text-sm text-gray-500 dark:text-slate-400">
              該当する銘柄がありません
            </p>
          </div>
        ) : (
          displayedStocks.map((stock) => {
            const q = quotes[stock.symbol];
            const s = stats[stock.symbol];
            const sig = signals[stock.symbol];
            return (
              <StockCard
                key={stock.symbol}
                stock={stock}
                price={q?.price}
                change={q?.changePercent}
                per={s?.per ?? undefined}
                pbr={s?.pbr ?? undefined}
                roe={s?.roe ?? undefined}
                simpleNcRatio={s?.simpleNcRatio ?? undefined}
                marketCap={s?.marketCap ?? undefined}
                sharpe1y={s?.sharpe1y ?? undefined}
                latestDividend={s?.latestDividend ?? undefined}
                latestIncrease={s?.latestIncrease ?? undefined}
                signals={sig}
                signalPeriodFilter={signalPeriodFilter}
                fundamentalJudgment={stock.fundamental?.judgment}
                fundamentalMemo={stock.fundamental?.memo}
                onDelete={onDeleteStock}
                onEditGroups={onEditGroups}
                onVisible={onCardVisible}
              />
            );
          })
        )}
      </div>

      {/* もっと見る */}
      {hasMore && (
        <div className="mt-6 text-center">
          <button
            onClick={onLoadMore}
            className="rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-6 py-2.5 text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
          >
            もっと見る（残り {sortedStocks.length - displayCount} 件）
          </button>
        </div>
      )}
    </>
  );
}

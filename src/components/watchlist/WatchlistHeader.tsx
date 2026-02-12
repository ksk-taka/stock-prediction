import type { WatchlistGroup } from "@/types";

interface WatchlistHeaderProps {
  allGroups: WatchlistGroup[];
  selectedGroupIds: Set<number>;
  onToggleGroup: (groupId: number) => void;
  onOpenModal: () => void;
}

export function WatchlistHeader({
  allGroups,
  selectedGroupIds,
  onToggleGroup,
  onOpenModal,
}: WatchlistHeaderProps) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white">ウォッチリスト</h2>
        {allGroups.length > 0 && (
          <div className="flex items-center gap-1">
            {allGroups.map((g) => (
              <button
                key={g.id}
                onClick={() => onToggleGroup(g.id)}
                className={`flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                  selectedGroupIds.has(g.id)
                    ? "border-current text-white"
                    : "border-gray-300 bg-white text-gray-500 hover:border-gray-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500"
                }`}
                style={
                  selectedGroupIds.has(g.id)
                    ? { backgroundColor: g.color, borderColor: g.color }
                    : undefined
                }
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{
                    backgroundColor: selectedGroupIds.has(g.id) ? "#fff" : g.color,
                  }}
                />
                {g.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        onClick={onOpenModal}
        className="flex items-center gap-1 rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
      >
        <svg
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        銘柄追加
      </button>
    </div>
  );
}

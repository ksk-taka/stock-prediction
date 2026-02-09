import { getWatchList } from "@/lib/data/watchlist";
import { getCachedSignals } from "@/lib/cache/signalsCache";
import { computeAndCacheSignals } from "@/lib/signals/computeSignals";

// 7817.T は YF データエラーのため除外
const EXCLUDE_SYMBOLS = new Set(["7817.T"]);

const CONCURRENCY = 5;

export async function POST() {
  const list = getWatchList();
  const allSymbols = list.stocks
    .map((s) => s.symbol)
    .filter((s) => !EXCLUDE_SYMBOLS.has(s));

  const total = allSymbols.length;
  let scanned = 0;
  let errors = 0;
  let skipped = 0;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      send({ type: "start", total });

      // 5並列で処理
      let idx = 0;
      const processNext = async () => {
        while (idx < allSymbols.length) {
          const symbol = allSymbols[idx++];

          // 有効なキャッシュがあればスキップ
          const cached = getCachedSignals(symbol);
          if (cached) {
            skipped++;
            scanned++;
            if (scanned % 50 === 0 || scanned === total) {
              send({ type: "progress", scanned, total, skipped, errors });
            }
            continue;
          }

          try {
            await computeAndCacheSignals(symbol);
          } catch (e) {
            errors++;
            console.error(`Signal scan error for ${symbol}:`, e instanceof Error ? e.message : e);
          }
          scanned++;
          // 50件ごと or 最後にprogress送信（SSEの頻度を抑える）
          if (scanned % 50 === 0 || scanned === total) {
            send({ type: "progress", scanned, total, skipped, errors });
          }
        }
      };

      const workers = Array.from({ length: CONCURRENCY }, () => processNext());
      await Promise.all(workers);

      send({
        type: "done",
        scanned,
        total,
        skipped,
        errors,
        completedAt: new Date().toISOString(),
      });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

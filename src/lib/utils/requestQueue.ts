/**
 * 同時実行数制限付きリクエストキュー
 * Yahoo Finance APIの暗黙的レート制限を回避するため、
 * 同時リクエスト数を制御する。
 */

type Task<T> = () => Promise<T>;

interface QueueItem {
  task: Task<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

export class RequestQueue {
  private concurrency: number;
  private running = 0;
  private queue: QueueItem[] = [];

  constructor(concurrency = 10) {
    this.concurrency = concurrency;
  }

  async add<T>(task: Task<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        task: task as Task<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.run();
    });
  }

  private run() {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const item = this.queue.shift()!;
      this.running++;
      item
        .task()
        .then(item.resolve)
        .catch(item.reject)
        .finally(() => {
          this.running--;
          this.run();
        });
    }
  }
}

/** Yahoo Finance API用のグローバルキュー（同時10リクエスト） */
export const yfQueue = new RequestQueue(10);

/** J-Quants API用のグローバルキュー（同時5リクエスト） */
export const jqQueue = new RequestQueue(5);

/** Kabutan スクレイピング用のグローバルキュー（同時3リクエスト） */
export const kabutanQueue = new RequestQueue(3);

import { Injectable, Logger } from '@nestjs/common';
import { BatchConfig, DEFAULT_BATCH_CONFIG, validateBatchConfig } from '../config/batch.config';
import { BatchResult, BatchSummary } from './batch.types';

/**
 * BatchService
 *
 * Provides a concurrency-controlled `runBatch` method that replaces
 * raw Promise.all() usage. Processes an array of async operations with a
 * sliding-window semaphore, preserves result order, and surfaces both
 * fulfilled values and rejected reasons without throwing.
 */
@Injectable()
export class BatchService {
  private readonly logger = new Logger(BatchService.name);

  /**
   * Run an array of async operations with a concurrency cap.
   *
   * @param items          Input items to process.
   * @param operation      Async function applied to each item.
   * @param configOverride Optional per-call concurrency override.
   * @returns              Ordered BatchResult array + summary stats.
   *
   * @example
   * const { results, succeeded, failed } = await batchService.runBatch(
   *   userIds,
   *   (id) => fetchUser(id),
   *   { concurrency: 20 },
   * );
   */
  async runBatch<T, R>(
    items: T[],
    operation: (item: T, index: number) => Promise<R>,
    configOverride?: Partial<BatchConfig>,
  ): Promise<BatchSummary<R>> {
    const config = validateBatchConfig(configOverride ?? DEFAULT_BATCH_CONFIG);
    const { concurrency } = config;

    const startTime = Date.now();
    const total = items.length;

    this.logger.debug(`runBatch started — total: ${total}, concurrency: ${concurrency}`);

    if (total === 0) {
      return { results: [], total: 0, succeeded: 0, failed: 0, durationMs: 0 };
    }

    // Pre-allocate result slots so order is always preserved
    const results: BatchResult<R>[] = new Array(total);

    await this.slidingWindow(items, operation, results, concurrency);

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;
    const durationMs = Date.now() - startTime;

    this.logger.debug(
      `runBatch completed — succeeded: ${succeeded}, failed: ${failed}, duration: ${durationMs}ms`,
    );

    return { results, total, succeeded, failed, durationMs };
  }

  // ---------------------------------------------------------------------------
  // Private: true sliding-window via Promise.race
  // Maintains exactly `concurrency` in-flight promises at all times.
  // No chunk-boundary stalls; free slots are refilled immediately.
  // ---------------------------------------------------------------------------
  private async slidingWindow<T, R>(
    items: T[],
    operation: (item: T, index: number) => Promise<R>,
    results: BatchResult<R>[],
    concurrency: number,
  ): Promise<void> {
    let cursor = 0;
    const active = new Map<number, Promise<void>>();

    const wrap = (index: number): Promise<void> => {
      const p = (async () => {
        const item = items[index];
        try {
          const value = await operation(item, index);
          results[index] = { index, status: 'fulfilled', value };
        } catch (err) {
          results[index] = { index, status: 'rejected', reason: err };
        } finally {
          active.delete(index);
        }
      })();
      return p;
    };

    // Seed initial window
    while (cursor < items.length && active.size < concurrency) {
      active.set(cursor, wrap(cursor));
      cursor++;
    }

    // Race → refill until all items are processed
    while (active.size > 0) {
      await Promise.race(active.values());
      while (cursor < items.length && active.size < concurrency) {
        active.set(cursor, wrap(cursor));
        cursor++;
      }
    }
  }
}

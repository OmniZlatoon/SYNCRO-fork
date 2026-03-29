/**
 * Batch Operation Helper
 * Runs multiple async operations in parallel with graceful partial failure handling.
 * Returns array of individual results; failures don't block successes.
 */

import type { Logger } from "./types.js";
import { silentLogger } from "./logger.js";

export interface BatchResultItem<T, K = string> {
  id: K;
  success: boolean;
  data?: T;
  error?: string;
}

export interface BatchResult<T, K = string> {
  results: BatchResultItem<T, K>[];
  successCount: number;
  failureCount: number;
}

/**
 * Runs a batch of async operations, collecting individual results.
 * Partial failures are handled gracefully - each operation's result is captured independently.
 */
export async function runBatch<T, K = string>(
  ids: K[],
  operation: (id: K, options?: { signal?: AbortSignal }) => Promise<{ success: boolean; data?: T; error?: string }>,
  options?: { signal?: AbortSignal }
): Promise<BatchResult<T, K>> {
  const log = logger ?? silentLogger;

  if (!ids || ids.length === 0) {
    return { results: [], successCount: 0, failureCount: 0 };
  }

  log.info("Batch execution starting", { totalOperations: ids.length });

  const promises = ids.map(async (id): Promise<BatchResultItem<T, K>> => {
    try {
      if (options?.signal?.aborted) {
        return { id, success: false, error: 'AbortError: The operation was aborted' };
      }
      const requestOptions = options?.signal ? { signal: options.signal } : undefined;
      const result = await operation(id, requestOptions);
      const item: BatchResultItem<T, K> = { id, success: result.success };
      if (result.data !== undefined) item.data = result.data;
      if (result.error !== undefined) item.error = result.error;
      return item;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      log.error("Batch operation exception", { id, error: errorMessage });
      return { id, success: false, error: errorMessage };
    }
  });

  const results = await Promise.all(promises);
  const successCount = results.filter((r) => r.success).length;
  const failureCount = results.length - successCount;

  log.info("Batch execution completed", {
    totalOperations: results.length,
    successCount,
    failureCount,
  });

  return { results, successCount, failureCount };
}

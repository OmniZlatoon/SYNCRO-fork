export interface BatchConfig {
  /**
   * Maximum number of operations to run concurrently.
   * Must be between 1 and 500.
   * @default 10
   */
  concurrency: number;
}

export const DEFAULT_BATCH_CONFIG: BatchConfig = {
  concurrency: 10,
};

export const MAX_CONCURRENCY = 500;
export const MIN_CONCURRENCY = 1;

export function validateBatchConfig(config: Partial<BatchConfig>): BatchConfig {
  const concurrency = config.concurrency ?? DEFAULT_BATCH_CONFIG.concurrency;

  if (!Number.isInteger(concurrency) || concurrency < MIN_CONCURRENCY || concurrency > MAX_CONCURRENCY) {
    throw new Error(
      `Invalid concurrency value "${concurrency}". Must be an integer between ${MIN_CONCURRENCY} and ${MAX_CONCURRENCY}.`,
    );
  }

  return { concurrency };
}

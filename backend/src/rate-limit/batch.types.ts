export type BatchStatus = 'fulfilled' | 'rejected';

export interface BatchResult<T> {
  index: number;
  status: BatchStatus;
  value?: T;
  reason?: unknown;
}

export interface BatchSummary<T> {
  results: BatchResult<T>[];
  total: number;
  succeeded: number;
  failed: number;
  durationMs: number;
}

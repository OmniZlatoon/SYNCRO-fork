const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

interface FailureRecord {
  count: number;
  windowStart: number; // epoch ms
  lockedUntil?: number; // epoch ms
}

export class TotpRateLimiter {
  private records = new Map<string, FailureRecord>();

  isLocked(sessionId: string): boolean {
    const record = this.records.get(sessionId);
    if (!record?.lockedUntil) return false;
    return Date.now() < record.lockedUntil;
  }

  recordFailure(sessionId: string): void {
    const now = Date.now();
    const record = this.records.get(sessionId);

    if (!record || now - record.windowStart > WINDOW_MS) {
      // No record or window expired — start fresh
      this.records.set(sessionId, { count: 1, windowStart: now });
      return;
    }

    record.count += 1;

    if (record.count >= MAX_FAILURES) {
      record.lockedUntil = now + LOCKOUT_MS;
    }
  }

  reset(sessionId: string): void {
    this.records.delete(sessionId);
  }
}

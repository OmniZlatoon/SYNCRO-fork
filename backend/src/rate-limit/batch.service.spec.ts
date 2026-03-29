import { Test, TestingModule } from '@nestjs/testing';
import { BatchService } from '../src/batch/batch.service';
import { BATCH_CONFIG } from '../src/batch/batch.module';
import { DEFAULT_BATCH_CONFIG } from '../src/config/batch.config';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const makeCounter = () => {
  let current = 0;
  let peak = 0;
  return {
    inc() { current++; if (current > peak) peak = current; },
    dec() { current--; },
    get peak() { return peak; },
    get current() { return current; },
  };
};

async function buildService(concurrency = 10): Promise<BatchService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      { provide: BATCH_CONFIG, useValue: { concurrency } },
      BatchService,
    ],
  }).compile();
  return module.get(BatchService);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('BatchService', () => {
  let service: BatchService;

  beforeEach(async () => {
    service = await buildService(10);
  });

  // ── Basic correctness ────────────────────────────────────────────────────

  describe('basic correctness', () => {
    it('returns an empty summary for an empty input array', async () => {
      const result = await service.runBatch([], async () => 1);
      expect(result.total).toBe(0);
      expect(result.results).toHaveLength(0);
      expect(result.succeeded).toBe(0);
      expect(result.failed).toBe(0);
    });

    it('processes all items and returns fulfilled results', async () => {
      const items = [1, 2, 3, 4, 5];
      const { results, succeeded, failed, total } = await service.runBatch(
        items,
        async (x) => x * 2,
      );
      expect(total).toBe(5);
      expect(succeeded).toBe(5);
      expect(failed).toBe(0);
      expect(results.map((r) => r.value)).toEqual([2, 4, 6, 8, 10]);
    });

    it('preserves result order regardless of async timing', async () => {
      // Items complete in reverse order
      const items = [50, 40, 30, 20, 10];
      const { results } = await service.runBatch(items, async (ms) => {
        await delay(ms);
        return ms;
      });
      expect(results.map((r) => r.index)).toEqual([0, 1, 2, 3, 4]);
      expect(results.map((r) => r.value)).toEqual([50, 40, 30, 20, 10]);
    });

    it('passes the correct index to the operation', async () => {
      const items = ['a', 'b', 'c'];
      const captured: number[] = [];
      await service.runBatch(items, async (_item, idx) => {
        captured.push(idx);
      });
      expect(captured.sort()).toEqual([0, 1, 2]);
    });
  });

  // ── Error handling ───────────────────────────────────────────────────────

  describe('error handling', () => {
    it('marks failed items as rejected without throwing', async () => {
      const items = [1, 2, 3];
      const { results, succeeded, failed } = await service.runBatch(
        items,
        async (x) => {
          if (x === 2) throw new Error('boom');
          return x;
        },
      );
      expect(succeeded).toBe(2);
      expect(failed).toBe(1);
      expect(results[1].status).toBe('rejected');
      expect((results[1].reason as Error).message).toBe('boom');
    });

    it('handles all items failing gracefully', async () => {
      const items = [1, 2, 3];
      const { succeeded, failed } = await service.runBatch(items, async () => {
        throw new Error('always fail');
      });
      expect(succeeded).toBe(0);
      expect(failed).toBe(3);
    });

    it('continues processing after individual failures', async () => {
      const processed: number[] = [];
      const items = Array.from({ length: 10 }, (_, i) => i);
      await service.runBatch(items, async (x) => {
        processed.push(x);
        if (x % 2 === 0) throw new Error('even fail');
        return x;
      });
      expect(processed).toHaveLength(10);
    });
  });

  // ── Concurrency enforcement ──────────────────────────────────────────────

  describe('concurrency limit', () => {
    it('never exceeds the configured concurrency limit', async () => {
      const LIMIT = 5;
      const svc = await buildService(LIMIT);
      const counter = makeCounter();
      const items = Array.from({ length: 50 }, (_, i) => i);

      await svc.runBatch(items, async () => {
        counter.inc();
        await delay(10);
        counter.dec();
      });

      expect(counter.peak).toBeLessThanOrEqual(LIMIT);
    });

    it('honours a per-call concurrency override', async () => {
      const OVERRIDE = 3;
      const counter = makeCounter();
      const items = Array.from({ length: 30 }, (_, i) => i);

      await service.runBatch(
        items,
        async () => {
          counter.inc();
          await delay(10);
          counter.dec();
        },
        { concurrency: OVERRIDE },
      );

      expect(counter.peak).toBeLessThanOrEqual(OVERRIDE);
    });

    it('achieves near-full concurrency (utilisation check)', async () => {
      const LIMIT = 10;
      const svc = await buildService(LIMIT);
      const counter = makeCounter();
      const items = Array.from({ length: 100 }, (_, i) => i);

      await svc.runBatch(items, async () => {
        counter.inc();
        await delay(20);
        counter.dec();
      });

      // Peak should reach the full limit (sliding window keeps it full)
      expect(counter.peak).toBe(LIMIT);
    });

    it('handles concurrency=1 (serial execution)', async () => {
      const svc = await buildService(1);
      const counter = makeCounter();
      const items = Array.from({ length: 10 }, (_, i) => i);

      await svc.runBatch(items, async () => {
        counter.inc();
        await delay(5);
        counter.dec();
      });

      expect(counter.peak).toBe(1);
    });
  });

  // ── Config validation ────────────────────────────────────────────────────

  describe('config validation', () => {
    it('throws for concurrency = 0', async () => {
      await expect(
        service.runBatch([1], async (x) => x, { concurrency: 0 }),
      ).rejects.toThrow('Invalid concurrency value');
    });

    it('throws for concurrency > 500', async () => {
      await expect(
        service.runBatch([1], async (x) => x, { concurrency: 501 }),
      ).rejects.toThrow('Invalid concurrency value');
    });

    it('throws for non-integer concurrency', async () => {
      await expect(
        service.runBatch([1], async (x) => x, { concurrency: 2.5 }),
      ).rejects.toThrow('Invalid concurrency value');
    });

    it('accepts boundary value concurrency=1', async () => {
      const { total } = await service.runBatch([1, 2], async (x) => x, {
        concurrency: 1,
      });
      expect(total).toBe(2);
    });

    it('accepts boundary value concurrency=500', async () => {
      const { total } = await service.runBatch([1, 2], async (x) => x, {
        concurrency: 500,
      });
      expect(total).toBe(2);
    });
  });

  // ── Summary stats ────────────────────────────────────────────────────────

  describe('summary stats', () => {
    it('reports accurate succeeded and failed counts', async () => {
      const items = Array.from({ length: 10 }, (_, i) => i);
      const { succeeded, failed } = await service.runBatch(items, async (x) => {
        if (x < 3) throw new Error('low');
        return x;
      });
      expect(succeeded).toBe(7);
      expect(failed).toBe(3);
    });

    it('durationMs is a positive number', async () => {
      const { durationMs } = await service.runBatch(
        [1, 2, 3],
        async (x) => x,
      );
      expect(durationMs).toBeGreaterThanOrEqual(0);
    });

    it('each result carries the correct index field', async () => {
      const items = ['x', 'y', 'z'];
      const { results } = await service.runBatch(items, async (v) => v);
      results.forEach((r, i) => expect(r.index).toBe(i));
    });
  });

  // ── Stress test ──────────────────────────────────────────────────────────

  describe('stress tests', () => {
    jest.setTimeout(30_000);

    it('handles 1 000 items with concurrency 50 correctly', async () => {
      const SIZE = 1_000;
      const LIMIT = 50;
      const svc = await buildService(LIMIT);
      const counter = makeCounter();
      const items = Array.from({ length: SIZE }, (_, i) => i);

      const { results, succeeded, failed, durationMs } = await svc.runBatch(
        items,
        async (x) => {
          counter.inc();
          await delay(2);
          counter.dec();
          return x * 2;
        },
      );

      expect(results).toHaveLength(SIZE);
      expect(succeeded).toBe(SIZE);
      expect(failed).toBe(0);
      expect(counter.peak).toBeLessThanOrEqual(LIMIT);
      // Should complete well under 5 s with concurrency=50 and 2 ms tasks
      expect(durationMs).toBeLessThan(5_000);
      // Order preserved
      results.forEach((r, i) => {
        expect(r.index).toBe(i);
        expect(r.value).toBe(i * 2);
      });
    });

    it('handles 5 000 items with mixed success/failure at concurrency 25', async () => {
      const SIZE = 5_000;
      const LIMIT = 25;
      const svc = await buildService(LIMIT);
      const items = Array.from({ length: SIZE }, (_, i) => i);
      let peakConcurrency = 0;
      let current = 0;

      const { succeeded, failed } = await svc.runBatch(
        items,
        async (x) => {
          current++;
          if (current > peakConcurrency) peakConcurrency = current;
          await delay(1);
          current--;
          if (x % 10 === 0) throw new Error('divisible by 10');
          return x;
        },
      );

      expect(succeeded + failed).toBe(SIZE);
      expect(failed).toBe(SIZE / 10); // every 10th item fails
      expect(peakConcurrency).toBeLessThanOrEqual(LIMIT);
    });

    it('handles 10 000 synchronous-style items without stack overflow', async () => {
      const SIZE = 10_000;
      const svc = await buildService(100);
      const items = Array.from({ length: SIZE }, (_, i) => i);

      const { total, succeeded } = await svc.runBatch(items, async (x) => x);

      expect(total).toBe(SIZE);
      expect(succeeded).toBe(SIZE);
    });

    it('does NOT regress to old Promise.all behaviour (peak > limit is a fail)', async () => {
      // If someone accidentally reverts to Promise.all, peak will equal SIZE
      const SIZE = 200;
      const LIMIT = 10;
      const svc = await buildService(LIMIT);
      const counter = makeCounter();
      const items = Array.from({ length: SIZE }, (_, i) => i);

      await svc.runBatch(items, async () => {
        counter.inc();
        await delay(5);
        counter.dec();
      });

      // This fails loudly if Promise.all is used
      expect(counter.peak).toBeLessThanOrEqual(LIMIT);
      expect(counter.peak).not.toBe(SIZE);
    });
  });
});

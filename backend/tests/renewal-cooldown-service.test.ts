import { renewalCooldownService } from '../src/services/renewal-cooldown-service';
import { supabase } from '../src/config/database';

// Mock supabase
jest.mock('../src/config/database', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

describe('RenewalCooldownService', () => {
  const mockSubscriptionId = 'test-sub-123';
  const mockTimestamp = new Date().toISOString();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('checkCooldown', () => {
    it('should return canRetry=true when no previous attempt', async () => {
      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: {
            last_renewal_attempt_at: null,
            renewal_cooldown_minutes: 5,
          },
          error: null,
        }),
      };

      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const result = await renewalCooldownService.checkCooldown(mockSubscriptionId);

      expect(result.canRetry).toBe(true);
      expect(result.isOnCooldown).toBe(false);
      expect(result.timeRemainingSeconds).toBe(0);
      expect(result.lastAttemptAt).toBeNull();
    });

    it('should return canRetry=false when cooldown is active', async () => {
      const minutesAgo = new Date(Date.now() - 2 * 60 * 1000); // 2 minutes ago
      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: {
            last_renewal_attempt_at: minutesAgo.toISOString(),
            renewal_cooldown_minutes: 5,
          },
          error: null,
        }),
      };

      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const result = await renewalCooldownService.checkCooldown(mockSubscriptionId);

      expect(result.canRetry).toBe(false);
      expect(result.isOnCooldown).toBe(true);
      expect(result.timeRemainingSeconds).toBeGreaterThan(0);
      expect(result.timeRemainingSeconds).toBeLessThanOrEqual(180); // ~3 minutes
    });

    it('should return canRetry=true when cooldown period has passed', async () => {
      const minutesAgo = new Date(Date.now() - 6 * 60 * 1000); // 6 minutes ago
      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: {
            last_renewal_attempt_at: minutesAgo.toISOString(),
            renewal_cooldown_minutes: 5,
          },
          error: null,
        }),
      };

      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const result = await renewalCooldownService.checkCooldown(mockSubscriptionId);

      expect(result.canRetry).toBe(true);
      expect(result.isOnCooldown).toBe(false);
      expect(result.timeRemainingSeconds).toBe(0);
    });
  });

  describe('recordRenewalAttempt', () => {
    it('should record successful renewal attempt', async () => {
      const mockUpdateQuery = {
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: {
            last_renewal_attempt_at: mockTimestamp,
          },
          error: null,
        }),
      };

      const mockInsertQuery = {
        insert: jest.fn().mockResolvedValue({
          data: null,
          error: null,
        }),
      };

      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'subscriptions') return mockUpdateQuery;
        if (table === 'subscription_renewal_attempts') return mockInsertQuery;
        return {
          update: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          single: jest.fn(),
        };
      });

      const result = await renewalCooldownService.recordRenewalAttempt(
        mockSubscriptionId,
        true,
        undefined,
        'manual'
      );

      expect(result.new_attempt_at).toEqual(mockTimestamp);
      expect(mockUpdateQuery.update).toHaveBeenCalledWith(
        expect.objectContaining({
          last_renewal_attempt_at: expect.any(String),
        })
      );
    });

    it('should record failed renewal attempt with error message', async () => {
      const errorMsg = 'Network timeout';
      const mockUpdateQuery = {
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: {
            last_renewal_attempt_at: mockTimestamp,
          },
          error: null,
        }),
      };

      const mockInsertQuery = {
        insert: jest.fn().mockResolvedValue({
          data: null,
          error: null,
        }),
      };

      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'subscriptions') return mockUpdateQuery;
        if (table === 'subscription_renewal_attempts') return mockInsertQuery;
        return mockUpdateQuery;
      });

      await renewalCooldownService.recordRenewalAttempt(
        mockSubscriptionId,
        false,
        errorMsg,
        'retry'
      );

      expect(mockInsertQuery.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error_message: errorMsg,
          attempt_type: 'retry',
        })
      );
    });
  });

  describe('setCooldownPeriod', () => {
    it('should update cooldown period for subscription', async () => {
      const newCooldownMinutes = 10;
      const mockSelectQuery = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: {
            renewal_cooldown_minutes: 5,
          },
          error: null,
        }),
      };

      const mockUpdateQuery = {
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockResolvedValue({
          data: null,
          error: null,
        }),
      };

      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'subscriptions') {
          return {
            select: mockSelectQuery.select,
            eq: jest.fn().mockImplementation(() => ({
              single: mockSelectQuery.single,
            })),
            update: mockUpdateQuery.update,
          };
        }
        return mockUpdateQuery;
      });

      const result = await renewalCooldownService.setCooldownPeriod(
        mockSubscriptionId,
        newCooldownMinutes
      );

      expect(result.success).toBe(true);
      expect(result.previousCooldown).toBe(5);
      expect(result.newCooldown).toBe(newCooldownMinutes);
    });

    it('should reject invalid cooldown periods', async () => {
      await expect(
        renewalCooldownService.setCooldownPeriod(mockSubscriptionId, -1)
      ).rejects.toThrow('Cooldown period must be between 0 and 1440 minutes');

      await expect(
        renewalCooldownService.setCooldownPeriod(mockSubscriptionId, 1500)
      ).rejects.toThrow('Cooldown period must be between 0 and 1440 minutes');
    });
  });

  describe('resetCooldown', () => {
    it('should reset last_renewal_attempt_at to null', async () => {
      const mockQuery = {
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockResolvedValue({
          data: null,
          error: null,
        }),
      };

      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const result = await renewalCooldownService.resetCooldown(mockSubscriptionId);

      expect(result.success).toBe(true);
      expect(mockQuery.update).toHaveBeenCalledWith(
        expect.objectContaining({
          last_renewal_attempt_at: null,
        })
      );
    });
  });

  describe('getCooldownConfig', () => {
    it('should retrieve cooldown configuration', async () => {
      const pastTime = new Date(Date.now() - 10 * 60 * 1000);
      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: {
            renewal_cooldown_minutes: 5,
            last_renewal_attempt_at: pastTime.toISOString(),
          },
          error: null,
        }),
      };

      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const config = await renewalCooldownService.getCooldownConfig(mockSubscriptionId);

      expect(config.cooldownMinutes).toBe(5);
      expect(config.lastAttemptAt).toBeDefined();
      expect(config.nextRetryAt).toBeDefined();
    });
  });
});

describe('Cooldown Enforcement Integration Tests', () => {
  describe('Workflow: Rapid retry prevention', () => {
    it('should prevent rapid renewal attempts within cooldown window', async () => {
      // Simulates: User clicks retry button twice within 5 minutes
      // Expected: Second attempt is rejected

      // This is a conceptual test showing the workflow
      const subscriptionId = 'workflow-test-123';
      
      // Mock: No previous attempt
      const mockQuery1 = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: {
            last_renewal_attempt_at: null,
            renewal_cooldown_minutes: 5,
          },
          error: null,
        }),
      };

      (supabase.from as jest.Mock).mockReturnValue(mockQuery1);

      // First attempt should be allowed
      const firstCheck = await renewalCooldownService.checkCooldown(subscriptionId);
      expect(firstCheck.canRetry).toBe(true);

      // Simulate: Record the first attempt
      const mockUpdateQuery = {
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: {
            last_renewal_attempt_at: new Date().toISOString(),
          },
          error: null,
        }),
      };

      const mockInsertQuery = {
        insert: jest.fn().mockResolvedValue({ data: null, error: null }),
      };

      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'subscriptions') return mockUpdateQuery;
        if (table === 'subscription_renewal_attempts') return mockInsertQuery;
        return mockUpdateQuery;
      });

      await renewalCooldownService.recordRenewalAttempt(
        subscriptionId,
        true,
        undefined,
        'manual'
      );

      // Mock: Attempt recorded, now check cooldown again (immediately after)
      const now = new Date();
      const mockQuery2 = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: {
            last_renewal_attempt_at: now.toISOString(),
            renewal_cooldown_minutes: 5,
          },
          error: null,
        }),
      };

      (supabase.from as jest.Mock).mockReturnValue(mockQuery2);

      // Second attempt should be rejected (still in cooldown)
      const secondCheck = await renewalCooldownService.checkCooldown(subscriptionId);
      expect(secondCheck.canRetry).toBe(false);
      expect(secondCheck.timeRemainingSeconds).toBeGreaterThan(0);
      expect(secondCheck.timeRemainingSeconds).toBeLessThanOrEqual(300); // 5 minutes
    });
  });
});

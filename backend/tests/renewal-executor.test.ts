// Mock supabase before any imports
jest.mock('../src/config/database', () => ({
  supabase: { from: jest.fn() },
}));

jest.mock('../src/config/logger', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  __esModule: true,
}));

jest.mock('../src/services/blockchain-service', () => ({
  blockchainService: { syncSubscription: jest.fn() },
}));

// Pass the mocked supabase directly as the transaction client
jest.mock('../src/utils/transaction', () => {
  const { supabase } = jest.requireMock('../src/config/database');
  return {
    DatabaseTransaction: {
      execute: jest.fn().mockImplementation((cb: (client: any) => any) => cb(supabase)),
    },
  };
});

import { renewalExecutor } from '../src/services/renewal-executor';
import { supabase } from '../src/config/database';
import { blockchainService } from '../src/services/blockchain-service';

describe('RenewalExecutor', () => {
  const mockRequest = {
    subscriptionId: 'sub-123',
    userId: 'user-456',
    approvalId: 'approval-789',
    amount: 9.99,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should execute renewal successfully', async () => {
    const approvalQuery = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { approval_id: 'approval-789', max_spend: 15.0, expires_at: null, used: false },
        error: null,
      }),
    };
    const subscriptionQuery = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: {
          status: 'active',
          next_billing_date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
        },
        error: null,
      }),
    };
    const updateQuery = {
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({ error: null }),
    };
    const insertQuery = {
      insert: jest.fn().mockResolvedValue({ error: null }),
    };

    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'renewal_approvals') return approvalQuery;
      if (table === 'subscriptions') return { ...subscriptionQuery, ...updateQuery };
      return insertQuery;
    });

    (blockchainService.syncSubscription as jest.Mock).mockResolvedValue({
      success: true,
      transactionHash: 'tx-hash-123',
    });

    const result = await renewalExecutor.executeRenewal(mockRequest);

    expect(result.success).toBe(true);
    expect(result.subscriptionId).toBe(mockRequest.subscriptionId);
    expect(result.transactionHash).toBe('tx-hash-123');
  });

  it('should fail with invalid approval', async () => {
    const approvalQuery = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: { message: 'Not found' } }),
    };
    const logQuery = { insert: jest.fn().mockResolvedValue({ error: null }) };

    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'renewal_approvals') return approvalQuery;
      return logQuery;
    });

    const result = await renewalExecutor.executeRenewal(mockRequest);

    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('invalid_approval');
  });

  it('should fail when billing window invalid', async () => {
    const approvalQuery = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { approval_id: 'approval-789', max_spend: 15.0, expires_at: null, used: false },
        error: null,
      }),
    };
    const subscriptionQuery = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: {
          status: 'active',
          next_billing_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        },
        error: null,
      }),
    };
    const logQuery = { insert: jest.fn().mockResolvedValue({ error: null }) };

    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'renewal_approvals') return approvalQuery;
      if (table === 'subscriptions') return subscriptionQuery;
      return logQuery;
    });

    const result = await renewalExecutor.executeRenewal(mockRequest);

    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('billing_window_invalid');
  });

  it('should retry on retryable failures', async () => {
    const approvalQuery = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: { message: 'Not found' } }),
    };
    const logQuery = { insert: jest.fn().mockResolvedValue({ error: null }) };

    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'renewal_approvals') return approvalQuery;
      return logQuery;
    });

    const result = await renewalExecutor.executeRenewalWithRetry(mockRequest, 3);

    expect(result).toBeDefined();
    expect(result.success).toBe(false);
  });
});

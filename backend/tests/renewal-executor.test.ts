import { renewalExecutor } from '../src/services/renewal-executor';
import { supabase } from '../src/config/database';

describe('RenewalExecutor', () => {
  const mockRequest = {
    subscriptionId: 'sub-123',
    userId: 'user-456',
    approvalId: 'approval-789',
    amount: 9.99,
  };

  beforeEach(async () => {
    // Setup test data
    await supabase.from('subscriptions').insert({
      id: mockRequest.subscriptionId,
      user_id: mockRequest.userId,
      name: 'Netflix',
      price: 9.99,
      status: 'active',
      next_billing_date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    });

    await supabase.from('renewal_approvals').insert({
      subscription_id: mockRequest.subscriptionId,
      approval_id: mockRequest.approvalId,
      max_spend: 15.0,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      used: false,
    });
  });

  afterEach(async () => {
    await supabase.from('renewal_logs').delete().eq('subscription_id', mockRequest.subscriptionId);
    await supabase.from('renewal_approvals').delete().eq('subscription_id', mockRequest.subscriptionId);
    await supabase.from('subscriptions').delete().eq('id', mockRequest.subscriptionId);
  });

  it('should execute renewal successfully', async () => {
    const result = await renewalExecutor.executeRenewal(mockRequest);

    expect(result.success).toBe(true);
    expect(result.subscriptionId).toBe(mockRequest.subscriptionId);
    expect(result.transactionHash).toBeDefined();
  });

  it('should fail with invalid approval', async () => {
    const invalidRequest = { ...mockRequest, approvalId: 'invalid' };
    const result = await renewalExecutor.executeRenewal(invalidRequest);

    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('invalid_approval');
  });

  it('should fail when billing window invalid', async () => {
    await supabase
      .from('subscriptions')
      .update({ next_billing_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() })
      .eq('id', mockRequest.subscriptionId);

    const result = await renewalExecutor.executeRenewal(mockRequest);

    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('billing_window_invalid');
  });

  it('should retry on retryable failures', async () => {
    const result = await renewalExecutor.executeRenewalWithRetry(mockRequest, 3);

    expect(result).toBeDefined();
  });
});

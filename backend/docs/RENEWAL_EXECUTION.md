# Renewal Execution Service

Centralized service for executing subscription renewals with atomic workflow and graceful retry handling.

## Architecture

The `RenewalExecutor` consolidates all renewal logic into a single atomic workflow:

```
┌─────────────────────────────────────────────────┐
│         Renewal Execution Workflow              │
├─────────────────────────────────────────────────┤
│ 1. Check Approval                               │
│    - Validate approval exists                   │
│    - Check expiration                           │
│    - Verify amount within max_spend             │
├─────────────────────────────────────────────────┤
│ 2. Validate Billing Window                      │
│    - Subscription is active                     │
│    - Within 7 days of billing date              │
├─────────────────────────────────────────────────┤
│ 3. Trigger Contract Renewal                     │
│    - Call Soroban smart contract                │
│    - Execute on-chain renewal                   │
├─────────────────────────────────────────────────┤
│ 4. Update Database                              │
│    - Update subscription status                 │
│    - Set next billing date                      │
│    - Record transaction hash                    │
├─────────────────────────────────────────────────┤
│ 5. Log Result                                   │
│    - Success: Record transaction                │
│    - Failure: Record reason & error             │
└─────────────────────────────────────────────────┘
```

## Usage

### Basic Execution

```typescript
import { renewalExecutor } from './services/renewal-executor';

const result = await renewalExecutor.executeRenewal({
  subscriptionId: 'sub-123',
  userId: 'user-456',
  approvalId: 'approval-789',
  amount: 9.99,
});

if (result.success) {
  console.log('Renewal successful:', result.transactionHash);
} else {
  console.error('Renewal failed:', result.failureReason);
}
```

### With Retry Logic

```typescript
const result = await renewalExecutor.executeRenewalWithRetry(
  {
    subscriptionId: 'sub-123',
    userId: 'user-456',
    approvalId: 'approval-789',
    amount: 9.99,
  },
  3 // max retries
);
```

## Failure Handling

### Failure Reasons

- `invalid_approval` - Approval not found, expired, or amount exceeds limit
- `billing_window_invalid` - Subscription not active or too early for renewal
- `contract_failure` - Smart contract execution failed (retryable)
- `execution_error` - Unexpected error during execution (retryable)

### Retry Strategy

- Exponential backoff: 1s, 2s, 4s, 8s, ... (max 30s)
- Only retries on retryable failures
- Configurable max retry attempts (default: 3)

## Database Schema

### renewal_logs

Tracks all renewal execution attempts:

```sql
CREATE TABLE renewal_logs (
  id UUID PRIMARY KEY,
  subscription_id UUID NOT NULL,
  user_id UUID NOT NULL,
  status TEXT NOT NULL, -- 'success' | 'failed'
  transaction_hash TEXT,
  failure_reason TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL
);
```

### renewal_approvals

Stores user approvals for renewals:

```sql
CREATE TABLE renewal_approvals (
  id UUID PRIMARY KEY,
  subscription_id UUID NOT NULL,
  approval_id TEXT NOT NULL,
  max_spend NUMERIC,
  expires_at TIMESTAMPTZ,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL
);
```

## Integration

### Scheduler Integration

The renewal executor is integrated into the scheduler service:

```typescript
// Runs every hour
cron.schedule('0 * * * *', async () => {
  await processRenewals();
});
```

### API Integration

```typescript
app.post('/api/renewals/execute', async (req, res) => {
  const result = await renewalExecutor.executeRenewalWithRetry(req.body);
  res.json(result);
});
```

## Testing

Run tests:

```bash
npm test renewal-executor.test.ts
```

## Benefits

✅ **Atomic workflow** - All steps execute within a database transaction
✅ **Graceful retries** - Exponential backoff with configurable attempts
✅ **Failure tracking** - All failures recorded with reasons
✅ **Centralized logic** - Single source of truth for renewal execution
✅ **Type-safe** - Full TypeScript support

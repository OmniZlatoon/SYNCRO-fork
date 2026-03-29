# GDPR Compliance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add GDPR compliance to SYNCRO — data export, account deletion with 30-day grace period, cookie consent, privacy/terms pages, and email unsubscribe system.

**Architecture:** Backend-first approach. New `compliance.ts` route and `compliance-service.ts` service handle data export, account deletion, and unsubscribe logic. Email service updated with unsubscribe footers and `List-Unsubscribe` headers. Cookie consent is client-only. Static legal pages added to the Next.js app.

**Tech Stack:** Express 5, Supabase (PostgreSQL), archiver (ZIP), crypto HMAC, nodemailer, Next.js 15, React 19, shadcn/ui

**Spec:** `docs/superpowers/specs/2026-03-28-gdpr-compliance-design.md`

---

## File Structure

### Backend — New Files
| File | Responsibility |
|------|---------------|
| `backend/scripts/018_gdpr_compliance.sql` | Migration: `account_deletions` table, audit_logs FK change |
| `backend/src/services/compliance-service.ts` | Data gathering for export, deletion orchestration, HMAC token utils |
| `backend/src/routes/compliance.ts` | Endpoints: export, delete account, cancel deletion, unsubscribe, email preferences |
| `backend/tests/compliance-service.test.ts` | Unit tests for compliance service |
| `backend/tests/compliance-routes.test.ts` | Integration tests for compliance endpoints |

### Backend — Modified Files
| File | Change |
|------|--------|
| `backend/src/index.ts` | Mount compliance routes |
| `backend/src/services/email-service.ts` | Add unsubscribe footer, List-Unsubscribe headers, token generation |
| `backend/src/services/scheduler.ts` | Add daily hard-delete cron job |
| `backend/package.json` | Add `archiver` + `@types/archiver` dependencies |

### Client — New Files
| File | Responsibility |
|------|---------------|
| `client/app/privacy/page.tsx` | Privacy Policy page |
| `client/app/terms/page.tsx` | Terms of Service page |
| `client/app/dpa/page.tsx` | DPA contact page |
| `client/app/email-preferences/page.tsx` | Email preferences management page |
| `client/components/cookie-consent.tsx` | Cookie consent banner |
| `client/components/deletion-banner.tsx` | Account deletion warning banner |

### Client — Modified Files
| File | Change |
|------|--------|
| `client/app/layout.tsx` | Add CookieConsent component |

---

## Task 1: Database Migration

**Files:**
- Create: `backend/scripts/018_gdpr_compliance.sql`

- [ ] **Step 1: Write the migration script**

```sql
-- 018_gdpr_compliance.sql
-- GDPR compliance: account_deletions table + audit_logs FK change

-- 1. Create account_deletions table
CREATE TABLE IF NOT EXISTS account_deletions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  scheduled_deletion_at TIMESTAMPTZ NOT NULL,
  cancelled_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'cancelled', 'completed')),
  CONSTRAINT valid_scheduled_date CHECK (scheduled_deletion_at > requested_at)
);

CREATE INDEX idx_account_deletions_status ON account_deletions(status);
CREATE INDEX idx_account_deletions_scheduled ON account_deletions(scheduled_deletion_at) WHERE status = 'pending';

ALTER TABLE account_deletions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own deletion status"
  ON account_deletions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can request own deletion"
  ON account_deletions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can cancel own deletion"
  ON account_deletions FOR UPDATE
  USING (auth.uid() = user_id);

-- 2. Make audit_logs.user_id nullable and change FK to SET NULL
-- This ensures audit logs survive user deletion (anonymized, not deleted)
ALTER TABLE audit_logs ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_user_id_fkey;
ALTER TABLE audit_logs
  ADD CONSTRAINT audit_logs_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- 3. Index for efficient data export queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
```

- [ ] **Step 2: Commit**

```bash
git add backend/scripts/018_gdpr_compliance.sql
git commit -m "feat(db): add account_deletions table and audit_logs FK migration"
```

---

## Task 2: Install Dependencies

**Files:**
- Modify: `backend/package.json`

- [ ] **Step 1: Install archiver for ZIP generation**

```bash
cd backend && npm install archiver && npm install --save-dev @types/archiver
```

- [ ] **Step 2: Verify installation**

```bash
cd backend && node -e "require('archiver'); console.log('archiver OK')"
```

Expected: `archiver OK`

- [ ] **Step 3: Commit**

```bash
git add backend/package.json backend/package-lock.json
git commit -m "feat(deps): add archiver for GDPR data export"
```

---

## Task 3: Compliance Service — HMAC Token Utilities

**Files:**
- Create: `backend/src/services/compliance-service.ts`
- Create: `backend/tests/compliance-service.test.ts`

- [ ] **Step 1: Write the failing test for HMAC token generation and verification**

```typescript
// backend/tests/compliance-service.test.ts
import { ComplianceService } from '../src/services/compliance-service';

// Set test secret before importing
process.env.UNSUBSCRIBE_SECRET = 'test-secret-key-for-hmac-signing';

describe('ComplianceService', () => {
  let service: ComplianceService;

  beforeEach(() => {
    service = new ComplianceService();
  });

  describe('HMAC Unsubscribe Tokens', () => {
    it('should generate a valid token', () => {
      const token = service.generateUnsubscribeToken('user-123', 'reminders');
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(0);
    });

    it('should verify a valid token', () => {
      const token = service.generateUnsubscribeToken('user-123', 'reminders');
      const result = service.verifyUnsubscribeToken(token);
      expect(result).toEqual({
        valid: true,
        userId: 'user-123',
        emailType: 'reminders',
      });
    });

    it('should reject a tampered token', () => {
      const token = service.generateUnsubscribeToken('user-123', 'reminders');
      const tampered = token.slice(0, -5) + 'XXXXX';
      const result = service.verifyUnsubscribeToken(tampered);
      expect(result).toEqual({ valid: false });
    });

    it('should reject an expired token', () => {
      // Generate token with timestamp 91 days ago
      const token = service.generateUnsubscribeToken('user-123', 'reminders', Date.now() - 91 * 24 * 60 * 60 * 1000);
      const result = service.verifyUnsubscribeToken(token);
      expect(result).toEqual({ valid: false });
    });

    it('should accept a token within 90-day expiry', () => {
      const token = service.generateUnsubscribeToken('user-123', 'reminders', Date.now() - 89 * 24 * 60 * 60 * 1000);
      const result = service.verifyUnsubscribeToken(token);
      expect(result).toEqual({
        valid: true,
        userId: 'user-123',
        emailType: 'reminders',
      });
    });

    it('should reject a malformed token', () => {
      const result = service.verifyUnsubscribeToken('not-a-real-token');
      expect(result).toEqual({ valid: false });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npx jest tests/compliance-service.test.ts --verbose
```

Expected: FAIL — `Cannot find module '../src/services/compliance-service'`

- [ ] **Step 3: Write the HMAC token implementation**

```typescript
// backend/src/services/compliance-service.ts
import crypto from 'crypto';
import { supabase } from '../config/database';
import { logger } from '../config/logger';

interface TokenVerificationResult {
  valid: boolean;
  userId?: string;
  emailType?: string;
}

const TOKEN_EXPIRY_DAYS = 90;

export class ComplianceService {
  private getSecret(): string {
    const secret = process.env.UNSUBSCRIBE_SECRET;
    if (!secret) {
      throw new Error('UNSUBSCRIBE_SECRET environment variable is required');
    }
    return secret;
  }

  generateUnsubscribeToken(userId: string, emailType: string, timestamp?: number): string {
    const ts = timestamp ?? Date.now();
    const payload = Buffer.from(JSON.stringify({ userId, emailType, ts })).toString('base64url');
    const signature = crypto
      .createHmac('sha256', this.getSecret())
      .update(payload)
      .digest('base64url');
    return `${payload}.${signature}`;
  }

  verifyUnsubscribeToken(token: string): TokenVerificationResult {
    try {
      const [payload, signature] = token.split('.');
      if (!payload || !signature) {
        return { valid: false };
      }

      const expectedSignature = crypto
        .createHmac('sha256', this.getSecret())
        .update(payload)
        .digest('base64url');

      if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
        return { valid: false };
      }

      const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
      const { userId, emailType, ts } = data;

      const ageMs = Date.now() - ts;
      const maxAgeMs = TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
      if (ageMs > maxAgeMs) {
        return { valid: false };
      }

      return { valid: true, userId, emailType };
    } catch {
      return { valid: false };
    }
  }
}

export const complianceService = new ComplianceService();
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && npx jest tests/compliance-service.test.ts --verbose
```

Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/compliance-service.ts backend/tests/compliance-service.test.ts
git commit -m "feat: add compliance service with HMAC unsubscribe tokens"
```

---

## Task 4: Compliance Service — Data Export

**Files:**
- Modify: `backend/src/services/compliance-service.ts`
- Modify: `backend/tests/compliance-service.test.ts`

- [ ] **Step 1: Write the failing test for data gathering**

Add to `backend/tests/compliance-service.test.ts`:

```typescript
// Add at the top of the file, after existing imports
jest.mock('../src/config/database', () => ({
  supabase: {
    from: jest.fn(),
    auth: { admin: { deleteUser: jest.fn() } },
  },
}));

import { supabase } from '../src/config/database';

// Add this describe block after the HMAC tests
describe('Data Export', () => {
  const mockFrom = supabase.from as jest.Mock;

  beforeEach(() => {
    mockFrom.mockReset();
  });

  it('should gather all user data for export', async () => {
    const userId = 'user-export-test';

    const mockProfile = { id: userId, display_name: 'Test User' };
    const mockSubscriptions = [{ id: 'sub-1', name: 'Netflix', status: 'active' }];
    const mockNotifications = [{ id: 'notif-1', type: 'reminder' }];
    const mockAuditLogs = [{ id: 'audit-1', action: 'login' }];
    const mockPreferences = { user_id: userId, email_opt_ins: { reminders: true } };
    const mockEmailAccounts = [{ id: 'ea-1', email: 'test@gmail.com' }];
    const mockTeamMembers = [{ id: 'tm-1', team_id: 'team-1' }];
    const mockContractEvents = [{ id: 'ce-1', event_type: 'renewal' }];
    const mockRenewalApprovals = [{ id: 'ra-1', approval_id: 'a-1' }];

    mockFrom.mockImplementation((table: string) => {
      const chainable = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn(),
      };

      const tableData: Record<string, any> = {
        profiles: { data: mockProfile, error: null },
        subscriptions: { data: mockSubscriptions, error: null },
        notifications: { data: mockNotifications, error: null },
        audit_logs: { data: mockAuditLogs, error: null },
        user_preferences: { data: mockPreferences, error: null },
        email_accounts: { data: mockEmailAccounts, error: null },
        team_members: { data: mockTeamMembers, error: null },
        contract_events: { data: mockContractEvents, error: null },
        renewal_approvals: { data: mockRenewalApprovals, error: null },
      };

      const result = tableData[table] || { data: null, error: null };

      // For tables that return single row
      if (table === 'profiles' || table === 'user_preferences') {
        chainable.single.mockResolvedValue(result);
      } else {
        // For tables that return arrays, resolve on .eq()
        chainable.eq.mockResolvedValue(result);
      }

      return chainable;
    });

    const data = await service.gatherUserData(userId);

    expect(data.profile).toEqual(mockProfile);
    expect(data.subscriptions).toEqual(mockSubscriptions);
    expect(data.notifications).toEqual(mockNotifications);
    expect(data.auditLogs).toEqual(mockAuditLogs);
    expect(data.preferences).toEqual(mockPreferences);
    expect(data.emailAccounts).toEqual(mockEmailAccounts);
    expect(data.teams).toEqual(mockTeamMembers);
    expect(data.blockchainLogs.contractEvents).toEqual(mockContractEvents);
    expect(data.blockchainLogs.renewalApprovals).toEqual(mockRenewalApprovals);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npx jest tests/compliance-service.test.ts --testNamePattern="Data Export" --verbose
```

Expected: FAIL — `service.gatherUserData is not a function`

- [ ] **Step 3: Implement data gathering**

Add to `ComplianceService` class in `backend/src/services/compliance-service.ts`:

```typescript
export interface UserExportData {
  profile: any;
  subscriptions: any[];
  notifications: any[];
  auditLogs: any[];
  preferences: any;
  emailAccounts: any[];
  teams: any[];
  blockchainLogs: {
    contractEvents: any[];
    renewalApprovals: any[];
  };
}

// Add this method inside the ComplianceService class
async gatherUserData(userId: string): Promise<UserExportData> {
  const [
    profileResult,
    subscriptionsResult,
    notificationsResult,
    auditLogsResult,
    preferencesResult,
    emailAccountsResult,
    teamsResult,
    contractEventsResult,
    renewalApprovalsResult,
  ] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).single(),
    supabase.from('subscriptions').select('*').eq('user_id', userId),
    supabase.from('notifications').select('*').eq('user_id', userId),
    supabase.from('audit_logs').select('*').eq('user_id', userId),
    supabase.from('user_preferences').select('*').eq('user_id', userId).single(),
    supabase.from('email_accounts').select('*').eq('user_id', userId),
    supabase.from('team_members').select('*').eq('user_id', userId),
    supabase.from('contract_events').select('*').eq('user_id', userId),
    supabase.from('renewal_approvals').select('*').eq('user_id', userId),
  ]);

  return {
    profile: profileResult.data || {},
    subscriptions: subscriptionsResult.data || [],
    notifications: notificationsResult.data || [],
    auditLogs: auditLogsResult.data || [],
    preferences: preferencesResult.data || {},
    emailAccounts: emailAccountsResult.data || [],
    teams: teamsResult.data || [],
    blockchainLogs: {
      contractEvents: contractEventsResult.data || [],
      renewalApprovals: renewalApprovalsResult.data || [],
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && npx jest tests/compliance-service.test.ts --testNamePattern="Data Export" --verbose
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/compliance-service.ts backend/tests/compliance-service.test.ts
git commit -m "feat: add data export gathering to compliance service"
```

---

## Task 5: Compliance Service — Account Deletion

**Files:**
- Modify: `backend/src/services/compliance-service.ts`
- Modify: `backend/tests/compliance-service.test.ts`

- [ ] **Step 1: Write failing tests for request deletion, cancel deletion, and hard delete**

Add to `backend/tests/compliance-service.test.ts`:

```typescript
describe('Account Deletion', () => {
  const mockFrom = supabase.from as jest.Mock;
  const mockDeleteUser = (supabase.auth.admin as any).deleteUser as jest.Mock;

  beforeEach(() => {
    mockFrom.mockReset();
    mockDeleteUser.mockReset();
  });

  it('should request account deletion with 30-day grace period', async () => {
    const userId = 'user-delete-test';

    let insertedData: any = null;

    mockFrom.mockImplementation((table: string) => {
      const chainable: any = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        in: jest.fn().mockReturnThis(),
        single: jest.fn(),
        insert: jest.fn().mockImplementation((data: any) => {
          insertedData = data;
          return { select: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data, error: null }) }) };
        }),
        update: jest.fn().mockReturnThis(),
      };

      if (table === 'account_deletions') {
        // No existing pending deletion
        chainable.single.mockResolvedValue({ data: null, error: { code: 'PGRST116' } });
      }
      if (table === 'subscriptions') {
        chainable.eq.mockResolvedValue({ data: [], error: null });
      }
      if (table === 'audit_logs') {
        chainable.insert.mockResolvedValue({ error: null });
      }

      return chainable;
    });

    const result = await service.requestDeletion(userId, 'No longer needed');

    expect(insertedData).toBeDefined();
    expect(insertedData.user_id).toBe(userId);
    expect(insertedData.status).toBe('pending');
    expect(insertedData.reason).toBe('No longer needed');
  });

  it('should reject deletion request if one is already pending', async () => {
    const userId = 'user-already-pending';

    mockFrom.mockImplementation((table: string) => {
      const chainable: any = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        in: jest.fn().mockReturnThis(),
        single: jest.fn(),
      };

      if (table === 'account_deletions') {
        chainable.single.mockResolvedValue({
          data: { user_id: userId, status: 'pending' },
          error: null,
        });
      }

      return chainable;
    });

    await expect(service.requestDeletion(userId)).rejects.toThrow('Account deletion already pending');
  });

  it('should cancel a pending deletion', async () => {
    const userId = 'user-cancel-test';
    let updatedData: any = null;

    mockFrom.mockImplementation((table: string) => {
      const chainable: any = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn(),
        update: jest.fn().mockImplementation((data: any) => {
          updatedData = data;
          return {
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                select: jest.fn().mockReturnValue({
                  single: jest.fn().mockResolvedValue({ data: { ...data, user_id: userId }, error: null }),
                }),
              }),
            }),
          };
        }),
      };

      return chainable;
    });

    const result = await service.cancelDeletion(userId);

    expect(updatedData.status).toBe('cancelled');
    expect(updatedData.cancelled_at).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npx jest tests/compliance-service.test.ts --testNamePattern="Account Deletion" --verbose
```

Expected: FAIL — `service.requestDeletion is not a function`

- [ ] **Step 3: Implement account deletion methods**

Add to `ComplianceService` class in `backend/src/services/compliance-service.ts`:

```typescript
async requestDeletion(userId: string, reason?: string): Promise<any> {
  // Check for existing pending deletion
  const { data: existing, error: checkError } = await supabase
    .from('account_deletions')
    .select('*')
    .eq('user_id', userId)
    .in('status', ['pending'])
    .single();

  if (existing && !checkError) {
    throw new Error('Account deletion already pending');
  }

  const now = new Date();
  const scheduledDeletionAt = new Date(now);
  scheduledDeletionAt.setDate(scheduledDeletionAt.getDate() + 30);

  // Check for existing cancelled row to reuse (UNIQUE constraint on user_id)
  const { data: cancelledRow } = await supabase
    .from('account_deletions')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'cancelled')
    .single();

  let deletionRecord;

  if (cancelledRow) {
    // Reuse existing row
    const { data, error } = await supabase
      .from('account_deletions')
      .update({
        status: 'pending',
        requested_at: now.toISOString(),
        scheduled_deletion_at: scheduledDeletionAt.toISOString(),
        cancelled_at: null,
        completed_at: null,
        reason: reason || null,
      })
      .eq('id', cancelledRow.id)
      .select()
      .single();

    if (error) throw new Error(`Failed to request deletion: ${error.message}`);
    deletionRecord = data;
  } else {
    // Insert new row
    const insertData = {
      user_id: userId,
      status: 'pending',
      requested_at: now.toISOString(),
      scheduled_deletion_at: scheduledDeletionAt.toISOString(),
      reason: reason || null,
    };

    const { data, error } = await supabase
      .from('account_deletions')
      .insert(insertData)
      .select()
      .single();

    if (error) throw new Error(`Failed to request deletion: ${error.message}`);
    deletionRecord = data;
  }

  // Cancel active subscriptions
  await supabase
    .from('subscriptions')
    .update({ status: 'cancelled', updated_at: now.toISOString() })
    .eq('user_id', userId)
    .in('status', ['active', 'paused']);

  // Log to audit
  await supabase.from('audit_logs').insert({
    user_id: userId,
    action: 'account_deletion_requested',
    resource_type: 'account',
    resource_id: userId,
    metadata: { scheduled_deletion_at: scheduledDeletionAt.toISOString(), reason },
  });

  logger.info(`Account deletion requested for user ${userId}, scheduled for ${scheduledDeletionAt.toISOString()}`);
  return deletionRecord;
}

async cancelDeletion(userId: string): Promise<any> {
  const { data, error } = await supabase
    .from('account_deletions')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('status', 'pending')
    .select()
    .single();

  if (error) throw new Error(`Failed to cancel deletion: ${error.message}`);

  await supabase.from('audit_logs').insert({
    user_id: userId,
    action: 'account_deletion_cancelled',
    resource_type: 'account',
    resource_id: userId,
  });

  logger.info(`Account deletion cancelled for user ${userId}`);
  return data;
}

async getDeletionStatus(userId: string): Promise<any | null> {
  const { data } = await supabase
    .from('account_deletions')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .single();

  return data || null;
}

async processHardDeletes(): Promise<number> {
  const now = new Date().toISOString();

  const { data: pendingDeletions, error } = await supabase
    .from('account_deletions')
    .select('*')
    .eq('status', 'pending')
    .lte('scheduled_deletion_at', now);

  if (error || !pendingDeletions || pendingDeletions.length === 0) {
    return 0;
  }

  let processed = 0;

  for (const deletion of pendingDeletions) {
    try {
      // 1. Anonymize audit logs BEFORE deleting auth user
      await supabase
        .from('audit_logs')
        .update({ user_id: null, ip_address: null, user_agent: null })
        .eq('user_id', deletion.user_id);

      // 2. Delete Supabase auth user (cascading deletes handle app tables)
      const { error: deleteError } = await supabase.auth.admin.deleteUser(deletion.user_id);

      if (deleteError) {
        logger.error(`Failed to delete auth user ${deletion.user_id}: ${deleteError.message}`);
        continue;
      }

      // 3. Mark deletion as completed
      await supabase
        .from('account_deletions')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', deletion.id);

      logger.info(`Hard delete completed for user ${deletion.user_id}`);
      processed++;
    } catch (err) {
      logger.error(`Error processing hard delete for user ${deletion.user_id}:`, err);
    }
  }

  return processed;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && npx jest tests/compliance-service.test.ts --testNamePattern="Account Deletion" --verbose
```

Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/compliance-service.ts backend/tests/compliance-service.test.ts
git commit -m "feat: add account deletion lifecycle to compliance service"
```

---

## Task 6: Compliance Routes — Export, Deletion, Unsubscribe

**Files:**
- Create: `backend/src/routes/compliance.ts`
- Create: `backend/tests/compliance-routes.test.ts`
- Modify: `backend/src/index.ts`

- [ ] **Step 1: Write the route tests**

```typescript
// backend/tests/compliance-routes.test.ts
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';

// Mock dependencies before imports
jest.mock('../src/config/database', () => ({
  supabase: {
    from: jest.fn(),
    auth: {
      getUser: jest.fn(),
      admin: { deleteUser: jest.fn() },
    },
  },
}));

jest.mock('../src/services/compliance-service', () => ({
  complianceService: {
    gatherUserData: jest.fn(),
    generateUnsubscribeToken: jest.fn(),
    verifyUnsubscribeToken: jest.fn(),
    requestDeletion: jest.fn(),
    cancelDeletion: jest.fn(),
    getDeletionStatus: jest.fn(),
  },
}));

jest.mock('../src/config/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

import { supabase } from '../src/config/database';
import { complianceService } from '../src/services/compliance-service';
import complianceRoutes from '../src/routes/compliance';

const app = express();
app.use(cookieParser());
app.use(express.json());

// Mock auth middleware for testing
app.use((req: any, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader === 'Bearer valid-token') {
    req.user = { id: 'test-user-id', email: 'test@example.com' };
  }
  next();
});

app.use('/api/compliance', complianceRoutes);

describe('Compliance Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/compliance/account/delete', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app)
        .post('/api/compliance/account/delete')
        .send();

      expect(res.status).toBe(401);
    });

    it('should request deletion with auth', async () => {
      (complianceService.requestDeletion as jest.Mock).mockResolvedValue({
        user_id: 'test-user-id',
        status: 'pending',
        scheduled_deletion_at: '2026-04-27T00:00:00.000Z',
      });

      const res = await request(app)
        .post('/api/compliance/account/delete')
        .set('Authorization', 'Bearer valid-token')
        .send({ reason: 'Testing' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('pending');
    });
  });

  describe('POST /api/compliance/account/delete/cancel', () => {
    it('should cancel pending deletion', async () => {
      (complianceService.cancelDeletion as jest.Mock).mockResolvedValue({
        user_id: 'test-user-id',
        status: 'cancelled',
      });

      const res = await request(app)
        .post('/api/compliance/account/delete/cancel')
        .set('Authorization', 'Bearer valid-token')
        .send();

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('GET /api/compliance/unsubscribe', () => {
    it('should render confirmation page for valid token', async () => {
      (complianceService.verifyUnsubscribeToken as jest.Mock).mockReturnValue({
        valid: true,
        userId: 'user-123',
        emailType: 'reminders',
      });

      const res = await request(app)
        .get('/api/compliance/unsubscribe?token=valid-token');

      expect(res.status).toBe(200);
      expect(res.type).toBe('text/html');
      expect(res.text).toContain('Unsubscribe');
      expect(res.text).toContain('reminders');
    });

    it('should return error page for invalid token', async () => {
      (complianceService.verifyUnsubscribeToken as jest.Mock).mockReturnValue({
        valid: false,
      });

      const res = await request(app)
        .get('/api/compliance/unsubscribe?token=invalid-token');

      expect(res.status).toBe(400);
      expect(res.type).toBe('text/html');
      expect(res.text).toContain('invalid or expired');
    });
  });

  describe('POST /api/compliance/unsubscribe', () => {
    it('should unsubscribe and render success page', async () => {
      (complianceService.verifyUnsubscribeToken as jest.Mock).mockReturnValue({
        valid: true,
        userId: 'user-123',
        emailType: 'reminders',
      });

      const mockFrom = supabase.from as jest.Mock;
      mockFrom.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: { email_opt_ins: { reminders: true, marketing: false, updates: true } },
          error: null,
        }),
        upsert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: {}, error: null }),
          }),
        }),
      });

      const res = await request(app)
        .post('/api/compliance/unsubscribe')
        .send({ token: 'valid-token' });

      expect(res.status).toBe(200);
      expect(res.type).toBe('text/html');
      expect(res.text).toContain('unsubscribed');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npx jest tests/compliance-routes.test.ts --verbose
```

Expected: FAIL — `Cannot find module '../src/routes/compliance'`

- [ ] **Step 3: Implement the compliance routes**

```typescript
// backend/src/routes/compliance.ts
import { Router, Request, Response } from 'express';
import archiver from 'archiver';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { complianceService } from '../services/compliance-service';
import { userPreferenceService } from '../services/user-preference-service';
import { logger } from '../config/logger';
import { supabase } from '../config/database';

const router = Router();

// --- Data Export ---

router.get('/export', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    const data = await complianceService.gatherUserData(userId);

    const date = new Date().toISOString().split('T')[0];
    const filename = `syncro-export-${userId}-${date}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => {
      logger.error('Archive error:', err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: 'Failed to generate export' });
      }
    });

    archive.pipe(res);

    archive.append(JSON.stringify(data.profile, null, 2), { name: 'profile.json' });
    archive.append(JSON.stringify(data.subscriptions, null, 2), { name: 'subscriptions.json' });
    archive.append(JSON.stringify(data.notifications, null, 2), { name: 'notifications.json' });
    archive.append(JSON.stringify(data.auditLogs, null, 2), { name: 'audit-log.json' });
    archive.append(JSON.stringify(data.preferences, null, 2), { name: 'preferences.json' });
    archive.append(JSON.stringify(data.emailAccounts, null, 2), { name: 'email-accounts.json' });
    archive.append(JSON.stringify(data.teams, null, 2), { name: 'teams.json' });
    archive.append(JSON.stringify(data.blockchainLogs, null, 2), { name: 'blockchain-log.json' });

    const readme = `SYNCRO Data Export
Generated: ${new Date().toISOString()}
User ID: ${userId}

Files:
- profile.json — Your profile information
- subscriptions.json — All subscriptions (including cancelled/paused)
- notifications.json — Notification history
- audit-log.json — Account activity log
- preferences.json — Your notification and automation preferences
- email-accounts.json — Connected email accounts
- teams.json — Team memberships
- blockchain-log.json — On-chain activity (contract events and renewal approvals)

This export was generated per your GDPR data portability request.
`;
    archive.append(readme, { name: 'README.txt' });

    await archive.finalize();

    // Log the export
    await supabase.from('audit_logs').insert({
      user_id: userId,
      action: 'data_export',
      resource_type: 'account',
      resource_id: userId,
    });
  } catch (error) {
    logger.error('Data export error:', error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: 'Failed to generate data export' });
    }
  }
});

// --- Account Deletion ---

router.post('/account/delete', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { reason } = req.body || {};

    const result = await complianceService.requestDeletion(userId, reason);

    res.json({
      success: true,
      data: {
        status: result.status,
        scheduled_deletion_at: result.scheduled_deletion_at,
      },
    });
  } catch (error: any) {
    if (error.message === 'Account deletion already pending') {
      res.status(409).json({ success: false, error: error.message });
      return;
    }
    logger.error('Account deletion request error:', error);
    res.status(500).json({ success: false, error: 'Failed to request account deletion' });
  }
});

router.post('/account/delete/cancel', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const result = await complianceService.cancelDeletion(userId);

    res.json({ success: true, data: { status: result.status } });
  } catch (error) {
    logger.error('Cancel deletion error:', error);
    res.status(500).json({ success: false, error: 'Failed to cancel account deletion' });
  }
});

router.get('/account/deletion-status', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const status = await complianceService.getDeletionStatus(userId);

    res.json({ success: true, data: status });
  } catch (error) {
    logger.error('Deletion status error:', error);
    res.status(500).json({ success: false, error: 'Failed to get deletion status' });
  }
});

// --- Email Unsubscribe ---

router.get('/unsubscribe', (req: Request, res: Response) => {
  const { token } = req.query;

  if (!token || typeof token !== 'string') {
    res.status(400).type('html').send(renderErrorPage('No unsubscribe token provided.'));
    return;
  }

  const result = complianceService.verifyUnsubscribeToken(token);

  if (!result.valid) {
    res.status(400).type('html').send(renderErrorPage('This unsubscribe link is invalid or expired.'));
    return;
  }

  res.type('html').send(renderConfirmPage(token, result.emailType!));
});

router.post('/unsubscribe', async (req: Request, res: Response) => {
  const { token } = req.body;

  if (!token || typeof token !== 'string') {
    res.status(400).type('html').send(renderErrorPage('No unsubscribe token provided.'));
    return;
  }

  const result = complianceService.verifyUnsubscribeToken(token);

  if (!result.valid) {
    res.status(400).type('html').send(renderErrorPage('This unsubscribe link is invalid or expired.'));
    return;
  }

  try {
    // Get current preferences
    const { data: prefs } = await supabase
      .from('user_preferences')
      .select('email_opt_ins')
      .eq('user_id', result.userId)
      .single();

    const currentOptIns = prefs?.email_opt_ins || { reminders: true, marketing: false, updates: true };
    const updatedOptIns = { ...currentOptIns, [result.emailType!]: false };

    await supabase
      .from('user_preferences')
      .upsert({ user_id: result.userId, email_opt_ins: updatedOptIns })
      .select()
      .single();

    res.type('html').send(renderSuccessPage(result.emailType!));
  } catch (error) {
    logger.error('Unsubscribe error:', error);
    res.status(500).type('html').send(renderErrorPage('Something went wrong. Please try again later.'));
  }
});

// --- Email Preferences API (token or session auth) ---

router.get('/email-preferences', async (req: Request, res: Response) => {
  try {
    let userId: string | undefined;

    // Try token auth first
    const { token } = req.query;
    if (token && typeof token === 'string') {
      const result = complianceService.verifyUnsubscribeToken(token);
      if (result.valid) {
        userId = result.userId;
      }
    }

    // Fall back to session auth
    if (!userId) {
      const authHeader = req.headers.authorization;
      let authToken: string | null = null;

      if (authHeader?.startsWith('Bearer ')) {
        authToken = authHeader.substring(7);
      } else if ((req as any).cookies?.authToken) {
        authToken = (req as any).cookies.authToken;
      }

      if (authToken) {
        const { data: { user } } = await supabase.auth.getUser(authToken);
        if (user) userId = user.id;
      }
    }

    if (!userId) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }

    const { data: prefs } = await supabase
      .from('user_preferences')
      .select('email_opt_ins')
      .eq('user_id', userId)
      .single();

    res.json({
      success: true,
      data: {
        email_opt_ins: prefs?.email_opt_ins || { reminders: true, marketing: false, updates: true, digests: true },
      },
    });
  } catch (error) {
    logger.error('Get email preferences error:', error);
    res.status(500).json({ success: false, error: 'Failed to get preferences' });
  }
});

router.patch('/email-preferences', async (req: Request, res: Response) => {
  try {
    let userId: string | undefined;

    // Try token auth
    const { token } = req.body;
    if (token && typeof token === 'string') {
      const result = complianceService.verifyUnsubscribeToken(token);
      if (result.valid) userId = result.userId;
    }

    // Fall back to session auth
    if (!userId) {
      const authHeader = req.headers.authorization;
      let authToken: string | null = null;

      if (authHeader?.startsWith('Bearer ')) {
        authToken = authHeader.substring(7);
      } else if ((req as any).cookies?.authToken) {
        authToken = (req as any).cookies.authToken;
      }

      if (authToken) {
        const { data: { user } } = await supabase.auth.getUser(authToken);
        if (user) userId = user.id;
      }
    }

    if (!userId) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }

    const { email_opt_ins } = req.body;
    if (!email_opt_ins || typeof email_opt_ins !== 'object') {
      res.status(400).json({ success: false, error: 'email_opt_ins object required' });
      return;
    }

    // Only allow known keys
    const allowedKeys = ['reminders', 'marketing', 'updates', 'digests'];
    const filtered: Record<string, boolean> = {};
    for (const key of allowedKeys) {
      if (typeof email_opt_ins[key] === 'boolean') {
        filtered[key] = email_opt_ins[key];
      }
    }

    const { data: current } = await supabase
      .from('user_preferences')
      .select('email_opt_ins')
      .eq('user_id', userId)
      .single();

    const merged = { ...(current?.email_opt_ins || {}), ...filtered };

    await supabase
      .from('user_preferences')
      .upsert({ user_id: userId, email_opt_ins: merged })
      .select()
      .single();

    res.json({ success: true, data: { email_opt_ins: merged } });
  } catch (error) {
    logger.error('Update email preferences error:', error);
    res.status(500).json({ success: false, error: 'Failed to update preferences' });
  }
});

// --- HTML Renderers for Unsubscribe Pages ---

function renderConfirmPage(token: string, emailType: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Unsubscribe — Synchro</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 80px auto; padding: 0 20px; text-align: center; color: #333; }
  h1 { font-size: 24px; margin-bottom: 16px; }
  p { font-size: 16px; color: #666; margin-bottom: 32px; }
  form { display: inline; }
  button { background: #6366f1; color: white; border: none; padding: 12px 32px; border-radius: 8px; font-size: 16px; cursor: pointer; }
  button:hover { background: #4f46e5; }
  a { color: #6366f1; text-decoration: none; margin-left: 16px; }
</style>
</head>
<body>
  <h1>Unsubscribe from ${emailType}?</h1>
  <p>You will no longer receive ${emailType} emails from Synchro.</p>
  <form method="POST" action="/api/compliance/unsubscribe">
    <input type="hidden" name="token" value="${token}">
    <button type="submit">Confirm Unsubscribe</button>
  </form>
  <a href="/email-preferences?token=${token}">Manage all preferences</a>
</body>
</html>`;
}

function renderSuccessPage(emailType: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Unsubscribed — Synchro</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 80px auto; padding: 0 20px; text-align: center; color: #333; }
  h1 { font-size: 24px; margin-bottom: 16px; }
  p { font-size: 16px; color: #666; }
  a { color: #6366f1; text-decoration: none; }
</style>
</head>
<body>
  <h1>You've been unsubscribed</h1>
  <p>You will no longer receive ${emailType} emails from Synchro.</p>
  <p><a href="/email-preferences">Manage all email preferences</a></p>
</body>
</html>`;
}

function renderErrorPage(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Error — Synchro</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 80px auto; padding: 0 20px; text-align: center; color: #333; }
  h1 { font-size: 24px; margin-bottom: 16px; color: #dc2626; }
  p { font-size: 16px; color: #666; }
</style>
</head>
<body>
  <h1>Something went wrong</h1>
  <p>${message}</p>
</body>
</html>`;
}

export default router;
```

- [ ] **Step 4: Mount the routes in index.ts**

Add to `backend/src/index.ts`, alongside the other route imports and mount points:

Import at top:
```typescript
import complianceRoutes from './routes/compliance';
```

Mount with other routes:
```typescript
app.use('/api/compliance', complianceRoutes);
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd backend && npx jest tests/compliance-routes.test.ts --verbose
```

Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/compliance.ts backend/tests/compliance-routes.test.ts backend/src/index.ts
git commit -m "feat: add compliance routes for data export, account deletion, and unsubscribe"
```

---

## Task 7: Update Email Service — Unsubscribe Footer & Headers

**Files:**
- Modify: `backend/src/services/email-service.ts`

- [ ] **Step 1: Add unsubscribe token import and footer generation**

At the top of `email-service.ts`, add the import:

```typescript
import { complianceService } from './compliance-service';
```

- [ ] **Step 2: Add a method to generate the unsubscribe footer HTML**

Add this method to the `EmailService` class:

```typescript
private getUnsubscribeFooter(userId: string, emailType: string): string {
  const appUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const apiUrl = process.env.BACKEND_URL || 'http://localhost:3001';
  const token = complianceService.generateUnsubscribeToken(userId, emailType);
  const unsubscribeUrl = `${apiUrl}/api/compliance/unsubscribe?token=${token}`;
  const preferencesUrl = `${appUrl}/email-preferences?token=${token}`;

  return `
    <div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 12px; color: #9ca3af;">
      <p>You're receiving this because you have ${emailType} enabled in your Synchro account.</p>
      <p>
        <a href="${unsubscribeUrl}" style="color: #6366f1;">Unsubscribe from ${emailType}</a>
        &nbsp;|&nbsp;
        <a href="${preferencesUrl}" style="color: #6366f1;">Manage email preferences</a>
      </p>
    </div>
  `;
}
```

- [ ] **Step 3: Add a method to generate List-Unsubscribe email headers**

Add this method to the `EmailService` class:

```typescript
private getUnsubscribeHeaders(userId: string, emailType: string): Record<string, string> {
  const apiUrl = process.env.BACKEND_URL || 'http://localhost:3001';
  const token = complianceService.generateUnsubscribeToken(userId, emailType);
  const unsubscribeUrl = `${apiUrl}/api/compliance/unsubscribe?token=${token}`;

  return {
    'List-Unsubscribe': `<${unsubscribeUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}
```

- [ ] **Step 4: Update `sendReminderEmail` to include unsubscribe footer and headers**

In the `sendReminderEmail` method, modify the `sendMail` call to include the unsubscribe footer at the end of the HTML body and add the List-Unsubscribe headers.

Find the section where `this.transporter.sendMail` is called and update it. The HTML template should append the unsubscribe footer before the closing `</body>` tag. Add `headers` to the `sendMail` options:

```typescript
// Inside sendReminderEmail, where sendMail is called:
const userId = payload.userId || '';
const unsubscribeFooter = userId ? this.getUnsubscribeFooter(userId, 'reminders') : '';
const unsubscribeHeaders = userId ? this.getUnsubscribeHeaders(userId, 'reminders') : {};

const info = await this.transporter.sendMail({
  from: this.fromEmail,
  to: recipientEmail,
  subject,
  html: html + unsubscribeFooter,
  text: this.getEmailText(payload),
  headers: unsubscribeHeaders,
});
```

Note: The `NotificationPayload` type may need a `userId` field added. If it doesn't already have one, add `userId?: string` to the interface. Check the existing interface and add it if missing.

- [ ] **Step 5: Update `sendSimpleEmail` similarly**

For `sendSimpleEmail`, if a userId is available in the calling context, add the same unsubscribe footer and headers. If userId is not passed to `sendSimpleEmail`, add an optional `options` parameter:

```typescript
async sendSimpleEmail(
  to: string,
  subject: string,
  text: string,
  options?: { userId?: string; emailType?: string }
): Promise<void> {
  // ... existing logic ...
  const unsubscribeFooter = options?.userId ? this.getUnsubscribeFooter(options.userId, options.emailType || 'updates') : '';
  const unsubscribeHeaders = options?.userId ? this.getUnsubscribeHeaders(options.userId, options.emailType || 'updates') : {};

  await this.transporter.sendMail({
    from: this.fromEmail,
    to,
    subject,
    text,
    html: `<p>${text}</p>${unsubscribeFooter}`,
    headers: unsubscribeHeaders,
  });
}
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/email-service.ts
git commit -m "feat: add unsubscribe footer and List-Unsubscribe headers to emails"
```

---

## Task 8: Add Hard Delete Cron Job to Scheduler

**Files:**
- Modify: `backend/src/services/scheduler.ts`

- [ ] **Step 1: Import the compliance service**

Add to the top of `scheduler.ts`:

```typescript
import { complianceService } from './compliance-service';
```

- [ ] **Step 2: Add the daily hard-delete cron job**

Inside the `start()` method, add a new job after the existing jobs:

```typescript
// Process account hard deletes (daily at 3 AM UTC)
this.jobs.push(
  cron.schedule('0 3 * * *', async () => {
    logger.info('Running account hard delete job');
    try {
      const processed = await complianceService.processHardDeletes();
      logger.info(`Hard delete job completed: ${processed} accounts processed`);
    } catch (error) {
      logger.error('Error in hard delete job:', error);
    }
  }),
);
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/scheduler.ts
git commit -m "feat: add daily hard-delete cron job for expired account deletions"
```

---

## Task 9: Cookie Consent Banner

**Files:**
- Create: `client/components/cookie-consent.tsx`
- Modify: `client/app/layout.tsx`

- [ ] **Step 1: Create the cookie consent component**

```tsx
// client/components/cookie-consent.tsx
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(^| )${name}=([^;]+)`));
  return match ? match[2] : null;
}

function setCookie(name: string, value: string, days: number): void {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${value}; expires=${expires}; path=/; SameSite=Lax; Secure`;
}

export function hasAnalyticsConsent(): boolean {
  return getCookie('syncro_consent') === 'accepted';
}

export default function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!getCookie('syncro_consent')) {
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  const handleAccept = () => {
    setCookie('syncro_consent', 'accepted', 365);
    setVisible(false);
  };

  const handleNecessaryOnly = () => {
    setCookie('syncro_consent', 'necessary_only', 365);
    setVisible(false);
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 shadow-lg p-4">
      <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        <p className="text-sm text-gray-600">
          We use cookies to improve your experience.{' '}
          <Link href="/privacy" className="text-indigo-600 underline">
            Privacy Policy
          </Link>
        </p>
        <div className="flex gap-3 shrink-0">
          <button
            onClick={handleNecessaryOnly}
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Necessary Only
          </button>
          <button
            onClick={handleAccept}
            className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
          >
            Accept All
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add CookieConsent to the root layout**

In `client/app/layout.tsx`, import and render the component inside the body, after `<PWAProvider>`:

Import at top:
```tsx
import CookieConsent from '@/components/cookie-consent';
```

Update the body to include it:
```tsx
<body className={`font-sans antialiased`} suppressHydrationWarning>
    <PWAProvider>
        {children}
    </PWAProvider>
    <CookieConsent />
</body>
```

- [ ] **Step 3: Add Privacy Policy and Terms footer links to layout**

Check if there is an existing footer component in the codebase. If there is, add links there. If not, add a minimal footer inside `layout.tsx` or the main page layout with:

```tsx
<footer className="border-t border-gray-200 py-6 text-center text-sm text-gray-500">
  <Link href="/privacy" className="hover:underline">Privacy Policy</Link>
  {' | '}
  <Link href="/terms" className="hover:underline">Terms of Service</Link>
</footer>
```

The exact placement depends on the existing layout structure. Add it where it will appear on all pages.

- [ ] **Step 4: Commit**

```bash
git add client/components/cookie-consent.tsx client/app/layout.tsx
git commit -m "feat: add cookie consent banner, analytics gating, and footer legal links"
```

---

## Task 10: Privacy Policy Page

**Files:**
- Create: `client/app/privacy/page.tsx`

- [ ] **Step 1: Create the privacy policy page**

```tsx
// client/app/privacy/page.tsx
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy Policy — SYNCRO',
  description: 'How SYNCRO collects, uses, and protects your data.',
};

export default function PrivacyPolicyPage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-16">
      <Link href="/" className="text-indigo-600 text-sm hover:underline">&larr; Back to home</Link>

      <h1 className="text-3xl font-bold mt-6 mb-2">Privacy Policy</h1>
      <p className="text-sm text-gray-500 mb-8">Last updated: March 28, 2026</p>

      <div className="prose prose-gray max-w-none space-y-8">
        <section>
          <h2 className="text-xl font-semibold mb-3">1. What We Collect</h2>
          <p>When you use SYNCRO, we collect the following data:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li><strong>Account information</strong> — email address, display name, company name (if provided)</li>
            <li><strong>Subscription data</strong> — names, prices, billing cycles, renewal dates, and status of your tracked subscriptions</li>
            <li><strong>Connected email accounts</strong> — email provider and connection status (we do not store email contents)</li>
            <li><strong>Blockchain activity</strong> — on-chain contract events and renewal approvals on the Stellar network</li>
            <li><strong>Device and access data</strong> — IP address, user agent, and timestamps recorded in audit logs for security</li>
            <li><strong>Notification preferences</strong> — your chosen notification channels, reminder timing, and email opt-in settings</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">2. How We Use Your Data</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li><strong>Subscription management</strong> — to track, display, and manage your recurring subscriptions</li>
            <li><strong>Renewal reminders</strong> — to send email and push notifications before subscription renewals</li>
            <li><strong>Monthly digests</strong> — to generate spending summaries (if enabled)</li>
            <li><strong>Security</strong> — to log access events, enforce two-factor authentication, and detect suspicious activity</li>
            <li><strong>Blockchain synchronization</strong> — to interact with Soroban smart contracts on Stellar for self-custodial subscription management</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">3. Third-Party Processors</h2>
          <p>We use the following third-party services to process your data:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li><strong>Supabase</strong> — database hosting and authentication</li>
            <li><strong>SMTP email provider</strong> — email delivery for reminders and notifications</li>
            <li><strong>Stellar Network</strong> — public blockchain for on-chain subscription management (self-custodial; we never hold your funds)</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">4. Data Retention</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li><strong>Active accounts</strong> — data is retained as long as your account is active</li>
            <li><strong>Deleted accounts</strong> — upon account deletion, there is a 30-day grace period during which you can cancel the deletion. After 30 days, all personal data is permanently deleted</li>
            <li><strong>Audit logs</strong> — after account deletion, audit logs are anonymized (personal identifiers removed) but retained for security purposes</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">5. Your Rights</h2>
          <p>Under GDPR and similar regulations, you have the right to:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li><strong>Export your data</strong> — download a complete copy of all your data in machine-readable format (available in Settings)</li>
            <li><strong>Delete your account</strong> — request permanent deletion of your account and all associated data (available in Settings)</li>
            <li><strong>Unsubscribe from emails</strong> — every email includes an unsubscribe link; you can also manage preferences in Settings</li>
            <li><strong>Manage cookie consent</strong> — choose which cookies to accept via the consent banner</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">6. Cookies</h2>
          <p>SYNCRO uses the following cookies:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li><strong>Authentication cookies</strong> (necessary) — session management and login state</li>
            <li><strong>Consent cookie</strong> (necessary) — remembers your cookie consent preference</li>
            <li><strong>Analytics cookies</strong> (optional) — only loaded with your explicit consent</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">7. Security</h2>
          <p>
            We protect your data with row-level security on all database tables, encrypted connections (TLS),
            HTTP-only authentication cookies, and optional two-factor authentication. All access is logged for audit purposes.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">8. Contact</h2>
          <p>
            For privacy-related questions or to exercise your rights, contact us at{' '}
            <a href="mailto:privacy@syncro.app" className="text-indigo-600 underline">privacy@syncro.app</a>.
          </p>
          <p className="mt-2">
            For enterprise data processing agreements, see our{' '}
            <Link href="/dpa" className="text-indigo-600 underline">DPA page</Link>.
          </p>
        </section>
      </div>

      <div className="mt-12 pt-6 border-t border-gray-200 text-sm text-gray-500">
        <p>
          See also: <Link href="/terms" className="text-indigo-600 underline">Terms of Service</Link>
        </p>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/app/privacy/page.tsx
git commit -m "feat: add privacy policy page"
```

---

## Task 11: Terms of Service Page

**Files:**
- Create: `client/app/terms/page.tsx`

- [ ] **Step 1: Create the terms of service page**

```tsx
// client/app/terms/page.tsx
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Terms of Service — SYNCRO',
  description: 'Terms and conditions for using SYNCRO.',
};

export default function TermsOfServicePage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-16">
      <Link href="/" className="text-indigo-600 text-sm hover:underline">&larr; Back to home</Link>

      <h1 className="text-3xl font-bold mt-6 mb-2">Terms of Service</h1>
      <p className="text-sm text-gray-500 mb-8">Last updated: March 28, 2026</p>

      <div className="prose prose-gray max-w-none space-y-8">
        <section>
          <h2 className="text-xl font-semibold mb-3">1. Acceptance of Terms</h2>
          <p>
            By creating an account or using SYNCRO, you agree to these Terms of Service.
            If you do not agree, do not use the service.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">2. Description of Service</h2>
          <p>
            SYNCRO is a self-custodial subscription management platform. It helps you track, manage,
            and receive reminders about your recurring subscriptions. SYNCRO integrates with the Stellar
            blockchain for on-chain subscription management via Soroban smart contracts.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">3. Self-Custodial Nature</h2>
          <p>
            SYNCRO is self-custodial. We never hold, control, or have access to your cryptocurrency
            or funds. All on-chain transactions are initiated and signed by you. You are solely responsible
            for your wallet security and any transactions you authorize.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">4. Account Responsibilities</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>You must provide accurate account information</li>
            <li>You are responsible for maintaining the security of your account credentials</li>
            <li>You must notify us immediately of any unauthorized use of your account</li>
            <li>You may enable two-factor authentication for additional security</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">5. Acceptable Use</h2>
          <p>You agree not to:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Use the service for any illegal purpose</li>
            <li>Attempt to access other users' data or accounts</li>
            <li>Interfere with the service's infrastructure or security</li>
            <li>Use automated systems to abuse the service (scraping, excessive API calls)</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">6. Service Availability</h2>
          <p>
            SYNCRO is provided "as is" without guarantees of uptime or availability. We do not offer
            a Service Level Agreement (SLA). We will make reasonable efforts to maintain service
            availability but are not liable for downtime, data loss, or service interruptions.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">7. Limitation of Liability</h2>
          <p>
            SYNCRO is not responsible for any financial losses resulting from missed renewal reminders,
            failed blockchain transactions, or service unavailability. The service is a management tool
            and does not guarantee the execution of any financial transaction.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">8. Termination</h2>
          <p>
            You may delete your account at any time from your account settings. Upon deletion, there is
            a 30-day grace period during which you can cancel the request. After 30 days, all personal
            data is permanently deleted per our <Link href="/privacy" className="text-indigo-600 underline">Privacy Policy</Link>.
          </p>
          <p className="mt-2">
            We reserve the right to suspend or terminate accounts that violate these terms.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">9. Changes to Terms</h2>
          <p>
            We may update these terms from time to time. Continued use of the service after changes
            constitutes acceptance. We will notify users of significant changes via email.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">10. Contact</h2>
          <p>
            Questions about these terms? Contact us at{' '}
            <a href="mailto:legal@syncro.app" className="text-indigo-600 underline">legal@syncro.app</a>.
          </p>
        </section>
      </div>

      <div className="mt-12 pt-6 border-t border-gray-200 text-sm text-gray-500">
        <p>
          See also: <Link href="/privacy" className="text-indigo-600 underline">Privacy Policy</Link>
          {' | '}
          <Link href="/dpa" className="text-indigo-600 underline">Data Processing Agreement</Link>
        </p>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/app/terms/page.tsx
git commit -m "feat: add terms of service page"
```

---

## Task 12: DPA Page

**Files:**
- Create: `client/app/dpa/page.tsx`

- [ ] **Step 1: Create the DPA contact page**

```tsx
// client/app/dpa/page.tsx
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Data Processing Agreement — SYNCRO',
  description: 'Request a Data Processing Agreement for enterprise use.',
};

export default function DpaPage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-16">
      <Link href="/" className="text-indigo-600 text-sm hover:underline">&larr; Back to home</Link>

      <h1 className="text-3xl font-bold mt-6 mb-2">Data Processing Agreement</h1>
      <p className="text-sm text-gray-500 mb-8">Last updated: March 28, 2026</p>

      <div className="prose prose-gray max-w-none space-y-6">
        <section>
          <h2 className="text-xl font-semibold mb-3">What is a DPA?</h2>
          <p>
            A Data Processing Agreement (DPA) is a legally binding contract between a data controller
            (you or your organization) and a data processor (SYNCRO). It outlines how personal data
            is handled, protected, and processed in compliance with GDPR and other data protection regulations.
          </p>
          <p>
            A DPA is typically required when your organization uses SYNCRO to manage subscription data
            on behalf of your employees or team members.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">Request a DPA</h2>
          <p>
            If your organization requires a Data Processing Agreement, please contact us. We will provide
            a DPA tailored to your needs and compliance requirements.
          </p>
          <div className="mt-6 p-6 bg-gray-50 rounded-lg border border-gray-200">
            <p className="text-lg font-medium mb-2">Contact our team</p>
            <p className="text-gray-600 mb-4">
              Email us at{' '}
              <a href="mailto:legal@syncro.app" className="text-indigo-600 underline font-medium">
                legal@syncro.app
              </a>{' '}
              with the subject line "DPA Request" and include:
            </p>
            <ul className="list-disc pl-6 space-y-1 text-gray-600">
              <li>Your organization name</li>
              <li>Contact person and role</li>
              <li>Applicable jurisdictions and regulations</li>
              <li>Any specific requirements or addenda needed</li>
            </ul>
          </div>
        </section>
      </div>

      <div className="mt-12 pt-6 border-t border-gray-200 text-sm text-gray-500">
        <p>
          See also: <Link href="/privacy" className="text-indigo-600 underline">Privacy Policy</Link>
          {' | '}
          <Link href="/terms" className="text-indigo-600 underline">Terms of Service</Link>
        </p>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/app/dpa/page.tsx
git commit -m "feat: add DPA contact page"
```

---

## Task 13: Email Preferences Page (Client)

**Files:**
- Create: `client/app/email-preferences/page.tsx`

- [ ] **Step 1: Create the email preferences page**

```tsx
// client/app/email-preferences/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

interface EmailOptIns {
  reminders: boolean;
  digests: boolean;
  marketing: boolean;
  updates: boolean;
}

const LABELS: Record<keyof EmailOptIns, { title: string; description: string }> = {
  reminders: {
    title: 'Renewal Reminders',
    description: 'Notifications before your subscriptions renew',
  },
  digests: {
    title: 'Monthly Digest',
    description: 'Monthly summary of your subscription spending',
  },
  marketing: {
    title: 'Marketing',
    description: 'Product announcements and feature updates',
  },
  updates: {
    title: 'Account Updates',
    description: 'Important account and security notifications',
  },
};

export default function EmailPreferencesPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [preferences, setPreferences] = useState<EmailOptIns | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

  useEffect(() => {
    async function fetchPreferences() {
      try {
        const url = new URL(`${apiBase}/api/compliance/email-preferences`);
        if (token) url.searchParams.set('token', token);

        const res = await fetch(url.toString(), {
          credentials: 'include',
          headers: token ? {} : { Authorization: `Bearer ${getAuthToken()}` },
        });

        if (!res.ok) throw new Error('Failed to load preferences');

        const data = await res.json();
        setPreferences(data.data.email_opt_ins);
      } catch (err: any) {
        setError(err.message || 'Failed to load preferences');
      } finally {
        setLoading(false);
      }
    }

    fetchPreferences();
  }, [token, apiBase]);

  const handleToggle = async (key: keyof EmailOptIns) => {
    if (!preferences) return;

    const updated = { ...preferences, [key]: !preferences[key] };
    setPreferences(updated);
    setSaving(true);
    setSaved(false);

    try {
      const res = await fetch(`${apiBase}/api/compliance/email-preferences`, {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? {} : { Authorization: `Bearer ${getAuthToken()}` }),
        },
        body: JSON.stringify({
          email_opt_ins: updated,
          ...(token ? { token } : {}),
        }),
      });

      if (!res.ok) throw new Error('Failed to save');
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // Revert on failure
      setPreferences(preferences);
      setError('Failed to save preference');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <main className="max-w-xl mx-auto px-6 py-16 text-center">
        <p className="text-gray-500">Loading preferences...</p>
      </main>
    );
  }

  if (error && !preferences) {
    return (
      <main className="max-w-xl mx-auto px-6 py-16 text-center">
        <h1 className="text-2xl font-bold mb-4">Email Preferences</h1>
        <p className="text-red-600">{error}</p>
        <p className="mt-4 text-gray-500">
          <Link href="/auth/login" className="text-indigo-600 underline">Log in</Link> to manage your preferences.
        </p>
      </main>
    );
  }

  return (
    <main className="max-w-xl mx-auto px-6 py-16">
      <Link href="/" className="text-indigo-600 text-sm hover:underline">&larr; Back to home</Link>

      <h1 className="text-2xl font-bold mt-6 mb-2">Email Preferences</h1>
      <p className="text-gray-500 mb-8">Choose which emails you receive from Synchro.</p>

      <div className="space-y-4">
        {(Object.keys(LABELS) as (keyof EmailOptIns)[]).map((key) => (
          <div
            key={key}
            className="flex items-center justify-between p-4 border border-gray-200 rounded-lg"
          >
            <div>
              <p className="font-medium">{LABELS[key].title}</p>
              <p className="text-sm text-gray-500">{LABELS[key].description}</p>
            </div>
            <button
              onClick={() => handleToggle(key)}
              disabled={saving}
              className={`relative w-11 h-6 rounded-full transition-colors ${
                preferences?.[key] ? 'bg-indigo-600' : 'bg-gray-300'
              }`}
              aria-label={`Toggle ${LABELS[key].title}`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                  preferences?.[key] ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        ))}
      </div>

      {saved && (
        <p className="mt-4 text-sm text-green-600">Preferences saved.</p>
      )}
      {error && preferences && (
        <p className="mt-4 text-sm text-red-600">{error}</p>
      )}

      <div className="mt-8 text-sm text-gray-500">
        <Link href="/privacy" className="text-indigo-600 underline">Privacy Policy</Link>
      </div>
    </main>
  );
}

function getAuthToken(): string {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.match(/(^| )authToken=([^;]+)/);
  return match ? match[2] : '';
}
```

- [ ] **Step 2: Commit**

```bash
git add client/app/email-preferences/page.tsx
git commit -m "feat: add email preferences page with token and session auth"
```

---

## Task 14: Deletion Banner Component

**Files:**
- Create: `client/components/deletion-banner.tsx`

- [ ] **Step 1: Create the deletion banner component**

```tsx
// client/components/deletion-banner.tsx
'use client';

import { useState, useEffect } from 'react';

interface DeletionStatus {
  status: string;
  scheduled_deletion_at: string;
}

export default function DeletionBanner() {
  const [deletion, setDeletion] = useState<DeletionStatus | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

  useEffect(() => {
    async function checkDeletionStatus() {
      try {
        const res = await fetch(`${apiBase}/api/compliance/account/deletion-status`, {
          credentials: 'include',
        });

        if (!res.ok) return;

        const data = await res.json();
        if (data.success && data.data) {
          setDeletion(data.data);
        }
      } catch {
        // Silently fail — banner is non-critical
      }
    }

    checkDeletionStatus();
  }, [apiBase]);

  const handleCancel = async () => {
    setCancelling(true);
    try {
      const res = await fetch(`${apiBase}/api/compliance/account/delete/cancel`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });

      if (res.ok) {
        setDeletion(null);
      }
    } catch {
      // Keep showing the banner on failure
    } finally {
      setCancelling(false);
    }
  };

  if (!deletion) return null;

  const deleteDate = new Date(deletion.scheduled_deletion_at).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="bg-red-50 border-b border-red-200 px-4 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm text-red-800">
          Your account is scheduled for deletion on <strong>{deleteDate}</strong>.
          All data will be permanently removed after this date.
        </p>
        <button
          onClick={handleCancel}
          disabled={cancelling}
          className="px-4 py-1.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
        >
          {cancelling ? 'Cancelling...' : 'Cancel Deletion'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/components/deletion-banner.tsx
git commit -m "feat: add account deletion warning banner"
```

---

## Task 15: Settings — Data & Privacy Section

**Files:**
- Create: `client/app/settings/privacy/page.tsx`

- [ ] **Step 1: Create the data & privacy settings page**

```tsx
// client/app/settings/privacy/page.tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function PrivacySettingsPage() {
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteSuccess, setDeleteSuccess] = useState(false);

  const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

  const handleExport = async () => {
    setExporting(true);
    setError(null);

    try {
      const res = await fetch(`${apiBase}/api/compliance/export`, {
        credentials: 'include',
      });

      if (!res.ok) throw new Error('Export failed');

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `syncro-export-${new Date().toISOString().split('T')[0]}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message || 'Failed to export data');
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmed) return;
    setDeleting(true);
    setError(null);

    try {
      const res = await fetch(`${apiBase}/api/compliance/account/delete`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: deleteReason || undefined }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to request deletion');
      }

      setDeleteSuccess(true);
      setShowDeleteModal(false);
    } catch (err: any) {
      setError(err.message || 'Failed to request deletion');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <Link href="/settings/security" className="text-indigo-600 text-sm hover:underline">&larr; Back to settings</Link>

      <h1 className="text-2xl font-bold mt-6 mb-2">Data & Privacy</h1>
      <p className="text-gray-500 mb-8">Manage your data export, email preferences, and account deletion.</p>

      {deleteSuccess && (
        <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p className="text-yellow-800 font-medium">Account deletion scheduled</p>
          <p className="text-yellow-700 text-sm mt-1">
            Your account will be permanently deleted in 30 days. You can cancel this from the banner at the top of the page.
          </p>
        </div>
      )}

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-800 text-sm">{error}</p>
        </div>
      )}

      {/* Data Export */}
      <section className="mb-8 p-6 border border-gray-200 rounded-lg">
        <h2 className="text-lg font-semibold mb-2">Export Your Data</h2>
        <p className="text-sm text-gray-600 mb-4">
          Download a complete copy of all your SYNCRO data in a ZIP file. This includes your profile,
          subscriptions, notifications, audit logs, preferences, and blockchain activity.
        </p>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {exporting ? 'Generating export...' : 'Export my data'}
        </button>
      </section>

      {/* Email Preferences */}
      <section className="mb-8 p-6 border border-gray-200 rounded-lg">
        <h2 className="text-lg font-semibold mb-2">Email Preferences</h2>
        <p className="text-sm text-gray-600 mb-4">
          Control which emails you receive from Synchro.
        </p>
        <Link
          href="/email-preferences"
          className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors inline-block"
        >
          Manage email preferences
        </Link>
      </section>

      {/* Account Deletion */}
      <section className="p-6 border border-red-200 rounded-lg">
        <h2 className="text-lg font-semibold mb-2 text-red-700">Delete Account</h2>
        <p className="text-sm text-gray-600 mb-4">
          Permanently delete your SYNCRO account and all associated data. This action has a 30-day
          grace period during which you can cancel the request by logging back in.
        </p>
        <button
          onClick={() => setShowDeleteModal(true)}
          className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
        >
          Delete my account
        </button>
      </section>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
            <h2 className="text-xl font-bold text-red-700 mb-4">Delete Your Account</h2>
            <p className="text-sm text-gray-600 mb-4">
              This will cancel all your active subscriptions and schedule your account for permanent
              deletion in 30 days. You can cancel this by logging in during the grace period.
            </p>

            <div className="mb-4">
              <label className="text-sm font-medium text-gray-700">
                Reason for leaving (optional)
              </label>
              <textarea
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
                className="mt-1 w-full border border-gray-300 rounded-lg p-2 text-sm"
                rows={3}
                placeholder="Help us improve..."
              />
            </div>

            <label className="flex items-start gap-2 mb-6 cursor-pointer">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-0.5"
              />
              <span className="text-sm text-gray-700">
                I understand this action will cancel my subscriptions and permanently delete my data after 30 days.
              </span>
            </label>

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => {
                  setShowDeleteModal(false);
                  setConfirmed(false);
                  setDeleteReason('');
                }}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={!confirmed || deleting}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? 'Processing...' : 'Delete Account'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mt-8 text-sm text-gray-500">
        <Link href="/privacy" className="text-indigo-600 underline">Privacy Policy</Link>
        {' | '}
        <Link href="/terms" className="text-indigo-600 underline">Terms of Service</Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/app/settings/privacy/page.tsx
git commit -m "feat: add data & privacy settings page with export and deletion"
```

---

## Task 16: Run All Backend Tests

**Files:** None (verification only)

- [ ] **Step 1: Run all backend tests**

```bash
cd backend && npx jest --verbose
```

Expected: All tests PASS

- [ ] **Step 2: If tests fail, fix issues and re-run**

Fix any import issues, mock configurations, or type errors. Re-run until all tests pass.

- [ ] **Step 3: Run the TypeScript compiler to check for type errors**

```bash
cd backend && npx tsc --noEmit
```

Expected: No errors

---

## Task 17: Verify Client Build

**Files:** None (verification only)

- [ ] **Step 1: Run the Next.js build**

```bash
cd client && npm run build
```

Expected: Build succeeds with no errors

- [ ] **Step 2: Run linting**

```bash
cd client && npm run lint
```

Expected: No errors

- [ ] **Step 3: If build fails, fix issues and re-run**

Fix any import issues, missing dependencies, or type errors.

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: resolve build and lint issues"
```

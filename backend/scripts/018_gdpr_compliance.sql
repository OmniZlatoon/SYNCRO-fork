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

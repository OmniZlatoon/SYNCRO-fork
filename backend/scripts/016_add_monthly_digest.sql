-- ============================================================
-- Migration: Monthly digest preferences and audit log
-- ============================================================

-- 1.  Add digest columns to user_preferences
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS digest_enabled        BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS digest_day            SMALLINT    NOT NULL DEFAULT 1
    CHECK (digest_day BETWEEN 1 AND 28),
  ADD COLUMN IF NOT EXISTS include_year_to_date  BOOLEAN     NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.user_preferences.digest_enabled
  IS 'Whether the user receives the monthly digest email';
COMMENT ON COLUMN public.user_preferences.digest_day
  IS 'Day of month on which the digest is sent (1–28)';
COMMENT ON COLUMN public.user_preferences.include_year_to_date
  IS 'Include year-to-date spend section in the digest';

-- 2.  Digest audit log table
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.digest_audit_log (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  digest_type   TEXT         NOT NULL DEFAULT 'monthly'
                               CHECK (digest_type IN ('monthly', 'test')),
  period_label  TEXT         NOT NULL,               -- e.g. "March 2025"
  status        TEXT         NOT NULL DEFAULT 'sent'
                               CHECK (status IN ('sent', 'failed', 'skipped')),
  error_message TEXT,
  sent_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER TABLE public.digest_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "digest_audit_select_own"
  ON public.digest_audit_log FOR SELECT
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS digest_audit_user_id_idx
  ON public.digest_audit_log(user_id);

CREATE INDEX IF NOT EXISTS digest_audit_sent_at_idx
  ON public.digest_audit_log(sent_at DESC);

COMMENT ON TABLE public.digest_audit_log
  IS 'Audit trail for every digest email attempted';
-- Add trial tracking fields to subscriptions table
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS trial_converts_to_price DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS credit_card_required BOOLEAN DEFAULT FALSE;

-- Note: is_trial and trial_ends_at already exist on the subscriptions table.
-- price_after_trial covers trial_converts_to_price semantics but we add the
-- canonical column name for clarity; both are kept for backwards compatibility.

-- Trial conversion events table
-- Tracks whether a trial converted intentionally (user clicked "Keep") or automatically,
-- and whether the user acted on reminders — used for the "Saved by SYNCRO" metric.
CREATE TABLE IF NOT EXISTS public.trial_conversion_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- 'converted' = user kept it, 'cancelled' = user cancelled before charge
  outcome TEXT NOT NULL CHECK (outcome IN ('converted', 'cancelled')),
  -- 'intentional' = user clicked Keep/Cancel, 'automatic' = trial expired without action
  conversion_type TEXT NOT NULL CHECK (conversion_type IN ('intentional', 'automatic')),
  -- true when user cancelled before auto-charge (counts toward "Saved by SYNCRO")
  saved_by_syncro BOOLEAN NOT NULL DEFAULT FALSE,
  -- which reminder (days_before) the user acted on, if any
  acted_on_reminder_days INTEGER,
  converted_price DECIMAL(10,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.trial_conversion_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trial_conversion_events_select_own"
  ON public.trial_conversion_events FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "trial_conversion_events_insert_own"
  ON public.trial_conversion_events FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS trial_conversion_events_user_id_idx
  ON public.trial_conversion_events(user_id);

CREATE INDEX IF NOT EXISTS trial_conversion_events_subscription_id_idx
  ON public.trial_conversion_events(subscription_id);

CREATE INDEX IF NOT EXISTS trial_conversion_events_saved_idx
  ON public.trial_conversion_events(saved_by_syncro)
  WHERE saved_by_syncro = TRUE;

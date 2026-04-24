-- Create subscription risk detection tables
-- This migration adds tables for tracking subscription risk scores, renewal attempts, and approvals

-- Risk scores table
CREATE TABLE IF NOT EXISTS public.subscription_risk_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH')),
  risk_factors JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_calculated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  last_notified_risk_level TEXT CHECK (last_notified_risk_level IN ('LOW', 'MEDIUM', 'HIGH')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(subscription_id)
);

-- Renewal attempts table
CREATE TABLE IF NOT EXISTS public.subscription_renewal_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  attempt_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  success BOOLEAN NOT NULL,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Subscription approvals table
CREATE TABLE IF NOT EXISTS public.subscription_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  approval_type TEXT NOT NULL CHECK (approval_type IN ('renewal', 'payment')),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.subscription_risk_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_renewal_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_approvals ENABLE ROW LEVEL SECURITY;

-- RLS Policies for subscription_risk_scores
CREATE POLICY "risk_scores_select_own"
  ON public.subscription_risk_scores FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "risk_scores_insert_own"
  ON public.subscription_risk_scores FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "risk_scores_update_own"
  ON public.subscription_risk_scores FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "risk_scores_delete_own"
  ON public.subscription_risk_scores FOR DELETE
  USING (auth.uid() = user_id);

-- RLS Policies for subscription_renewal_attempts
CREATE POLICY "renewal_attempts_select_own"
  ON public.subscription_renewal_attempts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.subscriptions
      WHERE subscriptions.id = subscription_renewal_attempts.subscription_id
      AND subscriptions.user_id = auth.uid()
    )
  );

CREATE POLICY "renewal_attempts_insert_own"
  ON public.subscription_renewal_attempts FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.subscriptions
      WHERE subscriptions.id = subscription_renewal_attempts.subscription_id
      AND subscriptions.user_id = auth.uid()
    )
  );

-- RLS Policies for subscription_approvals
CREATE POLICY "approvals_select_own"
  ON public.subscription_approvals FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "approvals_insert_own"
  ON public.subscription_approvals FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "approvals_update_own"
  ON public.subscription_approvals FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "approvals_delete_own"
  ON public.subscription_approvals FOR DELETE
  USING (auth.uid() = user_id);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_risk_scores_subscription ON public.subscription_risk_scores(subscription_id);
CREATE INDEX IF NOT EXISTS idx_risk_scores_user ON public.subscription_risk_scores(user_id);
CREATE INDEX IF NOT EXISTS idx_risk_scores_level ON public.subscription_risk_scores(risk_level);
CREATE INDEX IF NOT EXISTS idx_risk_scores_calculated ON public.subscription_risk_scores(last_calculated_at DESC);

CREATE INDEX IF NOT EXISTS idx_renewal_attempts_subscription ON public.subscription_renewal_attempts(subscription_id);
CREATE INDEX IF NOT EXISTS idx_renewal_attempts_date ON public.subscription_renewal_attempts(attempt_date DESC);
CREATE INDEX IF NOT EXISTS idx_renewal_attempts_success ON public.subscription_renewal_attempts(success);

CREATE INDEX IF NOT EXISTS idx_approvals_subscription ON public.subscription_approvals(subscription_id);
CREATE INDEX IF NOT EXISTS idx_approvals_user ON public.subscription_approvals(user_id);
CREATE INDEX IF NOT EXISTS idx_approvals_expires ON public.subscription_approvals(expires_at);
CREATE INDEX IF NOT EXISTS idx_approvals_status ON public.subscription_approvals(status);

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER update_risk_scores_updated_at
  BEFORE UPDATE ON public.subscription_risk_scores
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_approvals_updated_at
  BEFORE UPDATE ON public.subscription_approvals
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Comments for documentation
COMMENT ON TABLE public.subscription_risk_scores IS 'Stores computed risk levels for subscriptions';
COMMENT ON TABLE public.subscription_renewal_attempts IS 'Tracks renewal payment attempts for risk calculation';
COMMENT ON TABLE public.subscription_approvals IS 'Manages approval requirements and expiration for subscriptions';

COMMENT ON COLUMN public.subscription_risk_scores.risk_factors IS 'JSON array of risk factors with type, weight, and details';
COMMENT ON COLUMN public.subscription_risk_scores.last_notified_risk_level IS 'Last risk level that triggered a notification (for deduplication)';

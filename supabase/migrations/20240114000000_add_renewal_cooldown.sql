-- Migration: Add renewal cooldown mechanism to prevent rapid repeated retry attempts
-- This migration adds fields to track the last renewal attempt and enforces cooldown periods

-- Add cooldown-related columns to subscriptions table
ALTER TABLE public.subscriptions
ADD COLUMN IF NOT EXISTS last_renewal_attempt_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS renewal_cooldown_minutes INTEGER DEFAULT 5;

-- Add comment for documentation
COMMENT ON COLUMN public.subscriptions.last_renewal_attempt_at IS 'Timestamp of the last renewal attempt (successful or failed)';
COMMENT ON COLUMN public.subscriptions.renewal_cooldown_minutes IS 'Minimum minutes to wait between renewal attempts (default: 5 minutes)';

-- Update subscription_renewal_attempts table to include attempt type and last_attempt_timestamp for tracking
ALTER TABLE public.subscription_renewal_attempts
ADD COLUMN IF NOT EXISTS attempt_type TEXT DEFAULT 'automatic' CHECK (attempt_type IN ('automatic', 'manual', 'retry')),
ADD COLUMN IF NOT EXISTS updated_subscription_record BOOLEAN DEFAULT FALSE;

-- Create an index on last_renewal_attempt_at for efficient cooldown checks
CREATE INDEX IF NOT EXISTS idx_subscriptions_last_renewal_attempt 
ON public.subscriptions(last_renewal_attempt_at);

-- Create a function to check if cooldown period is active
CREATE OR REPLACE FUNCTION check_renewal_cooldown(
  subscription_id UUID,
  cooldown_minutes INTEGER DEFAULT 5
)
RETURNS TABLE(is_cooldown_active BOOLEAN, time_remaining_seconds INTEGER, can_retry BOOLEAN) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    (NOW() - sub.last_renewal_attempt_at) < (cooldown_minutes || ' minutes')::INTERVAL as is_cooldown_active,
    EXTRACT(EPOCH FROM (cooldown_minutes::TEXT || ' minutes')::INTERVAL - (NOW() - sub.last_renewal_attempt_at))::INTEGER as time_remaining_seconds,
    (NOW() - sub.last_renewal_attempt_at) >= (cooldown_minutes || ' minutes')::INTERVAL as can_retry
  FROM public.subscriptions sub
  WHERE sub.id = subscription_id AND sub.last_renewal_attempt_at IS NOT NULL;
  
  -- If no previous attempt, cooldown is not active
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 0, TRUE;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Create a function to update last renewal attempt timestamp
CREATE OR REPLACE FUNCTION update_last_renewal_attempt(
  subscription_id UUID
)
RETURNS TABLE(updated BOOLEAN, previous_attempt_at TIMESTAMP WITH TIME ZONE, new_attempt_at TIMESTAMP WITH TIME ZONE) AS $$
DECLARE
  v_previous_attempt TIMESTAMP WITH TIME ZONE;
BEGIN
  SELECT last_renewal_attempt_at INTO v_previous_attempt
  FROM public.subscriptions
  WHERE id = subscription_id;
  
  UPDATE public.subscriptions
  SET last_renewal_attempt_at = NOW(),
      updated_at = NOW()
  WHERE id = subscription_id;
  
  RETURN QUERY SELECT TRUE, v_previous_attempt, NOW();
END;
$$ LANGUAGE plpgsql;

-- Add RLS policy to prevent direct updates of renewal tracking fields (only via functions)
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- Grant execute permissions on functions to authenticated users
GRANT EXECUTE ON FUNCTION check_renewal_cooldown(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION update_last_renewal_attempt(UUID) TO authenticated;

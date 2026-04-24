-- Seed data for local development
-- WARNING: Do NOT run this in staging or production environments.
-- Uses fake data only — no real emails, payment info, or PII.

-- ─────────────────────────────────────────────────────────────
-- Test users (created via Supabase auth.users directly for local dev)
-- In practice, use `supabase auth` or the Studio UI to create users.
-- These UUIDs are stable so foreign keys work across seed runs.
-- ─────────────────────────────────────────────────────────────

-- Seed user preferences for any existing auth users
INSERT INTO public.user_preferences (user_id)
SELECT id FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- Sample subscriptions (requires at least one user in auth.users)
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_user_id UUID;
BEGIN
  SELECT id INTO v_user_id FROM auth.users LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE NOTICE 'No users found — skipping subscription seed. Create a user via Supabase Studio first.';
    RETURN;
  END IF;

  INSERT INTO public.subscriptions (user_id, name, amount, billing_cycle, status, next_billing_date)
  VALUES
    (v_user_id, 'Netflix',    15.99, 'monthly',  'active',    NOW() + INTERVAL '15 days'),
    (v_user_id, 'Spotify',     9.99, 'monthly',  'active',    NOW() + INTERVAL '22 days'),
    (v_user_id, 'GitHub Pro', 10.00, 'monthly',  'active',    NOW() + INTERVAL '5 days'),
    (v_user_id, 'AWS',        42.00, 'monthly',  'active',    NOW() + INTERVAL '3 days'),
    (v_user_id, 'Figma',      15.00, 'monthly',  'cancelled', NOW() - INTERVAL '10 days'),
    (v_user_id, 'Linear',      8.00, 'monthly',  'trial',     NOW() + INTERVAL '7 days'),
    (v_user_id, 'Vercel Pro', 20.00, 'monthly',  'active',    NOW() + INTERVAL '18 days'),
    (v_user_id, 'Adobe CC',   54.99, 'yearly',   'active',    NOW() + INTERVAL '200 days')
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'Seeded subscriptions for user %', v_user_id;
END;
$$;

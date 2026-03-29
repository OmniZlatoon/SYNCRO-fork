-- Migration: Add 2FA support tables and columns
-- Requirements: 1.5, 2.2, 4.2, 5.2

-- Recovery codes table for storing bcrypt-hashed one-time-use codes
create table public.recovery_codes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  code_hash   text not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index recovery_codes_user_id_idx on public.recovery_codes(user_id);

alter table public.recovery_codes enable row level security;

-- Users can only read their own recovery codes (inserts use service role key)
create policy "recovery_codes_select_own"
  on public.recovery_codes for select
  using (auth.uid() = user_id);

-- Users can delete their own recovery codes
create policy "recovery_codes_delete_own"
  on public.recovery_codes for delete
  using (auth.uid() = user_id);

-- Add team-level 2FA enforcement columns
alter table public.teams
  add column if not exists require_2fa boolean not null default false,
  add column if not exists require_2fa_set_at timestamptz;

-- Add 2FA enabled timestamp to profiles
alter table public.profiles
  add column if not exists two_fa_enabled_at timestamptz;

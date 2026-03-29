-- Create idempotency_keys table for request deduplication
create table if not exists public.idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  request_hash text not null,
  response_status integer not null,
  response_body jsonb not null,
  created_at timestamp with time zone default now(),
  expires_at timestamp with time zone not null
);

-- Enable RLS
alter table public.idempotency_keys enable row level security;

-- RLS Policies for idempotency_keys
create policy "idempotency_keys_select_own"
  on public.idempotency_keys for select
  using (auth.uid() = user_id);

create policy "idempotency_keys_insert_own"
  on public.idempotency_keys for insert
  with check (auth.uid() = user_id);

-- Unique constraint on key + user_id + request_hash
create unique index if not exists idempotency_keys_unique_idx 
  on public.idempotency_keys(key, user_id, request_hash);

-- Index for cleanup queries
create index if not exists idempotency_keys_expires_at_idx 
  on public.idempotency_keys(expires_at);

-- Index for user lookups
create index if not exists idempotency_keys_user_id_idx 
  on public.idempotency_keys(user_id);

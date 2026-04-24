-- Create api_keys table for storing encrypted API keys
create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  service_name text not null,
  api_key_encrypted text,
  key_hash text,
  scopes text[] default '{}' not null,
  revoked boolean default false not null,
  last_used_at timestamp with time zone,
  request_count integer default 0 not null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  unique(user_id, service_name),
  unique(key_hash)
);

-- Enable RLS
alter table public.api_keys enable row level security;

-- RLS Policies for api_keys
create policy "api_keys_select_own"
  on public.api_keys for select
  using (auth.uid() = user_id);

create policy "api_keys_insert_own"
  on public.api_keys for insert
  with check (auth.uid() = user_id);

create policy "api_keys_update_own"
  on public.api_keys for update
  using (auth.uid() = user_id);

create policy "api_keys_delete_own"
  on public.api_keys for delete
  using (auth.uid() = user_id);

-- Index
create index if not exists api_keys_user_id_idx on public.api_keys(user_id);

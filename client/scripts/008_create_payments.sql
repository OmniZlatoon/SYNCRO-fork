-- Create payments table to store transaction history
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  amount numeric not null,
  currency text not null default 'USD',
  status text not null, -- 'succeeded', 'failed', 'pending', 'refunded'
  provider text not null, -- 'stripe', 'paypal'
  transaction_id text unique,
  plan_name text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS
alter table public.payments enable row level security;

-- RLS Policies
create policy "payments_select_own"
  on public.payments for select
  using (auth.uid() = user_id);

-- Create indexes
create index idx_payments_user_id on public.payments(user_id);
create index idx_payments_transaction_id on public.payments(transaction_id);
create index idx_payments_status on public.payments(status);

create table if not exists public.bot_conversations (
  state_key text primary key,
  channel text not null,
  user_id text,
  chat_id text,
  state jsonb not null default '{}'::jsonb,
  session jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists bot_conversations_channel_chat_idx
  on public.bot_conversations (channel, chat_id);

create table if not exists public.bot_billing_profiles (
  state_key text primary key,
  channel text not null,
  user_id text,
  chat_id text,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  stripe_price_id text,
  stripe_checkout_session_id text,
  subscription_status text not null default 'free',
  cancel_at_period_end boolean not null default false,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bot_billing_profiles_customer_idx
  on public.bot_billing_profiles (stripe_customer_id);

create table if not exists public.bot_daily_usage (
  state_key text not null,
  channel text not null,
  user_id text,
  chat_id text,
  question_date date not null,
  question_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (state_key, question_date)
);

create index if not exists bot_daily_usage_lookup_idx
  on public.bot_daily_usage (question_date, state_key);

create table if not exists public.bot_event_queue (
  event_key text primary key,
  channel text not null,
  event_type text not null,
  payload jsonb not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  error text,
  available_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bot_event_queue_status_available_idx
  on public.bot_event_queue (status, available_at, created_at);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists bot_conversations_set_updated_at on public.bot_conversations;
create trigger bot_conversations_set_updated_at
before update on public.bot_conversations
for each row execute function public.set_updated_at();

drop trigger if exists bot_billing_profiles_set_updated_at on public.bot_billing_profiles;
create trigger bot_billing_profiles_set_updated_at
before update on public.bot_billing_profiles
for each row execute function public.set_updated_at();

drop trigger if exists bot_daily_usage_set_updated_at on public.bot_daily_usage;
create trigger bot_daily_usage_set_updated_at
before update on public.bot_daily_usage
for each row execute function public.set_updated_at();

drop trigger if exists bot_event_queue_set_updated_at on public.bot_event_queue;
create trigger bot_event_queue_set_updated_at
before update on public.bot_event_queue
for each row execute function public.set_updated_at();

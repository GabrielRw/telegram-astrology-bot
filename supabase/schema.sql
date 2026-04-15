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

create table if not exists public.bot_profiles (
  profile_id text primary key,
  state_key text not null,
  channel text not null,
  user_id text,
  chat_id text,
  profile_name text not null,
  is_active boolean not null default false,
  birth_date date,
  birth_time text,
  time_known boolean not null default true,
  city_name text,
  city_label text,
  timezone text,
  lat double precision,
  lng double precision,
  birth_country text,
  raw_natal_payload jsonb not null,
  natal_request_payload jsonb not null,
  chart_request_payload jsonb,
  profile_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bot_profiles_state_key_idx
  on public.bot_profiles (state_key, created_at);

create unique index if not exists bot_profiles_state_name_uidx
  on public.bot_profiles (state_key, lower(profile_name));

create unique index if not exists bot_profiles_state_active_uidx
  on public.bot_profiles (state_key)
  where is_active = true;

create table if not exists public.bot_tool_cache_entries (
  cache_entry_id text primary key,
  state_key text not null,
  channel text not null,
  user_id text,
  chat_id text,
  primary_profile_id text,
  secondary_profile_id text,
  profile_pair_key text not null default '',
  tool_name text not null,
  request_hash text not null,
  cache_month text not null default '',
  source text not null default 'runtime',
  request_args jsonb not null default '{}'::jsonb,
  response jsonb not null default '{}'::jsonb,
  response_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);

create unique index if not exists bot_tool_cache_entries_lookup_uidx
  on public.bot_tool_cache_entries (state_key, profile_pair_key, tool_name, request_hash, cache_month);

create index if not exists bot_tool_cache_entries_profile_idx
  on public.bot_tool_cache_entries (state_key, primary_profile_id, secondary_profile_id, tool_name, last_used_at desc);

create table if not exists public.bot_tool_call_logs (
  log_id text primary key,
  state_key text not null,
  channel text not null,
  user_id text,
  chat_id text,
  primary_profile_id text,
  secondary_profile_id text,
  tool_name text not null,
  request_hash text not null,
  question_text text,
  cache_hit boolean not null default false,
  cache_entry_id text,
  source text not null default 'runtime',
  request_args jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists bot_tool_call_logs_state_created_idx
  on public.bot_tool_call_logs (state_key, created_at desc);

create index if not exists bot_tool_call_logs_tool_created_idx
  on public.bot_tool_call_logs (tool_name, created_at desc);

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

drop trigger if exists bot_profiles_set_updated_at on public.bot_profiles;
create trigger bot_profiles_set_updated_at
before update on public.bot_profiles
for each row execute function public.set_updated_at();

drop trigger if exists bot_tool_cache_entries_set_updated_at on public.bot_tool_cache_entries;
create trigger bot_tool_cache_entries_set_updated_at
before update on public.bot_tool_cache_entries
for each row execute function public.set_updated_at();

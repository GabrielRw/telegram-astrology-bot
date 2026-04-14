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

drop trigger if exists bot_event_queue_set_updated_at on public.bot_event_queue;
create trigger bot_event_queue_set_updated_at
before update on public.bot_event_queue
for each row execute function public.set_updated_at();

-- Web Push 구독 및 알림함 테이블
-- Phase 1: service_role 이 write, authenticated 가 self read (role 분리는 Phase 3)

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint push_subscriptions_endpoint_unique unique (endpoint)
);

create index if not exists idx_push_subscriptions_user
  on push_subscriptions(user_id)
  where revoked_at is null;

create table if not exists push_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  title text not null,
  body text,
  deep_link text,
  kind text, -- 'new_booking' | 'payment_review' | 'fully_paid' | etc.
  payload jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_push_notifications_user_created
  on push_notifications(user_id, created_at desc);

create index if not exists idx_push_notifications_unread
  on push_notifications(user_id)
  where read_at is null;

-- RLS: Phase 1 에서는 authenticated 가 자기 것만 읽기. service_role 이 쓰기.
alter table push_subscriptions enable row level security;
alter table push_notifications enable row level security;

do $$ begin
  create policy push_subs_self_read on push_subscriptions
    for select to authenticated
    using (user_id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy push_subs_self_write on push_subscriptions
    for all to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy push_notifs_self_read on push_notifications
    for select to authenticated
    using (user_id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy push_notifs_self_update on push_notifications
    for update to authenticated
    using (user_id = auth.uid());
exception when duplicate_object then null; end $$;

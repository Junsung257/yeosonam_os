-- Affiliate machine phase 2
-- promo attribution + retention/gamification + playbook hub

create table if not exists public.affiliate_promo_codes (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates(id) on delete cascade,
  code text not null unique,
  discount_type text not null default 'percent' check (discount_type in ('percent', 'fixed')),
  discount_value numeric(12,2) not null default 0,
  is_active boolean not null default true,
  starts_at timestamptz null,
  ends_at timestamptz null,
  max_uses integer null,
  uses_count integer not null default 0,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_affiliate_promo_codes_affiliate on public.affiliate_promo_codes(affiliate_id);
create index if not exists idx_affiliate_promo_codes_active on public.affiliate_promo_codes(is_active, starts_at, ends_at);

create table if not exists public.affiliate_reward_events (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates(id) on delete cascade,
  event_type text not null,
  points integer not null default 0,
  reward_amount integer null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_affiliate_reward_events_affiliate on public.affiliate_reward_events(affiliate_id, created_at desc);

create table if not exists public.affiliate_best_practices (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  channel text not null default 'reels',
  summary text not null,
  example_url text null,
  tags text[] not null default '{}'::text[],
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.affiliate_cs_scripts (
  id uuid primary key default gen_random_uuid(),
  category text not null default 'general',
  title text not null,
  script text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='bookings' and column_name='promo_code'
  ) then
    alter table public.bookings add column promo_code text null;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='bookings' and column_name='promo_affiliate_id'
  ) then
    alter table public.bookings add column promo_affiliate_id uuid null references public.affiliates(id) on delete set null;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='bookings' and column_name='attribution_model'
  ) then
    alter table public.bookings add column attribution_model text not null default 'last_touch';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='bookings' and column_name='attribution_split'
  ) then
    alter table public.bookings add column attribution_split jsonb not null default '{}'::jsonb;
  end if;
end $$;

create index if not exists idx_bookings_promo_code on public.bookings(promo_code);
create index if not exists idx_bookings_promo_affiliate_id on public.bookings(promo_affiliate_id);


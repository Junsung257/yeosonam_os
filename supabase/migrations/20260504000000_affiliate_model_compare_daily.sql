-- affiliate model comparison daily cache

create table if not exists public.affiliate_model_compare_daily (
  id uuid primary key default gen_random_uuid(),
  day date not null unique,
  sample_size integer not null default 0,
  first_touch_match_count integer not null default 0,
  last_touch_match_count integer not null default 0,
  linear_multi_touch_candidates integer not null default 0,
  attribution_switch_count integer not null default 0,
  affected_commission_pool_krw numeric(18,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_affiliate_model_compare_daily_day
  on public.affiliate_model_compare_daily(day desc);


-- affiliate sub-id daily aggregation

create table if not exists public.affiliate_sub_attribution_daily (
  id uuid primary key default gen_random_uuid(),
  day date not null,
  referral_code text not null,
  sub_id text not null default 'default',
  clicks integer not null default 0,
  unique_sessions integer not null default 0,
  touched_packages integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(day, referral_code, sub_id)
);

create index if not exists idx_aff_sub_daily_day on public.affiliate_sub_attribution_daily(day desc);
create index if not exists idx_aff_sub_daily_ref on public.affiliate_sub_attribution_daily(referral_code, day desc);


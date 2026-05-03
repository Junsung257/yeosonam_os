-- Lifetime attribution experiment support

create table if not exists public.affiliate_lifetime_links (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  affiliate_id uuid not null references public.affiliates(id) on delete cascade,
  origin_booking_id uuid null references public.bookings(id) on delete set null,
  first_attributed_at timestamptz not null default now(),
  experiment_group text not null default 'control' check (experiment_group in ('control', 'lifetime_0_5')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(customer_id, affiliate_id)
);

create index if not exists idx_affiliate_lifetime_links_customer on public.affiliate_lifetime_links(customer_id);
create index if not exists idx_affiliate_lifetime_links_affiliate on public.affiliate_lifetime_links(affiliate_id);

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='bookings' and column_name='lifetime_commission'
  ) then
    alter table public.bookings add column lifetime_commission integer not null default 0;
  end if;
end $$;


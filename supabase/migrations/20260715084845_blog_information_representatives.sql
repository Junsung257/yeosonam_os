-- One canonical informational article per destination + intent + audience + locale.
-- Existing public rows are not backfilled or mutated by this migration.

begin;

create table if not exists public.blog_information_representatives (
  representative_key text primary key,
  destination_id text not null,
  intent text not null check (intent in (
    'food_budget',
    'monthly_weather',
    'airport_transport',
    'hotel_areas',
    'family_budget',
    'family_itinerary',
    'entry_requirements',
    'travel_insurance',
    'currency_payment',
    'general'
  )),
  audience text not null check (audience in ('general', 'family', 'couple', 'solo', 'senior', 'student')),
  locale text not null,
  canonical_creative_id uuid null unique references public.content_creatives(id) on delete restrict,
  canonical_slug text null,
  status text not null default 'reserved' check (status in ('reserved', 'active', 'retired')),
  reservation_owner text not null,
  reserved_at timestamptz not null default now(),
  activated_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint blog_information_representatives_key_not_blank check (btrim(representative_key) <> ''),
  constraint blog_information_representatives_destination_not_blank check (btrim(destination_id) <> ''),
  constraint blog_information_representatives_locale_format check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  constraint blog_information_representatives_owner_not_blank check (btrim(reservation_owner) <> ''),
  constraint blog_information_representatives_active_canonical check (
    status <> 'active'
    or (
      canonical_creative_id is not null
      and nullif(btrim(canonical_slug), '') is not null
      and activated_at is not null
    )
  ),
  unique (destination_id, intent, audience, locale)
);

alter table public.blog_information_representatives enable row level security;

revoke all on table public.blog_information_representatives from public, anon, authenticated;
grant select, insert, update, delete on table public.blog_information_representatives to service_role;

drop policy if exists blog_information_representatives_service_role_all
  on public.blog_information_representatives;
create policy blog_information_representatives_service_role_all
  on public.blog_information_representatives
  for all
  to service_role
  using (true)
  with check (true);

comment on table public.blog_information_representatives is
  'Information-only canonical registry. A unique destination+intent+audience+locale key prevents new public duplicate URLs.';

commit;

-- Blog V4 staging-only research registry supplement.
--
-- The persistent Supabase Preview Branch starts from an empty database and
-- therefore does not contain the legacy research registry migrations that
-- already exist in the main project's migration history. Keep this file
-- outside supabase/migrations; the staging workflow copies it into a
-- uniquely versioned staging-only migration.

create table if not exists public.blog_information_official_research_documents (
  id uuid primary key default gen_random_uuid(),
  official_source_registry_id uuid not null
    references public.blog_information_official_source_registry(id) on delete cascade,
  source_url text not null,
  intents text[] not null,
  destinations text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'revoked')),
  reviewed_by text not null,
  reviewed_at timestamptz not null,
  review_note text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint blog_information_official_research_documents_https check (source_url ~ '^https://'),
  constraint blog_information_official_research_documents_intents check (cardinality(intents) > 0),
  unique (official_source_registry_id, source_url)
);

create table if not exists public.blog_information_reputable_source_registry (
  id uuid primary key default gen_random_uuid(),
  hostname text not null unique,
  source_types text[] not null,
  intents text[] not null,
  allow_subdomains boolean not null default false,
  status text not null default 'active' check (status in ('active', 'revoked')),
  reviewed_by text not null,
  reviewed_at timestamptz not null,
  review_note text not null,
  research_urls text[] not null default '{}',
  research_destinations text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint blog_information_reputable_source_registry_hostname check (
    hostname = lower(hostname)
    and hostname = rtrim(hostname, '.')
    and hostname ~ '^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$'
    and hostname !~ '\.\.'
  ),
  constraint blog_information_reputable_source_registry_types check (cardinality(source_types) > 0),
  constraint blog_information_reputable_source_registry_intents check (cardinality(intents) > 0)
);

insert into public.blog_information_reputable_source_registry (
  hostname,
  source_types,
  intents,
  allow_subdomains,
  status,
  reviewed_by,
  reviewed_at,
  review_note,
  research_urls,
  research_destinations
)
values
  (
    'booking.com',
    array['reputable_price_source'],
    array['hotel_areas'],
    true,
    'active',
    'blog-v4-staging-autopilot',
    now(),
    'Staging canary direct-fetch source for checked-date Guam family hotel samples.',
    array['https://www.booking.com/family/country/gu.ko.html'],
    array['괌']
  ),
  (
    'agoda.com',
    array['reputable_price_source'],
    array['hotel_areas'],
    true,
    'active',
    'blog-v4-staging-autopilot',
    now(),
    'Staging canary direct-fetch source for Guam hotel-area location and family-fit facts.',
    array['https://www.agoda.com/ko-kr/travel-guides/guam/where-to-stay-in-guam-best-hotels/'],
    array['괌']
  )
on conflict (hostname) do update
set
  source_types = excluded.source_types,
  intents = excluded.intents,
  allow_subdomains = excluded.allow_subdomains,
  status = excluded.status,
  reviewed_by = excluded.reviewed_by,
  reviewed_at = excluded.reviewed_at,
  review_note = excluded.review_note,
  research_urls = excluded.research_urls,
  research_destinations = excluded.research_destinations,
  updated_at = now();

alter table public.blog_information_official_research_documents enable row level security;
revoke all on table public.blog_information_official_research_documents from public, anon, authenticated;
grant select on table public.blog_information_official_research_documents to service_role;

alter table public.blog_information_reputable_source_registry enable row level security;
revoke all on table public.blog_information_reputable_source_registry from public, anon, authenticated;
grant select on table public.blog_information_reputable_source_registry to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'blog_information_official_research_documents'
      and policyname = 'blog_information_official_research_documents_service_select'
  ) then
    create policy blog_information_official_research_documents_service_select
      on public.blog_information_official_research_documents
      for select to service_role
      using (true);
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'blog_information_reputable_source_registry'
      and policyname = 'blog_information_reputable_source_registry_service_select'
  ) then
    create policy blog_information_reputable_source_registry_service_select
      on public.blog_information_reputable_source_registry
      for select to service_role
      using (true);
  end if;
end $$;

create index if not exists idx_blog_official_research_documents_destinations
  on public.blog_information_official_research_documents using gin (destinations);

comment on table public.blog_information_reputable_source_registry is
  'Staging-only reviewed web domains eligible for direct automatic research.';

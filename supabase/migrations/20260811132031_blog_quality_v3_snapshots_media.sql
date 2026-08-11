-- Durable public snapshots, verified authors, and licensed media registry.
begin;

create table if not exists public.blog_author_profiles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  display_name text not null,
  bio text null,
  verified_experience jsonb not null default '[]'::jsonb,
  credentials jsonb not null default '[]'::jsonb,
  profile_image_url text null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.content_creatives
  drop constraint if exists content_creatives_author_profile_id_fkey;
alter table public.content_creatives
  add constraint content_creatives_author_profile_id_fkey
  foreign key (author_profile_id) references public.blog_author_profiles(id) on delete set null
  not valid;

create table if not exists public.blog_media_assets (
  id uuid primary key default gen_random_uuid(),
  asset_id text not null unique,
  url text not null,
  source_provider text not null,
  source_url text null,
  license text null,
  attribution text null,
  photographer text null,
  captured_at timestamptz null,
  location_entity_id text null,
  landmark_entity_id text null,
  image_type text not null check (image_type in ('first_party','authorized_customer','authorized_staff','official','wikimedia','stock','generated','decorative')),
  is_first_party boolean not null default false,
  is_generated boolean not null default false,
  perceptual_hash text null,
  width integer null check (width is null or width > 0),
  height integer null check (height is null or height > 0),
  verified_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.blog_content_media (
  creative_id uuid not null references public.content_creatives(id) on delete cascade,
  asset_id uuid not null references public.blog_media_assets(id) on delete restrict,
  placement text not null check (placement in ('hero','inline','gallery','og')),
  ordinal integer not null default 0 check (ordinal >= 0),
  alt_text text not null,
  caption text null,
  is_evidence boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (creative_id, asset_id, placement)
);

create table if not exists public.blog_public_snapshots (
  creative_id uuid primary key references public.content_creatives(id) on delete cascade,
  slug text not null unique,
  snapshot_version bigint not null,
  eligibility_reason text not null,
  canonical_url text not null,
  title text not null,
  description text null,
  content_document jsonb null,
  legacy_markdown text null,
  generation_meta jsonb not null default '{}'::jsonb,
  quality_gate jsonb not null default '{}'::jsonb,
  product_id uuid null,
  tracking_id text null,
  content_type text null,
  target_audience text null,
  landing_enabled boolean not null default false,
  landing_headline text null,
  landing_subtitle text null,
  author jsonb null,
  review jsonb null,
  hero_image jsonb null,
  citations jsonb not null default '[]'::jsonb,
  related_posts jsonb not null default '[]'::jsonb,
  previous_post jsonb null,
  next_post jsonb null,
  product_links jsonb not null default '[]'::jsonb,
  destination text null,
  angle_type text null,
  published_at timestamptz not null,
  content_modified_at timestamptz null,
  fact_checked_at timestamptz null,
  generated_at timestamptz not null default now(),
  is_current boolean not null default true,
  checksum char(64) not null
);

create table if not exists public.blog_public_snapshot_history (
  id bigint generated always as identity primary key,
  creative_id uuid not null references public.content_creatives(id) on delete cascade,
  slug text not null,
  snapshot_version bigint not null,
  snapshot jsonb not null,
  checksum char(64) not null,
  generated_at timestamptz not null,
  retired_at timestamptz not null default now(),
  unique (creative_id, snapshot_version)
);

create table if not exists public.blog_public_catalog_facets (
  facet_type text not null check (facet_type in ('destination','angle','category')),
  facet_key text not null,
  label text not null,
  post_count integer not null check (post_count >= 0),
  snapshot_generated_at timestamptz not null,
  primary key (facet_type, facet_key)
);

create index if not exists idx_blog_media_phash on public.blog_media_assets(perceptual_hash) where perceptual_hash is not null;
create index if not exists idx_blog_media_location on public.blog_media_assets(location_entity_id, image_type);
create index if not exists idx_blog_snapshots_published on public.blog_public_snapshots(published_at desc) where is_current;
create index if not exists idx_blog_snapshots_destination on public.blog_public_snapshots(destination, published_at desc) where is_current;

create or replace function public.archive_blog_public_snapshot_v3()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if old.checksum is distinct from new.checksum then
    insert into public.blog_public_snapshot_history(
      creative_id, slug, snapshot_version, snapshot, checksum, generated_at
    ) values (
      old.creative_id, old.slug, old.snapshot_version, to_jsonb(old), old.checksum, old.generated_at
    ) on conflict (creative_id, snapshot_version) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists blog_public_snapshot_archive_v3 on public.blog_public_snapshots;
create trigger blog_public_snapshot_archive_v3
before update on public.blog_public_snapshots
for each row execute function public.archive_blog_public_snapshot_v3();

create or replace function public.refresh_blog_public_snapshots_v3()
returns table (refreshed integer, retired integer, facet_rows integer)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_refreshed integer := 0;
  v_retired integer := 0;
  v_facets integer := 0;
begin
  update public.blog_public_snapshots s
  set is_current = false
  where s.is_current
    and not exists (select 1 from public.public_blog_content_creatives p where p.id = s.creative_id);
  get diagnostics v_retired = row_count;

  insert into public.blog_public_snapshots(
    creative_id, slug, snapshot_version, eligibility_reason, canonical_url,
    title, description, content_document, legacy_markdown, generation_meta,
    quality_gate, product_id, tracking_id, content_type, target_audience,
    landing_enabled, landing_headline, landing_subtitle, author, review,
    hero_image, destination, angle_type, published_at, content_modified_at,
    fact_checked_at, generated_at, is_current, checksum
  )
  select
    c.id, c.slug, 1, coalesce(c.public_eligibility_reason, c.public_eligibility_lane, 'eligible'),
    'https://www.yeosonam.com/blog/' || c.slug,
    coalesce(c.seo_title, c.title, c.slug), c.seo_description, c.content_document,
    c.blog_html, coalesce(c.generation_meta, '{}'::jsonb), coalesce(c.quality_gate, '{}'::jsonb),
    c.product_id, c.tracking_id, c.content_type, c.target_audience,
    coalesce(c.landing_enabled, false), c.landing_headline, c.landing_subtitle,
    case when c.author_profile_id is not null then jsonb_build_object(
      'id', a.id, 'slug', a.slug, 'display_name', a.display_name, 'bio', a.bio,
      'verified_experience', a.verified_experience, 'credentials', a.credentials,
      'profile_image_url', a.profile_image_url
    ) end,
    case when c.review_status = 'approved' and c.fact_checked_at is not null then jsonb_build_object(
      'review_status', c.review_status, 'reviewed_at', c.fact_checked_at,
      'review_scope', c.generation_meta ->> 'review_scope'
    ) end,
    case when nullif(c.og_image_url, '') is not null then jsonb_build_object('url', c.og_image_url) end,
    c.destination, c.angle_type, c.published_at,
    coalesce(c.content_modified_at, c.published_at), c.fact_checked_at, now(), true,
    encode(digest(convert_to(concat_ws(E'\u001f', c.slug, c.seo_title, c.seo_description, c.blog_html,
      c.content_modified_at::text, c.fact_checked_at::text), 'UTF8'), 'sha256'), 'hex')
  from public.public_blog_content_creatives c
  left join public.blog_author_profiles a on a.id = c.author_profile_id and a.is_active
  on conflict (creative_id) do update set
    slug = excluded.slug,
    snapshot_version = public.blog_public_snapshots.snapshot_version + 1,
    eligibility_reason = excluded.eligibility_reason,
    canonical_url = excluded.canonical_url,
    title = excluded.title,
    description = excluded.description,
    content_document = excluded.content_document,
    legacy_markdown = excluded.legacy_markdown,
    generation_meta = excluded.generation_meta,
    quality_gate = excluded.quality_gate,
    product_id = excluded.product_id,
    tracking_id = excluded.tracking_id,
    content_type = excluded.content_type,
    target_audience = excluded.target_audience,
    landing_enabled = excluded.landing_enabled,
    landing_headline = excluded.landing_headline,
    landing_subtitle = excluded.landing_subtitle,
    author = excluded.author,
    review = excluded.review,
    hero_image = excluded.hero_image,
    destination = excluded.destination,
    angle_type = excluded.angle_type,
    published_at = excluded.published_at,
    content_modified_at = excluded.content_modified_at,
    fact_checked_at = excluded.fact_checked_at,
    generated_at = excluded.generated_at,
    is_current = true,
    checksum = excluded.checksum
  where public.blog_public_snapshots.checksum is distinct from excluded.checksum
     or not public.blog_public_snapshots.is_current;
  get diagnostics v_refreshed = row_count;

  delete from public.blog_public_catalog_facets;
  insert into public.blog_public_catalog_facets(facet_type, facet_key, label, post_count, snapshot_generated_at)
  select facet_type, facet_key, facet_key, count(*)::integer, now()
  from (
    select 'destination'::text facet_type, destination facet_key from public.blog_public_snapshots where is_current and nullif(destination, '') is not null
    union all
    select 'angle', angle_type from public.blog_public_snapshots where is_current and nullif(angle_type, '') is not null
  ) facets
  group by facet_type, facet_key;
  get diagnostics v_facets = row_count;

  return query select v_refreshed, v_retired, v_facets;
end;
$$;

alter table public.blog_author_profiles enable row level security;
alter table public.blog_media_assets enable row level security;
alter table public.blog_content_media enable row level security;
alter table public.blog_public_snapshots enable row level security;
alter table public.blog_public_snapshot_history enable row level security;
alter table public.blog_public_catalog_facets enable row level security;
revoke all on public.blog_author_profiles, public.blog_media_assets, public.blog_content_media,
  public.blog_public_snapshots, public.blog_public_snapshot_history, public.blog_public_catalog_facets
  from public, anon, authenticated;
revoke all on function public.refresh_blog_public_snapshots_v3() from public, anon, authenticated;
grant select, insert, update, delete on public.blog_author_profiles, public.blog_media_assets, public.blog_content_media,
  public.blog_public_snapshots, public.blog_public_snapshot_history, public.blog_public_catalog_facets to service_role;
grant execute on function public.refresh_blog_public_snapshots_v3() to service_role;
create policy blog_author_profiles_service_role on public.blog_author_profiles for all to service_role using (true) with check (true);
create policy blog_media_assets_service_role on public.blog_media_assets for all to service_role using (true) with check (true);
create policy blog_content_media_service_role on public.blog_content_media for all to service_role using (true) with check (true);
create policy blog_public_snapshots_service_role on public.blog_public_snapshots for all to service_role using (true) with check (true);
create policy blog_public_snapshot_history_service_role on public.blog_public_snapshot_history for all to service_role using (true) with check (true);
create policy blog_public_catalog_facets_service_role on public.blog_public_catalog_facets for all to service_role using (true) with check (true);

comment on table public.blog_public_snapshots is 'Last-known-good primary public article snapshot. Only eligibility-passing canonical content may be written.';
comment on table public.blog_media_assets is 'Licensed and location-aware media SSOT. Generated media is never factual evidence.';

commit;

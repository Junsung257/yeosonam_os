-- Platform-global destination hero media SSOT.
-- Draft media remains service-role/admin only; anon/authenticated may read
-- rows only after the owner explicitly approves the photo.

create table if not exists public.destination_metadata (
  destination text primary key,
  tagline text,
  hero_tagline text,
  hero_image_url text,
  hero_image_pexels_id bigint,
  hero_photographer text,
  photo_approved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint destination_metadata_destination_not_blank
    check (btrim(destination) <> ''),
  constraint destination_metadata_approved_photo_complete
    check (
      photo_approved = false
      or (
        nullif(btrim(hero_image_url), '') is not null
        and nullif(btrim(hero_photographer), '') is not null
      )
    )
);

comment on table public.destination_metadata is
  'Owner-reviewed, platform-global destination display copy and hero media. photo_approved is the customer-exposure boundary.';
comment on column public.destination_metadata.hero_image_url is
  'Approved storage URL or reviewed source URL for a destination-level customer hero image.';
comment on column public.destination_metadata.hero_image_pexels_id is
  'Pexels photo identifier when Pexels is the source; nullable for other reviewed sources.';
comment on column public.destination_metadata.hero_photographer is
  'Required attribution or reviewed source owner whenever photo_approved=true.';
comment on column public.destination_metadata.photo_approved is
  'False until an owner reviews destination relevance, source, and attribution. Only true rows are publicly readable.';

alter table public.destination_metadata enable row level security;

grant select on public.destination_metadata to anon, authenticated;

create policy "Public can read approved destination metadata"
  on public.destination_metadata
  for select
  to anon, authenticated
  using (photo_approved = true);

drop trigger if exists trg_destination_metadata_updated_at
  on public.destination_metadata;
create trigger trg_destination_metadata_updated_at
  before update on public.destination_metadata
  for each row
  execute function public.set_updated_at();

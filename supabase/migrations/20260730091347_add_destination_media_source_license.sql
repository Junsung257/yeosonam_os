-- Provider-neutral provenance for owner-reviewed destination hero media.
-- Search results remain candidates; approval requires complete license evidence.

alter table public.destination_metadata
  add column if not exists hero_image_provider text,
  add column if not exists hero_image_license text,
  add column if not exists hero_image_license_url text,
  add column if not exists hero_image_source_file_title text;

alter table public.destination_metadata
  drop constraint if exists destination_metadata_provider_check;

alter table public.destination_metadata
  add constraint destination_metadata_provider_check
  check (
    hero_image_provider is null
    or hero_image_provider in (
      'pexels',
      'wikimedia_commons',
      'owner_upload',
      'supplier_official'
    )
  );

alter table public.destination_metadata
  drop constraint if exists destination_metadata_approved_provenance_check;

alter table public.destination_metadata
  add constraint destination_metadata_approved_provenance_check
  check (
    photo_approved = false
    or (
      nullif(btrim(hero_image_provider), '') is not null
      and nullif(btrim(hero_image_source_page_url), '') is not null
      and (
        (
          hero_image_provider = 'pexels'
          and hero_image_pexels_id is not null
        )
        or (
          hero_image_provider = 'wikimedia_commons'
          and nullif(btrim(hero_image_license), '') is not null
          and nullif(btrim(hero_image_license_url), '') is not null
          and nullif(btrim(hero_image_source_file_title), '') is not null
        )
        or hero_image_provider in ('owner_upload', 'supplier_official')
      )
    )
  );

alter table public.travel_packages
  drop constraint if exists travel_packages_approved_destination_media_check;

alter table public.travel_packages
  add constraint travel_packages_approved_destination_media_check
  check (
    approved_destination_media is null
    or (
      jsonb_typeof(approved_destination_media) = 'object'
      and nullif(btrim(approved_destination_media ->> 'destination'), '') is not null
      and nullif(btrim(approved_destination_media ->> 'url'), '') is not null
      and nullif(btrim(approved_destination_media ->> 'photographer'), '') is not null
      and nullif(btrim(approved_destination_media ->> 'provider'), '') is not null
      and nullif(btrim(approved_destination_media ->> 'source_page_url'), '') is not null
      and nullif(btrim(approved_destination_media ->> 'approval_source'), '') is not null
      and nullif(btrim(approved_destination_media ->> 'approved_at'), '') is not null
      and (
        approved_destination_media ->> 'provider' <> 'wikimedia_commons'
        or (
          nullif(btrim(approved_destination_media ->> 'license'), '') is not null
          and nullif(btrim(approved_destination_media ->> 'license_url'), '') is not null
          and nullif(btrim(approved_destination_media ->> 'source_file_title'), '') is not null
        )
      )
    )
  );

comment on column public.destination_metadata.hero_image_provider is
  'Reviewed media provider: pexels, wikimedia_commons, owner_upload, or supplier_official.';
comment on column public.destination_metadata.hero_image_license is
  'Human-readable license identifier required for approved Wikimedia Commons media.';
comment on column public.destination_metadata.hero_image_license_url is
  'Canonical license terms URL required for approved Wikimedia Commons media.';
comment on column public.destination_metadata.hero_image_source_file_title is
  'Original provider file title used to audit destination identity and attribution.';

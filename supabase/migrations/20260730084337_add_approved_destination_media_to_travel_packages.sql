-- Approved destination media must be frozen into each package before
-- mobile/A4 proof. Public rendering must never perform a live media lookup.

alter table public.destination_metadata
  add column if not exists hero_image_source_page_url text,
  add column if not exists hero_image_alt text,
  add column if not exists photo_approved_at timestamptz;

alter table public.destination_metadata
  drop constraint if exists destination_metadata_approved_audit_check;

alter table public.destination_metadata
  add constraint destination_metadata_approved_audit_check
  check (
    photo_approved = false
    or photo_approved_at is not null
  );

alter table public.travel_packages
  add column if not exists hero_image_url text,
  add column if not exists lp_hero_image_url text,
  add column if not exists approved_destination_media jsonb;

alter table public.travel_packages
  drop constraint if exists travel_packages_hero_image_url_safe_check;

alter table public.travel_packages
  add constraint travel_packages_hero_image_url_safe_check
  check (
    hero_image_url is null
    or (
      btrim(hero_image_url) <> ''
      and (
        hero_image_url ~* '^https?://'
        or hero_image_url ~ '^/'
      )
    )
  );

alter table public.travel_packages
  drop constraint if exists travel_packages_lp_hero_image_url_safe_check;

alter table public.travel_packages
  add constraint travel_packages_lp_hero_image_url_safe_check
  check (
    lp_hero_image_url is null
    or (
      btrim(lp_hero_image_url) <> ''
      and (
        lp_hero_image_url ~* '^https?://'
        or lp_hero_image_url ~ '^/'
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
      and nullif(btrim(approved_destination_media ->> 'approval_source'), '') is not null
      and nullif(btrim(approved_destination_media ->> 'approved_at'), '') is not null
    )
  );

comment on column public.destination_metadata.photo_approved_at is
  'Owner approval timestamp. Required whenever photo_approved is true.';
comment on column public.travel_packages.approved_destination_media is
  'Immutable owner-approved destination-media evidence frozen before mobile/A4 proof.';

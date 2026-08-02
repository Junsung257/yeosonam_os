-- Evidence-gated destination media approval. Approval provenance is immutable
-- evidence that can be frozen into package snapshots and audited later.

alter table public.destination_metadata
  add column if not exists photo_approval_source text,
  add column if not exists photo_quality_score numeric(4,3),
  add column if not exists photo_verification_evidence jsonb;

alter table public.destination_metadata
  drop constraint if exists destination_metadata_approval_source_check;

alter table public.destination_metadata
  add constraint destination_metadata_approval_source_check
  check (
    photo_approval_source is null
    or photo_approval_source in ('owner_reviewed', 'automated_evidence_gate')
  );

alter table public.destination_metadata
  drop constraint if exists destination_metadata_quality_score_check;

alter table public.destination_metadata
  add constraint destination_metadata_quality_score_check
  check (
    photo_quality_score is null
    or (photo_quality_score >= 0 and photo_quality_score <= 1)
  );

alter table public.destination_metadata
  drop constraint if exists destination_metadata_approved_evidence_check;

alter table public.destination_metadata
  add constraint destination_metadata_approved_evidence_check
  check (
    photo_approved = false
    or (
      photo_approval_source is not null
      and photo_quality_score is not null
      and photo_verification_evidence is not null
      and jsonb_typeof(photo_verification_evidence) = 'object'
      and (
        photo_approval_source <> 'automated_evidence_gate'
        or (
          photo_quality_score >= 0.950
          and photo_verification_evidence ->> 'binary_verified' = 'true'
          and photo_verification_evidence ->> 'destination_identity_verified' = 'true'
          and photo_verification_evidence ->> 'provider_page_verified' = 'true'
          and photo_verification_evidence ->> 'attribution_complete' = 'true'
        )
      )
    )
  );

comment on column public.destination_metadata.photo_approval_source is
  'Approval boundary: owner_reviewed or deterministic automated_evidence_gate.';
comment on column public.destination_metadata.photo_quality_score is
  'Deterministic approval score. Automated approval requires at least 0.950.';
comment on column public.destination_metadata.photo_verification_evidence is
  'Auditable binary, destination identity, provider-page, attribution, and license evidence.';

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
      and approved_destination_media ->> 'approval_source' in (
        'owner_reviewed_destination_metadata',
        'automated_evidence_gate'
      )
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

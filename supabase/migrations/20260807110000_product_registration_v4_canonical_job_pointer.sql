-- Keep the canonical normalization worker idempotent when compatibility
-- uploads already advanced upload_jobs to the legacy `normalized` stage.

alter table public.upload_jobs
  add column if not exists v4_canonical_normalization_id uuid
    references public.product_registration_v4_normalizations(id)
    on delete set null;

create index if not exists idx_upload_jobs_v4_canonical_pointer
  on public.upload_jobs(v4_canonical_normalization_id)
  where v4_canonical_normalization_id is not null;

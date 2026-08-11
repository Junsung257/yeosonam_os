-- Product Registration Engine V4 canonical normalization snapshots.
--
-- The normalized payload is append-only and lineage-bound. It is a worker
-- artifact, not a customer-public table; publication still requires the
-- existing package snapshot and mobile/customer gates.

create table if not exists public.product_registration_v4_normalizations (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.upload_jobs(id) on delete cascade,
  source_document_id uuid not null references public.product_source_documents(id) on delete restrict,
  extraction_id uuid not null references public.product_document_extractions(id) on delete restrict,
  normalization_version text not null,
  raw_text_hash text not null check (raw_text_hash ~ '^[0-9a-f]{64}$'),
  sections jsonb not null default '[]'::jsonb check (jsonb_typeof(sections) = 'array'),
  canonical_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(canonical_payload) = 'object'),
  quality_diagnostics jsonb not null default '{}'::jsonb check (jsonb_typeof(quality_diagnostics) = 'object'),
  status text not null default 'complete' check (status in ('complete', 'needs_review', 'failed')),
  created_at timestamptz not null default now(),
  unique (job_id, normalization_version, raw_text_hash)
);

comment on table public.product_registration_v4_normalizations is
  'Append-only canonical V4 segmentation/normalization snapshots. Never customer-visible by itself.';

create index if not exists idx_product_registration_v4_normalizations_job
  on public.product_registration_v4_normalizations(job_id, created_at desc);
create index if not exists idx_product_registration_v4_normalizations_source
  on public.product_registration_v4_normalizations(source_document_id, created_at desc);
create index if not exists idx_product_registration_v4_normalizations_extraction
  on public.product_registration_v4_normalizations(extraction_id, created_at desc);

alter table public.product_registration_v4_normalizations enable row level security;

drop policy if exists product_registration_v4_normalizations_service_role on public.product_registration_v4_normalizations;
create policy product_registration_v4_normalizations_service_role
  on public.product_registration_v4_normalizations for all to service_role
  using (true) with check (true);

revoke all on table public.product_registration_v4_normalizations from anon, authenticated;
grant all on table public.product_registration_v4_normalizations to service_role;

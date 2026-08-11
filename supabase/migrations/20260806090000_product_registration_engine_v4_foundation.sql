-- Product Registration Engine V4 foundation
--
-- This migration keeps the existing upload_jobs/product_registration_drafts
-- contracts backwards compatible while adding immutable source lineage,
-- structure-preserving extraction, resumable stages, and evidence-bound prices.

create table if not exists public.product_source_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  original_filename text not null,
  storage_bucket text not null default 'product-source-private',
  storage_path text not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size bigint not null check (byte_size >= 0),
  declared_mime text,
  detected_mime text,
  source_type text not null check (source_type in ('text', 'pdf', 'image', 'hwp', 'hwpx')),
  status text not null default 'stored' check (status in ('stored', 'scanning', 'ready', 'quarantined', 'deleted')),
  security_scan jsonb not null default '{}'::jsonb check (jsonb_typeof(security_scan) = 'object'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sha256, byte_size)
);

comment on table public.product_source_documents is
  'V4 private, immutable supplier source lineage. Raw binaries are never customer-visible.';

create index if not exists idx_product_source_documents_status
  on public.product_source_documents(status, created_at desc);
create index if not exists idx_product_source_documents_tenant
  on public.product_source_documents(tenant_id, created_at desc);
create index if not exists idx_product_source_documents_uploaded_by
  on public.product_source_documents(uploaded_by, created_at desc);

create table if not exists public.product_document_extractions (
  id uuid primary key default gen_random_uuid(),
  source_document_id uuid not null references public.product_source_documents(id) on delete restrict,
  parser_engine text not null,
  parser_version text not null,
  parser_checksum text,
  extraction_hash text not null check (extraction_hash ~ '^[0-9a-f]{64}$'),
  document_ir jsonb not null check (jsonb_typeof(document_ir) = 'object'),
  quality_diagnostics jsonb not null default '{}'::jsonb check (jsonb_typeof(quality_diagnostics) = 'object'),
  status text not null default 'complete' check (status in ('complete', 'partial', 'failed')),
  created_at timestamptz not null default now()
);

comment on table public.product_document_extractions is
  'Append-only structure-preserving extraction snapshots with parser provenance.';

create unique index if not exists idx_product_document_extractions_dedupe
  on public.product_document_extractions(source_document_id, parser_engine, parser_version, extraction_hash);
create index if not exists idx_product_document_extractions_source
  on public.product_document_extractions(source_document_id, created_at desc);

alter table public.upload_jobs
  add column if not exists source_document_id uuid references public.product_source_documents(id) on delete set null,
  add column if not exists extraction_id uuid references public.product_document_extractions(id) on delete set null,
  add column if not exists v4_stage text not null default 'uploaded'
    check (v4_stage in ('uploaded', 'preflight', 'extracted', 'segmented', 'normalized', 'verified', 'proofed', 'published', 'needs_review', 'failed', 'quarantined')),
  add column if not exists v4_attempt_count integer not null default 0 check (v4_attempt_count >= 0),
  add column if not exists v4_lease_expires_at timestamptz,
  add column if not exists v4_parser_engine text,
  add column if not exists v4_parser_version text,
  add column if not exists v4_stage_state jsonb not null default '{}'::jsonb,
  add column if not exists v4_review_reasons jsonb not null default '[]'::jsonb,
  add column if not exists v4_last_error_code text,
  add column if not exists v4_last_error_detail text;

create index if not exists idx_upload_jobs_v4_stage
  on public.upload_jobs(v4_stage, created_at desc);
create index if not exists idx_upload_jobs_v4_source
  on public.upload_jobs(source_document_id, created_at desc);

alter table public.normalized_intakes
  add column if not exists source_document_id uuid references public.product_source_documents(id) on delete set null,
  add column if not exists extraction_id uuid references public.product_document_extractions(id) on delete set null;

alter table public.product_registration_drafts
  add column if not exists source_document_id uuid references public.product_source_documents(id) on delete set null,
  add column if not exists extraction_id uuid references public.product_document_extractions(id) on delete set null,
  add column if not exists upload_job_id uuid references public.upload_jobs(id) on delete set null;

alter table public.product_prices
  add column if not exists variant_key text not null default 'base'
    check (btrim(variant_key) <> ''),
  add column if not exists currency text not null default 'KRW'
    check (btrim(currency) <> ''),
  add column if not exists price_kind text not null default 'package'
    check (price_kind in ('package', 'adult', 'child', 'single', 'surcharge', 'option')),
  add column if not exists source_extraction_id uuid references public.product_document_extractions(id) on delete set null,
  add column if not exists evidence_ref jsonb not null default '{}'::jsonb
    check (jsonb_typeof(evidence_ref) = 'object');

-- Existing legacy rows are not silently reinterpreted. The unique guards apply
-- only to V4 evidence-bound rows, where variant identity is mandatory.
create unique index if not exists idx_product_prices_v4_date_variant
  on public.product_prices(product_id, target_date, variant_key)
  where target_date is not null and source_extraction_id is not null;
create unique index if not exists idx_product_prices_v4_dow_variant
  on public.product_prices(product_id, day_of_week, variant_key)
  where day_of_week is not null and target_date is null and source_extraction_id is not null;
create index if not exists idx_product_prices_v4_extraction
  on public.product_prices(source_extraction_id)
  where source_extraction_id is not null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-source-private',
  'product-source-private',
  false,
  52428800,
  array[
    'text/plain', 'text/markdown', 'application/pdf',
    'application/x-hwp', 'application/haansofthwp',
    'application/vnd.hancom.hwp', 'application/vnd.hancom.hwpx',
    'application/zip', 'image/jpeg', 'image/png'
  ]::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.touch_product_registration_v4_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_product_source_documents_updated_at on public.product_source_documents;
create trigger trg_product_source_documents_updated_at
  before update on public.product_source_documents
  for each row execute function public.touch_product_registration_v4_updated_at();

alter table public.product_source_documents enable row level security;
alter table public.product_document_extractions enable row level security;

drop policy if exists product_source_documents_service_role on public.product_source_documents;
create policy product_source_documents_service_role
  on public.product_source_documents for all to service_role
  using (true) with check (true);

drop policy if exists product_document_extractions_service_role on public.product_document_extractions;
create policy product_document_extractions_service_role
  on public.product_document_extractions for all to service_role
  using (true) with check (true);

revoke all on table public.product_source_documents from anon, authenticated;
revoke all on table public.product_document_extractions from anon, authenticated;
grant all on table public.product_source_documents to service_role;
grant all on table public.product_document_extractions to service_role;

drop policy if exists product_source_documents_storage_service_role on storage.objects;
create policy product_source_documents_storage_service_role
  on storage.objects for all to service_role
  using (bucket_id = 'product-source-private')
  with check (bucket_id = 'product-source-private');

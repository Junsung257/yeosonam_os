-- Source-page image fallback evidence is an internal audit/review ledger.
-- It is never a canonical fact writer and never stores raw supplier images or
-- OCR response bodies. Artifact refs, when used, must point to a private
-- service-role-only object store.

create table if not exists internal_product_registration.image_fallback_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  source_document_id uuid not null references public.product_source_documents(id) on delete restrict,
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  parser_engine text not null check (btrim(parser_engine) <> ''),
  parser_version text not null check (btrim(parser_version) <> ''),
  renderer_engine text not null check (btrim(renderer_engine) <> ''),
  renderer_version text not null check (btrim(renderer_version) <> ''),
  render_config_hash text not null check (render_config_hash ~ '^[0-9a-f]{64}$'),
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'candidate' check (status in (
    'candidate', 'deterministically_verified', 'human_review_required',
    'human_verified', 'rejected', 'source_value_missing', 'superseded'
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (key_hash),
  unique (tenant_id, source_document_id, source_hash, parser_engine,
    parser_version, renderer_engine, renderer_version, render_config_hash)
);

comment on table internal_product_registration.image_fallback_runs is
  'Internal source-page fallback run lineage. Never a canonical/customer publication authority.';

create table if not exists internal_product_registration.image_fallback_pages (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references internal_product_registration.image_fallback_runs(id) on delete restrict,
  page_number integer not null check (page_number >= 0),
  source_page_hash text not null check (source_page_hash ~ '^[0-9a-f]{64}$'),
  image_sha256 text not null check (image_sha256 ~ '^[0-9a-f]{64}$'),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  render_artifact_ref text,
  status text not null default 'candidate' check (status in (
    'candidate', 'deterministically_verified', 'human_review_required',
    'human_verified', 'rejected', 'source_value_missing', 'superseded'
  )),
  created_at timestamptz not null default now(),
  unique (run_id, page_number)
);

comment on table internal_product_registration.image_fallback_pages is
  'Immutable rendered-page metadata. Raw images are kept outside the database.';

create table if not exists internal_product_registration.image_fallback_ocr_evidence (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references internal_product_registration.image_fallback_pages(id) on delete restrict,
  provider text not null check (btrim(provider) <> ''),
  provider_model_version text not null check (btrim(provider_model_version) <> ''),
  ocr_config_hash text not null check (ocr_config_hash ~ '^[0-9a-f]{64}$'),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  response_hash text not null check (response_hash ~ '^[0-9a-f]{64}$'),
  normalized_layout_hash text not null check (normalized_layout_hash ~ '^[0-9a-f]{64}$'),
  relation_hash text not null check (relation_hash ~ '^[0-9a-f]{64}$'),
  critical_token_hash text not null check (critical_token_hash ~ '^[0-9a-f]{64}$'),
  raw_artifact_ref text,
  provider_request_id text,
  status text not null check (status in (
    'deterministically_verified', 'human_review_required', 'human_verified',
    'rejected', 'source_value_missing'
  )),
  cost_krw numeric(12, 2) not null default 0 check (cost_krw >= 0),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  created_at timestamptz not null default now(),
  unique (page_id, provider, provider_model_version, ocr_config_hash)
);

comment on table internal_product_registration.image_fallback_ocr_evidence is
  'Append-only two-provider OCR evidence hashes and normalized layout/relation proof; no raw OCR payload.';

create index if not exists idx_image_fallback_runs_source
  on internal_product_registration.image_fallback_runs(tenant_id, source_document_id, created_at desc);
create index if not exists idx_image_fallback_pages_run
  on internal_product_registration.image_fallback_pages(run_id, page_number);
create index if not exists idx_image_fallback_ocr_page
  on internal_product_registration.image_fallback_ocr_evidence(page_id, provider);

alter table internal_product_registration.image_fallback_runs enable row level security;
alter table internal_product_registration.image_fallback_runs force row level security;
alter table internal_product_registration.image_fallback_pages enable row level security;
alter table internal_product_registration.image_fallback_pages force row level security;
alter table internal_product_registration.image_fallback_ocr_evidence enable row level security;
alter table internal_product_registration.image_fallback_ocr_evidence force row level security;

revoke all on table internal_product_registration.image_fallback_runs from public, anon, authenticated, service_role;
revoke all on table internal_product_registration.image_fallback_pages from public, anon, authenticated, service_role;
revoke all on table internal_product_registration.image_fallback_ocr_evidence from public, anon, authenticated, service_role;
grant select, insert, update on table internal_product_registration.image_fallback_runs to service_role;
grant select, insert on table internal_product_registration.image_fallback_pages to service_role;
grant select, insert on table internal_product_registration.image_fallback_ocr_evidence to service_role;

drop policy if exists image_fallback_runs_service_role on internal_product_registration.image_fallback_runs;
create policy image_fallback_runs_service_role
  on internal_product_registration.image_fallback_runs for all to service_role
  using (true) with check (true);
drop policy if exists image_fallback_pages_service_role on internal_product_registration.image_fallback_pages;
create policy image_fallback_pages_service_role
  on internal_product_registration.image_fallback_pages for all to service_role
  using (true) with check (true);
drop policy if exists image_fallback_ocr_service_role on internal_product_registration.image_fallback_ocr_evidence;
create policy image_fallback_ocr_service_role
  on internal_product_registration.image_fallback_ocr_evidence for all to service_role
  using (true) with check (true);

create or replace function internal_product_registration.reject_image_fallback_ledger_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception 'IMAGE_FALLBACK_LEDGER_APPEND_ONLY';
end;
$$;

revoke all on function internal_product_registration.reject_image_fallback_ledger_mutation() from public, anon, authenticated;

drop trigger if exists trg_image_fallback_pages_immutable
  on internal_product_registration.image_fallback_pages;
create trigger trg_image_fallback_pages_immutable
before update or delete on internal_product_registration.image_fallback_pages
for each row execute function internal_product_registration.reject_image_fallback_ledger_mutation();

drop trigger if exists trg_image_fallback_ocr_immutable
  on internal_product_registration.image_fallback_ocr_evidence;
create trigger trg_image_fallback_ocr_immutable
before update or delete on internal_product_registration.image_fallback_ocr_evidence
for each row execute function internal_product_registration.reject_image_fallback_ledger_mutation();

create or replace function internal_product_registration.touch_image_fallback_run_updated_at()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if new.tenant_id <> old.tenant_id
    or new.source_document_id <> old.source_document_id
    or new.source_hash <> old.source_hash
    or new.parser_engine <> old.parser_engine
    or new.parser_version <> old.parser_version
    or new.renderer_engine <> old.renderer_engine
    or new.renderer_version <> old.renderer_version
    or new.render_config_hash <> old.render_config_hash
    or new.created_at <> old.created_at then
    raise exception 'IMAGE_FALLBACK_RUN_LINEAGE_IMMUTABLE';
  end if;
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function internal_product_registration.touch_image_fallback_run_updated_at() from public, anon, authenticated;
drop trigger if exists trg_image_fallback_runs_updated_at
  on internal_product_registration.image_fallback_runs;
create trigger trg_image_fallback_runs_updated_at
before update on internal_product_registration.image_fallback_runs
for each row execute function internal_product_registration.touch_image_fallback_run_updated_at();

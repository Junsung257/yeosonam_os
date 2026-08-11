-- Product Registration Engine V5 foundation.
--
-- This migration introduces the immutable revision/evidence boundary without
-- changing the customer read path yet. V4 canonical normalizations remain the
-- input; publication continues through the existing gate until the V5 shadow
-- diff and proof rollout are complete.

create table if not exists public.product_registration_v5_segments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  job_id uuid not null references public.upload_jobs(id) on delete cascade,
  normalization_id uuid not null references public.product_registration_v4_normalizations(id) on delete restrict,
  source_document_id uuid not null references public.product_source_documents(id) on delete restrict,
  extraction_id uuid not null references public.product_document_extractions(id) on delete restrict,
  segment_index integer not null check (segment_index >= 0),
  section_key text not null,
  raw_text_hash text not null check (raw_text_hash ~ '^[0-9a-f]{64}$'),
  raw_text text not null,
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  state text not null default 'candidate'
    check (state in ('candidate', 'needs_review', 'verified', 'blocked', 'published')),
  created_at timestamptz not null default now(),
  unique (normalization_id, segment_index),
  unique (normalization_id, section_key)
);

comment on table public.product_registration_v5_segments is
  'V5 immutable segmentation records. Raw text remains private and source-bound.';

create index if not exists idx_product_registration_v5_segments_job
  on public.product_registration_v5_segments(job_id, segment_index);
create index if not exists idx_product_registration_v5_segments_source
  on public.product_registration_v5_segments(source_document_id, created_at desc);

create table if not exists public.product_registration_v5_revisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  package_id uuid references public.travel_packages(id) on delete set null,
  job_id uuid not null references public.upload_jobs(id) on delete cascade,
  normalization_id uuid not null references public.product_registration_v4_normalizations(id) on delete restrict,
  source_document_id uuid not null references public.product_source_documents(id) on delete restrict,
  extraction_id uuid not null references public.product_document_extractions(id) on delete restrict,
  revision_no bigint not null default 1 check (revision_no > 0),
  schema_version text not null default 'product-registration-v5-canonical-1',
  normalization_version text not null,
  canonical_payload jsonb not null check (jsonb_typeof(canonical_payload) = 'object'),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  lineage_hash text not null check (lineage_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'candidate'
    check (status in ('candidate', 'needs_review', 'verified', 'approved', 'published', 'superseded', 'blocked')),
  supersedes_revision_id uuid references public.product_registration_v5_revisions(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (normalization_id, payload_hash)
);

comment on table public.product_registration_v5_revisions is
  'Immutable V5 canonical aggregate. Every correction creates a new revision.';

create unique index if not exists idx_product_registration_v5_revisions_package_no
  on public.product_registration_v5_revisions(package_id, revision_no)
  where package_id is not null;
create index if not exists idx_product_registration_v5_revisions_package_latest
  on public.product_registration_v5_revisions(package_id, created_at desc)
  where package_id is not null;
create index if not exists idx_product_registration_v5_revisions_job
  on public.product_registration_v5_revisions(job_id, created_at desc);
create index if not exists idx_product_registration_v5_revisions_lineage
  on public.product_registration_v5_revisions(source_document_id, extraction_id, lineage_hash);

create table if not exists public.product_registration_v5_claims (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.product_registration_v5_revisions(id) on delete cascade,
  field_path text not null,
  normalized_value jsonb,
  criticality text not null default 'normal'
    check (criticality in ('critical', 'high', 'normal', 'low')),
  extraction_method text not null default 'deterministic',
  evidence_status text not null default 'unverified'
    check (evidence_status in ('verified', 'unverified', 'missing', 'conflicting')),
  conflict_status text not null default 'none'
    check (conflict_status in ('none', 'conflict')),
  claim_hash text not null check (claim_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (revision_id, field_path, claim_hash)
);

comment on table public.product_registration_v5_claims is
  'Field-level claims used by validation and publication policy. Claims never bypass evidence.';

create index if not exists idx_product_registration_v5_claims_revision
  on public.product_registration_v5_claims(revision_id, criticality, field_path);
create index if not exists idx_product_registration_v5_claims_blockers
  on public.product_registration_v5_claims(revision_id, evidence_status, conflict_status)
  where criticality in ('critical', 'high');

create table if not exists public.product_registration_v5_claim_evidence (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.product_registration_v5_claims(id) on delete cascade,
  source_document_id uuid not null references public.product_source_documents(id) on delete restrict,
  extraction_id uuid not null references public.product_document_extractions(id) on delete restrict,
  node_id text not null,
  page integer,
  table_ref jsonb check (table_ref is null or jsonb_typeof(table_ref) = 'object'),
  quote_hash text not null check (quote_hash ~ '^[0-9a-f]{64}$'),
  source_quote text,
  extractor_confidence numeric(6,5) check (extractor_confidence is null or extractor_confidence between 0 and 1),
  semantic_confidence numeric(6,5) check (semantic_confidence is null or semantic_confidence between 0 and 1),
  created_at timestamptz not null default now(),
  unique (claim_id, source_document_id, extraction_id, node_id, quote_hash)
);

create index if not exists idx_product_registration_v5_claim_evidence_claim
  on public.product_registration_v5_claim_evidence(claim_id);
create index if not exists idx_product_registration_v5_claim_evidence_source
  on public.product_registration_v5_claim_evidence(source_document_id, extraction_id, node_id);

create table if not exists public.product_registration_v5_proof_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  package_id uuid references public.travel_packages(id) on delete set null,
  revision_id uuid references public.product_registration_v5_revisions(id) on delete set null,
  public_snapshot_id uuid references public.public_package_snapshots(id) on delete set null,
  snapshot_hash text not null check (snapshot_hash ~ '^[0-9a-f]{64}$'),
  renderer_build_id text not null,
  proof_suite_version text not null,
  route text not null,
  viewport jsonb not null default '{}'::jsonb check (jsonb_typeof(viewport) = 'object'),
  locale text not null default 'ko-KR',
  device_profile text not null default 'mobile',
  status text not null default 'pending'
    check (status in ('pending', 'passed', 'failed', 'stale', 'blocked')),
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result) = 'object'),
  screenshot_hash text,
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (snapshot_hash, renderer_build_id, proof_suite_version, route, locale, device_profile)
);

comment on table public.product_registration_v5_proof_runs is
  'Browser proof bound to one immutable snapshot hash, renderer build, route and viewport profile.';

create index if not exists idx_product_registration_v5_proof_runs_package
  on public.product_registration_v5_proof_runs(package_id, created_at desc)
  where package_id is not null;
create index if not exists idx_product_registration_v5_proof_runs_snapshot
  on public.product_registration_v5_proof_runs(snapshot_hash, status, created_at desc);

create table if not exists public.product_registration_v5_publication_pointers (
  tenant_id uuid,
  package_id uuid not null references public.travel_packages(id) on delete cascade,
  channel text not null default 'customer',
  locale text not null default 'ko-KR',
  current_revision_id uuid references public.product_registration_v5_revisions(id) on delete set null,
  current_snapshot_id uuid references public.public_package_snapshots(id) on delete set null,
  state text not null default 'draft'
    check (state in ('draft', 'approved', 'published', 'blocked', 'quarantined', 'convergence_failed')),
  pointer_version bigint not null default 0 check (pointer_version >= 0),
  updated_at timestamptz not null default now(),
  primary key (package_id, channel, locale)
);

comment on table public.product_registration_v5_publication_pointers is
  'CAS-updated publication pointer. Immutable snapshots are never edited in place.';

create index if not exists idx_product_registration_v5_publication_pointers_tenant
  on public.product_registration_v5_publication_pointers(tenant_id, state, updated_at desc);

create table if not exists public.product_registration_v5_publication_outbox (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  aggregate_type text not null,
  aggregate_id uuid not null,
  event_type text not null,
  dedupe_key text not null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'delivered', 'failed', 'dead_letter')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (dedupe_key)
);

create index if not exists idx_product_registration_v5_publication_outbox_ready
  on public.product_registration_v5_publication_outbox(status, available_at, created_at)
  where status in ('pending', 'failed');

create table if not exists public.product_registration_v5_job_stage_runs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.upload_jobs(id) on delete cascade,
  stage_name text not null,
  stage_version text not null,
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'running'
    check (status in ('running', 'succeeded', 'failed', 'cancelled')),
  output_ref jsonb not null default '{}'::jsonb check (jsonb_typeof(output_ref) = 'object'),
  error_code text,
  error_detail text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (job_id, stage_name, stage_version, input_hash)
);

create table if not exists public.product_registration_v5_idempotency_ledger (
  operation_key text primary key,
  operation_type text not null,
  tenant_id uuid,
  aggregate_id uuid,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  response jsonb,
  status text not null default 'started'
    check (status in ('started', 'succeeded', 'failed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- Keep the old snapshot writer working during dual-write, while giving V5 a
-- place to record its canonical lineage and renderer contract.
alter table public.public_package_snapshots
  add column if not exists canonical_revision_id uuid,
  add column if not exists renderer_build_id text,
  add column if not exists locale text not null default 'ko-KR',
  add column if not exists projection_hashes jsonb not null default '{}'::jsonb;

create index if not exists idx_public_package_snapshots_canonical_revision
  on public.public_package_snapshots(canonical_revision_id)
  where canonical_revision_id is not null;

alter table public.package_publish_decisions
  add column if not exists canonical_revision_id uuid,
  add column if not exists proof_run_id uuid,
  add column if not exists policy_version text,
  add column if not exists idempotency_key text;

alter table public.travel_packages
  add column if not exists canonical_revision_id uuid,
  add column if not exists canonical_payload_hash text;

create index if not exists idx_travel_packages_canonical_revision
  on public.travel_packages(canonical_revision_id)
  where canonical_revision_id is not null;

create or replace function public.product_registration_v5_reject_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception '% is append-only; create a new revision instead', tg_table_name;
end;
$$;

drop trigger if exists trg_product_registration_v5_segments_immutable on public.product_registration_v5_segments;
create trigger trg_product_registration_v5_segments_immutable
  before update or delete on public.product_registration_v5_segments
  for each row execute function public.product_registration_v5_reject_mutation();

drop trigger if exists trg_product_registration_v5_revisions_immutable on public.product_registration_v5_revisions;
create trigger trg_product_registration_v5_revisions_immutable
  before update or delete on public.product_registration_v5_revisions
  for each row execute function public.product_registration_v5_reject_mutation();

drop trigger if exists trg_product_registration_v5_claims_immutable on public.product_registration_v5_claims;
create trigger trg_product_registration_v5_claims_immutable
  before update or delete on public.product_registration_v5_claims
  for each row execute function public.product_registration_v5_reject_mutation();

drop trigger if exists trg_product_registration_v5_claim_evidence_immutable on public.product_registration_v5_claim_evidence;
create trigger trg_product_registration_v5_claim_evidence_immutable
  before update or delete on public.product_registration_v5_claim_evidence
  for each row execute function public.product_registration_v5_reject_mutation();

drop trigger if exists trg_product_registration_v5_proof_runs_immutable on public.product_registration_v5_proof_runs;
create trigger trg_product_registration_v5_proof_runs_immutable
  before update or delete on public.product_registration_v5_proof_runs
  for each row execute function public.product_registration_v5_reject_mutation();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'product_registration_v5_segments',
    'product_registration_v5_revisions',
    'product_registration_v5_claims',
    'product_registration_v5_claim_evidence',
    'product_registration_v5_proof_runs',
    'product_registration_v5_publication_pointers',
    'product_registration_v5_publication_outbox',
    'product_registration_v5_job_stage_runs',
    'product_registration_v5_idempotency_ledger'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_service_role', table_name);
    execute format(
      'create policy %I on public.%I for all to service_role using (true) with check (true)',
      table_name || '_service_role',
      table_name
    );
    execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
    execute format('grant all on table public.%I to service_role', table_name);
  end loop;
end;
$$;

revoke all on function public.product_registration_v5_reject_mutation() from public, anon, authenticated;
grant execute on function public.product_registration_v5_reject_mutation() to service_role;

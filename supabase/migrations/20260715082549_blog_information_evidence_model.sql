-- Informational blog evidence namespace.
-- Product registration evidence and final product snapshots are intentionally untouched.

begin;

create table if not exists public.blog_information_sources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid null references public.tenants(id) on delete set null,
  source_key text not null unique,
  source_type text not null check (source_type in (
    'government',
    'embassy',
    'immigration',
    'customs',
    'meteorological_agency',
    'airport',
    'transport_operator',
    'insurer_policy',
    'regulator',
    'central_bank',
    'bank',
    'official_tourism',
    'official_map',
    'official_operator',
    'field_research',
    'reputable_local_source',
    'reputable_price_source',
    'reputable_source',
    'legal_review',
    'internal_reference'
  )),
  authority_level text not null check (authority_level in (
    'official_primary',
    'official_secondary',
    'editorial_secondary',
    'field_observation',
    'internal_reference'
  )),
  source_url text null,
  internal_identifier text null,
  publisher text not null,
  retrieved_at timestamptz not null,
  valid_from timestamptz null,
  valid_until timestamptz null,
  destination text null,
  country text null,
  claim_types text[] not null default '{}'::text[],
  risk_level text not null default 'LOW' check (risk_level in ('LOW', 'MEDIUM', 'HIGH')),
  reviewer_id uuid null,
  reviewed_at timestamptz null,
  status text not null default 'active' check (status in ('active', 'expired', 'revoked')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint blog_information_sources_locator_required
    check (nullif(btrim(source_url), '') is not null or nullif(btrim(internal_identifier), '') is not null),
  constraint blog_information_sources_key_not_blank check (btrim(source_key) <> ''),
  constraint blog_information_sources_valid_window
    check (valid_until is null or valid_from is null or valid_until >= valid_from),
  constraint blog_information_sources_review_pair
    check (
      (reviewer_id is null and reviewed_at is null)
      or (reviewer_id is not null and reviewed_at is not null)
    )
);

create table if not exists public.blog_information_evidence (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid null references public.tenants(id) on delete set null,
  content_key text not null,
  creative_id uuid null references public.content_creatives(id) on delete cascade,
  source_id uuid not null references public.blog_information_sources(id) on delete restrict,
  evidence_key text not null,
  source_locator text null,
  excerpt text null,
  claim_type text not null check (claim_type in (
    'price', 'currency', 'duration', 'percentage', 'climate', 'customs',
    'entry_visa', 'insurance', 'policy', 'superlative', 'factual'
  )),
  risk_level text not null default 'LOW' check (risk_level in ('LOW', 'MEDIUM', 'HIGH')),
  observed_at timestamptz not null,
  valid_from timestamptz null,
  valid_until timestamptz null,
  captured_by text not null default 'information_researcher',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint blog_information_evidence_content_key_not_blank check (btrim(content_key) <> ''),
  constraint blog_information_evidence_key_not_blank check (btrim(evidence_key) <> ''),
  constraint blog_information_evidence_valid_window
    check (valid_until is null or valid_from is null or valid_until >= valid_from),
  unique (content_key, evidence_key)
);

create table if not exists public.blog_information_claims (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid null references public.tenants(id) on delete set null,
  content_key text not null,
  creative_id uuid null references public.content_creatives(id) on delete cascade,
  claim_fingerprint char(64) not null,
  claim_text text not null,
  claim_type text not null check (claim_type in (
    'price', 'currency', 'duration', 'percentage', 'climate', 'customs',
    'entry_visa', 'insurance', 'policy', 'superlative', 'factual'
  )),
  risk_level text not null default 'LOW' check (risk_level in ('LOW', 'MEDIUM', 'HIGH')),
  extracted_value jsonb not null default '{}'::jsonb,
  requires_evidence boolean not null default true,
  validation_status text not null default 'pending' check (validation_status in (
    'pending', 'supported', 'unsupported', 'stale', 'review_required', 'approved', 'rejected'
  )),
  validation_reason text null,
  approved_by uuid null,
  approved_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint blog_information_claims_content_key_not_blank check (btrim(content_key) <> ''),
  constraint blog_information_claims_text_not_blank check (btrim(claim_text) <> ''),
  constraint blog_information_claims_fingerprint_format check (claim_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint blog_information_claims_approval_pair
    check (
      (approved_by is null and approved_at is null)
      or (approved_by is not null and approved_at is not null)
    ),
  unique (content_key, claim_fingerprint)
);

create table if not exists public.blog_information_claim_evidence (
  claim_id uuid not null references public.blog_information_claims(id) on delete cascade,
  evidence_id uuid not null references public.blog_information_evidence(id) on delete cascade,
  support_type text not null default 'supports' check (support_type in ('supports', 'contradicts', 'context')),
  note text null,
  created_at timestamptz not null default now(),
  primary key (claim_id, evidence_id)
);

alter table public.blog_information_sources enable row level security;
alter table public.blog_information_evidence enable row level security;
alter table public.blog_information_claims enable row level security;
alter table public.blog_information_claim_evidence enable row level security;

revoke all on table public.blog_information_sources from public, anon, authenticated;
revoke all on table public.blog_information_evidence from public, anon, authenticated;
revoke all on table public.blog_information_claims from public, anon, authenticated;
revoke all on table public.blog_information_claim_evidence from public, anon, authenticated;

grant select, insert, update, delete on table public.blog_information_sources to service_role;
grant select, insert, update, delete on table public.blog_information_evidence to service_role;
grant select, insert, update, delete on table public.blog_information_claims to service_role;
grant select, insert, update, delete on table public.blog_information_claim_evidence to service_role;

drop policy if exists blog_information_sources_service_role_all on public.blog_information_sources;
create policy blog_information_sources_service_role_all
  on public.blog_information_sources for all to service_role using (true) with check (true);

drop policy if exists blog_information_evidence_service_role_all on public.blog_information_evidence;
create policy blog_information_evidence_service_role_all
  on public.blog_information_evidence for all to service_role using (true) with check (true);

drop policy if exists blog_information_claims_service_role_all on public.blog_information_claims;
create policy blog_information_claims_service_role_all
  on public.blog_information_claims for all to service_role using (true) with check (true);

drop policy if exists blog_information_claim_evidence_service_role_all on public.blog_information_claim_evidence;
create policy blog_information_claim_evidence_service_role_all
  on public.blog_information_claim_evidence for all to service_role using (true) with check (true);

comment on table public.blog_information_sources is
  'Information-only external source registry. Separate from product registration evidence and snapshots.';
comment on table public.blog_information_evidence is
  'Information-only captured evidence linked to a source and future or persisted blog content.';
comment on table public.blog_information_claims is
  'Information-only customer-visible claims and their publish validation state.';
comment on table public.blog_information_claim_evidence is
  'Normalized support links between informational claims and informational evidence.';

commit;

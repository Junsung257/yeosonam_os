-- Verified commercial contract master used by product registration intake.
-- Historical package values and filename shorthand are never treated as proof.

create table if not exists public.product_commercial_contracts (
  id uuid primary key default gen_random_uuid(),
  land_operator_id uuid not null references public.land_operators(id) on delete restrict,
  contract_label text not null,
  commission_rate numeric(5,2) not null,
  filename_markers text[] not null default '{}'::text[],
  source_label_markers text[] not null default '{}'::text[],
  raw_text_markers text[] not null default '{}'::text[],
  allow_operator_alias_match boolean not null default false,
  valid_from date not null,
  valid_to date,
  evidence_url text,
  evidence_hash text,
  verified_at timestamptz not null,
  auto_apply boolean not null default true,
  is_active boolean not null default true,
  priority integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_commercial_contracts_label_not_blank
    check (btrim(contract_label) <> ''),
  constraint product_commercial_contracts_rate_range
    check (commission_rate > 0 and commission_rate <= 50),
  constraint product_commercial_contracts_validity
    check (valid_to is null or valid_to >= valid_from),
  constraint product_commercial_contracts_evidence_required
    check (
      auto_apply = false
      or nullif(btrim(coalesce(evidence_url, '')), '') is not null
      or nullif(btrim(coalesce(evidence_hash, '')), '') is not null
    ),
  constraint product_commercial_contracts_matcher_required
    check (
      auto_apply = false
      or cardinality(filename_markers) > 0
      or cardinality(source_label_markers) > 0
      or cardinality(raw_text_markers) > 0
      or allow_operator_alias_match = true
    )
);

create index if not exists product_commercial_contracts_active_validity_idx
  on public.product_commercial_contracts
  (is_active, auto_apply, valid_from, valid_to, priority desc);

create index if not exists product_commercial_contracts_operator_idx
  on public.product_commercial_contracts (land_operator_id, is_active);

drop trigger if exists trg_product_commercial_contracts_updated_at
  on public.product_commercial_contracts;
create trigger trg_product_commercial_contracts_updated_at
  before update on public.product_commercial_contracts
  for each row execute function public.set_updated_at();

alter table public.product_commercial_contracts enable row level security;

revoke all on table public.product_commercial_contracts from anon, authenticated;
grant select, insert, update, delete on table public.product_commercial_contracts to service_role;

drop policy if exists product_commercial_contracts_service_role_all
  on public.product_commercial_contracts;
create policy product_commercial_contracts_service_role_all
  on public.product_commercial_contracts
  for all
  to service_role
  using (true)
  with check (true);

comment on table public.product_commercial_contracts is
  'Private, evidence-backed commercial contract master. Registration may auto-apply only active, verified, in-date, unambiguous matches.';
comment on column public.product_commercial_contracts.filename_markers is
  'Explicit normalized filename markers configured from a verified contract; shorthand such as 15T/10T/8T/TL is not evidence.';
comment on column public.product_commercial_contracts.evidence_hash is
  'SHA-256 or other immutable reference to the reviewed contract evidence when a URL is unavailable.';

create table if not exists public.product_registration_section_jobs (
  id uuid primary key default gen_random_uuid(),
  upload_id text not null,
  raw_text_hash text not null,
  section_raw_text_hash text not null,
  supplier_code text not null,
  normalized_title text not null,
  status text not null default 'processing'
    check (status in ('processing', 'completed', 'blocked', 'failed')),
  product_id text null,
  package_id uuid null,
  attempt_count integer not null default 1,
  error_message text null,
  started_at timestamptz not null default now(),
  completed_at timestamptz null,
  updated_at timestamptz not null default now()
);

create unique index if not exists product_registration_section_jobs_idempotency_idx
  on public.product_registration_section_jobs (
    raw_text_hash,
    section_raw_text_hash,
    supplier_code,
    normalized_title
  );

create index if not exists product_registration_section_jobs_status_idx
  on public.product_registration_section_jobs (status, updated_at desc);

comment on table public.product_registration_section_jobs is
  'Idempotency ledger for product-registration section jobs. Prevents duplicate section processing across multi-product uploads.';

alter table public.product_registration_section_jobs enable row level security;

revoke all on public.product_registration_section_jobs from anon, authenticated;
grant select, insert, update on public.product_registration_section_jobs to service_role;

drop policy if exists product_registration_section_jobs_service_role_all
  on public.product_registration_section_jobs;

create policy product_registration_section_jobs_service_role_all
  on public.product_registration_section_jobs
  for all
  to service_role
  using (true)
  with check (true);

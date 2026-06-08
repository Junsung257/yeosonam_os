-- Entity resolution learning engine verification state.
-- Keeps automated external verification evidence separate from customer-facing master data.

alter table public.entity_master_candidates
  add column if not exists auto_verification_status text not null default 'unverified',
  add column if not exists verification_score numeric(5,4) not null default 0,
  add column if not exists canonical_name text,
  add column if not exists canonical_name_source text,
  add column if not exists source_reliability_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists verified_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'entity_master_candidates_auto_verification_status_check'
  ) then
    alter table public.entity_master_candidates
      add constraint entity_master_candidates_auto_verification_status_check
      check (
        auto_verification_status in (
          'unverified',
          'verifying',
          'verified_publishable',
          'verified_internal',
          'template_matched',
          'structured_non_master',
          'rejected_noise',
          'conflict',
          'needs_review'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'entity_master_candidates_verification_score_check'
  ) then
    alter table public.entity_master_candidates
      add constraint entity_master_candidates_verification_score_check
      check (verification_score >= 0 and verification_score <= 1);
  end if;
end $$;

create table if not exists public.entity_verification_attempts (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid references public.entity_master_candidates(id) on delete cascade,
  candidate_key text not null,
  source text not null,
  query text not null,
  status text not null,
  score numeric(5,4) not null default 0,
  evidence jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint entity_verification_attempts_source_check
    check (source in ('naver_search', 'naver_searchad', 'wikidata', 'osm_nominatim', 'internal', 'manual')),
  constraint entity_verification_attempts_status_check
    check (status in ('success', 'empty', 'error', 'skipped')),
  constraint entity_verification_attempts_score_check
    check (score >= 0 and score <= 1)
);

create index if not exists entity_verification_attempts_candidate_idx
  on public.entity_verification_attempts(candidate_key, created_at desc);

create index if not exists entity_verification_attempts_source_idx
  on public.entity_verification_attempts(source, status, created_at desc);

alter table public.entity_verification_attempts enable row level security;

drop policy if exists entity_verification_attempts_service_role_all on public.entity_verification_attempts;
create policy entity_verification_attempts_service_role_all
  on public.entity_verification_attempts
  for all
  to service_role
  using (true)
  with check (true);

grant select, insert, update, delete on public.entity_verification_attempts to service_role;

create table if not exists public.entity_source_reliability (
  source text primary key,
  weight numeric(5,4) not null default 0.5,
  success_count integer not null default 0,
  conflict_count integer not null default 0,
  last_seen_at timestamptz,
  notes text,
  updated_at timestamptz not null default now(),
  constraint entity_source_reliability_weight_check check (weight >= 0 and weight <= 1)
);

alter table public.entity_source_reliability enable row level security;

drop policy if exists entity_source_reliability_service_role_all on public.entity_source_reliability;
create policy entity_source_reliability_service_role_all
  on public.entity_source_reliability
  for all
  to service_role
  using (true)
  with check (true);

grant select, insert, update, delete on public.entity_source_reliability to service_role;

insert into public.entity_source_reliability(source, weight, notes)
values
  ('wikidata', 0.9, 'identity source'),
  ('osm_nominatim', 0.82, 'identity source, public usage policy requires low-volume scheduled calls'),
  ('naver_search', 0.68, 'Korean naming and context signal'),
  ('naver_searchad', 0.62, 'Korean demand/canonical naming signal'),
  ('internal', 0.75, 'existing corpus and admin history'),
  ('manual', 1.0, 'admin-approved')
on conflict (source) do update
set weight = excluded.weight,
    notes = excluded.notes,
    updated_at = now();

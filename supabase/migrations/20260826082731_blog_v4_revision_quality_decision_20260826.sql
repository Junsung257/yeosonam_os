-- Blog V4 revision and final-quality decision contract.
-- Additive only. Existing public creatives and publication rows remain the
-- compatibility projection; new V4 publication paths must carry exact IDs.

begin;

create table if not exists public.blog_content_revisions (
  id uuid primary key default gen_random_uuid(),
  creative_id uuid not null references public.content_creatives(id) on delete restrict,
  operation_id uuid null references public.blog_content_operations(id) on delete set null,
  parent_revision_id uuid null references public.blog_content_revisions(id) on delete restrict,
  revision_no integer not null check (revision_no > 0),
  revision_type text not null check (revision_type in ('generation', 'opening_repair', 'full_rewrite')),
  slug text not null check (btrim(slug) <> ''),
  title text not null check (btrim(title) <> ''),
  description text not null default '',
  blog_html text not null check (btrim(blog_html) <> ''),
  content_hash char(64) not null check (content_hash ~ '^[0-9a-f]{64}$'),
  claim_fingerprint text,
  immutable boolean not null default false,
  created_at timestamptz not null default now(),
  unique (creative_id, revision_no),
  unique (creative_id, content_hash)
);

create table if not exists public.blog_quality_decisions (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null unique references public.blog_content_revisions(id) on delete restrict,
  evaluator_version text not null,
  overall_score numeric(5,2) not null check (overall_score between 0 and 100),
  minimum_score numeric(5,2) not null check (minimum_score between 0 and 100),
  decision text not null check (decision in ('pass', 'repairable_fail', 'human_review', 'reject')),
  passed boolean not null,
  hard_blockers jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  evaluated_content_hash char(64) not null check (evaluated_content_hash ~ '^[0-9a-f]{64}$'),
  comparison_corpus_version text not null,
  evaluated_at timestamptz not null default now(),
  constraint blog_quality_decision_pass_consistency check (
    passed = (
      decision = 'pass'
      and jsonb_array_length(hard_blockers) = 0
      and overall_score >= minimum_score
    )
  )
);

alter table public.blog_quality_evaluations
  add column if not exists revision_id uuid null references public.blog_content_revisions(id) on delete restrict,
  add column if not exists content_hash char(64) null,
  add column if not exists corpus_version text null,
  add column if not exists opening_evidence jsonb not null default '{}'::jsonb;

alter table public.blog_content_operations
  drop constraint if exists blog_content_operations_status_check,
  drop constraint if exists blog_content_operations_current_stage_check,
  add column if not exists generation_status text not null default 'pending'
    check (generation_status in ('pending', 'running', 'succeeded', 'failed')),
  add column if not exists review_status text not null default 'not_required'
    check (review_status in ('not_required', 'pending', 'approved', 'rejected', 'changes_requested')),
  add column if not exists publication_status text not null default 'not_eligible'
    check (publication_status in ('not_eligible', 'suppressed_by_policy', 'not_attempted', 'queued', 'publishing', 'published', 'failed')),
  add column if not exists indexing_status text not null default 'not_eligible'
    check (indexing_status in ('not_eligible', 'not_attempted', 'queued', 'processing', 'succeeded', 'failed')),
  add column if not exists final_revision_id uuid null references public.blog_content_revisions(id) on delete restrict,
  add column if not exists final_quality_decision_id uuid null references public.blog_quality_decisions(id) on delete restrict;

alter table public.blog_content_operations
  add constraint blog_content_operations_status_check
  check (status in (
    'queued', 'running', 'human_review', 'approved_for_slot', 'research_backlog',
    'quarantined', 'publishing', 'published', 'indexed', 'failed', 'cancelled', 'completed'
  )),
  add constraint blog_content_operations_current_stage_check
  check (current_stage in (
    'demand_verified', 'brief_verified', 'research_ready', 'drafting', 'evaluating',
    'repairing', 'human_review', 'approved_for_slot', 'publishing', 'published',
    'indexed', 'research_backlog', 'quarantined', 'failed', 'cancelled', 'completed'
  ));

alter table public.blog_content_operations
  drop constraint if exists blog_content_operations_terminal_time;
alter table public.blog_content_operations
  add constraint blog_content_operations_terminal_time check (
    status not in ('research_backlog', 'quarantined', 'published', 'indexed', 'failed', 'cancelled', 'completed')
    or completed_at is not null
  );

-- Keep the existing fenced stage-event RPC as the single operation state
-- writer, while allowing a generation-only completion to be terminalized
-- without pretending that a human review occurred.
create or replace function public.record_blog_content_stage_event_v4(
  p_operation_id uuid,
  p_fencing_token bigint,
  p_lease_owner text,
  p_event jsonb
) returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_operation public.blog_content_operations%rowtype;
  v_event_id uuid;
  v_event_status text := p_event ->> 'status';
  v_next_status text := nullif(p_event ->> 'operation_status', '');
  v_next_stage text := p_event ->> 'stage';
begin
  select * into v_operation from public.blog_content_operations
  where id = p_operation_id for update;
  if v_operation.id is null or v_operation.fencing_token <> p_fencing_token then
    raise exception 'blog_content_operation_fencing_conflict';
  end if;
  select id into v_event_id from public.blog_content_stage_events
  where operation_id = p_operation_id and event_key = p_event ->> 'event_key';
  if v_event_id is not null then
    if v_operation.status in ('running', 'publishing') then
      if v_operation.lease_owner is distinct from p_lease_owner then
        raise exception 'blog_content_operation_fencing_conflict';
      end if;
      update public.blog_content_operations
      set lease_expires_at = now() + interval '15 minutes', updated_at = now()
      where id = p_operation_id and fencing_token = p_fencing_token;
    end if;
    return v_event_id;
  end if;
  if v_operation.lease_owner is distinct from p_lease_owner
    or v_operation.status not in ('running', 'publishing') then
    raise exception 'blog_content_operation_fencing_conflict';
  end if;

  insert into public.blog_content_stage_events (
    operation_id, event_key, fencing_token, stage, status, failure_code,
    duration_ms, provider, model, attempt_number, input_tokens,
    cached_input_tokens, output_tokens, estimated_cost_usd, evidence, occurred_at
  ) values (
    p_operation_id, p_event ->> 'event_key', p_fencing_token, v_next_stage,
    v_event_status, nullif(p_event ->> 'failure_code', ''),
    nullif(p_event ->> 'duration_ms', '')::integer,
    nullif(p_event ->> 'provider', ''), nullif(p_event ->> 'model', ''),
    nullif(p_event ->> 'attempt_number', '')::integer,
    nullif(p_event ->> 'input_tokens', '')::bigint,
    nullif(p_event ->> 'cached_input_tokens', '')::bigint,
    nullif(p_event ->> 'output_tokens', '')::bigint,
    nullif(p_event ->> 'estimated_cost_usd', '')::numeric,
    coalesce(p_event -> 'evidence', '{}'::jsonb),
    coalesce(nullif(p_event ->> 'occurred_at', '')::timestamptz, now())
  ) on conflict (operation_id, event_key) do nothing returning id into v_event_id;

  if v_event_id is null then
    select id into v_event_id from public.blog_content_stage_events
    where operation_id = p_operation_id and event_key = p_event ->> 'event_key';
  else
    update public.blog_content_operations
    set current_stage = v_next_stage,
        status = coalesce(v_next_status, status),
        failure_code = coalesce(nullif(p_event ->> 'failure_code', ''), failure_code),
        skip_reason = coalesce(nullif(p_event ->> 'skip_reason', ''), skip_reason),
        generation_run_id = coalesce(nullif(p_event ->> 'generation_run_id', '')::uuid, generation_run_id),
        creative_id = coalesce(nullif(p_event ->> 'creative_id', '')::uuid, creative_id),
        lease_expires_at = case
          when coalesce(v_next_status, status) in ('human_review', 'approved_for_slot', 'research_backlog', 'quarantined', 'published', 'indexed', 'failed', 'cancelled', 'completed') then null
          else now() + interval '15 minutes'
        end,
        lease_owner = case
          when coalesce(v_next_status, status) in ('human_review', 'approved_for_slot', 'research_backlog', 'quarantined', 'published', 'indexed', 'failed', 'cancelled', 'completed') then null
          else lease_owner
        end,
        completed_at = case
          when coalesce(v_next_status, status) in ('human_review', 'approved_for_slot', 'research_backlog', 'quarantined', 'published', 'indexed', 'failed', 'cancelled', 'completed') then now()
          else completed_at
        end,
        updated_at = now()
    where id = p_operation_id;
  end if;
  return v_event_id;
end;
$$;

revoke all on function public.record_blog_content_stage_event_v4(uuid, bigint, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_blog_content_stage_event_v4(uuid, bigint, text, jsonb)
  to service_role;

do $$
begin
  -- The Preview branch may intentionally omit the live informational
  -- publication ledger. Add the exact-revision foreign keys wherever that
  -- ledger exists, without creating a fake publication surface in Preview.
  if to_regclass('public.blog_information_publications') is not null then
    alter table public.blog_information_publications
      add column if not exists revision_id uuid null references public.blog_content_revisions(id) on delete restrict,
      add column if not exists quality_decision_id uuid null references public.blog_quality_decisions(id) on delete restrict;
  end if;
end;
$$;

create index if not exists idx_blog_content_revisions_creative_created
  on public.blog_content_revisions(creative_id, created_at desc);
create index if not exists idx_blog_content_revisions_operation
  on public.blog_content_revisions(operation_id, revision_no desc)
  where operation_id is not null;
create index if not exists idx_blog_quality_decisions_passed
  on public.blog_quality_decisions(passed, evaluated_at desc);
create index if not exists idx_blog_quality_evaluations_revision
  on public.blog_quality_evaluations(revision_id, evaluated_at desc)
  where revision_id is not null;
create index if not exists idx_blog_content_operations_final_revision
  on public.blog_content_operations(final_revision_id)
  where final_revision_id is not null;

create or replace function public.prevent_immutable_blog_content_revision_mutation_v1()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if coalesce(old.immutable, false) then
      raise exception 'immutable_blog_content_revision';
    end if;
    return old;
  end if;
  if coalesce(old.immutable, false) then
    raise exception 'immutable_blog_content_revision';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_blog_content_revisions_immutable
  on public.blog_content_revisions;
create trigger trg_blog_content_revisions_immutable
before update or delete on public.blog_content_revisions
for each row execute function public.prevent_immutable_blog_content_revision_mutation_v1();

alter table public.blog_content_revisions enable row level security;
alter table public.blog_quality_decisions enable row level security;
revoke all on table public.blog_content_revisions, public.blog_quality_decisions
  from public, anon, authenticated;
grant select, insert, update on table public.blog_content_revisions to service_role;
grant select, insert, update on table public.blog_quality_decisions to service_role;

drop policy if exists blog_content_revisions_service_role on public.blog_content_revisions;
create policy blog_content_revisions_service_role
  on public.blog_content_revisions for all to service_role
  using (true) with check (true);
drop policy if exists blog_quality_decisions_service_role on public.blog_quality_decisions;
create policy blog_quality_decisions_service_role
  on public.blog_quality_decisions for all to service_role
  using (true) with check (true);

comment on table public.blog_content_revisions is
  'Immutable-by-contract Blog V4 article revisions. Publication must pin one exact revision.';
comment on table public.blog_quality_decisions is
  'Single final quality authority for one Blog V4 revision; subordinate evaluators remain diagnostic.';
comment on column public.blog_quality_evaluations.opening_evidence is
  'Bounded similarity evidence: window, nearest match, threshold, and content/corpus identity only.';

commit;

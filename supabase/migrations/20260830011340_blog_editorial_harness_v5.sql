-- Blog editorial harness V5
--
-- Adds fail-closed prompt trace evidence for new approved attempts and gives
-- the independent editorial judge its own atomic daily-budget reservation.
-- Historical approved attempts are intentionally not fabricated; the prompt
-- trace constraint is NOT VALID so it applies to new writes without blocking
-- this additive migration on legacy nulls.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.blog_generation_attempts
  add column if not exists prompt_trace_version text,
  add column if not exists prompt_template_version text,
  add column if not exists git_commit_sha text,
  add column if not exists brief_hash text,
  add column if not exists claim_packet_hash text;

alter table public.blog_generation_attempts
  drop constraint if exists blog_generation_attempts_approved_prompt_trace_v1;
alter table public.blog_generation_attempts
  add constraint blog_generation_attempts_approved_prompt_trace_v1 check (
    route <> 'approved_for_slot'
    or (
      prompt_trace_version = 'blog-prompt-trace-v1'
      and prompt_hash ~ '^[0-9a-f]{64}$'
      and brief_hash ~ '^[0-9a-f]{64}$'
      and claim_packet_hash ~ '^[0-9a-f]{64}$'
      and length(btrim(prompt_template_version)) > 0
      and git_commit_sha ~ '^[0-9a-f]{40}$'
    )
  ) not valid;

comment on column public.blog_generation_attempts.prompt_hash is
  'SHA-256 of the exact rendered provider prompt. Required for every new approved_for_slot attempt.';
comment on constraint blog_generation_attempts_approved_prompt_trace_v1
  on public.blog_generation_attempts is
  'Fail-closed for new approvals; legacy rows remain unvalidated until an explicit audited backfill decision.';

alter table public.blog_ai_budget_reservations
  add column if not exists call_kind text not null default 'generation';

alter table public.blog_ai_budget_reservations
  drop constraint if exists blog_ai_budget_reservations_stage_check,
  drop constraint if exists blog_ai_budget_reservations_call_kind_check,
  drop constraint if exists blog_ai_budget_reservations_queue_id_attempt_number_key,
  drop constraint if exists blog_ai_budget_reservations_queue_attempt_call_kind_key;

alter table public.blog_ai_budget_reservations
  add constraint blog_ai_budget_reservations_stage_check
    check (stage in ('draft_flash', 'rewrite_pro_high', 'rewrite_pro_max', 'editorial_judge')),
  add constraint blog_ai_budget_reservations_call_kind_check
    check (call_kind in ('generation', 'editorial_judge')),
  add constraint blog_ai_budget_reservations_queue_attempt_call_kind_key
    unique (queue_id, attempt_number, call_kind);

create or replace function public.reserve_blog_ai_budget_v5(
  p_queue_id uuid,
  p_attempt_number integer,
  p_stage text,
  p_provider text,
  p_model text,
  p_requested_usd numeric,
  p_cap_usd numeric,
  p_budget_day_kst date,
  p_call_kind text
) returns table (
  reservation_id uuid,
  allowed boolean,
  reason text,
  cap_usd numeric,
  actual_usd numeric,
  reserved_usd numeric,
  requested_usd numeric,
  remaining_usd numeric
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_existing public.blog_ai_budget_reservations%rowtype;
  v_actual numeric := 0;
  v_reserved numeric := 0;
begin
  if p_requested_usd <= 0 or p_cap_usd <= 0
    or p_attempt_number not between 1 and 5
    or p_provider <> 'deepseek'
    or p_call_kind not in ('generation', 'editorial_judge')
    or (p_call_kind = 'generation' and p_stage not in ('draft_flash', 'rewrite_pro_high', 'rewrite_pro_max'))
    or (p_call_kind = 'editorial_judge' and p_stage <> 'editorial_judge') then
    raise exception 'invalid_blog_ai_budget_reservation_v5';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('blog-ai-budget:' || p_budget_day_kst::text, 0));

  select * into v_existing
  from public.blog_ai_budget_reservations
  where queue_id = p_queue_id
    and attempt_number = p_attempt_number
    and call_kind = p_call_kind;

  select coalesce(sum(r.actual_usd), 0), coalesce(sum(r.reserved_usd), 0)
  into v_actual, v_reserved
  from public.blog_ai_budget_reservations r
  where r.budget_day_kst = p_budget_day_kst;

  if found and v_existing.id is not null then
    return query select
      v_existing.id,
      false,
      'attempt_budget_already_reserved'::text,
      least(p_cap_usd, v_existing.cap_usd),
      v_actual,
      v_reserved,
      v_existing.requested_usd,
      greatest(0::numeric, least(p_cap_usd, v_existing.cap_usd) - v_actual - v_reserved);
    return;
  end if;

  if v_actual + v_reserved + p_requested_usd > p_cap_usd then
    return query select
      null::uuid,
      false,
      'daily_ai_cost_cap_reached'::text,
      p_cap_usd,
      v_actual,
      v_reserved,
      p_requested_usd,
      greatest(0::numeric, p_cap_usd - v_actual - v_reserved);
    return;
  end if;

  insert into public.blog_ai_budget_reservations (
    budget_day_kst, queue_id, attempt_number, stage, provider, model,
    cap_usd, requested_usd, reserved_usd, call_kind
  ) values (
    p_budget_day_kst, p_queue_id, p_attempt_number, p_stage, p_provider, p_model,
    p_cap_usd, p_requested_usd, p_requested_usd, p_call_kind
  ) returning id into reservation_id;

  allowed := true;
  reason := 'budget_reserved';
  cap_usd := p_cap_usd;
  actual_usd := v_actual;
  reserved_usd := v_reserved + p_requested_usd;
  requested_usd := p_requested_usd;
  remaining_usd := greatest(0::numeric, p_cap_usd - actual_usd - reserved_usd);
  return next;
end;
$$;

-- Preserve the V4 application contract while making generation rows explicit
-- after the uniqueness key expands to include call_kind.
create or replace function public.reserve_blog_ai_budget_v4(
  p_queue_id uuid,
  p_attempt_number integer,
  p_stage text,
  p_provider text,
  p_model text,
  p_requested_usd numeric,
  p_cap_usd numeric,
  p_budget_day_kst date
) returns table (
  reservation_id uuid,
  allowed boolean,
  reason text,
  cap_usd numeric,
  actual_usd numeric,
  reserved_usd numeric,
  requested_usd numeric,
  remaining_usd numeric
)
language sql
security invoker
set search_path = public, pg_temp
as $$
  select * from public.reserve_blog_ai_budget_v5(
    p_queue_id, p_attempt_number, p_stage, p_provider, p_model,
    p_requested_usd, p_cap_usd, p_budget_day_kst, 'generation'
  );
$$;

revoke all on function public.reserve_blog_ai_budget_v5(uuid,integer,text,text,text,numeric,numeric,date,text)
  from public, anon, authenticated;
grant execute on function public.reserve_blog_ai_budget_v5(uuid,integer,text,text,text,numeric,numeric,date,text)
  to service_role;

comment on column public.blog_ai_budget_reservations.call_kind is
  'Separates article generation from the independent editorial judge while retaining one KST-day spend cap.';

commit;

-- Post-deploy verification (read only):
-- select route, count(*), count(prompt_hash) as traced
-- from public.blog_generation_attempts
-- where created_at >= '2026-08-30T00:00:00Z'
-- group by route;
-- select budget_day_kst, call_kind, sum(actual_usd), sum(reserved_usd), count(*)
-- from public.blog_ai_budget_reservations
-- group by budget_day_kst, call_kind order by budget_day_kst desc, call_kind;

-- Rollback after application rollback only:
-- drop function if exists public.reserve_blog_ai_budget_v5(uuid,integer,text,text,text,numeric,numeric,date,text);
-- The additive prompt-trace columns are intentionally retained for audit.

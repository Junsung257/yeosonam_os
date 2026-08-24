-- Read-only reviewed rollback for 20260818080000_blog_deepseek_auto_repair_budget_v1.sql.
-- Never run automatically. The guard aborts if any five-attempt row exists.

begin;

do $$
begin
  if exists (
    select 1 from public.blog_generation_runs where attempt_count > 3
  ) or exists (
    select 1 from public.blog_generation_attempts where attempt_number > 3
  ) or exists (
    select 1 from public.blog_ai_budget_reservations where attempt_number > 3
  ) then
    raise exception 'blog_auto_repair_rollback_blocked_attempts_above_three_exist';
  end if;
end;
$$;

alter table public.blog_generation_runs
  drop constraint if exists blog_generation_runs_attempt_count_v5_check;
alter table public.blog_generation_runs
  add constraint blog_generation_runs_attempt_count_v3_check
    check (attempt_count between 0 and 3);

alter table public.blog_generation_attempts
  drop constraint if exists blog_generation_attempts_attempt_number_v5_check;
alter table public.blog_generation_attempts
  add constraint blog_generation_attempts_attempt_number_v3_check
    check (attempt_number between 1 and 3);

alter table public.blog_ai_budget_reservations
  drop constraint if exists blog_ai_budget_reservations_attempt_number_v5_check;
alter table public.blog_ai_budget_reservations
  add constraint blog_ai_budget_reservations_attempt_number_v3_check
    check (attempt_number between 1 and 3);

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
    or p_attempt_number not between 1 and 3
    or p_provider <> 'deepseek'
    or p_stage not in ('draft_flash', 'rewrite_pro_high', 'rewrite_pro_max') then
    raise exception 'invalid_blog_ai_budget_reservation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('blog-ai-budget:' || p_budget_day_kst::text, 0));

  select * into v_existing
  from public.blog_ai_budget_reservations
  where queue_id = p_queue_id and attempt_number = p_attempt_number;

  select coalesce(sum(r.actual_usd), 0), coalesce(sum(r.reserved_usd), 0)
  into v_actual, v_reserved
  from public.blog_ai_budget_reservations r
  where r.budget_day_kst = p_budget_day_kst;

  if found and v_existing.id is not null then
    return query select v_existing.id, false,
      'attempt_budget_already_reserved'::text,
      least(p_cap_usd, v_existing.cap_usd), v_actual, v_reserved,
      v_existing.requested_usd,
      greatest(0::numeric, least(p_cap_usd, v_existing.cap_usd) - v_actual - v_reserved);
    return;
  end if;

  if v_actual + v_reserved + p_requested_usd > p_cap_usd then
    return query select null::uuid, false, 'daily_ai_cost_cap_reached'::text,
      p_cap_usd, v_actual, v_reserved, p_requested_usd,
      greatest(0::numeric, p_cap_usd - v_actual - v_reserved);
    return;
  end if;

  insert into public.blog_ai_budget_reservations (
    budget_day_kst, queue_id, attempt_number, stage, provider, model,
    cap_usd, requested_usd, reserved_usd
  ) values (
    p_budget_day_kst, p_queue_id, p_attempt_number, p_stage, p_provider, p_model,
    p_cap_usd, p_requested_usd, p_requested_usd
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

commit;

-- Dry-run before approval:
-- select max(attempt_count) from public.blog_generation_runs;
-- select max(attempt_number) from public.blog_generation_attempts;
-- select max(attempt_number) from public.blog_ai_budget_reservations;

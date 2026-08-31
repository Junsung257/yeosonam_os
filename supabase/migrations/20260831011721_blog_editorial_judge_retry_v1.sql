-- One bounded, ledgered retry for an editorial judge response that was billed
-- but could not be parsed. The retry remains distinct from article generation
-- and is still subject to the same atomic KST-day cost cap.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.blog_ai_budget_reservations
  drop constraint if exists blog_ai_budget_reservations_call_kind_check;
alter table public.blog_ai_budget_reservations
  add constraint blog_ai_budget_reservations_call_kind_check
    check (call_kind in ('generation', 'editorial_judge', 'editorial_judge_retry'));

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
    or p_call_kind not in ('generation', 'editorial_judge', 'editorial_judge_retry')
    or (p_call_kind = 'generation' and p_stage not in ('draft_flash', 'rewrite_pro_high', 'rewrite_pro_max'))
    or (p_call_kind in ('editorial_judge', 'editorial_judge_retry') and p_stage <> 'editorial_judge') then
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

comment on constraint blog_ai_budget_reservations_call_kind_check
  on public.blog_ai_budget_reservations is
  'Allows one separately ledgered editorial-judge parse retry without creating another article-generation attempt.';

commit;

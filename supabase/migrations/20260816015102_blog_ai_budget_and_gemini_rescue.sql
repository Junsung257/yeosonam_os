begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.blog_generation_runs
  drop constraint if exists blog_generation_runs_status_check;
alter table public.blog_generation_runs
  add constraint blog_generation_runs_status_check
    check (status in (
      'queued', 'generating', 'approved_for_slot', 'rewrite_pro_high', 'rewrite_pro_max',
      'rescue_gemini', 'reresearch', 'human_review', 'quarantine', 'publishing',
      'published', 'failed', 'cancelled'
    ));

alter table public.blog_generation_attempts
  drop constraint if exists blog_generation_attempts_stage_check,
  drop constraint if exists blog_generation_attempts_provider_check,
  drop constraint if exists blog_generation_attempts_model_check;

alter table public.blog_generation_attempts
  add constraint blog_generation_attempts_stage_check
    check (stage in ('draft_flash', 'rewrite_pro_high', 'rewrite_pro_max', 'rescue_gemini')),
  add constraint blog_generation_attempts_provider_check
    check (provider in ('deepseek', 'gemini')),
  add constraint blog_generation_attempts_provider_model_stage_check check (
    (
      provider = 'deepseek'
      and stage in ('draft_flash', 'rewrite_pro_high', 'rewrite_pro_max')
      and model in ('deepseek-v4-flash', 'deepseek-v4-pro')
    ) or (
      provider = 'gemini'
      and stage = 'rescue_gemini'
      and model ~ '^gemini-[a-zA-Z0-9][a-zA-Z0-9._-]*$'
    )
  );

create table if not exists public.blog_ai_budget_reservations (
  id uuid primary key default gen_random_uuid(),
  budget_day_kst date not null,
  queue_id uuid not null references public.blog_topic_queue(id) on delete cascade,
  attempt_number integer not null check (attempt_number between 1 and 3),
  stage text not null check (stage in ('draft_flash', 'rewrite_pro_high', 'rewrite_pro_max', 'rescue_gemini')),
  provider text not null check (provider in ('deepseek', 'gemini')),
  model text not null,
  cap_usd numeric(12,8) not null check (cap_usd > 0),
  requested_usd numeric(12,8) not null check (requested_usd > 0),
  reserved_usd numeric(12,8) not null check (reserved_usd >= 0),
  actual_usd numeric(12,8) not null default 0 check (actual_usd >= 0),
  status text not null default 'reserved' check (status in ('reserved', 'completed', 'failed')),
  receipt jsonb not null default '{}'::jsonb,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (queue_id, attempt_number)
);

create index if not exists idx_blog_ai_budget_reservations_day
  on public.blog_ai_budget_reservations(budget_day_kst, created_at);

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
    or p_provider not in ('deepseek', 'gemini')
    or p_stage not in ('draft_flash', 'rewrite_pro_high', 'rewrite_pro_max', 'rescue_gemini') then
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

create or replace function public.settle_blog_ai_budget_v4(
  p_reservation_id uuid,
  p_actual_usd numeric,
  p_receipt jsonb,
  p_status text,
  p_retain_reservation boolean default false
) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if p_status not in ('completed', 'failed')
    or (p_actual_usd is not null and p_actual_usd < 0) then
    raise exception 'invalid_blog_ai_budget_settlement';
  end if;

  update public.blog_ai_budget_reservations
  set
    actual_usd = coalesce(p_actual_usd, actual_usd),
    reserved_usd = case
      when p_retain_reservation or p_actual_usd is null then reserved_usd
      else 0
    end,
    receipt = coalesce(p_receipt, '{}'::jsonb),
    status = p_status,
    settled_at = now(),
    updated_at = now()
  where id = p_reservation_id;

  if not found then raise exception 'blog_ai_budget_reservation_missing'; end if;
end;
$$;

alter table public.blog_ai_budget_reservations enable row level security;
revoke all on table public.blog_ai_budget_reservations from public, anon, authenticated;
revoke all on function public.reserve_blog_ai_budget_v4(uuid,integer,text,text,text,numeric,numeric,date)
  from public, anon, authenticated;
revoke all on function public.settle_blog_ai_budget_v4(uuid,numeric,jsonb,text,boolean)
  from public, anon, authenticated;
grant select, insert, update on table public.blog_ai_budget_reservations to service_role;
grant execute on function public.reserve_blog_ai_budget_v4(uuid,integer,text,text,text,numeric,numeric,date)
  to service_role;
grant execute on function public.settle_blog_ai_budget_v4(uuid,numeric,jsonb,text,boolean)
  to service_role;
drop policy if exists blog_ai_budget_reservations_service_role on public.blog_ai_budget_reservations;
create policy blog_ai_budget_reservations_service_role
  on public.blog_ai_budget_reservations for all to service_role
  using (true) with check (true);

comment on table public.blog_ai_budget_reservations is
  'Atomic KST-day model spend reservations. Unknown provider cost retains the conservative reservation.';

commit;

-- Dry-run after migration:
-- select budget_day_kst, sum(actual_usd) actual_usd, sum(reserved_usd) reserved_usd,
--        max(cap_usd) cap_usd, count(*) calls
-- from public.blog_ai_budget_reservations
-- group by budget_day_kst order by budget_day_kst desc;

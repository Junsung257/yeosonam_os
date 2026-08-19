-- AI Control Plane P0 (additive, service-role only)
-- Apply only after the blog generation canary has BLOG_AI_CONTROL_PLANE_ENABLED=1.

create table if not exists public.ai_budget_buckets (
  id uuid primary key default gen_random_uuid(),
  scope_type text not null check (scope_type in ('global', 'workload', 'candidate')),
  scope_key text not null,
  budget_day_kst date not null,
  hard_cap_usd numeric(12,8) not null check (hard_cap_usd >= 0),
  soft_cap_usd numeric(12,8) not null check (soft_cap_usd >= 0 and soft_cap_usd <= hard_cap_usd),
  reserved_usd numeric(12,8) not null default 0 check (reserved_usd >= 0),
  settled_usd numeric(12,8) not null default 0 check (settled_usd >= 0),
  status text not null default 'active' check (status in ('active', 'warning', 'frozen')),
  updated_at timestamptz not null default now(),
  unique (scope_type, scope_key, budget_day_kst)
);

create table if not exists public.ai_call_reservations (
  id uuid primary key default gen_random_uuid(),
  root_job_id text not null,
  candidate_id text not null,
  workload text not null,
  task text not null,
  stage text not null,
  provider text not null check (provider = 'deepseek'),
  model text not null check (model in ('deepseek-v4-flash', 'deepseek-v4-pro')),
  model_class text not null check (model_class in ('flash', 'pro')),
  idempotency_key text not null unique,
  prompt_hash text not null,
  estimated_input_tokens integer not null check (estimated_input_tokens > 0),
  max_output_tokens integer not null check (max_output_tokens > 0),
  reserved_usd numeric(12,8) not null check (reserved_usd > 0),
  actual_usd numeric(12,8),
  status text not null default 'reserved' check (status in ('reserved', 'completed', 'failed', 'expired')),
  provider_request_id text,
  started_at timestamptz not null default now(),
  settled_at timestamptz,
  error_code text,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_call_receipts (
  reservation_id uuid primary key references public.ai_call_reservations(id) on delete cascade,
  success boolean not null,
  finish_reason text,
  input_tokens integer,
  cached_input_tokens integer,
  output_tokens integer,
  actual_cost_usd numeric(12,8),
  latency_ms integer,
  retry_index integer not null default 0 check (retry_index >= 0),
  trace_id text,
  response_hash text,
  error_code text,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_budget_buckets_day_scope
  on public.ai_budget_buckets (budget_day_kst, scope_type, scope_key);
create index if not exists idx_ai_call_reservations_candidate
  on public.ai_call_reservations (candidate_id, model_class, status, created_at);
create index if not exists idx_ai_call_reservations_workload_day
  on public.ai_call_reservations (workload, created_at, status);

alter table public.ai_budget_buckets enable row level security;
alter table public.ai_call_reservations enable row level security;
alter table public.ai_call_receipts enable row level security;
revoke all on table public.ai_budget_buckets from anon, authenticated;
revoke all on table public.ai_call_reservations from anon, authenticated;
revoke all on table public.ai_call_receipts from anon, authenticated;
revoke all on table public.ai_budget_buckets from public;
revoke all on table public.ai_call_reservations from public;
revoke all on table public.ai_call_receipts from public;

create or replace function public.reserve_ai_budget_v1(
  p_root_job_id text,
  p_candidate_id text,
  p_workload text,
  p_task text,
  p_stage text,
  p_provider text,
  p_model text,
  p_model_class text,
  p_idempotency_key text,
  p_prompt_hash text,
  p_estimated_input_tokens integer,
  p_max_output_tokens integer,
  p_requested_usd numeric
)
returns table (
  reservation_id uuid,
  allowed boolean,
  reason text,
  requested_usd numeric,
  reserved_usd numeric,
  remaining_usd numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  day_kst date := (now() at time zone 'Asia/Seoul')::date;
  global_bucket public.ai_budget_buckets%rowtype;
  workload_bucket public.ai_budget_buckets%rowtype;
  candidate_bucket public.ai_budget_buckets%rowtype;
  existing public.ai_call_reservations%rowtype;
  candidate_calls integer;
  pro_calls integer;
  requested numeric := round(greatest(coalesce(p_requested_usd, 0), 0)::numeric, 8);
  remaining numeric;
begin
  if p_provider <> 'deepseek' or p_model not in ('deepseek-v4-flash', 'deepseek-v4-pro') then
    return query select null::uuid, false, 'provider_not_allowed', requested, 0::numeric, 0::numeric;
    return;
  end if;
  if p_model_class not in ('flash', 'pro') or requested <= 0 then
    return query select null::uuid, false, 'invalid_budget_request', requested, 0::numeric, 0::numeric;
    return;
  end if;

  select * into existing from public.ai_call_reservations r
    where r.idempotency_key = p_idempotency_key for update;
  if found then
    return query select existing.id, false,
      case when existing.status = 'reserved' then 'duplicate_inflight' else 'duplicate_completed' end,
      existing.reserved_usd, existing.reserved_usd, 0::numeric;
    return;
  end if;

  insert into public.ai_budget_buckets(scope_type, scope_key, budget_day_kst, hard_cap_usd, soft_cap_usd)
    values ('global', 'all', day_kst, 1.50, 0.90)
    on conflict (scope_type, scope_key, budget_day_kst) do nothing;
  insert into public.ai_budget_buckets(scope_type, scope_key, budget_day_kst, hard_cap_usd, soft_cap_usd)
    values ('workload', p_workload, day_kst, 1.50, 0.90)
    on conflict (scope_type, scope_key, budget_day_kst) do nothing;
  insert into public.ai_budget_buckets(scope_type, scope_key, budget_day_kst, hard_cap_usd, soft_cap_usd)
    values ('candidate', p_candidate_id, day_kst, 0.08, 0.06)
    on conflict (scope_type, scope_key, budget_day_kst) do nothing;

  -- Stable lock order prevents global/workload/candidate deadlocks.
  select * into global_bucket from public.ai_budget_buckets
    where scope_type = 'global' and scope_key = 'all' and budget_day_kst = day_kst for update;
  select * into workload_bucket from public.ai_budget_buckets
    where scope_type = 'workload' and scope_key = p_workload and budget_day_kst = day_kst for update;
  select * into candidate_bucket from public.ai_budget_buckets
    where scope_type = 'candidate' and scope_key = p_candidate_id and budget_day_kst = day_kst for update;

  if global_bucket.status = 'frozen' or workload_bucket.status = 'frozen' or candidate_bucket.status = 'frozen' then
    return query select null::uuid, false, 'budget_frozen', requested, 0::numeric, 0::numeric;
    return;
  end if;

  select count(*) into candidate_calls from public.ai_call_reservations r
    where r.candidate_id = p_candidate_id and r.model_class = p_model_class
      -- A provider failure is still a paid-provider attempt. Counting it
      -- prevents an outer cron retry from bypassing the one Flash/one Pro cap.
      and r.status in ('reserved', 'completed', 'failed');
  if candidate_calls >= 1 then
    return query select null::uuid, false, 'candidate_model_call_cap', requested, 0::numeric, 0::numeric;
    return;
  end if;

  if p_model_class = 'pro' then
    select count(*) into pro_calls
    from public.ai_call_reservations r
    where r.workload = p_workload
      and (r.created_at at time zone 'Asia/Seoul')::date = day_kst
      and r.model_class = 'pro'
      and r.status in ('reserved', 'completed', 'failed');
    if pro_calls >= 10 then
      return query select null::uuid, false, 'pro_daily_call_cap', requested, 0::numeric, 0::numeric;
      return;
    end if;
  end if;

  if global_bucket.reserved_usd + global_bucket.settled_usd + requested > global_bucket.hard_cap_usd
    or workload_bucket.reserved_usd + workload_bucket.settled_usd + requested > workload_bucket.hard_cap_usd
    or candidate_bucket.reserved_usd + candidate_bucket.settled_usd + requested > candidate_bucket.hard_cap_usd then
    remaining := greatest(0, least(
      global_bucket.hard_cap_usd - global_bucket.reserved_usd - global_bucket.settled_usd,
      workload_bucket.hard_cap_usd - workload_bucket.reserved_usd - workload_bucket.settled_usd,
      candidate_bucket.hard_cap_usd - candidate_bucket.reserved_usd - candidate_bucket.settled_usd
    ));
    return query select null::uuid, false, 'budget_cap_reached', requested, 0::numeric, remaining;
    return;
  end if;

  insert into public.ai_call_reservations(
    root_job_id, candidate_id, workload, task, stage, provider, model, model_class,
    idempotency_key, prompt_hash, estimated_input_tokens, max_output_tokens, reserved_usd
  ) values (
    p_root_job_id, p_candidate_id, p_workload, p_task, p_stage, p_provider, p_model, p_model_class,
    p_idempotency_key, p_prompt_hash, p_estimated_input_tokens, p_max_output_tokens, requested
  ) returning id into reservation_id;

  update public.ai_budget_buckets set reserved_usd = reserved_usd + requested, updated_at = now()
    where id in (global_bucket.id, workload_bucket.id, candidate_bucket.id);
  remaining := least(
    global_bucket.hard_cap_usd - global_bucket.reserved_usd - global_bucket.settled_usd - requested,
    workload_bucket.hard_cap_usd - workload_bucket.reserved_usd - workload_bucket.settled_usd - requested,
    candidate_bucket.hard_cap_usd - candidate_bucket.reserved_usd - candidate_bucket.settled_usd - requested
  );
  return query select reservation_id, true, 'reserved', requested, requested, greatest(0, remaining);
end;
$$;

create or replace function public.settle_ai_budget_v1(
  p_reservation_id uuid,
  p_success boolean,
  p_finish_reason text,
  p_input_tokens integer,
  p_cached_input_tokens integer,
  p_output_tokens integer,
  p_actual_cost_usd numeric,
  p_latency_ms integer,
  p_provider_request_id text,
  p_response_hash text,
  p_error_code text,
  p_idempotency_key text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  reservation public.ai_call_reservations%rowtype;
  actual numeric;
begin
  select * into reservation from public.ai_call_reservations where id = p_reservation_id for update;
  if not found then raise exception 'ai_reservation_not_found'; end if;
  if reservation.status <> 'reserved' then return; end if;

  actual := case when p_actual_cost_usd is null then null else greatest(0, round(p_actual_cost_usd::numeric, 8)) end;
  update public.ai_call_reservations set
    status = case when p_success then 'completed' else 'failed' end,
    actual_usd = actual,
    provider_request_id = p_provider_request_id,
    settled_at = now(),
    error_code = p_error_code
  where id = p_reservation_id;

  insert into public.ai_call_receipts(
    reservation_id, success, finish_reason, input_tokens, cached_input_tokens, output_tokens,
    actual_cost_usd, latency_ms, response_hash, error_code
  ) values (
    p_reservation_id, coalesce(p_success, false), p_finish_reason, p_input_tokens,
    p_cached_input_tokens, p_output_tokens, actual, p_latency_ms, p_response_hash, p_error_code
  ) on conflict (reservation_id) do update set
    success = excluded.success,
    finish_reason = excluded.finish_reason,
    input_tokens = excluded.input_tokens,
    cached_input_tokens = excluded.cached_input_tokens,
    output_tokens = excluded.output_tokens,
    actual_cost_usd = excluded.actual_cost_usd,
    latency_ms = excluded.latency_ms,
    response_hash = excluded.response_hash,
    error_code = excluded.error_code;

  -- Unknown usage retains the conservative reservation until the day closes.
  if actual is not null then
    update public.ai_budget_buckets b set
      reserved_usd = greatest(0, b.reserved_usd - reservation.reserved_usd),
      settled_usd = b.settled_usd + actual,
      updated_at = now()
    where b.budget_day_kst = (reservation.created_at at time zone 'Asia/Seoul')::date
      and ((b.scope_type = 'global' and b.scope_key = 'all')
        or (b.scope_type = 'workload' and b.scope_key = reservation.workload)
        or (b.scope_type = 'candidate' and b.scope_key = reservation.candidate_id));
  end if;
end;
$$;

create or replace function public.expire_stale_ai_reservations_v1(p_older_than_minutes integer default 30)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare changed integer;
begin
  update public.ai_call_reservations
    set status = 'expired', settled_at = now(), error_code = 'reservation_expired'
    where status = 'reserved'
      and started_at < now() - make_interval(mins => greatest(1, p_older_than_minutes));
  get diagnostics changed = row_count;
  return changed;
end;
$$;

create or replace function public.freeze_ai_workload_v1(p_workload text, p_budget_day_kst date default (now() at time zone 'Asia/Seoul')::date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare changed integer;
begin
  update public.ai_budget_buckets set status = 'frozen', updated_at = now()
    where budget_day_kst = p_budget_day_kst
      and (scope_type = 'global' or (scope_type = 'workload' and scope_key = p_workload));
  get diagnostics changed = row_count;
  return changed;
end;
$$;

revoke all on function public.reserve_ai_budget_v1(text,text,text,text,text,text,text,text,text,text,integer,integer,numeric) from public, anon, authenticated;
revoke all on function public.settle_ai_budget_v1(uuid,boolean,text,integer,integer,integer,numeric,integer,text,text,text,text) from public, anon, authenticated;
revoke all on function public.expire_stale_ai_reservations_v1(integer) from public, anon, authenticated;
revoke all on function public.freeze_ai_workload_v1(text,date) from public, anon, authenticated;
grant execute on function public.reserve_ai_budget_v1(text,text,text,text,text,text,text,text,text,text,integer,integer,numeric) to service_role;
grant execute on function public.settle_ai_budget_v1(uuid,boolean,text,integer,integer,integer,numeric,integer,text,text,text,text) to service_role;
grant execute on function public.expire_stale_ai_reservations_v1(integer) to service_role;
grant execute on function public.freeze_ai_workload_v1(text,date) to service_role;

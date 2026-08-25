-- Blog V4 forward migration: make every fatal/quality terminal path use one
-- idempotent, fenced transition that clears the lease and preserves lineage.

-- 20260823020000 already installed this function with a composite return type.
-- PostgreSQL cannot change a function's return type with CREATE OR REPLACE, so
-- replace the exact signature explicitly while preserving that contract.
drop function if exists public.requeue_blog_content_operation_v4(uuid);

create or replace function public.requeue_blog_content_operation_v4(
  p_operation_id uuid
) returns public.blog_content_operations
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_operation public.blog_content_operations%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('blog-operation:' || p_operation_id::text, 0));
  select * into v_operation
  from public.blog_content_operations
  where id = p_operation_id
  for update;
  if v_operation.id is null then
    raise exception 'blog_content_operation_not_found';
  end if;

  if v_operation.status = 'research_backlog' then
    update public.blog_content_operations
    set status = 'queued',
        current_stage = 'demand_verified',
        failure_code = null,
        skip_reason = null,
        workflow_run_id = null,
        lease_owner = null,
        lease_expires_at = null,
        started_at = null,
        completed_at = null,
        updated_at = now()
    where id = p_operation_id
    returning * into v_operation;
  elsif v_operation.status = 'running'
    and (v_operation.lease_expires_at is null or v_operation.lease_expires_at < now()) then
    update public.blog_content_operations
    set status = 'queued',
        current_stage = 'demand_verified',
        fencing_token = fencing_token + 1,
        lease_owner = null,
        lease_expires_at = null,
        workflow_run_id = null,
        completed_at = null,
        updated_at = now()
    where id = p_operation_id
    returning * into v_operation;
  elsif v_operation.status <> 'queued' then
    raise exception 'blog_content_operation_not_requeueable:%', v_operation.status;
  end if;

  if v_operation.queue_id is not null then
    update public.blog_topic_queue
    set status = 'queued',
        updated_at = now()
    where id = v_operation.queue_id
      and status in ('generating', 'queued');
  end if;
  return v_operation;
end;
$$;

revoke all on function public.requeue_blog_content_operation_v4(uuid) from public, anon, authenticated;
grant execute on function public.requeue_blog_content_operation_v4(uuid) to service_role;

create or replace function public.terminalize_blog_content_operation_v4(
  p_operation_id uuid,
  p_fencing_token bigint,
  p_lease_owner text,
  p_terminal_status text,
  p_stage text,
  p_event_key text,
  p_failure_code text,
  p_skip_reason text,
  p_generation_run_id uuid,
  p_creative_id uuid,
  p_evidence jsonb
) returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_operation public.blog_content_operations%rowtype;
  v_event_id uuid;
  v_event_status text;
begin
  if p_terminal_status not in (
    'failed', 'human_review', 'approved_for_slot',
    'research_backlog', 'quarantined', 'cancelled'
  ) then
    raise exception 'invalid_blog_content_terminal_status';
  end if;
  if nullif(btrim(p_lease_owner), '') is null or nullif(btrim(p_event_key), '') is null then
    raise exception 'invalid_blog_content_terminalization_contract';
  end if;

  select * into v_operation
  from public.blog_content_operations
  where id = p_operation_id
  for update;
  if v_operation.id is null or v_operation.fencing_token <> p_fencing_token then
    raise exception 'blog_content_operation_fencing_conflict';
  end if;

  select id into v_event_id
  from public.blog_content_stage_events
  where operation_id = p_operation_id and event_key = p_event_key;
  if v_event_id is not null then
    return v_event_id;
  end if;

  if v_operation.lease_owner is distinct from p_lease_owner
    or v_operation.status not in ('running', 'publishing') then
    raise exception 'blog_content_operation_not_terminalizable';
  end if;

  v_event_status := case
    when p_terminal_status in ('human_review', 'approved_for_slot', 'research_backlog') then 'succeeded'
    when p_terminal_status = 'cancelled' then 'skipped'
    else 'failed'
  end;

  insert into public.blog_content_stage_events (
    operation_id, event_key, fencing_token, stage, status, failure_code,
    evidence, occurred_at
  ) values (
    p_operation_id, p_event_key, p_fencing_token, p_stage, v_event_status,
    nullif(btrim(p_failure_code), ''), coalesce(p_evidence, '{}'::jsonb), now()
  ) returning id into v_event_id;

  update public.blog_content_operations
  set status = p_terminal_status,
      current_stage = p_stage,
      failure_code = coalesce(nullif(btrim(p_failure_code), ''), failure_code),
      skip_reason = coalesce(nullif(btrim(p_skip_reason), ''), skip_reason),
      generation_run_id = coalesce(p_generation_run_id, generation_run_id),
      creative_id = coalesce(p_creative_id, creative_id),
      lease_owner = null,
      lease_expires_at = null,
      completed_at = coalesce(completed_at, now()),
      updated_at = now()
  where id = p_operation_id;

  return v_event_id;
end;
$$;

grant execute on function public.terminalize_blog_content_operation_v4(
  uuid, bigint, text, text, text, text, text, text, uuid, uuid, jsonb
) to service_role;

-- Blog V4 publication retry handoff.
-- A transient public-provider or persistence failure must return both the
-- generation run and its fenced content operation to the publication queue as
-- one transaction. This avoids an orphaned publishing lease or a run that the
-- next controller pass can no longer see.

begin;

create or replace function public.retry_blog_content_operation_publication_v4(
  p_operation_id uuid,
  p_fencing_token bigint,
  p_lease_owner text,
  p_event_key text,
  p_failure_code text,
  p_evidence jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_operation public.blog_content_operations%rowtype;
  v_event_id uuid;
begin
  if nullif(btrim(p_lease_owner), '') is null
    or nullif(btrim(p_event_key), '') is null
    or nullif(btrim(p_failure_code), '') is null then
    raise exception 'invalid_blog_content_publication_retry_contract';
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
    or v_operation.status <> 'publishing'
    or v_operation.generation_run_id is null then
    raise exception 'blog_content_operation_publication_not_retryable';
  end if;

  insert into public.blog_content_stage_events (
    operation_id, event_key, fencing_token, stage, status, failure_code,
    evidence, occurred_at
  ) values (
    p_operation_id, p_event_key, p_fencing_token, 'publishing',
    'retryable_failure', nullif(btrim(p_failure_code), ''),
    coalesce(p_evidence, '{}'::jsonb), now()
  ) returning id into v_event_id;

  update public.blog_generation_runs
  set status = 'approved_for_slot',
      disposition = 'publication_retryable',
      last_error = nullif(btrim(p_failure_code), ''),
      lease_owner = null,
      lease_expires_at = null,
      updated_at = now()
  where id = v_operation.generation_run_id
    and status = 'publishing';
  if not found then
    raise exception 'blog_content_operation_generation_run_retry_race';
  end if;

  update public.blog_content_operations
  set status = 'approved_for_slot',
      current_stage = 'approved_for_slot',
      publication_status = 'queued',
      failure_code = nullif(btrim(p_failure_code), ''),
      skip_reason = null,
      lease_owner = null,
      lease_expires_at = null,
      completed_at = null,
      updated_at = now()
  where id = p_operation_id;

  return v_event_id;
end;
$$;

revoke all on function public.retry_blog_content_operation_publication_v4(uuid, bigint, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.retry_blog_content_operation_publication_v4(uuid, bigint, text, text, text, jsonb)
  to service_role;

commit;

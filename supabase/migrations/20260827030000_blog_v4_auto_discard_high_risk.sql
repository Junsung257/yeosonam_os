-- Blog V4 high-risk automation policy.
-- High-risk operations are discarded before any model call. Terminalization
-- also retires the source queue row so the scheduler cannot present it again.

begin;

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
  v_operation_state jsonb := coalesce(p_evidence -> 'operationState', '{}'::jsonb);
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
    -- A replay may observe an event written by an earlier attempt before the
    -- source queue retirement completed. Re-apply the terminal queue
    -- projection so replay remains safe and idempotent.
    if p_terminal_status = 'quarantined' and v_operation.queue_id is not null then
      update public.blog_topic_queue
      set status = 'skipped',
          last_error = coalesce(nullif(btrim(p_failure_code), ''), last_error),
          meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
            'blog_v4_disposition', case
              when p_skip_reason = 'high_risk_auto_discarded'
                or p_skip_reason = 'high_risk_topic_auto_discarded'
                then 'auto_discarded'
              else 'quality_blocked'
            end,
            'blog_v4_disposition_reason', coalesce(nullif(btrim(p_skip_reason), ''), p_failure_code),
            'blog_v4_disposed_at', now()
          ),
          updated_at = now()
      where id = v_operation.queue_id
        and status in ('queued', 'generating', 'deferred', 'pending_review');
    end if;
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
      generation_status = coalesce(nullif(v_operation_state ->> 'generationStatus', ''), generation_status),
      review_status = coalesce(nullif(v_operation_state ->> 'reviewStatus', ''), review_status),
      publication_status = coalesce(nullif(v_operation_state ->> 'publicationStatus', ''), publication_status),
      indexing_status = coalesce(nullif(v_operation_state ->> 'indexingStatus', ''), indexing_status),
      lease_owner = null,
      lease_expires_at = null,
      completed_at = coalesce(completed_at, now()),
      updated_at = now()
  where id = p_operation_id;

  if p_terminal_status = 'quarantined' and v_operation.queue_id is not null then
    update public.blog_topic_queue
    set status = 'skipped',
        last_error = coalesce(nullif(btrim(p_failure_code), ''), last_error),
        meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
          'blog_v4_disposition', case
            when p_skip_reason = 'high_risk_auto_discarded'
              or p_skip_reason = 'high_risk_topic_auto_discarded'
              then 'auto_discarded'
            else 'quality_blocked'
          end,
          'blog_v4_disposition_reason', coalesce(nullif(btrim(p_skip_reason), ''), p_failure_code),
          'blog_v4_disposed_at', now()
        ),
        updated_at = now()
    where id = v_operation.queue_id
      and status in ('queued', 'generating', 'deferred', 'pending_review');
  end if;

  return v_event_id;
end;
$$;

grant execute on function public.terminalize_blog_content_operation_v4(
  uuid, bigint, text, text, text, text, text, text, uuid, uuid, jsonb
) to service_role;

commit;

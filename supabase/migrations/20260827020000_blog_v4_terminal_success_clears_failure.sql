-- Blog V4: a successful terminal projection must not retain a transient
-- failure from an earlier bounded attempt.
-- This is additive and intentionally leaves failed/review terminal reasons
-- intact.

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
  v_operation_state jsonb := coalesce(p_event -> 'evidence' -> 'operationState', '{}'::jsonb);
  v_generation_status text := coalesce(
    nullif(v_operation_state ->> 'generationStatus', ''),
    nullif(v_operation_state ->> 'generation_status', '')
  );
  v_review_status text := coalesce(
    nullif(v_operation_state ->> 'reviewStatus', ''),
    nullif(v_operation_state ->> 'review_status', '')
  );
  v_publication_status text := coalesce(
    nullif(v_operation_state ->> 'publicationStatus', ''),
    nullif(v_operation_state ->> 'publication_status', '')
  );
  v_indexing_status text := coalesce(
    nullif(v_operation_state ->> 'indexingStatus', ''),
    nullif(v_operation_state ->> 'indexing_status', '')
  );
  v_final_revision_id text := coalesce(
    nullif(v_operation_state ->> 'finalRevisionId', ''),
    nullif(v_operation_state ->> 'final_revision_id', '')
  );
  v_final_quality_decision_id text := coalesce(
    nullif(v_operation_state ->> 'finalQualityDecisionId', ''),
    nullif(v_operation_state ->> 'final_quality_decision_id', '')
  );
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
        -- A completed or approved operation is a success projection. Clear a
        -- prior transient retry marker unless this event explicitly supplies
        -- a terminal failure code.
        failure_code = case
          when coalesce(v_next_status, status) in ('completed', 'approved_for_slot')
            and nullif(btrim(p_event ->> 'failure_code'), '') is null then null
          else coalesce(nullif(p_event ->> 'failure_code', ''), failure_code)
        end,
        skip_reason = coalesce(nullif(p_event ->> 'skip_reason', ''), skip_reason),
        generation_run_id = coalesce(nullif(p_event ->> 'generation_run_id', '')::uuid, generation_run_id),
        creative_id = coalesce(nullif(p_event ->> 'creative_id', '')::uuid, creative_id),
        generation_status = coalesce(v_generation_status, generation_status),
        review_status = coalesce(v_review_status, review_status),
        publication_status = coalesce(v_publication_status, publication_status),
        indexing_status = coalesce(v_indexing_status, indexing_status),
        final_revision_id = coalesce(nullif(v_final_revision_id, '')::uuid, final_revision_id),
        final_quality_decision_id = coalesce(nullif(v_final_quality_decision_id, '')::uuid, final_quality_decision_id),
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

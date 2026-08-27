-- Allow one bounded quality-repair rerun for a staging canary that already
-- owns a pending-review draft. Production and normal human-review operations
-- remain terminal and cannot be requeued through this RPC.
create or replace function public.requeue_blog_content_operation_v4(
  p_operation_id uuid
) returns public.blog_content_operations
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_operation public.blog_content_operations%rowtype;
  v_queue public.blog_topic_queue%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('blog-operation:' || p_operation_id::text, 0));

  select * into v_operation
  from public.blog_content_operations
  where id = p_operation_id
  for update;
  if v_operation.id is null then
    raise exception 'blog_content_operation_not_found';
  end if;

  if v_operation.queue_id is not null then
    select * into v_queue
    from public.blog_topic_queue
    where id = v_operation.queue_id
    for update;
  end if;

  if v_operation.status = 'research_backlog' then
    update public.blog_content_operations
    set status = 'queued',
        current_stage = 'demand_verified',
        failure_code = null,
        skip_reason = null,
        workflow_run_id = null,
        generation_run_id = null,
        creative_id = null,
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
        generation_run_id = null,
        creative_id = null,
        completed_at = null,
        updated_at = now()
    where id = p_operation_id
    returning * into v_operation;
  elsif v_operation.status = 'human_review'
    and v_queue.id is not null
    and v_queue.source = 'user_seed'
    and coalesce(v_queue.meta ->> 'blog_v4_staging_seed', '') <> ''
    and v_queue.meta ->> 'publication_disposition' = 'draft_only' then
    update public.blog_content_operations
    set status = 'queued',
        current_stage = 'demand_verified',
        failure_code = null,
        skip_reason = null,
        workflow_run_id = null,
        generation_run_id = null,
        creative_id = null,
        lease_owner = null,
        lease_expires_at = null,
        started_at = null,
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
        last_error = null,
        updated_at = now()
    where id = v_operation.queue_id
      and (
        status in ('generating', 'queued')
        or (
          status = 'pending_review'
          and source = 'user_seed'
          and coalesce(meta ->> 'blog_v4_staging_seed', '') <> ''
          and meta ->> 'publication_disposition' = 'draft_only'
        )
      );
  end if;
  return v_operation;
end;
$$;

revoke all on function public.requeue_blog_content_operation_v4(uuid) from public, anon, authenticated;
grant execute on function public.requeue_blog_content_operation_v4(uuid) to service_role;

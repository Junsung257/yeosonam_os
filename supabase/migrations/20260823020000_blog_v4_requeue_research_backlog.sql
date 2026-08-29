-- Research backlog is a retryable operational state, not a terminal dead end.
-- Requeue only that state so a later run can re-use the idempotent operation
-- after sources, credentials, or provider availability have been repaired.
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
  elsif v_operation.status <> 'queued' then
    raise exception 'blog_content_operation_not_requeueable:%', v_operation.status;
  end if;

  return v_operation;
end;
$$;

revoke all on function public.requeue_blog_content_operation_v4(uuid) from public, anon, authenticated;
grant execute on function public.requeue_blog_content_operation_v4(uuid) to service_role;

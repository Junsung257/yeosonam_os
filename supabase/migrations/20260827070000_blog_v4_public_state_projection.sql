-- Blog V4 public lifecycle projection.
-- Commercial publication is finalized in one RPC and indexing is finalized by
-- another RPC. This projection keeps the explicit generation/publication/
-- indexing columns in sync with those durable terminal transitions.

begin;

create or replace function public.project_blog_content_operation_public_state_v4(
  p_operation_id uuid,
  p_generation_run_id uuid,
  p_creative_id uuid,
  p_final_revision_id uuid,
  p_final_quality_decision_id uuid
) returns boolean
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
  if v_operation.id is null then raise exception 'blog_content_operation_not_found'; end if;
  if v_operation.status not in ('published', 'indexed') then
    raise exception 'blog_content_operation_public_state_not_terminal';
  end if;

  update public.blog_content_operations
  set generation_run_id = coalesce(p_generation_run_id, generation_run_id),
      creative_id = coalesce(p_creative_id, creative_id),
      final_revision_id = coalesce(p_final_revision_id, final_revision_id),
      final_quality_decision_id = coalesce(p_final_quality_decision_id, final_quality_decision_id),
      generation_status = 'succeeded',
      review_status = 'not_required',
      publication_status = 'published',
      indexing_status = case when status = 'indexed' then 'succeeded' else 'queued' end,
      updated_at = now()
  where id = p_operation_id;
  return true;
end;
$$;

create or replace function public.mark_blog_content_operation_indexed_v4(
  p_indexing_job_id uuid
) returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_job public.blog_indexing_jobs%rowtype;
  v_operation public.blog_content_operations%rowtype;
begin
  select * into v_job from public.blog_indexing_jobs
  where id = p_indexing_job_id and status = 'succeeded';
  if v_job.id is null or v_job.content_creative_id is null then return false; end if;

  select * into v_operation from public.blog_content_operations
  where creative_id = v_job.content_creative_id and status in ('published', 'indexed')
  order by completed_at desc nulls last, created_at desc limit 1 for update;
  if v_operation.id is null then return false; end if;
  if v_operation.status = 'indexed' then
    update public.blog_content_operations
    set generation_status = 'succeeded',
        review_status = 'not_required',
        publication_status = 'published',
        indexing_status = 'succeeded',
        updated_at = now()
    where id = v_operation.id;
    return true;
  end if;

  insert into public.blog_content_stage_events (
    operation_id, event_key, fencing_token, stage, status, evidence
  ) values (
    v_operation.id, 'indexing:succeeded:' || p_indexing_job_id::text,
    v_operation.fencing_token, 'indexed', 'succeeded',
    jsonb_build_object('indexing_job_id', p_indexing_job_id, 'url', v_job.url)
  ) on conflict (operation_id, event_key) do nothing;

  update public.blog_content_operations
  set status = 'indexed', current_stage = 'indexed', completed_at = now(), updated_at = now(),
      generation_status = 'succeeded', review_status = 'not_required',
      publication_status = 'published', indexing_status = 'succeeded'
  where id = v_operation.id and status = 'published';
  return true;
end;
$$;

revoke all on function public.project_blog_content_operation_public_state_v4(uuid, uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.project_blog_content_operation_public_state_v4(uuid, uuid, uuid, uuid, uuid)
  to service_role;
revoke all on function public.mark_blog_content_operation_indexed_v4(uuid)
  from public, anon, authenticated;
grant execute on function public.mark_blog_content_operation_indexed_v4(uuid)
  to service_role;

commit;

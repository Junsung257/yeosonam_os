-- Blog V4 durable content factory rollback.
-- Run only after the application feature flag is disabled and evidence is exported.
-- This script aborts when any operation is still active or approved for publication.

begin;

do $$
declare
  v_active bigint;
begin
  if to_regclass('public.blog_content_operations') is null then return; end if;
  select count(*) into v_active
  from public.blog_content_operations
  where status in ('queued', 'running', 'approved_for_slot', 'publishing');
  if v_active > 0 then
    raise exception 'blog_content_factory_rollback_blocked_active_operations:%', v_active;
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.blog_content_stage_events') is not null then
    execute 'drop trigger if exists trg_blog_content_stage_events_append_only on public.blog_content_stage_events';
  end if;
end;
$$;

drop function if exists public.record_blog_content_stage_event_v4(uuid,bigint,text,jsonb);
drop function if exists public.mark_blog_content_operation_indexed_v4(uuid);
drop function if exists public.publish_blog_commercial_operation_v4(uuid,bigint,text,uuid,uuid,uuid,text,timestamptz);
drop function if exists public.claim_blog_content_operation_publication_v4(uuid,text,date,integer,integer,integer);
drop function if exists public.bind_blog_content_operation_workflow_v4(uuid,bigint,text,text);
drop function if exists public.claim_blog_content_operation_v4(uuid,text,integer);
drop function if exists public.materialize_blog_content_operation_v4(jsonb,jsonb,jsonb);
drop function if exists public.prevent_blog_content_stage_event_mutation_v4();

drop table if exists public.blog_content_stage_events;
drop table if exists public.blog_content_operations;
drop table if exists public.blog_demand_cluster_signals;
drop table if exists public.blog_demand_clusters;
drop function if exists public.transition_blog_publication_rollout_stage_v1(text,text,text,bigint,text,integer,text,text,text,text);
drop table if exists public.blog_publication_rollout_manual_transitions;

commit;

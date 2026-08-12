-- Keep the shadow backfill ledger terminal in the same transaction as the
-- authoritative V6 job and prefer evidence-rich legacy rows for bounded canaries.
-- This migration never publishes or changes the publication freeze.

create or replace function internal_product_registration.sync_one_legacy_backfill_terminal_state()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
begin
  if new.v6_analysis_outcome is null then
    return new;
  end if;

  update internal_product_registration.legacy_backfill_jobs b
  set status = case new.v6_analysis_outcome
        when 'verified' then 'verified'
        when 'degraded' then 'degraded'
        when 'blocked' then 'blocked'
        else b.status
      end,
      terminal_at = coalesce(new.v6_terminal_at, now()),
      last_error = case
        when new.v6_analysis_outcome = 'blocked' then array_to_string(
          array(select jsonb_array_elements_text(coalesce(new.v6_blockers, '[]'::jsonb))),
          '|'
        )
        else null
      end,
      updated_at = now()
  where b.workflow_job_id = new.id
    and b.status in ('reserved', 'started');

  return new;
end;
$$;

drop trigger if exists trg_sync_legacy_backfill_terminal_state on public.upload_jobs;
create trigger trg_sync_legacy_backfill_terminal_state
after insert or update of v6_analysis_outcome, v6_terminal_at, v6_blockers
on public.upload_jobs
for each row
when (new.v6_analysis_outcome is not null)
execute function internal_product_registration.sync_one_legacy_backfill_terminal_state();

revoke all on function internal_product_registration.sync_one_legacy_backfill_terminal_state()
  from public, anon, authenticated;

create or replace function public.claim_product_registration_legacy_backfill(p_limit integer default 10)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare
  v_result jsonb;
begin
  perform internal_product_registration.sync_legacy_backfill_terminal_states();
  with candidates as (
    select p.tenant_id, p.catalog_product_id, p.id as package_id
    from public.travel_packages p
    left join internal_product_registration.legacy_backfill_jobs b
      on b.tenant_id = p.tenant_id and b.catalog_product_id = p.catalog_product_id
    where p.catalog_product_id is not null
      and p.tenant_id is not null
      and (
        b.id is null
        or (b.status = 'failed' and b.attempt_count < 3 and b.updated_at < now() - interval '30 minutes')
      )
    order by
      (
        case when length(btrim(coalesce(p.raw_text, ''))) >= 50 then 100 else 0 end
        + case when coalesce(p.raw_text, '') ~* '(DAY\s*[0-9]+|[0-9]+\s*일차)' then 20 else 0 end
        + case when coalesce(p.raw_text, '') ~ '[0-9]{1,3}(,[0-9]{3})+' then 20 else 0 end
        + case when coalesce(p.raw_text, '') ~* '(포함|INCLUSION)' then 10 else 0 end
        + case when coalesce(p.raw_text, '') ~* '(불포함|EXCLUSION)' then 10 else 0 end
        + least(20, length(coalesce(p.raw_text, '')) / 1000)
      ) desc,
      p.created_at desc,
      p.id
    for update of p skip locked
    limit greatest(1, least(coalesce(p_limit, 10), 25))
  ), claimed as (
    insert into internal_product_registration.legacy_backfill_jobs (
      tenant_id, catalog_product_id, package_id, status, attempt_count, last_error, updated_at
    )
    select tenant_id, catalog_product_id, package_id, 'reserved', 1, null, now()
    from candidates
    on conflict (tenant_id, catalog_product_id) do update
      set status = 'reserved',
          attempt_count = internal_product_registration.legacy_backfill_jobs.attempt_count + 1,
          last_error = null,
          updated_at = now(),
          workflow_job_id = null,
          workflow_run_id = null,
          source_document_id = null,
          terminal_at = null
      where internal_product_registration.legacy_backfill_jobs.status = 'failed'
        and internal_product_registration.legacy_backfill_jobs.attempt_count < 3
    returning id, tenant_id, catalog_product_id, package_id, attempt_count
  )
  select coalesce(jsonb_agg(to_jsonb(claimed)), '[]'::jsonb) into v_result
  from claimed;
  return v_result;
end;
$$;

revoke all on function public.claim_product_registration_legacy_backfill(integer)
  from public, anon, authenticated;
grant execute on function public.claim_product_registration_legacy_backfill(integer) to service_role;

select internal_product_registration.sync_legacy_backfill_terminal_states();

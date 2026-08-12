-- A corrected parser/kernel retry must run before unseen inventory so a bounded
-- canary proves the fix immediately instead of waiting behind the entire queue.

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
      case when b.status = 'failed' then 1000 else 0 end desc,
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

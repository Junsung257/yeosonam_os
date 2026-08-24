-- Re-evaluate prior business blocks when the Registration Kernel version
-- changes. A parser/policy fix must be able to recover an old product; the
-- previous function only retried infrastructure failures, leaving valid
-- yearless-date and relation fixes permanently stranded.

create or replace function public.claim_product_registration_legacy_backfill(
  p_limit integer default 10,
  p_engine_version text default 'product-registration-v6-workflow-24'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare
  v_result jsonb;
  v_engine_version text := nullif(btrim(p_engine_version), '');
begin
  if v_engine_version is null then
    raise exception 'REGISTRATION_BACKFILL_ENGINE_VERSION_REQUIRED';
  end if;

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
        or (
          b.status = 'failed'
          and b.engine_version = v_engine_version
          and b.attempt_count < 3
          and b.updated_at < now() - interval '30 minutes'
        )
        or (
          b.status in ('failed', 'blocked')
          and b.engine_version is distinct from v_engine_version
        )
      )
    order by
      case when b.id is not null and b.engine_version is distinct from v_engine_version then 2000
           when b.status = 'failed' then 1000 else 0 end desc,
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
      tenant_id, catalog_product_id, package_id, status, attempt_count,
      total_attempt_count, engine_version, last_error, updated_at
    )
    select tenant_id, catalog_product_id, package_id, 'reserved', 1,
           1, v_engine_version, null, now()
    from candidates
    on conflict (tenant_id, catalog_product_id) do update
      set status = 'reserved',
          attempt_count = case
            when internal_product_registration.legacy_backfill_jobs.engine_version is distinct from v_engine_version then 1
            else internal_product_registration.legacy_backfill_jobs.attempt_count + 1
          end,
          total_attempt_count = internal_product_registration.legacy_backfill_jobs.total_attempt_count + 1,
          engine_version = v_engine_version,
          last_error = null,
          updated_at = now(),
          workflow_job_id = null,
          workflow_run_id = null,
          source_document_id = null,
          terminal_at = null
      where (
        internal_product_registration.legacy_backfill_jobs.status = 'failed'
        and internal_product_registration.legacy_backfill_jobs.engine_version = v_engine_version
        and internal_product_registration.legacy_backfill_jobs.attempt_count < 3
      ) or (
        internal_product_registration.legacy_backfill_jobs.status in ('failed', 'blocked')
        and internal_product_registration.legacy_backfill_jobs.engine_version is distinct from v_engine_version
      )
    returning id, tenant_id, catalog_product_id, package_id, attempt_count
  )
  select coalesce(jsonb_agg(to_jsonb(claimed)), '[]'::jsonb) into v_result
  from claimed;
  return v_result;
end;
$$;

revoke all on function public.claim_product_registration_legacy_backfill(integer, text)
  from public, anon, authenticated;
grant execute on function public.claim_product_registration_legacy_backfill(integer, text) to service_role;

revoke all on function public.claim_product_registration_legacy_backfill(integer)
  from public, anon, authenticated, service_role;

-- Product Registration: new jobs use bounded yearless-date policy v4.
-- V4 keeps upcoming dates in the current year, permits a near year-boundary
-- rollover (for example August intake -> next January), and rejects stale
-- month/day rows instead of silently publishing the same date next year.

alter table public.upload_jobs
  alter column v6_date_policy_version set default 'source-departure-date-policy-4';

comment on column public.upload_jobs.v6_date_policy_version is
  'Immutable date-resolution policy pinned per job. V4 bounds yearless rollover to the selling horizon; legacy rows are never silently upgraded.';

create or replace function internal_product_registration.reject_past_product_fact_write()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_reference_date date;
  v_policy_version text;
begin
  select j.v6_reference_date, j.v6_date_policy_version
  into v_reference_date, v_policy_version
  from public.product_registration_v5_revisions r
  join public.upload_jobs j on j.id = r.job_id
  where r.id = new.revision_id;

  if coalesce(v_policy_version, '') not in (
    'source-departure-date-policy-2',
    'source-departure-date-policy-3',
    'source-departure-date-policy-4'
  ) then
    return new;
  end if;
  if v_reference_date is null then
    raise exception 'REGISTRATION_DEPARTURE_REFERENCE_DATE_REQUIRED';
  end if;

  if tg_table_schema = 'internal_product_registration'
     and tg_table_name = 'departure_instances' then
    if new.departure_date < v_reference_date then
      raise exception 'REGISTRATION_PAST_DEPARTURE_REJECTED:%<%', new.departure_date, v_reference_date;
    end if;
    return new;
  end if;

  if tg_table_schema = 'public'
     and tg_table_name = 'product_registration_v5_price_rules' then
    if new.specific_date is not null and new.specific_date < v_reference_date then
      raise exception 'REGISTRATION_PAST_PRICE_DATE_REJECTED:%<%', new.specific_date, v_reference_date;
    end if;
    if new.effective_end is not null and new.effective_end < v_reference_date then
      raise exception 'REGISTRATION_PAST_PRICE_RANGE_REJECTED:%<%', new.effective_end, v_reference_date;
    end if;
    if new.effective_start is not null and new.effective_start < v_reference_date then
      raise exception 'REGISTRATION_UNCLIPPED_PRICE_RANGE_REJECTED:%<%', new.effective_start, v_reference_date;
    end if;
    return new;
  end if;

  raise exception 'REGISTRATION_FUTURE_DATE_GUARD_TARGET_INVALID:%.%', tg_table_schema, tg_table_name;
end;
$$;

revoke all on function internal_product_registration.reject_past_product_fact_write()
from public, anon, authenticated;

-- Product Registration V6: pin one Korea-local intake date per durable job and
-- reject any product fact write that would reintroduce an already-past sale
-- date after the application has applied the future-departure policy.

alter table public.upload_jobs
  add column if not exists v6_reference_date date,
  add column if not exists v6_date_policy_version text,
  add column if not exists v6_source_channel text;

update public.upload_jobs
set
  v6_reference_date = coalesce(v6_reference_date, timezone('Asia/Seoul', created_at)::date),
  v6_date_policy_version = coalesce(v6_date_policy_version, 'legacy'),
  v6_source_channel = coalesce(v6_source_channel, nullif(v4_stage_state->>'sourceChannel', ''), 'legacy')
where v6_reference_date is null
   or v6_date_policy_version is null
   or v6_source_channel is null;

alter table public.upload_jobs
  alter column v6_reference_date set default timezone('Asia/Seoul', now())::date,
  alter column v6_reference_date set not null,
  alter column v6_date_policy_version set default 'source-departure-date-policy-2',
  alter column v6_date_policy_version set not null,
  alter column v6_source_channel set default 'upload',
  alter column v6_source_channel set not null;

comment on column public.upload_jobs.v6_reference_date is
  'Immutable Korea-local reference date for retry-safe departure-date resolution.';
comment on column public.upload_jobs.v6_date_policy_version is
  'Date-resolution policy pinned to the job; legacy rows are never silently upgraded.';
comment on column public.upload_jobs.v6_source_channel is
  'Source channel used to decide whether yearless nearest-future inference is permitted.';

create or replace function internal_product_registration.prevent_departure_reference_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if old.v6_reference_date is distinct from new.v6_reference_date
     or old.v6_date_policy_version is distinct from new.v6_date_policy_version
     or old.v6_source_channel is distinct from new.v6_source_channel then
    raise exception 'REGISTRATION_DEPARTURE_REFERENCE_IMMUTABLE';
  end if;
  return new;
end;
$$;

revoke all on function internal_product_registration.prevent_departure_reference_mutation()
from public, anon, authenticated;

drop trigger if exists trg_product_registration_departure_reference_immutable
  on public.upload_jobs;
create trigger trg_product_registration_departure_reference_immutable
before update of v6_reference_date, v6_date_policy_version, v6_source_channel
on public.upload_jobs
for each row execute function internal_product_registration.prevent_departure_reference_mutation();

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

  if v_policy_version is distinct from 'source-departure-date-policy-2' then
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

drop trigger if exists trg_product_registration_departure_future_guard
  on internal_product_registration.departure_instances;
create trigger trg_product_registration_departure_future_guard
before insert or update of departure_date, revision_id
on internal_product_registration.departure_instances
for each row execute function internal_product_registration.reject_past_product_fact_write();

drop trigger if exists trg_product_registration_price_future_guard
  on public.product_registration_v5_price_rules;
create trigger trg_product_registration_price_future_guard
before insert or update of specific_date, effective_start, effective_end, revision_id
on public.product_registration_v5_price_rules
for each row execute function internal_product_registration.reject_past_product_fact_write();

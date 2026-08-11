-- The append-only trigger is shared by heterogeneous tables. Access optional
-- columns through row JSON so PostgreSQL does not try to resolve a field that
-- is absent from another trigger target (for example observed_at on
-- golf_rounds).

create or replace function internal_product_registration.reject_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  v_writer text := current_setting('app.product_registration_writer', true);
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
begin
  if tg_op = 'UPDATE' and v_writer = 'registration-kernel' then
    if tg_table_name = 'golf_rounds'
      and nullif(v_old->>'golf_fact_resolution_id', '') is null
      and nullif(v_new->>'golf_fact_resolution_id', '') is not null
      and (v_old - 'golf_fact_resolution_id') = (v_new - 'golf_fact_resolution_id') then
      return new;
    end if;

    if tg_table_name = 'golf_fact_observations'
      and (v_old - 'observed_at') = (v_new - 'observed_at')
      and (v_new->>'observed_at')::timestamptz >= (v_old->>'observed_at')::timestamptz then
      return new;
    end if;

    if tg_table_name = 'golf_fact_resolutions'
      and (v_old - 'observation_ids') = (v_new - 'observation_ids')
      and coalesce(v_new->'observation_ids', '[]'::jsonb)
        @> coalesce(v_old->'observation_ids', '[]'::jsonb) then
      return new;
    end if;
  end if;

  raise exception '% is append-only; insert a new V6 record instead', tg_table_name;
end;
$$;

revoke all on function internal_product_registration.reject_mutation() from public, anon, authenticated;
grant execute on function internal_product_registration.reject_mutation() to service_role;

comment on function internal_product_registration.reject_mutation() is
  'Rejects immutable-row mutation except JSON-safe registration-kernel construction transitions inside commit_revision_atomic.';

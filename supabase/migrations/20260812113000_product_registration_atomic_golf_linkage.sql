-- Keep V6 facts append-only while allowing the registration kernel to finish
-- one immutable aggregate inside the same transaction. The original commit
-- RPC must attach a newly inserted golf round to its fact resolution and may
-- merge an identical observation encountered twice in one source document.
-- Those narrowly scoped, monotonic transitions are construction-time writes;
-- every post-commit mutation remains rejected.

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
    -- The canonical commit creates the shared fact first, then finalizes the
    -- foreign-key link before the surrounding transaction is committed.
    if tg_table_name = 'golf_rounds'
      and nullif(v_old->>'golf_fact_resolution_id', '') is null
      and nullif(v_new->>'golf_fact_resolution_id', '') is not null
      and (v_old - 'golf_fact_resolution_id') = (v_new - 'golf_fact_resolution_id') then
      return new;
    end if;

    -- Repeated identical golf facts inside one document share an observation.
    -- Only its observation timestamp may move forward during the same commit.
    if tg_table_name = 'golf_fact_observations'
      and (v_old - 'observed_at') = (v_new - 'observed_at')
      and new.observed_at >= old.observed_at then
      return new;
    end if;

    -- A shared resolution may only gain observation ids; its resolved facts
    -- and provenance hashes cannot be rewritten.
    if tg_table_name = 'golf_fact_resolutions'
      and (v_old - 'observation_ids') = (v_new - 'observation_ids')
      and old.observation_ids <@ new.observation_ids then
      return new;
    end if;
  end if;

  raise exception '% is append-only; insert a new V6 record instead', tg_table_name;
end;
$$;

revoke all on function internal_product_registration.reject_mutation() from public, anon, authenticated;
grant execute on function internal_product_registration.reject_mutation() to service_role;

comment on function internal_product_registration.reject_mutation() is
  'Rejects immutable-row mutation except narrow registration-kernel construction transitions inside commit_revision_atomic.';

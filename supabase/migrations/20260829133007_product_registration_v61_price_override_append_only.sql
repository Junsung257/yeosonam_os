-- Keep the V6.1 compatibility price override append-only and idempotent.
-- V6.2 uses departure_price_lineage as the customer price authority, but V6.1
-- may still be called during a shadow rollout and must never mutate evidence.

create or replace function internal_product_registration.commit_revision_v61_knowledge_atomic(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, extensions, pg_temp
as $$
declare
  v_result jsonb;
  v_revision_id uuid;
  v_tenant_id uuid := nullif(p_payload->>'tenant_id', '')::uuid;
  v_catalog_product_id uuid;
  v_revision_hash text := p_payload->>'payload_hash';
  v_source_hash text := p_payload->>'source_hash';
  v_row jsonb;
  v_override_id uuid;
  v_override_key text;
begin
  perform set_config('app.product_registration_writer', 'registration-kernel', true);
  v_result := internal_product_registration.commit_revision_atomic(p_payload);
  v_revision_id := nullif(v_result->>'revision_id', '')::uuid;
  v_catalog_product_id := nullif(v_result->>'catalog_product_id', '')::uuid;
  if v_revision_id is null or v_catalog_product_id is null then
    raise exception 'REGISTRATION_V61_REVISION_RESULT_INVALID';
  end if;
  if coalesce(v_source_hash, '') !~ '^[0-9a-f]{64}$'
    or coalesce(v_revision_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'REGISTRATION_V61_LINEAGE_HASH_INVALID';
  end if;

  for v_row in
    select value from jsonb_array_elements(coalesce(p_payload->'departure_instances', '[]'::jsonb))
  loop
    v_override_id := null;
    v_override_key := nullif(v_row->>'price_override_key', '');
    if v_override_key is not null then
      insert into internal_product_registration.price_date_overrides (
        tenant_id, catalog_product_id, revision_id, section_index, variant_key,
        departure_date, override_key, raw_amount, adult_selling_price,
        child_selling_price, currency, pricing_state, booking_state,
        source_field_path, source_hash, revision_hash, source_ref_ids, evidence
      ) values (
        v_tenant_id, v_catalog_product_id, v_revision_id,
        (v_row->>'section_index')::integer, v_row->>'variant_key',
        (v_row->>'departure_date')::date, v_override_key,
        nullif(v_row->>'raw_amount', ''), nullif(v_row->>'adult_selling_price', '')::numeric,
        nullif(v_row->>'child_selling_price', '')::numeric,
        coalesce(nullif(v_row->>'currency', ''), 'KRW'),
        coalesce(nullif(v_row->>'pricing_state', ''), 'UNRESOLVED'),
        coalesce(nullif(v_row->>'booking_state', ''), 'UNKNOWN'),
        coalesce(nullif(v_row->>'source_field_path', ''), v_override_key),
        v_source_hash, v_revision_hash,
        coalesce(array(select jsonb_array_elements_text(coalesce(v_row->'source_ref_ids', '[]'::jsonb))), '{}'::text[]),
        coalesce(v_row->'evidence', '[]'::jsonb)
      )
      on conflict (revision_id, override_key) do nothing
      returning id into v_override_id;

      if v_override_id is null then
        select id into v_override_id
        from internal_product_registration.price_date_overrides
        where revision_id = v_revision_id and override_key = v_override_key;
      end if;

      if not exists (
        select 1
        from internal_product_registration.price_date_overrides price_override
        where price_override.id = v_override_id
          and price_override.tenant_id = v_tenant_id
          and price_override.catalog_product_id = v_catalog_product_id
          and price_override.section_index = (v_row->>'section_index')::integer
          and price_override.variant_key = v_row->>'variant_key'
          and price_override.departure_date = (v_row->>'departure_date')::date
          and price_override.raw_amount is not distinct from nullif(v_row->>'raw_amount', '')
          and price_override.adult_selling_price is not distinct from nullif(v_row->>'adult_selling_price', '')::numeric
          and price_override.child_selling_price is not distinct from nullif(v_row->>'child_selling_price', '')::numeric
          and price_override.currency = coalesce(nullif(v_row->>'currency', ''), 'KRW')
          and price_override.pricing_state = coalesce(nullif(v_row->>'pricing_state', ''), 'UNRESOLVED')
          and price_override.booking_state = coalesce(nullif(v_row->>'booking_state', ''), 'UNKNOWN')
          and price_override.source_field_path = coalesce(nullif(v_row->>'source_field_path', ''), v_override_key)
          and price_override.source_hash = v_source_hash
          and price_override.revision_hash = v_revision_hash
          and price_override.source_ref_ids = coalesce(
            array(select jsonb_array_elements_text(coalesce(v_row->'source_ref_ids', '[]'::jsonb))),
            '{}'::text[]
          )
          and price_override.evidence = coalesce(v_row->'evidence', '[]'::jsonb)
      ) then
        raise exception 'REGISTRATION_V61_OVERRIDE_IDEMPOTENCY_CONFLICT:%', v_override_key;
      end if;
    end if;

    if not exists (
      select 1
      from internal_product_registration.departure_instances departure
      where departure.revision_id = v_revision_id
        and departure.catalog_product_id = v_catalog_product_id
        and departure.section_index = (v_row->>'section_index')::integer
        and departure.variant_key = v_row->>'variant_key'
        and departure.departure_date = (v_row->>'departure_date')::date
    ) then
      raise exception 'REGISTRATION_V61_DEPARTURE_FACT_MISSING:%', v_row->>'departure_date';
    end if;
  end loop;

  for v_row in
    select value from jsonb_array_elements(coalesce(p_payload->'entity_relations', '[]'::jsonb))
  loop
    insert into internal_product_registration.product_entity_relations (
      tenant_id, catalog_product_id, product_revision_id, entity_type, role,
      source_mention, source_field_path, canonical_entity_id, entity_revision_id,
      canonical_attraction_id, approved_alias_id, match_state, match_method,
      day_indexes, candidates, evidence, source_hash
    ) values (
      v_tenant_id, v_catalog_product_id, v_revision_id,
      v_row->>'entity_type', coalesce(nullif(v_row->>'role', ''), 'UNSPECIFIED'),
      v_row->>'source_mention', v_row->>'source_field_path',
      nullif(v_row->>'canonical_entity_id', '')::uuid,
      nullif(v_row->>'entity_revision_id', '')::uuid,
      nullif(v_row->>'canonical_attraction_id', '')::uuid,
      nullif(v_row->>'approved_alias_id', '')::bigint,
      coalesce(nullif(v_row->>'match_state', ''), 'REVIEW_REQUIRED'),
      coalesce(nullif(v_row->>'match_method', ''), 'UNRESOLVED'),
      coalesce(array(select jsonb_array_elements_text(coalesce(v_row->'day_indexes', '[]'::jsonb))), '{}'::integer[]),
      coalesce(v_row->'candidates', '[]'::jsonb),
      coalesce(v_row->'evidence', '[]'::jsonb),
      coalesce(nullif(v_row->>'source_hash', ''), v_source_hash)
    ) on conflict (product_revision_id, entity_type, source_field_path, source_mention) do update set
      canonical_entity_id = excluded.canonical_entity_id,
      entity_revision_id = excluded.entity_revision_id,
      canonical_attraction_id = excluded.canonical_attraction_id,
      approved_alias_id = excluded.approved_alias_id,
      match_state = excluded.match_state,
      match_method = excluded.match_method,
      day_indexes = excluded.day_indexes,
      candidates = excluded.candidates,
      evidence = excluded.evidence;
  end loop;

  return v_result || jsonb_build_object('knowledge_ledger_version', 'product-registration-v61-knowledge-1');
end;
$$;

revoke all on function internal_product_registration.commit_revision_v61_knowledge_atomic(jsonb)
  from public, anon, authenticated;
grant execute on function internal_product_registration.commit_revision_v61_knowledge_atomic(jsonb)
  to service_role;

drop trigger if exists trg_pr_v61_price_date_overrides_immutable
  on internal_product_registration.price_date_overrides;
create trigger trg_pr_v61_price_date_overrides_immutable
  before update or delete on internal_product_registration.price_date_overrides
  for each row execute function internal_product_registration.reject_mutation();

comment on table internal_product_registration.price_date_overrides is
  'Append-only V6.1 compatibility projection. V6.2 customer price authority is departure_price_lineage.';

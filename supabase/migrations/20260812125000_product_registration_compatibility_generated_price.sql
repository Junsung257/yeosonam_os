-- products.selling_price is generated from net_price, margin_rate, and
-- discount_amount. The compatibility projection must preserve the canonical
-- customer price by deriving net_price instead of writing the generated
-- column directly.
do $migration$
declare
  v_definition text;
  v_legacy_insert_columns constant text :=
    'net_price, selling_price, margin_rate, departure_region, status,';
  v_current_insert_columns constant text :=
    'net_price, margin_rate, departure_region, status,';
  v_legacy_insert_values constant text :=
    '      0,
      nullif(v_projection->>''price'', '''')::numeric,
      coalesce(nullif(p_payload->>''commission_rate'', '''')::numeric, 0) / 100,';
  v_current_insert_values constant text :=
    '      case
        when nullif(v_projection->>''price'', '''') is null then 0
        else round(
          nullif(v_projection->>''price'', '''')::numeric
          / (1 + coalesce(nullif(p_payload->>''commission_rate'', '''')::numeric, 0) / 100)
        )::integer
      end,
      coalesce(nullif(p_payload->>''commission_rate'', '''')::numeric, 0) / 100,';
  v_legacy_update_price constant text :=
    '      selling_price = nullif(v_projection->>''price'', '''')::numeric,';
  v_current_update_price constant text :=
    '      net_price = case
        when nullif(v_projection->>''price'', '''') is null then net_price
        else round(
          (nullif(v_projection->>''price'', '''')::numeric + coalesce(discount_amount, 0))
          / (1 + coalesce(nullif(p_payload->>''commission_rate'', '''')::numeric, 0) / 100)
        )::integer
      end,';
  v_projection_guard_marker constant text :=
    '  if jsonb_typeof(v_projection) <> ''object'' then raise exception ''REGISTRATION_COMPATIBILITY_PROJECTION_INVALID''; end if;';
  v_projection_guard_replacement constant text :=
    '  if jsonb_typeof(v_projection) <> ''object'' then raise exception ''REGISTRATION_COMPATIBILITY_PROJECTION_INVALID''; end if;
  if coalesce(nullif(p_payload->>''commission_rate'', '''')::numeric, 0) <= -100 then
    raise exception ''REGISTRATION_COMPATIBILITY_MARGIN_RATE_INVALID'';
  end if;';
  v_price_assertion_marker constant text :=
    '  select count(*), min(id) into v_count, v_package_id
  from public.travel_packages';
  v_price_assertion_replacement constant text :=
    '  if nullif(v_projection->>''price'', '''') is not null and not exists (
    select 1
    from public.products projected_product
    where projected_product.tenant_id = v_tenant_id
      and projected_product.catalog_product_id = v_catalog_product_id
      and projected_product.internal_code = v_internal_code
      and projected_product.selling_price = round(nullif(v_projection->>''price'', '''')::numeric)::integer
  ) then
    raise exception ''REGISTRATION_COMPATIBILITY_SELLING_PRICE_PARITY_MISMATCH'';
  end if;

  select count(*), min(id) into v_count, v_package_id
  from public.travel_packages';
begin
  select pg_get_functiondef(
    'internal_product_registration.project_compatibility_atomic(jsonb)'::regprocedure
  ) into v_definition;

  if position(v_legacy_insert_columns in v_definition) = 0
    and position(v_current_update_price in v_definition) > 0
    and position('REGISTRATION_COMPATIBILITY_SELLING_PRICE_PARITY_MISMATCH' in v_definition) > 0 then
    return;
  end if;
  if position(v_legacy_insert_columns in v_definition) = 0
    or position(v_legacy_insert_values in v_definition) = 0
    or position(v_legacy_update_price in v_definition) = 0
    or position(v_projection_guard_marker in v_definition) = 0
    or position(v_price_assertion_marker in v_definition) = 0 then
    raise exception 'REGISTRATION_COMPATIBILITY_GENERATED_PRICE_CONTRACT_UNKNOWN';
  end if;

  v_definition := replace(v_definition, v_legacy_insert_columns, v_current_insert_columns);
  v_definition := replace(v_definition, v_legacy_insert_values, v_current_insert_values);
  v_definition := replace(v_definition, v_legacy_update_price, v_current_update_price);
  v_definition := replace(v_definition, v_projection_guard_marker, v_projection_guard_replacement);
  v_definition := replace(v_definition, v_price_assertion_marker, v_price_assertion_replacement);
  execute v_definition;
end;
$migration$;

revoke all on function internal_product_registration.project_compatibility_atomic(jsonb)
  from public, anon, authenticated;
grant execute on function internal_product_registration.project_compatibility_atomic(jsonb)
  to service_role;

comment on function internal_product_registration.project_compatibility_atomic(jsonb) is
  'Projects a revision into legacy compatibility rows with tenant/source lineage and generated selling-price parity validation.';

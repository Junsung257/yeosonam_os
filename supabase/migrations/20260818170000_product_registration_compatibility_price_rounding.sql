-- The legacy products table derives selling_price from rounded net_price.
-- For some prices (for example 479,000 at 9%), a single inverse round can
-- produce 479,001.  Keep the parity guard, but search the tiny deterministic
-- neighbourhood so canonical customer price is preserved without weakening
-- the safety check.
do $migration$
declare
  v_definition text;
  v_declaration_marker constant text := '  v_result jsonb;';
  v_declaration_replacement constant text :=
    '  v_result jsonb;
  v_target_price integer;
  v_candidate_net integer;
  v_delta integer;
  v_parity_ok boolean := false;';
  v_guard constant text := $guard$
  if nullif(v_projection->>'price', '') is not null and not exists (
    select 1
    from public.products projected_product
    where projected_product.tenant_id = v_tenant_id
      and projected_product.catalog_product_id = v_catalog_product_id
      and projected_product.internal_code = v_internal_code
      and projected_product.selling_price = round(nullif(v_projection->>'price', '')::numeric)::integer
  ) then
    raise exception 'REGISTRATION_COMPATIBILITY_SELLING_PRICE_PARITY_MISMATCH';
  end if;$guard$;
  v_replacement constant text := $replacement$
  if nullif(v_projection->>'price', '') is not null then
    v_target_price := round(nullif(v_projection->>'price', '')::numeric)::integer;
    select round(
      (v_target_price + coalesce(discount_amount, 0))
      / (1 + coalesce(nullif(p_payload->>'commission_rate', '')::numeric, 0) / 100)
    )::integer
    into v_candidate_net
    from public.products
    where tenant_id = v_tenant_id
      and catalog_product_id = v_catalog_product_id
      and internal_code = v_internal_code;

    -- The generated column rounds after applying the margin.  Try the
    -- inverse-rounded value and its immediate neighbours; this is bounded,
    -- deterministic, and never accepts a non-matching selling_price.
    for v_delta in -2..2 loop
      update public.products
      set net_price = v_candidate_net + v_delta
      where tenant_id = v_tenant_id
        and catalog_product_id = v_catalog_product_id
        and internal_code = v_internal_code;
      select exists (
        select 1
        from public.products projected_product
        where projected_product.tenant_id = v_tenant_id
          and projected_product.catalog_product_id = v_catalog_product_id
          and projected_product.internal_code = v_internal_code
          and projected_product.selling_price = v_target_price
      ) into v_parity_ok;
      exit when v_parity_ok;
    end loop;
    if not coalesce(v_parity_ok, false) then
      raise exception 'REGISTRATION_COMPATIBILITY_SELLING_PRICE_PARITY_MISMATCH';
    end if;
  end if;$replacement$;
begin
  select pg_get_functiondef(
    'internal_product_registration.project_compatibility_atomic(jsonb)'::regprocedure
  ) into v_definition;
  if position(v_declaration_marker in v_definition) = 0
    or position(v_guard in v_definition) = 0 then
    raise exception 'REGISTRATION_COMPATIBILITY_PRICE_ROUNDING_CONTRACT_UNKNOWN';
  end if;
  v_definition := replace(v_definition, v_declaration_marker, v_declaration_replacement);
  v_definition := replace(v_definition, v_guard, v_replacement);
  execute v_definition;
end;
$migration$;

revoke all on function internal_product_registration.project_compatibility_atomic(jsonb)
  from public, anon, authenticated;
grant execute on function internal_product_registration.project_compatibility_atomic(jsonb)
  to service_role;

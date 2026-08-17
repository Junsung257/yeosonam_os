-- Customer-open readiness must prove both sides of source disposition:
-- invalid/price-less sources are never published, and valid products are never
-- discarded merely because their supplier price notation was misread.

create or replace function public.get_product_registration_benchmark_v2_readiness()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
  with latest as (
    select * from internal_product_registration.profile_benchmark_runs
    where run_scope = 'global' and metrics->>'state' = 'complete'
    order by created_at desc limit 1
  ), current_profiles as (
    select tenant_id,
      'registry:' || encode(extensions.digest(convert_to(coalesce(string_agg(profile_hash, E'\n' order by profile_hash), 'none'), 'utf8'), 'sha256'), 'hex') as version
    from internal_product_registration.supplier_layout_profiles
    where activation_state = 'active'
    group by tenant_id
  )
  select coalesce((select jsonb_build_object(
    'release_manifest_hash', l.release_manifest_hash,
    'normalization_version', l.release_manifest->>'normalizationVersion',
    'terms_policy_hash', l.release_manifest->>'termsPolicyHash',
    'supplier_profile_version', l.release_manifest->>'supplierProfileVersion',
    'current_supplier_profile_version', coalesce(p.version, 'registry:' || encode(extensions.digest('none', 'sha256'), 'hex')),
    'corpus_hash', l.corpus_hash,
    'reference_date', l.reference_date,
    'annotation_schema_version', l.annotation_schema_version,
    'observed_safe_open_rate', l.safe_open_rate,
    'negative_terminal_outcome_exact_rate', (l.metrics->>'negativeTerminalOutcomeExactRate')::numeric,
    'source_incomplete_discard_exact_rate', (l.metrics->>'sourceIncompleteDiscardExactRate')::numeric,
    'false_source_incomplete_discard_count', (l.metrics->>'falseSourceIncompleteDiscardCount')::integer,
    'invalid_source_published_count', (l.metrics->>'invalidSourcePublishedCount')::integer
  ) from latest l left join current_profiles p on p.tenant_id = l.tenant_id), '{}'::jsonb);
$$;

revoke all on function public.get_product_registration_benchmark_v2_readiness() from public, anon, authenticated;
grant execute on function public.get_product_registration_benchmark_v2_readiness() to service_role;

comment on function public.get_product_registration_benchmark_v2_readiness() is
  'Service-role readiness facts for the latest completed double-reviewed benchmark, including exact negative/source-incomplete disposition gates.';

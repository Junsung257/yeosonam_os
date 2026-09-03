-- The internal registration schema is accessed through service-role RPCs and
-- server-side workers only.  These tables must not rely on privileges alone:
-- with RLS disabled, a future grant or generated client can expose every row.
-- Keep the customer-facing surface behind the existing public RPCs.

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'catalog_products',
    'registration_authority_config',
    'registration_authority_events',
    'source_blobs',
    'source_document_uploads',
    'correction_jobs',
    'terms_revisions',
    'terms_claim_links',
    'media_assets',
    'media_revision_links',
    'hotel_fact_observations',
    'hotel_fact_resolutions',
    'supplier_layout_profiles',
    'profile_benchmark_runs',
    'package_availability_overlays',
    'schedule_revalidation_jobs',
    'cohort_quality_metrics',
    'product_search_embeddings'
  ] loop
    execute format(
      'alter table internal_product_registration.%I enable row level security',
      v_table
    );
    execute format(
      'alter table internal_product_registration.%I force row level security',
      v_table
    );
    execute format(
      'revoke all on table internal_product_registration.%I from public, anon, authenticated',
      v_table
    );
    execute format(
      'grant all on table internal_product_registration.%I to service_role',
      v_table
    );
    execute format(
      'drop policy if exists %I on internal_product_registration.%I',
      v_table || '_service_role', v_table
    );
    execute format(
      'create policy %I on internal_product_registration.%I '
      || 'for all to service_role using (true) with check (true)',
      v_table || '_service_role', v_table
    );
  end loop;
end;
$$;

comment on schema internal_product_registration is
  'Private registration state. RLS is mandatory; service_role RPCs/workers are the only data-plane access path.';

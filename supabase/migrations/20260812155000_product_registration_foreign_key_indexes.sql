-- Cover every Product Registration internal foreign key currently reported by
-- the Supabase advisor. These indexes support tenant cleanup, revision joins,
-- backfill terminal sync, provider retries, and 100k-product scale.

do $$
declare
  r record;
  v_index_name text;
begin
  for r in
    select * from (values
      ('copy_claim_links', 'catalog_product_id'),
      ('copy_claim_links', 'claim_id'),
      ('copy_claim_links', 'tenant_id'),
      ('copy_revisions', 'catalog_product_id'),
      ('copy_revisions', 'tenant_id'),
      ('correction_jobs', 'base_revision_id'),
      ('correction_jobs', 'catalog_product_id'),
      ('correction_jobs', 'created_by'),
      ('correction_jobs', 'resulting_revision_id'),
      ('correction_jobs', 'source_document_id'),
      ('correction_jobs', 'workflow_job_id'),
      ('dead_letter_jobs', 'job_id'),
      ('departure_instances', 'catalog_product_id'),
      ('departure_instances', 'package_id'),
      ('departure_instances', 'tenant_id'),
      ('golf_fact_observations', 'product_revision_id'),
      ('golf_fact_observations', 'source_document_id'),
      ('golf_rounds', 'catalog_product_id'),
      ('golf_rounds', 'golf_fact_resolution_id'),
      ('golf_rounds', 'package_id'),
      ('golf_rounds', 'tenant_id'),
      ('hotel_fact_observations', 'catalog_product_id'),
      ('hotel_fact_observations', 'product_revision_id'),
      ('hotel_fact_observations', 'source_document_id'),
      ('hotel_fact_resolutions', 'catalog_product_id'),
      ('hotel_fact_resolutions', 'tenant_id'),
      ('legacy_backfill_jobs', 'catalog_product_id'),
      ('legacy_backfill_jobs', 'package_id'),
      ('legacy_backfill_jobs', 'source_document_id'),
      ('legacy_backfill_jobs', 'workflow_job_id'),
      ('lodging_stays', 'catalog_product_id'),
      ('lodging_stays', 'package_id'),
      ('lodging_stays', 'tenant_id'),
      ('media_assets', 'source_document_id'),
      ('media_revision_links', 'catalog_product_id'),
      ('media_revision_links', 'claim_id'),
      ('media_revision_links', 'media_asset_id'),
      ('media_revision_links', 'tenant_id'),
      ('package_availability_overlays', 'catalog_product_id'),
      ('profile_benchmark_runs', 'tenant_id'),
      ('provider_calls', 'product_revision_id'),
      ('registration_authority_config', 'updated_by'),
      ('registration_authority_events', 'package_id'),
      ('registration_authority_events', 'revision_id'),
      ('schedule_revalidation_jobs', 'catalog_product_id'),
      ('schedule_revalidation_jobs', 'product_revision_id'),
      ('source_document_uploads', 'source_blob_id'),
      ('terms_claim_links', 'claim_id'),
      ('terms_claim_links', 'tenant_id'),
      ('terms_revisions', 'catalog_product_id'),
      ('terms_revisions', 'tenant_id'),
      ('transport_fact_observations', 'package_id'),
      ('transport_fact_observations', 'product_revision_id'),
      ('transport_fact_observations', 'source_document_id'),
      ('transport_fact_resolutions', 'catalog_product_id'),
      ('transport_fact_resolutions', 'tenant_id'),
      ('transport_segments', 'catalog_product_id'),
      ('transport_segments', 'departure_instance_id'),
      ('transport_segments', 'package_id'),
      ('transport_segments', 'tenant_id'),
      ('workflow_stage_runs', 'tenant_id')
    ) as missing_fk(table_name, column_name)
  loop
    v_index_name := left(
      format('idx_pr_fk_%s_%s', r.table_name, r.column_name),
      63
    );
    execute format(
      'create index if not exists %I on internal_product_registration.%I (%I)',
      v_index_name,
      r.table_name,
      r.column_name
    );
  end loop;
end;
$$;

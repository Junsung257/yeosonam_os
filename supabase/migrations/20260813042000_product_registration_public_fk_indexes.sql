-- Cover the remaining public-schema Product Registration foreign keys. The
-- internal aggregate indexes were added earlier; these are the compatibility,
-- revision, proof and publication-side joins used during backfill and release.

create index if not exists idx_pr_drafts_extraction_fk
  on public.product_registration_drafts(extraction_id);
create index if not exists idx_pr_drafts_source_document_fk
  on public.product_registration_drafts(source_document_id);
create index if not exists idx_pr_drafts_upload_job_fk
  on public.product_registration_drafts(upload_job_id);

create index if not exists idx_pr_v4_normalizations_tenant_fk
  on public.product_registration_v4_normalizations(tenant_id);
create index if not exists idx_pr_v5_proof_runs_catalog_fk
  on public.product_registration_v5_proof_runs(catalog_product_id);

create index if not exists idx_pr_v5_pointers_tenant_catalog_fk
  on public.product_registration_v5_publication_pointers(tenant_id, catalog_product_id);
create index if not exists idx_pr_v5_revisions_tenant_catalog_fk
  on public.product_registration_v5_revisions(tenant_id, catalog_product_id);
create index if not exists idx_pr_public_snapshots_tenant_catalog_fk
  on public.public_package_snapshots(tenant_id, catalog_product_id);

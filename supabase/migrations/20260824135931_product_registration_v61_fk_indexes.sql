-- Forward-only FK indexes for the V6.1 authority/publication ledgers.
-- Supabase applies migrations transactionally, where CREATE INDEX CONCURRENTLY
-- is invalid. Bound lock waiting so production rollout fails closed and can be
-- retried during the publication freeze instead of blocking writers.

set local lock_timeout = '5s';
set local statement_timeout = '5min';

create index if not exists idx_pr_freeze_items_revision
  on internal_product_registration.publication_freeze_manifest_items(revision_id);
create index if not exists idx_pr_freeze_items_snapshot
  on internal_product_registration.publication_freeze_manifest_items(snapshot_id);
create index if not exists idx_pr_freeze_items_proof
  on internal_product_registration.publication_freeze_manifest_items(proof_id);
create index if not exists idx_pr_release_authorizations_approved_by
  on internal_product_registration.publication_release_authorizations(approved_by);

create index if not exists idx_pr_availability_visibility_manifest_item
  on internal_product_registration.package_availability_overlays(visibility_manifest_item_id);
create index if not exists idx_pr_surface_artifacts_tenant
  on internal_product_registration.surface_render_artifacts(tenant_id);
create index if not exists idx_pr_surface_artifacts_catalog_product
  on internal_product_registration.surface_render_artifacts(catalog_product_id);
create index if not exists idx_pr_surface_artifacts_package
  on internal_product_registration.surface_render_artifacts(package_id);
create index if not exists idx_pr_attraction_candidates_tenant
  on internal_product_registration.attraction_match_candidates(tenant_id);
create index if not exists idx_pr_attraction_candidates_approved_by
  on internal_product_registration.attraction_match_candidates(approved_by);

create index if not exists idx_pr_departures_price_override
  on internal_product_registration.departure_instances(price_override_id);
create index if not exists idx_pr_entity_aliases_approved_by
  on internal_product_registration.catalog_entity_aliases(approved_by);
create index if not exists idx_pr_entity_relations_canonical_entity
  on internal_product_registration.product_entity_relations(canonical_entity_id);
create index if not exists idx_pr_entity_relations_entity_revision
  on internal_product_registration.product_entity_relations(entity_revision_id);
create index if not exists idx_pr_entity_relations_canonical_attraction
  on internal_product_registration.product_entity_relations(canonical_attraction_id);
create index if not exists idx_pr_entity_relations_approved_alias
  on internal_product_registration.product_entity_relations(approved_alias_id);

create index if not exists idx_pr_publication_requests_package
  on internal_product_registration.publication_requests(package_id);
create index if not exists idx_pr_publication_requests_expected_revision
  on internal_product_registration.publication_requests(expected_revision_id);
create index if not exists idx_pr_publication_requests_snapshot
  on internal_product_registration.publication_requests(snapshot_id);
create index if not exists idx_pr_publication_requests_proof
  on internal_product_registration.publication_requests(proof_id);
create index if not exists idx_pr_publication_requests_requested_by
  on internal_product_registration.publication_requests(requested_by);

-- V5 foreign-key indexes identified by Supabase performance advisors.
-- These indexes protect cleanup, revision replacement, and operational lookups
-- as the registration corpus grows. Existing useful composite/unique indexes
-- are intentionally not duplicated.

create index if not exists idx_product_registration_v5_cache_convergence_snapshot
  on public.product_registration_v5_cache_convergence_runs(snapshot_id)
  where snapshot_id is not null;

create index if not exists idx_product_registration_v5_claim_evidence_extraction
  on public.product_registration_v5_claim_evidence(extraction_id);

create index if not exists idx_product_registration_v5_kill_switches_created_by
  on public.product_registration_v5_kill_switches(created_by)
  where created_by is not null;

create index if not exists idx_product_registration_v5_proof_runs_revision
  on public.product_registration_v5_proof_runs(revision_id)
  where revision_id is not null;

create index if not exists idx_product_registration_v5_proof_runs_snapshot
  on public.product_registration_v5_proof_runs(public_snapshot_id)
  where public_snapshot_id is not null;

create index if not exists idx_product_registration_v5_publication_pointers_revision
  on public.product_registration_v5_publication_pointers(current_revision_id)
  where current_revision_id is not null;

create index if not exists idx_product_registration_v5_publication_pointers_snapshot
  on public.product_registration_v5_publication_pointers(current_snapshot_id)
  where current_snapshot_id is not null;

create index if not exists idx_product_registration_v5_publication_policies_created_by
  on public.product_registration_v5_publication_policies(created_by)
  where created_by is not null;

create index if not exists idx_product_registration_v5_revisions_extraction
  on public.product_registration_v5_revisions(extraction_id);

create index if not exists idx_product_registration_v5_revisions_created_by
  on public.product_registration_v5_revisions(created_by)
  where created_by is not null;

create index if not exists idx_product_registration_v5_revisions_supersedes
  on public.product_registration_v5_revisions(supersedes_revision_id)
  where supersedes_revision_id is not null;

create index if not exists idx_product_registration_v5_segments_extraction
  on public.product_registration_v5_segments(extraction_id);

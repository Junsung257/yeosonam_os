-- The existing proof-run snapshot index is optimized for hash/status lookups.
-- Keep it and add a dedicated FK covering index for snapshot cleanup/joins.

create index if not exists idx_product_registration_v5_proof_runs_public_snapshot_id
  on public.product_registration_v5_proof_runs(public_snapshot_id)
  where public_snapshot_id is not null;

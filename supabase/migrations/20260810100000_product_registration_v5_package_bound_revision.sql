-- V5 package binding hardening.
--
-- A normalization may finish before the legacy compatibility writer has
-- created travel_packages.  The first row is therefore allowed to be an
-- unbound shadow witness, but a publishable revision must be package-bound.
-- Keep the revision aggregate append-only and allow one immutable bound
-- revision per package without collapsing different packages that share the
-- same source normalization.

alter table public.product_registration_v5_revisions
  drop constraint if exists product_registration_v5_revisions_normalization_id_payload_hash_key;

create unique index if not exists idx_product_registration_v5_revisions_unbound_payload
  on public.product_registration_v5_revisions(normalization_id, payload_hash)
  where package_id is null;

create unique index if not exists idx_product_registration_v5_revisions_bound_payload
  on public.product_registration_v5_revisions(normalization_id, payload_hash, package_id)
  where package_id is not null;

comment on index public.idx_product_registration_v5_revisions_unbound_payload is
  'At most one unbound V5 shadow witness exists for a normalization payload.';

comment on index public.idx_product_registration_v5_revisions_bound_payload is
  'Package-bound V5 revisions remain distinct immutable aggregates per package.';

-- Never allow an unbound shadow witness to be published for an arbitrary
-- package through a direct service-role RPC call.
-- The function body is replaced by the hardened definition in the next
-- migration; this migration only owns the revision identity indexes.

# PR #749 Public Surface Security Contract

Date: 2026-07-17

## Verdict

`STATIC SECURITY CONTRACT PASSED, STAGING SECURITY INVENTORY NOT RUN`

Staging identity is still not verified, so no staging database query or write was executed. This report covers the static migration/security contract for the new public package surfaces introduced by PR #749.

## Scope

Checked migration contracts for:

- `public_package_snapshots`
- `package_publish_decisions`
- `quarantined_package_fields`
- `field_evidence_ledger`
- `package_render_proofs`
- `published_public_packages_v1`
- `published_public_package_cards_v1`
- `published_public_package_details_v1`
- `published_public_package_api_v1`
- `published_public_package_marketing_v1`
- `published_public_package_partner_v1`
- `content_creatives` snapshot provenance
- `ad_creatives` snapshot provenance
- `publish_package_snapshot_atomic`

## Local Verification

Command:

```bash
npm run verify:public-package-security -- --json
```

Result:

- status: `pass`
- passed checks: `51`
- failed checks: `0`

Migrations covered:

- `supabase/migrations/20260707115319_public_package_snapshot_gate.sql`
- `supabase/migrations/20260710153000_atomic_package_publication_rpc.sql`
- `supabase/migrations/20260715114704_public_package_published_pointer.sql`

## Security Findings

Static checks prove the migration contract includes:

- RLS enabled on snapshot, decision, quarantine, evidence ledger, and render proof tables.
- Direct `anon` / `authenticated` access revoked for internal raw/evidence/proof/quarantine tables.
- No direct `anon` / `authenticated` grants on those internal tables.
- Service role grants on internal tables.
- Projection views use `security_invoker = true`.
- Projection views revoke `PUBLIC`, `anon`, and `authenticated`.
- Projection views grant `SELECT` only to `service_role`.
- `content_creatives` and `ad_creatives` carry snapshot provenance columns and restrictive FK references to `public_package_snapshots`.
- `publish_package_snapshot_atomic` is `SECURITY INVOKER`, not `SECURITY DEFINER`.
- `publish_package_snapshot_atomic` fixes `search_path = public, extensions`.
- `publish_package_snapshot_atomic` revokes execution from `PUBLIC`, `anon`, and `authenticated`.
- `publish_package_snapshot_atomic` grants execution to `service_role`.
- Customer DTO projection access remains server/read-model mediated rather than directly granted to `anon` / `authenticated`.

## Not Yet Proven

The following require verified staging identity and were intentionally not run:

- live staging RLS state introspection
- live staging grants introspection
- live staging RPC execution permission check
- Supabase Data API exposure check
- API schema cache refresh check
- route/browser proof using staging data

## Current Blocker

`STAGING IDENTITY NOT VERIFIED`

The static contract is stronger now, but it is not a substitute for the staging data gate. The PR must remain Draft until real staging identity, migration, snapshot, proof, promotion, external route, security inventory, admin smoke, and 500-package audit evidence exist.

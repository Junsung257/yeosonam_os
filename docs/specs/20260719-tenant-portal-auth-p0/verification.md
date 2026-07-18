# Verification: tenant portal authorization P0

## Automated Checks

```bash
npx vitest run <tenant authorization and route security tests>
npx eslint <changed TypeScript files>
npm run type-check
npx supabase migration list --local
git diff --check
```

## Manual QA

- [ ] Browser runtime was not used in this lane; validate admin preview and one provisioned tenant account after the migration is approved and applied.
- [ ] Confirm a tenant A account gets 403 for a tenant B route and cannot mutate a tenant B product/bid in the deployed environment.

## Evidence To Report

- Test output: final focused suite passed — 6 files, 64 tests; RLS contract-only rerun also passed — 1 file, 12 tests.
- API response: route tests assert 401/403 denial before data access, authoritative tenant scoping, cross-tenant product/inventory rejection, tenant-scoped settlements/RFQ bid state, and RFQ secret/PII omission.
- Lint: changed TypeScript files passed with zero warnings after fixing the inventory hook dependency.
- DB/schema check: migration prefix audit found 0 new/unbaselined collisions; migration safety checker found 0 issues; `supabase migration list --local` lists `20260719171000` as local-only. No remote apply or repair was performed.
- Diff check: `git diff --check` passed.
- Full type-check: `npm run type-check` passed (exit 0).
- Screenshot/browser proof: not performed.
- Audit/eval/readiness result: code-level P0 gates pass; production remains approval-blocked on applying the migration and provisioning active memberships.

## Approval Gates

- [x] No production money, booking, PII, credential, DB migration, or external publishing mutation is performed without explicit approval.
- [ ] Production owner approves migration application and membership provisioning.

## Rollout Notes

1. Verify production contains the referenced `tenants`, `travel_packages`, inventory, orders, and RFQ tables and review current policies before applying the migration.
2. Apply `20260719171000_tenant_portal_memberships_rls.sql` only through the approved production migration workflow.
3. Provision each portal user's exact `auth.users.id` and tenant ID in `tenant_memberships`; do not derive access from JWT `user_metadata` or contact email automatically.
4. Validate one platform admin, one active tenant member, one cross-tenant denial, and one suspended tenant denial before opening the portal.

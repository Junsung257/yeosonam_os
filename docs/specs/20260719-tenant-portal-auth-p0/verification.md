# Verification: tenant portal authorization P0

> Current release state: **DRAFT / MERGE-BLOCKED** pending coordinated RFQ
> service-role companion commit verification. Passing tests do not clear this gate.

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

- Test output: follow-up focused suite passed — 8 files, 92 tests, including pinned JWT trust-root, real admin/tenant caller compatibility, S2S middleware runtime matrix, additive migration contract, and tenant RFQ detail visibility tests.
- API response: route tests assert 401/403 denial before data access, authoritative tenant scoping, cross-tenant product/inventory rejection, tenant-scoped settlements/RFQ bid state, RFQ secret/PII omission, and draft/cancelled guessed-UUID 404 unless the tenant owns a bid.
- JWT verification: normal configured-project ES256 and HS256 tokens pass; attacker-controlled issuer/JWKS, wrong audience/issuer, and unsupported algorithm tokens fail. Other real callers (`requireAdminRequest`, `requireTenantPortalRequest`) accept the normal pinned token contract.
- Middleware S2S: valid `x-admin-token` reaches route-local guards across `/api/tenant/**`, `/api/tenants`, and `/api/tenants/**`; invalid tokens return 403 and missing tokens retain the login redirect boundary.
- Lint: all follow-up changed TypeScript files passed with zero warnings/errors.
- DB/schema check: migration prefix audit found 0 new/unbaselined collisions; migration safety checker found 0 issues; `supabase migration list --local` lists `20260719171000` as local-only. No remote apply or repair was performed.
- Diff check: `git diff --check` passed.
- Full type-check: follow-up `npm run type-check` passed (exit 0, 68.7s) after the RFQ checker released the coordinated single-checker slot.
- Screenshot/browser proof: not performed.
- Audit/eval/readiness result: code-level P0 checks may pass, but merge/deploy remains blocked until the RFQ companion and all rollout phases below are explicitly approved.

## Approval Gates

- [x] No production money, booking, PII, credential, DB migration, or external publishing mutation is performed without explicit approval.
- [ ] Production owner approves migration application and membership provisioning.
- [x] RFQ service-role companion commits are recorded as `03e16701` + `653eba11`.
- [ ] Integration owner confirms the paired RFQ runtime has no remaining anon CRUD dependency before Phase C.

## Mandatory Three-Phase Rollout

1. **Phase A — additive DB gate:** verify production base tables/policies, approve and apply only `20260719171000_tenant_portal_memberships_rls.sql`, then provision each portal user's exact `auth.users.id` and tenant ID. Do not derive access from JWT `user_metadata` or contact email. Prove active, cross-tenant, suspended, and unmapped-user outcomes before continuing.
2. **Phase B — application deploy gate:** only after Phase-A membership provisioning evidence exists, deploy the membership-bound tenant portal code together with RFQ commits `03e16701` and `653eba11`. Validate platform-admin S2S, one tenant login, inventory/product mutation ownership, settlements, RFQ list/detail, and draft/cancelled UUID denial.
3. **Phase C — RLS hardening gate:** `phase-c-rls-hardening-proposal.sql` is a proposal outside executable migrations. Convert it into a newly versioned migration only after Phase B is healthy, RFQ service-role reads/writes are verified in production-like runtime, and a human explicitly approves the broad-policy removal. Never apply the proposal file directly.

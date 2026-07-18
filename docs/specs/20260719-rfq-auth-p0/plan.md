# RFQ authentication P0 plan

1. Encode malicious and legitimate controls at the real route/helper interfaces.
2. Add one RFQ request-actor helper using admin authorization or verified JWT `app_metadata.tenant_id`.
3. Enforce administrator, tenant-owner, and share-token boundaries per route.
4. Encode all stored strings in generated contract HTML.
5. Re-run focused tests, changed-file ESLint, full type-check, and diff check.
6. Record the out-of-scope tenant route and database/RLS release blockers without mutating Supabase.

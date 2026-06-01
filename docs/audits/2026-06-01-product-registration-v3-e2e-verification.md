# Product Registration V3 E2E Verification

Date: 2026-06-01

Branch: `codex/product-registration-v3-draft-ledger`

PR: https://github.com/Junsung257/yeosonam_os/pull/215

## Scope

This audit verifies the Product Registration V3 sidecar flow against a real upload path after the code-level V3 draft ledger, evidence gate, review queue, upload verify, mobile LP, and A4 render work landed.

## Database Migration

Applied the V3 sidecar migration to Supabase project `ixaxnvbmhzjvupissmly` with Supabase MCP `apply_migration`.

Verified table:

- `public.product_registration_drafts`
- RLS enabled
- Comment: `V3 sidecar draft ledger for upload registration. Customer-visible facts remain gated until evidence and render checks pass.`

## Upload E2E

Input fixture:

- `.tmp/baekdu-e2e-input.txt`

Upload route:

- `POST http://127.0.0.1:3001/api/upload?force=1`
- Auth: service-role admin guard

Response artifact:

- `.tmp/codex-v3-baekdu-upload-after-draft-table.json`

Result:

- `success=true`
- `productCount=8`
- `dbIds=8`
- `gate=CLEAN`
- `priceRowsSaved=792`

Created packages:

- `58d4594e-335a-4d21-a464-4be79f635928` / `PUS-ETC-YNJ-03-0045`
- `835bf0db-2a34-4e70-918d-3f84db873fb5` / `PUS-ETC-YNJ-03-0046`
- `2c61ea9c-39b2-4c37-a5e0-51641d84e33f` / `PUS-ETC-YNJ-03-0047`
- `0e7e945b-b8a4-4fc2-a7fd-6d91761dd0e7` / `PUS-ETC-YNJ-03-0048`
- `6ef563e1-e2d9-4fb1-a09b-323c7e563098` / `PUS-ETC-YNJ-04-0045`
- `654ed12d-cdbc-42fb-aca0-c1ecefac7473` / `PUS-ETC-YNJ-04-0046`
- `b0a50c98-cb33-4b73-89a5-d893866466d7` / `PUS-ETC-YNJ-04-0047`
- `40f097c7-9ede-437b-8cf9-ab0d614d1b54` / `PUS-ETC-YNJ-04-0048`

## Draft Ledger Evidence

Verified `product_registration_drafts` rows for all 8 package ids.

Observed per package:

- `status=needs_review`
- `gate_result.status=needs_review`
- `ledger.variants=1`
- `evidence_index` lines: 524 to 547
- `match_summary.unmatched`: 137 to 148

This proves the sidecar persists raw-backed line evidence and routes unmatched attraction candidates to review instead of creating attractions automatically.

## Upload Verify

Verifier route:

- `POST http://127.0.0.1:3001/api/admin/upload/verify`

Response artifact:

- `.tmp/codex-v3-upload-verify-results.json`

Sample results:

- `58d4594e-335a-4d21-a464-4be79f635928`: `status=warnings`, `passCount=4`, `warnCount=2`, `failCount=0`, `checkCount=11`
- `654ed12d-cdbc-42fb-aca0-c1ecefac7473`: `status=clean`, `passCount=6`, `warnCount=0`, `failCount=0`, `checkCount=11`

## Browser Render Verification

Browser artifact:

- `.tmp/codex-v3-browser-render-results.json`

Verified package:

- `654ed12d-cdbc-42fb-aca0-c1ecefac7473`

Mobile LP:

- URL: `http://127.0.0.1:3001/lp/654ed12d-cdbc-42fb-aca0-c1ecefac7473`
- HTTP: `200`
- Console errors: `0`
- Failed requests: `0`
- Screenshot: `.tmp/codex-v3-654ed12d-cdbc-42fb-aca0-c1ecefac7473-lp.png`

A4 print:

- URL: `http://127.0.0.1:3001/itinerary/654ed12d-cdbc-42fb-aca0-c1ecefac7473/print`
- HTTP: `200`
- Console errors: `0`
- Failed requests: `0`
- Screenshot: `.tmp/codex-v3-654ed12d-cdbc-42fb-aca0-c1ecefac7473-a4-print.png`

Note: `/packages/[id]` returned the app's package-not-found copy for the pending package. This is expected for non-public pending inventory. The mobile LP verification target for this audit is `/lp/[id]`.

## PR Checks

Latest observed PR checks for PR #215 were all passing after commit `f9545146`, including:

- Build & Test
- TypeScript + Vitest
- product registration golden corpus
- upload-verify deterministic rules
- Next build + bundle budget
- Performance Analysis
- Trivy
- Vercel

## Residual Risk

The new upload used the current parser and real Supabase tables, but the uploaded test package remains `pending`/`needs_review` as designed. Publishing still requires the human review path to resolve unmatched attraction candidates and any warning-level audit items before public activation.

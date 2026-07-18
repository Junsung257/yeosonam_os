# RFQ authentication P0 tasks

- [x] Preserve public `POST /api/rfq` creation.
- [x] Require exact boolean privacy consent, bounded/malformed-input validation, rate limiting, and recent-duplicate rejection on public creation.
- [x] Add administrator/verified-tenant actor resolution that ignores `user_metadata` tenancy.
- [x] Block public bid/proposal/analysis collection disclosure.
- [x] Bind bid and proposal mutation to the verified tenant and actual bid ownership.
- [x] Use a fail-closed service-role lookup for the authorized active tenant; do not depend on the anonymous tenant helper.
- [x] Route authorized RFQ CRUD through an explicit service-role repository, distinct from browser/anonymous helpers.
- [x] Preserve share-token customer message reads while requiring admin/tenant authentication for message writes.
- [x] Make selection administrator-only until an owner-action token SSOT is rebuilt.
- [x] Validate the RFQ share token before server-side reaction writes and preserve the direct share-page caller.
- [x] Fix the uppercase `GOLD`/`SILVER`/`BRONZE` tier contract.
- [x] Add private/no-store headers to sensitive collection/message responses.
- [x] Escape RFQ/proposal strings in generated contract HTML.
- [x] Add malicious and legitimate control tests.
- [x] Obtain one clean full type-check result after workspace dependency/process contention clears.
- [ ] Pair and verify tenant ownership/RLS commit `9d3df38c` before release.
- [ ] Add approved transactional RPCs for bid capacity and winner selection (P1; no remote mutation in this lane).
- [ ] Rebuild customer selection on a dedicated owner-action token SSOT before re-enabling it.

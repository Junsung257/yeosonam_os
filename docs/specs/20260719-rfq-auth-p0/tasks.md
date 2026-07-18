# RFQ authentication P0 tasks

- [x] Preserve public `POST /api/rfq` creation.
- [x] Add administrator/verified-tenant actor resolution that ignores `user_metadata` tenancy.
- [x] Block public bid/proposal/analysis collection disclosure.
- [x] Bind bid and proposal mutation to the verified tenant and actual bid ownership.
- [x] Use a fail-closed service-role lookup for the authorized active tenant; do not depend on the anonymous tenant helper.
- [x] Derive message view/sender on the server and require customer share token.
- [x] Add private/no-store headers to sensitive collection/message responses.
- [x] Escape RFQ/proposal strings in generated contract HTML.
- [x] Add malicious and legitimate control tests.
- [x] Obtain one clean full type-check result after workspace dependency/process contention clears.
- [ ] Fix `src/app/api/tenant/rfqs/**` in its owning lane.
- [ ] Implement and approve the ordered service-role/RLS migration lane.

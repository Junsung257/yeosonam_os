# Product Publication Rebuild Verification

## Static and unit checks

- `node --max-old-space-size=8192 node_modules/typescript/bin/tsc --noEmit`: PASS
- Focused and broad Vitest suites for publication authority, customer copy, documentary media, public catalog, admin truth, package/LP routes, search, sitemap, migration contracts, and mobile proof: PASS — 74 files / 342 tests
- Full Vitest regression: PASS — 878 files / 6,551 passed, 7 conditional skips
- `NODE_OPTIONS=--max-old-space-size=8192 npm run lint`: PASS with zero warnings
- Production Next compilation: PASS. The default 6 GB local build wrapper exhausted heap during its second type-check; rerun uses `NEXT_BUILD_MAX_OLD_SPACE_SIZE=8192` and is the required large-repository local profile.
- Production postbuild output and pinned native/WASM `rhwp` runtime tracing: PASS
- `git diff --check`: PASS before final documentation refresh; rerun after final staging.

## Database checks

- Isolated Supabase rehearsal project: `product-registration-v61-rehearsal` (`nwtmtksjedkqehgnrxij`), never the production project.
- Candidate migrations through customer-readiness V3 plus the append-only price-lineage follow-ups: PASS.
- First remote V62 replay reproduced the P0 defect exactly: the wrapper tried to update `departure_instances` and the existing append-only trigger rejected it. The replacement writes one immutable `departure_price_lineage` row in the revision transaction and never updates the departure fact.
- Baseline A: PASS. Danang revision 3 persisted one SELLING-price lineage row (`699,000 KRW`), with `priced_departure_count=1` and `invalid_price_lineage_count=0`.
- Idempotency: PASS. Two further identical V62 calls retained one revision 3, one departure lineage, and one authority event.
- Rollback: PASS. A malformed `REQUEST_ONLY` numeric price raised `REGISTRATION_V62_REQUEST_ONLY_NUMERIC_PRICE_FORBIDDEN`; revision, departure and authority-event counts stayed unchanged.
- Immutability: PASS. Direct UPDATE attempts against both `departure_price_lineage` and the V61 `price_date_overrides` projection were rejected by the append-only trigger.
- Baseline C: PASS. The Atitaya review-required fixture remains customer-hidden with two invalid/missing price-lineage rows and grounded-copy/documentary-media blockers.
- Baseline B: PASS. The exact Clark shared-price golden source (`2,673` bytes; SHA-256 `4f10c9f365e85a58cdf7871c134c12e08e8ce7cd28175979e7d0244c027274f8`) persisted four catalog products, four revisions, 54 scoped departures and 54 immutable SELLING-price lineage rows. One identical retry per product retained one revision and one authority event. Lean/villa and 3-night/4-night sample prices stayed distinct; five excluded dates produced zero rows.
- Service-role public-catalog canary: PASS and count `0`, proving the migrated catalog still fails closed. `anon` and `authenticated` have no catalog SELECT privilege.
- Security advisor: no WARN/ERROR. Two INFO-only `RLS enabled with no policy` notices document service-role-only fail-closed tables (`departure_price_lineage`, existing `publication_requests`).
- Publication CAS/race and price/package rollback contracts: PASS in unit/contract tests.
- Production database writes: `0`.
- The protected application Preview targets only the rehearsal project. Branch configuration keeps authority in shadow, publication freeze on, publish/backfill/auto-publish off, and service credentials server-only.
- Required rollout order now resumes at rebuilding the two Danang golden products → shadow publication/convergence canary → explicit production approval.

## Browser checks

- Admin truth, publication request, signed mobile proof, CTA, private-preview headers, and canary hashes are covered by route/workflow contracts.
- Fresh read-only Chrome baseline at 390x844 confirmed that production `/packages` exposes two Danang products with `참고 이미지` and generic copy. The inspected LP uses a `여소남 브랜드 이미지` hero, repeats the alternative-hotel sentence, and shows `시간 미정` flight times. No console error was observed. This is a defect baseline, not candidate proof.
- Fresh authenticated 390x844 browser evidence against migrated rehearsal data: PASS on commit `161ef4991619308003a14228c7658ca7dd8d4adb`, Preview deployment `dpl_Hp4G6gCZDRspnWQQCukv1YLizSdr`.
- Public `/packages` returned 200 and zero products, proving the stale rehearsal pointer fails closed. The signed package and LP routes returned the same immutable snapshot hash `5d1fe4a7808cd431f46ffcb3e6b9e18bb07f29d48ca2d669663273ac95f702b9`, revision `d9ebc962-fb4f-483a-9513-5a2761fb0d7b`, renderer build `b1497a8cafa3b2c3ec7bc35562779c029dd357ce`, and KRW 699,000.
- The proof exchange returned 307 with `private, no-store`, `noindex, nofollow, noarchive`, and route marker `v6-proof-cookie-20260829`. The final LP emitted `noindex,nofollow,nocache`; the initial `index,follow` defect was fixed before final proof.
- Package reservation and LP departure-date consultation sheets both opened. No inquiry was submitted. Final browser console warning/error count was zero.
- Vercel runtime for the final deployment showed repeated 200 package/LP responses and no warning/error/fatal application logs. A single transient edge-middleware 503 during the first post-alias-cutover tab was followed by repeated 200s and did not recur.
- Screenshots: [`docs/audits/evidence/product-publication-2026-08-30`](../../audits/evidence/product-publication-2026-08-30/README.md).
- Existing production is not evidence for this candidate and was not mutated.

## Release gates

- production writes: 0 during local implementation
- auto-publish: OFF
- no public pointer change until explicit rollout approval
- P0 implementation ready: YES
- production ready: NO

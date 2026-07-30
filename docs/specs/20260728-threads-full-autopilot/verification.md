# Verification: Threads Full Autopilot

## Automated Checks

| Check | Result |
| --- | --- |
| Focused Vitest suite | PASS — 8 files, 41 tests |
| `npm run type-check` | PASS |
| Targeted ESLint | PASS |
| `npm run verify:marketing-automation` | PASS — 66 passed, 0 blocked, 0 failed |
| `npm run audit:sensitive-api-guards` | PASS |
| Vercel function count audit | PASS — 26/50 |
| `vercel.json` parse and schedule contract tests | PASS |
| Production build | CODE PASS / ARTIFACT BLOCKED — optimized compilation and Next.js type validation passed; the repository build guard then intentionally refused final artifact completion because an existing `next dev` process was active in the same workspace |
| Agent workflow packet audit | PRE-EXISTING BLOCKER — unrelated `20260705-multi-agent-stabilization` packet lacks `plan.md` |

## Contract Evidence

- [x] Readiness API returns blockers, expiry, identity match, scopes, and schedules without exposing the token.
- [x] Conversation traversal excludes self-authored and already-answered replies.
- [x] Booking, payment, refund, complaint, PII, legal, medical, and safety cases are held for review.
- [x] Routine fixtures execute the official two-step reply publish contract.
- [x] Threads long-lived tokens refresh through `graph.threads.net/refresh_access_token`.
- [x] Cron schedules match the runbook contract.
- [x] PII is redacted before engagement audit persistence.
- [x] Comment URLs are never fetched.
- [x] Daily generation, external publish, and reply processing use claims/leases to prevent overlapping cron duplication.
- [x] Failed/stale reply actions retry at most 3 times and only while the source item remains unanswered.
- [x] Dry-run does not consume critic quota or persist live publish decisions.
- [x] Automatic live publishing is restricted to autopilot-created drafts or explicitly approved rows.
- [x] Readiness requires all 7 full-autopilot scopes.
- [x] Threads Graph credentials are absent from request URLs and publish form bodies.

## DB and External-State Evidence

- No migration or new production table was introduced.
- Existing `agent_actions` provides idempotency, review state, and audit history.
- No real Threads post or reply was sent during implementation or verification.
- No remote credential, configuration, or production schema was changed.

## Activation Gate

- [x] Code, scheduler, safety policy, readiness endpoint, and documentation are ready.
- [ ] Deploy this source revision.
- [ ] Complete the administrator Threads OAuth flow once with the full requested scopes.
- [ ] Confirm the readiness endpoint reports `ready: true` before enabling live operations.

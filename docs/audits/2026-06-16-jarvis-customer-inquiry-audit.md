# Jarvis + Customer Inquiry Full Audit

> Date: 2026-06-16
> Scope: Jarvis V2, RAG, customer chat/inquiry, concierge, escalation, HITL approvals, admin Jarvis surfaces.

## 1-page Summary

| Area | Current state | Score | Verdict |
|---|---|---:|---|
| Jarvis code/test readiness | Deterministic evals, RAG golden set, trace grading, typecheck, UI regression, and V2 smoke pass locally. Vercel production env has real Supabase/LLM keys; live RAG audit now reaches production data. | 93/100 local default, 100/100 with Vercel env | WARN |
| Customer inquiry operational readiness | The end-to-end flow exists in code. Vercel env has the keys needed for live DB/LLM operation, but external customer-channel delivery and authenticated admin operation are still not fully proven. | 65/100 | PARTIAL LIVE-PROVEN |
| Admin operator surface | `/admin/jarvis`, `/admin/jarvis/rag`, `/admin/concierge` route and redirect correctly to login. Authenticated screens were not verified because no admin session/credentials were provided. | 70/100 | PARTIAL |
| Risk and approval controls | High-risk refund/payment/price-change scenarios are classified for approval; guest customer tools block mutating actions. | 90/100 | STRONG |
| RAG/data grounding | Offline RAG golden set passes 4/4. Live production `jarvis_knowledge_chunks` audit reached 1,399 rows and sampled 250 rows with quality score 97; watch remains because of duplicate chunks and one non-enriched context sample. | 97/100 | WATCH |

Top risks to fix first:

1. Local default shell does not automatically load Vercel secrets, but Vercel production/preview/development envs do contain real Supabase service-role and LLM keys.
2. Live RAG is reachable and mostly healthy, but duplicate blog chunks and one contextual-indexing issue can skew retrieval/citations.
3. Kakao/Alimtalk/external customer-channel handoff exists in scattered code paths but has no confirmed E2E result.
4. Admin Jarvis screens are protected correctly, but authenticated UI behavior was not verified in this audit.
5. Several Jarvis/admin source files show mojibake text in comments/UI strings when read in this workspace, creating operator-copy and maintainability risk.

## Implementation Catalog

| Subsystem | Implemented surface | What it can do now | Current limitation |
|---|---|---|---|
| Customer QA intake | `src/app/api/qa/route.ts` | Save inquiries, classify inquiry type, generate recommendation/comparison/general consultation response, save AI response. | Requires Supabase; legacy flow is not the V2 agent loop. |
| Customer chat V1 | `src/app/api/qa/chat/route.ts`, `src/lib/qa-chat-engine.ts` | Rate-limit, block prompt injection, stream response, critique replies, update journey, record learning events, create inquiries on escalation. | Still depends on live DB/LLM for full runtime proof. |
| Customer chat V2 | `src/app/api/qa/chat/v2/route.ts` | SSE streaming, Jarvis auth/guest mode, supervisor/risk decision, approval freeze for high risk, package context, memory facts, V2 dispatch, response critic, journey update, learning events. | Local no-env POST previously returned a raw Supabase-admin error; fixed to return a safe escalation response. Full live answer loop still needs scripted Vercel-env scenario testing. |
| Booking concierge | `src/app/api/booking-concierge/chat/route.ts`, `messages/route.ts` | Magic-session protected booking chat, message persistence, AI pause/human handoff, fallback when no LLM key. | Needs Supabase and booking portal session; no live portal E2E verified. |
| Escalation CTA | `src/app/api/qa/escalation-cta/route.ts` | Logs phone/Kakao escalation intent, redacts summary, records learning event, optionally creates inquiry. | Does not itself prove external channel delivery. |
| Admin Jarvis chat | `src/app/admin/jarvis/page.tsx`, `src/lib/jarvis/useJarvisStream.ts` | V2 streaming UI, event timeline, pending action panel, feedback, readiness/RAG cards. | Authenticated UI not verified; some strings appear mojibake in source. |
| Admin RAG search | `src/app/admin/jarvis/rag/page.tsx`, `src/app/api/admin/jarvis/rag-search/route.ts` | Operator can query Jarvis knowledge through RAG search. | Needs admin auth and live RAG DB. |
| Admin concierge | `src/app/admin/concierge/page.tsx` | Mock API mode control, transaction monitoring, margin/failure summaries. | Appears more like test/ops dashboard than customer-service console. |
| HITL approvals | `src/lib/jarvis/risk-scorer.ts`, `src/lib/jarvis/hitl.ts`, `src/app/api/admin/hitl/*` | High/critical risk requests freeze tasks or create pending actions; admin can take over/resume. | Approval-to-real-world execution needs more E2E coverage. |
| RAG index/audit | `src/lib/jarvis/rag/*`, `scripts/audit-jarvis-rag.ts` | Index package/blog/attraction/policy docs; audit chunk quality and source coverage. | Live production audit reaches 1,399 rows; current remediation is dedupe blog chunks and rerun contextual indexing for one weak sample. |

## Business Capability Matrix

| Business task | Current capability | Automation level | Required data/permission | Failure mode | Priority |
|---|---|---|---|---|---|
| Product recommendation inquiry | Implemented through QA V2 concierge tools: `knowledge_search`, `recommend_best_packages`, `recommend_compare_pair`. | Assisted auto-reply | Supabase package/RAG data, LLM key | No DB/env -> error; weak RAG -> unsupported answer | P0 |
| Price/package comparison | Implemented in legacy QA and concierge compare tool. | Assisted auto-reply | Package data and price fields | Outdated prices, missing source citations | P0 |
| Refund/cancel question | Risk-scored and should hedge with "staff confirmation required"; RAG golden set covers refund policy answer style. | Answer only, no execution | Policy/RAG data | Over-promising refund if prompt or source drifts | P0 |
| Booking status lookup | Customer guest tools allow read-only booking lookup; booking concierge can read booking context. | Assisted lookup | Magic session or scoped customer context | Missing session/DB -> 401/503/error | P0 |
| Payment/deposit check | Operations tools include unmatched payment and match payment, but mutating match is blocked for guest and approval-gated. | Admin-assisted | Admin auth, payment ledger | False match risk; needs approval trail | P0 |
| Create/update booking | Operations tools exist; create/update are HITL-class actions. | Approval-required | Admin auth, customer/package data | Bad booking mutation if approval/execution not covered | P1 |
| Send booking guide | Tool exists but blocked for guest exposure. | Approval/controlled send | Notification integration | Wrong recipient/message if external channel unverified | P1 |
| Kakao/phone escalation | CTA endpoint records escalation and inquiry; admin-facing follow-up is implied. | Logged handoff | Supabase, channel config | Event logged but no confirmed outbound delivery | P0 |
| Customer memory/facts | V2 loads/stores active facts and conversation journey. | Assisted personalization | Conversation/customer id, tenant scope | PII leakage or stale facts if not audited | P1 |
| Admin system/marketing/finance questions | Tools exist for KPI, ledger, content, alerts, policies, jobs, integrations. | Admin copilot | Admin auth, scoped DB | Tool results unverified without live env | P1 |
| Refund/payment execution | Explicitly should not execute from customer chat; high/critical risk requires human approval. | Not auto-executable | Human approval | Any direct execution would be a blocker | P0 guardrail |

## Verification Results

Commands run:

| Check | Result |
|---|---|
| `npm run verify:jarvis-readiness -- --json` | Local default env: WARN score `93/100`. With Vercel production env temporarily loaded: WARN score `100/100`, with `live-rag-index` warning because live RAG quality is `97/100 watch`. |
| `npm run eval:jarvis -- --json` | PASS: deterministic `12/12`, RAG `4/4`, trace `3/3`, trace avg `98.3/100`. |
| Focused unit tests | PASS: 5 files, 22 tests covering risk scorer, persona/tool allowlist, HITL execution, concierge public payload, destination hints. |
| Live RAG DB audit with Vercel production env | PASS for DB access: 1,399 total rows, 250 sampled rows, quality score `97/100`, coverage `3/3` source types. Verdict remains `watch` because duplicate blog chunks and one contextual-indexing issue were found. |
| Local server `/login` | PASS after cleaning `.next`: status 200. |
| Local admin routes | PASS for auth gate: `/admin/jarvis`, `/admin/jarvis/rag`, `/admin/concierge` redirect to `/login?redirect=...`. |
| Browser check | PASS for unauthenticated flow: `/admin/jarvis` lands on login with email/password fields. |
| Customer chat V2 POST | Route responds as SSE, but returns error because `SUPABASE_SERVICE_ROLE_KEY` is missing. |

Local runtime caveat:

- First dev-server browser attempt hit a Next/webpack cache error under the Korean Windows path. Cleaning `.next` and restarting fixed page rendering for `/login` and admin redirect checks.
- Because admin credentials/session were unavailable, this audit proves local code/test readiness plus live RAG data access, but not authenticated admin production readiness.

Safe Vercel env runner added:

- `scripts/run-with-vercel-env.mjs` pulls Vercel env into a temp folder, injects it only into the child process, and deletes the temp folder afterward.
- `npm run audit:jarvis-rag:vercel` verifies live RAG access without writing secrets to `.env.local`.
- `npm run verify:jarvis-readiness:vercel` runs the full Jarvis readiness gate with Vercel production env loaded.

## What Jarvis Can Do Today

- Route a user message to a domain agent and specialist.
- Stream Jarvis V2 events: agent picked, tool start/result, HITL pending, done/error.
- Search and recommend customer-facing packages through concierge tools when RAG/package data exists.
- Classify dangerous requests like refund, payment cancellation, and price change as approval-required.
- Keep customer-facing guest mode read-only by filtering mutating tools before LLM exposure.
- Record feedback and platform-learning events for customer chat and escalation actions.
- Maintain customer journey/memory hooks in the V2 QA flow.
- Provide admin operator cards for readiness, RAG status, pending actions, and MCP/tool guidance.

## What Jarvis Cannot Safely Claim Yet

- It cannot be called fully production-ready for real customer inquiries until scripted live answer scenarios and external handoff E2E pass.
- It cannot verify actual Kakao/Alimtalk delivery or phone/Kakao handoff completion from this workspace.
- It cannot prove authenticated admin Jarvis UX without a valid admin session.
- It cannot safely auto-execute refund, payment cancellation, discount, policy, settlement, or destructive product/system changes.
- It cannot guarantee Korean operator copy quality while mojibake remains in source strings/comments.

## Development Tickets

### P0 - Live customer-inquiry readiness gate

Acceptance criteria:

- Provide a safe local/CI secret profile or mock profile for Supabase-dependent QA V2.
- `npm run audit:jarvis-rag -- --strict --require-db` or an agreed watch threshold passes against live/staging RAG data after duplicate chunk cleanup.
- `/api/qa/chat/v2` completes at least 7 scripted scenarios: recommendation, comparison, refund policy, booking status, payment check, high-risk refund/cancel, prompt injection.
- Report includes actual RAG chunk counts, source distribution, and top remediation actions.

### P0 - External handoff and customer escalation proof

Acceptance criteria:

- Phone/Kakao CTA creates a durable inquiry or task with session, redacted summary, channel, and owner.
- Kakao/Alimtalk send path has staging E2E evidence or a deterministic mock contract test.
- Admin dashboard shows escalation queue status and whether the customer was contacted.

### P0 - Dangerous action hardening

Acceptance criteria:

- Refund, payment cancellation, settlement creation, price/discount change, policy update, product delete, GDPR processing all require explicit human approval.
- Approval-to-execution has tests for success, rejection, execution failure, and retry.
- Customer-surface LLM tool catalog never exposes those tools.

### P1 - Customer inquiry regression suite expansion

Acceptance criteria:

- Add 30+ Korean customer scenarios with expected risk level, tool choice, escalation flag, and forbidden phrases.
- Include no-DB/no-LLM fallback cases.
- CI fails on over-promising refund/payment/guarantee language.

### P1 - Authenticated admin UX verification

Acceptance criteria:

- Add a staging admin login path or seeded test session for browser verification.
- Verify `/admin/jarvis`, `/admin/jarvis/rag`, `/admin/concierge`, and HITL queue screen with screenshots or Playwright assertions.
- Confirm readiness/RAG cards degrade cleanly when DB/RAG is unavailable.

### P2 - Encoding and documentation cleanup

Acceptance criteria:

- Fix mojibake in Jarvis/admin source strings and docs.
- Update `docs/jarvis-readiness-gate.md` so the "Current Evidence" section matches the latest local gate result and explains DB-missing WARN.
- Add a short runbook for local Jarvis audit: env prerequisites, commands, expected pass/warn states.

## Improvement Execution Update (2026-06-16)

Implemented after this audit:

- Hardened `src/lib/jarvis/risk-scorer.ts` so Korean refund, payment cancellation, price/discount mutation, booking status, and deposit-check messages are classified deterministically.
- Hardened `src/lib/guardrails/prompt-injection.ts` so Korean prompt-injection phrases for ignoring instructions, bypassing approval, escalating permissions, and forcing refunds are blocked.
- Added a customer inquiry readiness gate:
  - `src/lib/jarvis/eval/customer-inquiry-readiness.ts`
  - `scripts/verify-customer-inquiry-readiness.ts`
  - `npm run verify:customer-inquiry`
  - `npm run verify:customer-inquiry:ci`

Post-change verification:

- `npm run verify:customer-inquiry -- --json`: PASS, score `100/100`, scenarios `32/32`. Environment warnings remain for missing Supabase, LLM, and external handoff channel secrets.
- Focused Vitest regression: PASS, 3 files and 11 tests for the customer inquiry/risk/prompt-injection guardrails.
- `npm run eval:jarvis -- --json`: PASS.
- `npm run verify:jarvis-readiness -- --json`: local default env WARN score `93/100`; with Vercel production env loaded, WARN score `100/100`.
- Vercel production env live RAG audit: PASS for DB access, quality `97/100`, readiness `watch`, total rows `1,399`, sampled rows `250`.

Net effect:

- The P0 dangerous customer request hardening item is now partially implemented and regression-tested.
- The P1 customer inquiry regression suite now has 32 customer-like scenarios across recommendations, package details, refund/cancel policy, booking changes, deposit checks, handoff requests, privacy deletion, and prompt-injection attempts.
- The main remaining gap is still operational proof: scripted live customer answers, real external handoff/Kakao evidence, and authenticated admin E2E.

## Actual Customer/Admin Simulation Update (2026-06-16)

What was actually exercised:

- Customer-like deterministic inquiry set: PASS `32/32`.
- Browser admin access check: `/admin/jarvis` redirects to `/login?redirect=%2Fadmin%2Fjarvis`; login form renders with email, password, and login button.
- API checks found `/api/qa` was treated as protected middleware traffic even though it is part of the customer inquiry flow. Fixed by adding `/api/qa` to public middleware routes.
- API checks found `/api/qa/chat/v2` exposed a raw `SUPABASE_SERVICE_ROLE_KEY is required for supabaseAdmin` error when DB keys were missing. Fixed by returning a safe customer-facing escalation message when Supabase admin is not configured.

Still not proven:

- Real customer answer generation should now be proven with Vercel production or staging env loaded into a controlled runner.
- Real refund/cancel approval queue persistence should now be proven with Vercel env, but must use non-destructive dry-run/test scenarios unless explicitly approved.
- Authenticated admin Jarvis/RAG/Concierge screens were not operated after login because no admin session/credentials were available.
- Local Next dev server is unstable on this Windows Korean-path workspace: repeated 500s and missing `.next` manifest errors appeared during broad public-page checks. This should be verified again from an ASCII-only workspace path or staging deployment before claiming E2E readiness.

Post-fix verification:

- `npm run verify:customer-inquiry -- --json`: PASS, score `100/100`, scenarios `32/32`.
- Focused Vitest regression: PASS, 3 files and 11 tests.
- `npx tsc --noEmit -p tsconfig.jarvis-readiness.json`: PASS.
- `npm run eval:jarvis -- --json`: PASS.
- `npm run verify:jarvis-readiness -- --json`: local default env WARN score `93/100`; with Vercel production env loaded, WARN score `100/100`.
- Vercel production env live RAG audit: PASS for access, score `97/100`, status `watch`.

## Final Verdict

Jarvis is substantially implemented as an internal/admin copilot and customer inquiry assistant skeleton. The strongest parts are routing, risk classification, guest read-only guardrails, readiness tests, and V2 streaming structure. Vercel has the real Supabase/LLM keys, and live RAG data is reachable with a 97/100 audit score. The biggest remaining gap is live operational proof: scripted customer-answer scenarios, external channel delivery, and authenticated admin E2E. Treat it as "code-ready, RAG-reachable, ops-partial" until the P0 gates pass.

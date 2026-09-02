# Blog Autopilot V4 completion review

## Evidence

- [x] Automated command results and deferred runtime evidence are recorded in `verification.md`.
- [x] Current behavior and approval boundaries are recorded in `docs/blog-autopublish-contract.md` and `docs/blog-ops-runbook.md`.
- [x] Release migration and rollback identity are recorded in `supabase/release-manifests/blog-orchestrator-v4-20260816.json`.

## Remaining risk

- [x] Production generation remains disabled until the V3/V4 migrations are applied to staging, readiness passes, and shadow/canary evidence is reviewed.
- [x] Crawl4AI and Docling remain disabled until service endpoints, credentials, and a reviewed 30-case failed-source fixture pass the benchmark contract.
- [x] Authenticated mobile/desktop preview, public-page browser verification, and one no-publication Inngest shadow event require a deployed staging candidate.
- [x] The compatibility publisher route still contains legacy orchestration code. Responsibility modules are extracted and contract-tested, but a riskier all-at-once physical rewrite was intentionally not used as a release prerequisite.

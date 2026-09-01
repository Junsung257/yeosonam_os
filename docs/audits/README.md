# Audit Archive Index

Last updated: 2026-08-30
- 2026-08-30 — Blog People-First Editorial Harness V5: Guam failure regression, deterministic calculations, source honesty, semantic judge, prompt trace, 33-case Promptfoo gate: `2026-08-30-blog-editorial-harness-v5.md`
- 2026-08-30 — Exact Guam editorial-incident quarantine preview (one creative, no replacement target, reviewer/PITR fields intentionally blank): `2026-08-30-blog-editorial-v5-quarantine-preview.csv`
- 2026-08-27 — GitHub OSS adoption audit: 41 active repositories, codebase-fit decisions, six bounded adoption batches, and explicit defer/reject triggers: `oss-adoption-audit-2026-08-27.md`
- 2026-08-11 — Blog Quality Engine V3 baseline, canary, corpus disposition/redirect preview, verification: `blog-quality-engine-v3-baseline-2026-08-11.md`
- 2026-08-12 — Blog Quality Engine V3 reliability follow-up migration safety (5 files, 0 issues): `blog-quality-v3-migration-safety-report.json`
- 2026-08-12 — Blog Quality Engine V3 production readiness: live Vercel/Supabase/public-surface read-only evidence, migration-history drift, and fail-closed release decision: `blog-quality-engine-v3-production-readiness-2026-08-12.md`
- 2026-08-12 — Blog Quality Engine V3 isolated Supabase staging rehearsal: five migrations, SQL/TS parity, snapshot/Data API, ACL, Advisor, and rollback-safe evidence: `blog-quality-engine-v3-staging-rehearsal-2026-08-12.md`

- 2026-08-13 — Blog live operations revalidation: production source, full corpus, autopublish, demand, GSC, eligibility, indexing, images, RUM, and fail-closed release evidence: `blog-live-operations-revalidation-2026-08-13.md`
- 2026-08-14 — Naver-first SERP benchmark: 24 queries, 240 editorial samples, page-structure fetch evidence and provider semantics: `blog-serp-benchmark-2026-08-14.md`
- 2026-08-14 — SERP brief structured canary: 24 offline drafts with per-canary failure evidence: `blog-serp-generated-canary-2026-08-14.md`

- 2026-08-15 — Blog live operations browser verification: publisher health, queue visibility, effective policy, runtime schema, and fail-closed release decision: `blog-live-ops-verification-2026-08-15.md`
- 2026-08-15 — Blog DeepSeek Orchestrator V4 local verification: DeepSeek-only quality routing, off-peak generation/daytime publication split, durable attempt evidence, Naver fallback, 1,494 blog tests, and production build: `blog-deepseek-orchestrator-v4-verification-2026-08-15.md`

Last updated: 2026-08-15

This folder is an evidence archive, not the current operating playbook.

Use current SSOT documents first:

- Product registration, mobile landing, and A4 readiness: `docs/product-registration-current-ssot.md`
- AI documentation automation and repeated-mistake capture: `docs/ai-agent-doc-automation.md`
- Repeated product-registration mistakes: `db/error-registry.md`

## Search Rule

When looking for current rules, exclude this folder first:

```bash
rg "keyword" docs AGENTS.md .claude --glob "!docs/audits/**"
```

Search this folder only when you need historical evidence, investigation details, screenshots, JSON audit output, or proof that a change was previously verified.

## Current Evidence Anchors

These audits contain recent evidence for the current product-registration engine. They are still evidence, not the source of truth:

| Area | File |
|---|---|
| Learning engine verification | `2026-06-08-product-registration-learning-engine-audit.md` |
| Upload pipeline map | `2026-06-04-upload-registration-pipeline-map.md` |
| Registration object verification | `2026-06-05-registration-object-verification.md` |
| Upload centralization proof | `2026-06-05-upload-registration-pipeline-centralization.md` |
| Goal completion proof | `2026-06-05-upload-registration-goal-completion-audit.md` |
| Raw resource inventory | `2026-06-02-product-registration-raw-resource-inventory.md` |
| V3 e2e verification | `2026-06-01-product-registration-v3-e2e-verification.md` |

## Product Registration And Mobile Landing

| Date | File | Use |
|---|---|---|
| 2026-08-17 | `2026-08-17-product-registration-real-hwp-mobile-proof.md` | Real Phu Quoc HWP production workflow, source-backed revision/snapshot, exact-hash 390×844 package and LP proof, customer-fact corrections, proof-analytics isolation, DB advisor hardening, and remaining corpus launch gate. |
| 2026-08-16 | `2026-08-16-product-registration-v138-guide-commercial-scope.md` | V138 actual-source replay, guide-fee commercial/heading/clause scoping, genuine contradiction preservation, zero comparable regression, 5,626-test verification, and remaining launch gates. |
| 2026-08-16 | `2026-08-16-product-registration-v95-grade-duration-customer-facts.md` | V95 actual-source replay, Xian grade/duration product identity, customer-fact isolation, year/deadline corrections, contradiction gates, 5,590-test verification, and remaining launch gates. |
| 2026-08-16 | `2026-08-16-product-registration-v82-full-audit.md` | V82 full actual-source replay, false split and cross-product price contamination fixes, deposit suppression, fuel conflict hard block, 1,253-test verification, and remaining customer-open gates. |
| 2026-08-16 | `2026-08-16-product-registration-v80-budget-and-duration-pattern.md` | V80 guide-fee/fuel expected-budget contract, broad-range versus explicit-duration table binding, actual double-onsen/Biei and Kota HWP checks, 1,171-file replay, two recoveries, zero regression, and remaining launch gate. |
| 2026-08-15 | `2026-08-15-product-registration-v78-owner-decisions.md` | V78 exception-price/inquiry-date, lodging-axis, missing-departure-date decisions; 1,171-file replay, three safe recoveries, zero regression, and remaining launch gate. |
| 2026-08-15 | `2026-08-15-product-registration-v75-policy-implementation.md` | V75 actual-source aggregate, row-spanned product/duration price binding, sale-context safeguards, 907-test verification, and remaining 95%/customer-open gates. |
| 2026-08-15 | `2026-08-15-product-registration-product-axis-source-validation.md` | 1,171-file HWP V68 rerun, duration/hotel axes, monthly calendar and bare-DAY replay, ticketing lifecycle, strict attraction fallback, AI fact-authority removal, and 81.98% active structural automation measurement. |
| 2026-08-15 | `2026-08-15-product-registration-source-format-audit.md` | 731-source non-frozen HWP price-format audit, deterministic normalization contract, measured recovery, and remaining structural blockers; no supplier-file cleanup required. |
| 2026-08-15 | `2026-08-15-product-registration-missing-sale-price-discard-policy.md` | Source-incomplete terminal outcome, false-discard protections, 1,171-file private shadow rerun, and required double-reviewed sale-price-presence benchmark contract. |
| 2026-08-14 | `2026-08-14-product-registration-future-date-policy.md` | Pinned Korea reference date, nearest-future yearless schedule handling, explicit-past exclusion, application/DB guards, and 1,171-file private shadow aggregate. |
| 2026-08-14 | `2026-08-14-product-registration-active-learning-loop.md` | Frozen-safe active-learning cycle, blind review and silver-candidate separation, actual-source weekday/date-price corrections, and promotion safeguards. |
| 2026-08-13 | `2026-08-13-product-registration-95-actual-source-validation.md` | Actual 1,155-HWP private corpus aggregate, conservative structural/terminal measurements, price-evidence and source-year fixes, multi-source bundle lineage, and remaining 95% customer-open gates. |
| 2026-08-12 | `2026-08-12-product-registration-authority-live-cutover.md` | Production authority hardening plus a real HWP source-to-revision-to-snapshot-to-mobile-Chrome terminal canary, customer assessment, private screenshot evidence, and remaining cohort launch gates. |
| 2026-08-11 | `2026-08-11-product-registration-v6-implementation.md` | V6 durable workflow, private schema, real HWP 40/40 recheck, production Supabase permission boundary, and remaining launch prerequisites. |
| 2026-08-10 | `2026-08-10-product-registration-v5-shadow-corpus.md` | 40개 HWP 원문을 고객 비노출 격리 상태에서 V5 정규화·근거·가격·일정·고객 화면 계약까지 전수 검증한 결과. |
| 2026-08-10 | `2026-08-10-product-registration-live-readiness.md` | Chrome·Vercel·Supabase·고객 `/packages`·`/lp` 실시간 점검과 V5 production open blockers. |
| 2026-08-10 | `2026-08-10-product-registration-live-shadow.md` | 운영 Supabase shadow 1건의 source→V5 revision→blocked snapshot→동일 hash 모바일 `/packages`·`/lp` proof 결과. |
| 2026-08-10 | `2026-08-10-product-registration-v5-final-open.md` | package-bound V5 revision, CAS publication, 4면 convergence, 헤더 없는 모바일 고객 URL 최종 공개 검증. |
| 2026-08-10 | `2026-08-10-product-registration-live-recheck.md` | Final production browser journey recheck: catalog discovery, detail, mobile LP, inquiry sheets, snapshot parity, and surcharge-copy repair. |
| 2026-08-10 | `2026-08-10-product-registration-v5-implementation-recheck.md` | Final implementation verification: full tests, type/lint/build, production V5 schema, customer-open gate, live 100-sample decision, and ready preview deployment. |
| 2026-07-06 | `2026-07-06-mobile-landing-copy-audit-smoke/` | Mobile landing copy audit smoke output for shared customer-facing package title/summary logic. |
| 2026-06-24 | `2026-06-24-upload-function-timeout-queue-first.md` | Queue-first upload timeout prevention and replay-source preservation evidence. |
| 2026-06-08 | `2026-06-08-product-registration-learning-engine-audit.md` | Self-improving registration engine verification and live readiness evidence. |
| 2026-06-20 | `2026-06-20-upload-inbox-engine-hardening.md` | Offline upload-inbox hardening evidence for price/date, flight, and remaining itinerary blockers. |
| 2026-06-05 | `2026-06-05-upload-registration-goal-completion-audit.md` | Completion evidence for centralized upload registration. |
| 2026-06-05 | `2026-06-05-upload-registration-pipeline-centralization.md` | Evidence that route logic moved behind the centralized registration pipeline. |
| 2026-06-05 | `2026-06-05-registration-object-verification.md` | Standard registration object verification. |
| 2026-06-04 | `2026-06-04-upload-registration-pipeline-map.md` | Earlier pipeline map and failure taxonomy. |
| 2026-06-02 | `2026-06-02-product-registration-raw-resource-inventory.md` | Inventory of historical raw supplier material. |
| 2026-06-01 | `2026-06-01-product-registration-v3-e2e-verification.md` | V3 registration verification evidence. |
| 2026-05-22 | `2026-05-22-mobile-landing-audit.json` | Historical mobile landing audit output. |
| 2026-05-22 | `2026-05-22-mobile-landing-audit-real.json` | Historical real mobile landing audit output. |

## Admin, UX, And Launch Readiness

| Date | File | Use |
|---|---|---|
| 2026-07-20 | `2026-07-20-launch-readiness-continuation-audit.md` | Continuation evidence for Git/PR cleanup, public package/blog readiness hardening, merged #824-#830 work, and remaining launch blockers. |
| 2026-07-19 | `2026-07-19-release-readiness-full-audit.md` | Customer launch HOLD evidence, completed P0 remediations, open gates, Git/PR cleanup, and parallel closure lanes. |
| 2026-07-06 | `2026-07-06-destinations-full-audit/` | Public destinations full audit output: desktop/mobile screenshots, route matrix, image/placeholder/climate/attraction checks. |
| 2026-05-30 | `2026-05-30-full-stack-admin-final-audit.md` | Full-stack admin final audit evidence. |
| 2026-05-30 | `2026-05-30-admin-full-system-audit.md` | Admin full-system evidence. |
| 2026-05-30 | `2026-05-30-launch-readiness-audit.md` | Launch readiness evidence. |
| 2026-05-30 | `2026-05-30-www-yeosonam-uxui-audit.md` | Public domain UX/UI audit evidence. |
| 2026-05-30 | `2026-05-30-authenticated-admin-uxui-audit.md` | Authenticated admin UX/UI evidence. |
| 2026-05-30 | `2026-05-30-yeosonam-uxui-product-masterplan.md` | Historical UX/UI product master plan. |
| 2026-05-30 | `2026-05-30-uxui-strategy-and-roadmap.md` | Historical UX/UI strategy and roadmap. |
| 2026-05-30 | `2026-05-30-uxui-plan-codebase-verification.md` | Codebase verification for UX/UI plan. |
| 2026-05-30 | `2026-05-30-admin-erp-uxui-optimization.md` | Historical admin ERP UX optimization. |
| 2026-05-30 | `2026-05-30-admin-dashboard-design-data-plan.md` | Dashboard design/data plan evidence. |
| 2026-05-30 | `2026-05-30-admin-dashboard-local-render-audit.json` | Dashboard render audit output. |
| 2026-05-30 | `2026-05-30-admin-local-page-audit.json` | Admin local page audit output. |
| 2026-05-30 | `2026-05-30-authenticated-admin-audit.json` | Authenticated admin audit output. |
| 2026-05-30 | `2026-05-30-live-domain-page-audit.json` | Live domain page audit output. |
| 2026-05-30 | `2026-05-30-live-domain-customer-cta-audit.json` | Live domain CTA audit output. |
| 2026-05-30 | `2026-05-30-live-domain-customer-journey-audit.md` | Live customer journey audit. |

## Finance And Settlement

| Date | File | Use |
|---|---|---|
| 2026-08-12 | `2026-08-12-finance-operational-completion-v4-1.md` | Selected-month workday, unique task counts, focused review UX, sync status, fee assistance, evidence wording, and release gates. |
| 2026-08-12 | `2026-08-12-finance-guided-workday-ux.md` | Guided daily settlement UX, atomic company batch classification, privacy-safe telemetry, and verification evidence. |
| 2026-08-11 | `2026-08-11-finance-integrity-and-ux.md` | Clobe review fingerprint integrity, reserve math, booking/month-close UX, production DB reconciliation, and release evidence. |
| 2026-08-06 | `2026-08-06-finance-v3-revalidation.md` | Settlement Center V3 split allocation, owner review, legacy revalidation, production reconciliation, and case-correction evidence. |

## Marketing, Blog, And Ad OS

| Date | File | Use |
|---|---|---|
| 2026-08-16 | `blog-orchestrator-v4-deepseek-only-verification-2026-08-16.md` + `.json` | DeepSeek-only publication routing, real 3-stage provider canary, full test/build, isolated DB dry-run, and production blockers. |
| 2026-08-16 | `blog-orchestrator-v4-production-verification-2026-08-16.md` + `.json` | V4 candidate tests, real provider/model canary, isolated Supabase dry-run, production read-only evidence, blockers, and exact activation sequence. |
| 2026-08-16 | `blog-corpus-reconciliation-v4-preview-2026-08-16.json` + `.csv` | Read-only review-blocked and failed-queue disposition preview; no production writes. |
| 2026-08-13 | `blog-image-phash-preview.json` + `blog-image-phash-preview.csv` | Dry-run public-snapshot image hash coverage and actionable cross-destination duplicate-pair evidence; no DB writes. |
| 2026-07-29 | `2026-07-29-blog-full-process-95-audit.md` | Full blog publication, public-render quality, category coverage, research backlog, crawler stampede root cause, and prevention evidence. |
| 2026-07-24 | `2026-07-24-blog-autopublish-live-evidence-audit.md` | Live ten-intent direct-source audit with production create, update-publish, immutable revision, public render, and reindex proof. |
| 2026-07-20 | `2026-07-20-meta-publisher-boundary.md` | Meta publisher external-write boundary audit: disabled incomplete deploy context, guarded mutation routes, and aligned PAUSED ad copy with the marketing SSOT. |
| 2026-07-22 | `2026-07-22-npm-audit-dependency-cleanup.md` | Dependency-only audit cleanup for high severity npm audit findings, including sharp/libvips and blog image normalize type compatibility evidence. |
| 2026-07-09 | `2026-07-09-blog-writing-engine-research.md` | Blog writing-engine research: competitor patterns, customer-language scorecard, open-source eval/observability adoption priorities, and remaining hardening backlog. |
| 2026-06-15 | `2026-06-15-blog-autopublish-quality-incident.md` + `../blog-autopublish-contract.md` | Blog autopublish repeated-quality root cause, evidence-backed prevention contract, verification commands, and remaining slug migration gate. |
| 2026-06-08 | `2026-06-08-blog-production-visual-audit.md` | Blog visual QA, GSC canonical/domain evidence, and 100-point prevention gate. |
| 2026-06-09 | `2026-06-09-blog-publish-quality-reverification.md` | Blog publish-path SEO/readability/render quality gate reverification. |
| 2026-06-09 | `2026-06-09-blog-image-proxy-reverification.md` | Browser-side Pexels image blocking root cause and image proxy verification. |
| 2026-06-09 | `2026-06-09-blog-mobile-overflow-reverification.md` | Mobile horizontal overflow root cause from article heading typography and prevention rule. |
| 2026-06-09 | `2026-06-09-blog-editorial-intent-quality-engine.md` | Blog editorial intent quality gate, audit results, and 3-4/day publishing quota hardening. |
| 2026-06-09 | `2026-06-09-blog-revenue-funnel-code-research.md` | Codebase and external-research evidence for turning blog SEO content into a product recommendation and revenue funnel engine. |
| 2026-06-10 | `2026-06-10-search-indexability-diagnostics.md` | GSC/Naver indexability root-cause audit and sitemap/canonical/title prevention gate evidence. |
| 2026-06-29 | `2026-06-29-admin-mobile-marketing-ux/` | Mobile admin marketing and Ad OS overflow-fix screenshots after action/tab wrapping and layout guard updates. |
| 2026-06-29 | `2026-06-29-ad-os-real-use-smoke/` | Ad OS real-use smoke screenshots for public destination/blog render and admin marketing/Ad OS desktop/mobile flows. |
| 2026-06-06 | `2026-06-06-blog-automation-hardening.md` | Blog automation hardening evidence. |
| 2026-06-05 | `2026-06-05-serpapi-naver-rank-provider.md` | SERP/Naver rank provider evidence. |
| 2026-06-04 | `2026-06-04-blog-automation-audit.md` | Blog automation audit evidence. |
| 2026-06-04 | `2026-06-04-os-product-design-audit.md` | Product design and OS audit evidence. |
| 2026-06-04 | `2026-06-04-ad-os-decomposition-plan.md` | Historical Ad OS decomposition plan. |
| 2026-05-30 | `2026-05-30-marketing-capi-gsc-snapshot-followup.md` | Marketing CAPI/GSC follow-up evidence. |
| 2026-05-30 | `2026-05-30-marketing-command-center-deep-research.md` | Historical marketing command center research. |
| 2026-05-30 | `2026-05-30-marketing-followup-recommendation-ledger.md` | Marketing follow-up recommendation ledger. |
| 2026-05-30 | `2026-05-30-evidence-based-ai-ux-masterplan-v2.md` | Historical evidence-based AI UX masterplan. |

## AI, Jarvis, And RAG

| Date | File | Use |
|---|---|---|
| 2026-07-05 | `2026-07-05-jarvis-product-db-learning-scan.md` | Live product catalog learning coverage, active package RAG gap, and package RAG backfill command evidence. |

## System, Runtime, And Code Review

| Date | File | Use |
|---|---|---|
| 2026-09-01 | `2026-09-01-harness-doc-remediation-final.md` | Documentation, agent harness, permissions, Research Node integration, CI, and evaluation verification record. |
| 2026-07-05 | `2026-07-05-jarvis-customer-inquiry-research.md` | Research-backed Jarvis customer inquiry answer-quality gate mapping for grounding, uncertainty, handoff, no-dead-end, and bounded-empathy checks. |
| 2026-07-05 | `2026-07-05-secret-surface-audit.md` | Secret/env surface audit covering local env files, tracked `.env.prod`, command-output risk, rotation priorities, and existing prevention checks. |
| 2026-06-26 | `2026-06-26-project-readiness-audit.md` | Pre-development local, Vercel, Supabase, MCP, docs, and build readiness audit after workspace consolidation. |
| 2026-05-28 | `2026-05-28-runtime-risk-audit.md` | Runtime risk audit evidence. |
| 2026-05-30 | `2026-05-30-env-secrets-inventory.md` | Environment/secrets inventory evidence. |
| 2026-05-30 | `2026-05-30-missed-risks-and-total-plan.md` | Historical missed-risk review. |
| 2026-05-30 | `2026-05-30-open-readiness-pr-notes.md` | Historical open-readiness PR notes. |
| 2026-05-30 | `2026-05-30-post-fix-verification-and-improvements.md` | Post-fix verification notes. |
| 2026-05-11 | `2026-05-11-comprehensive-code-review.md` | Historical comprehensive code review. |
| 2026-05-11 | `2026-05-11-vercel-functions-optimization.md` | Vercel functions optimization evidence. |
| 2026-05-11 | `2026-05-11-admin-perf-audit.md` | Admin performance audit evidence. |
| 2026-05-11 | `ir-canary-activation-2026-05-11.md` | IR canary activation note. |
| 2026-05-10 | `page-audit-2026-05-10.md` | Historical page audit evidence. |
| 2026-05-20 | `2026-05-20-legacy-sections-broken.md` | Legacy sections investigation. |
| 2026-06-12 | `2026-06-12-project-improvement-audit.md` | Project improvement audit evidence. |
| 2026-06-16 | `2026-06-16-jarvis-customer-inquiry-audit.md` | Jarvis customer inquiry audit evidence. |
| 2026-06-21 | `2026-06-21-customer-visibility-upload-gate.md` | Customer visibility upload-gate evidence. |
| 2026-06-21 | `2026-06-21-mobile-audit-env-preflight.md` | Mobile audit environment preflight evidence. |
| record | `blog-quality-engine-v3-canary-results.md` | Blog quality V3 canary result record. |
| record | `blog-quality-engine-v3-verification.md` | Blog quality V3 verification record. |

## Maintenance Rule

When adding a new file under `docs/audits/`, update this index with one row. If the new file becomes a current rule, move the rule into a domain SSOT instead and keep only the evidence here.

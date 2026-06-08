# Audit Archive Index

Last updated: 2026-06-08

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
| 2026-06-08 | `2026-06-08-product-registration-learning-engine-audit.md` | Self-improving registration engine verification and live readiness evidence. |
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

## Marketing, Blog, And Ad OS

| Date | File | Use |
|---|---|---|
| 2026-06-08 | `2026-06-08-blog-production-visual-audit.md` | Blog visual QA, GSC canonical/domain evidence, and 100-point prevention gate. |
| 2026-06-06 | `2026-06-06-blog-automation-hardening.md` | Blog automation hardening evidence. |
| 2026-06-05 | `2026-06-05-serpapi-naver-rank-provider.md` | SERP/Naver rank provider evidence. |
| 2026-06-04 | `2026-06-04-blog-automation-audit.md` | Blog automation audit evidence. |
| 2026-06-04 | `2026-06-04-os-product-design-audit.md` | Product design and OS audit evidence. |
| 2026-06-04 | `2026-06-04-ad-os-decomposition-plan.md` | Historical Ad OS decomposition plan. |
| 2026-05-30 | `2026-05-30-marketing-capi-gsc-snapshot-followup.md` | Marketing CAPI/GSC follow-up evidence. |
| 2026-05-30 | `2026-05-30-marketing-command-center-deep-research.md` | Historical marketing command center research. |
| 2026-05-30 | `2026-05-30-marketing-followup-recommendation-ledger.md` | Marketing follow-up recommendation ledger. |
| 2026-05-30 | `2026-05-30-evidence-based-ai-ux-masterplan-v2.md` | Historical evidence-based AI UX masterplan. |

## System, Runtime, And Code Review

| Date | File | Use |
|---|---|---|
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

## Maintenance Rule

When adding a new file under `docs/audits/`, update this index with one row. If the new file becomes a current rule, move the rule into a domain SSOT instead and keep only the evidence here.

# OSS Adoption Audit — 2026-08-27

## Decision

This audit reviewed 41 active GitHub repositories across supply-chain security, API contracts, admin UI, AI evaluation, document/OCR processing, observability, feature control, search/CMS, workflow orchestration, and testing. GitHub stars are a discovery signal only; adoption is decided by Yeosonam's current code, SSOT boundaries, license, operational cost, data exposure, and ability to fail closed.

The useful near-term work is deliberately small:

- adopt Gitleaks, OSV-Scanner, and Trivy as immutable CI gates;
- use Pino, Zod/OpenAPI generation, and typed API clients for the external V1 boundary;
- standardize complex admin tables on TanStack Table while retaining the existing component system;
- add Promptfoo only as an offline, manually triggered challenger to the existing deterministic concierge evaluation;
- keep Docling and PaddleOCR outside production and benchmark them through the existing provenance-safe OCR shadow harness;
- harden the already-installed T3 Env, OpenTelemetry, and Sentry stack instead of introducing a second telemetry plane;
- retain the existing Dependabot, Playwright, Vitest, Lighthouse CI, Recharts, and accessibility foundations.

No new search engine, CMS, workflow orchestrator, experimentation platform, or LLM observability SaaS is justified now.

## Method

- Snapshot time: 2026-08-27 KST.
- Repository facts came from the GitHub repository API. Stars change continuously and are not release-quality evidence.
- All reviewed repositories were unarchived at the snapshot time. A recent push was checked as a maintenance signal.
- License values are GitHub's detected SPDX value. `NOASSERTION` or `NONE` requires a separate legal review before adoption.
- Codebase evidence included `package.json`, `.github/dependabot.yml`, `.github/workflows/lighthouse-ci.yml`, the current AI, workflow, and product-registration SSOTs, and existing outbox/proof/publication contracts.
- Adoption requires all of: a current gap, no duplicate authority, bounded runtime/data risk, reversible rollout, and proportionate maintenance cost.

## Inventory And Disposition

| Area | Repository | Stars | License | Decision | Yeosonam rationale |
|---|---|---:|---|---|---|
| Supply chain | [Gitleaks](https://github.com/gitleaks/gitleaks) | 28,962 | MIT | Adopted | Diff-scoped secret gate with immutable action pin. |
| Supply chain | [OSV-Scanner](https://github.com/google/osv-scanner) | 10,923 | Apache-2.0 | Adopted | Lockfile-aware dependency vulnerability gate. |
| Supply chain | [Trivy](https://github.com/aquasecurity/trivy) | 37,628 | Apache-2.0 | Adopted | Filesystem and configuration advisory scan; pinned digest. |
| Dependency updates | [Dependabot Core](https://github.com/dependabot/dependabot-core) | 5,737 | MIT | Keep existing | `.github/dependabot.yml` already covers npm and GitHub Actions. |
| Dependency updates | [Renovate](https://github.com/renovatebot/renovate) | 22,349 | AGPL-3.0 | Defer | Duplicates Dependabot and adds policy/hosting overhead. |
| API/logging | [Pino](https://github.com/pinojs/pino) | 18,154 | MIT | Adopted | Structured server logs with request correlation and redaction. |
| API/contracts | [Zod](https://github.com/colinhacks/zod) | 43,533 | MIT | Keep/extend | Existing runtime schema authority; reused for external API validation. |
| API/contracts | [zod-to-openapi](https://github.com/asteasolutions/zod-to-openapi) | 1,611 | MIT | Adopted, build-only | Generates OpenAPI from executable schemas without runtime bundle coupling. |
| API/contracts | [openapi-typescript](https://github.com/openapi-ts/openapi-typescript) | 8,332 | MIT | Adopted, build-only | Generates consumer types from the same public contract. |
| API/docs | [Scalar](https://github.com/scalar/scalar) | 15,999 | MIT | Defer | The current small API needs a JSON contract, not a second public docs application. |
| API/lint | [Spectral](https://github.com/stoplightio/spectral) | 3,189 | Apache-2.0 | Defer | Zod runtime tests and generated-type parity cover the current surface; revisit as partner APIs grow. |
| Admin data UI | [TanStack Table](https://github.com/TanStack/table) | 28,383 | MIT | Adopted | Headless sorting/table state fits the existing UI and avoids a second design system. |
| UI system | [shadcn/ui](https://github.com/shadcn-ui/ui) | 122,204 | MIT | Keep existing patterns | Component composition is already present; wholesale regeneration would create visual drift. |
| Charts | [Recharts](https://github.com/recharts/recharts) | 27,515 | MIT | Keep existing | Already installed; adequate for current admin analytics. |
| Admin grid | [MUI X](https://github.com/mui/mui-x) | 5,838 | NONE | Reject now | Duplicates TanStack/shadcn and introduces licensing/design-system ambiguity. |
| AI evaluation | [Promptfoo](https://github.com/promptfoo/promptfoo) | 24,595 | MIT | Adopted as challenger | Manual, offline adapter reuses the existing JSONL corpus; it cannot replace production gates. |
| LLM observability | [Langfuse](https://github.com/langfuse/langfuse) | 33,765 | NOASSERTION | Defer | Duplicates OTel/Sentry/cost ledger and creates another customer-data plane. |
| LLM observability | [Phoenix](https://github.com/Arize-ai/phoenix) | 11,204 | NOASSERTION | Defer | Useful for future trace evaluation, but duplicates current telemetry and requires governance work. |
| LLM observability | [OpenLIT](https://github.com/openlit/openlit) | 2,718 | Apache-2.0 | Defer | Current OTel instrumentation can be improved without a parallel platform. |
| Document AI | [Docling](https://github.com/docling-project/docling) | 65,599 | MIT | Shadow benchmark | Candidate for PDF/HWP-derived image/OCR comparison only; never production authority. |
| OCR | [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) | 88,310 | Apache-2.0 | Shadow benchmark | Strong Korean OCR candidate; evaluate accuracy, cost, and provenance before any adapter. |
| Document AI | [Marker](https://github.com/datalab-to/marker) | 39,283 | Apache-2.0 | Later challenger | Benchmark only if Docling/Paddle do not meet the frozen corpus target. |
| Document AI | [MinerU](https://github.com/opendatalab/MinerU) | 78,554 | NOASSERTION | Defer | Large runtime and unresolved detected license make near-term use unjustified. |
| Document layout | [Layout Parser](https://github.com/Layout-Parser/layout-parser) | 5,774 | Apache-2.0 | Reject now | Last repository push observed in 2024; weaker maintenance signal than the chosen challengers. |
| Error telemetry | [Sentry JavaScript](https://github.com/getsentry/sentry-javascript) | 8,726 | MIT | Keep/harden | Already installed; add recursive credential and Korean-PII scrubbing. |
| Tracing | [OpenTelemetry JS](https://github.com/open-telemetry/opentelemetry-js) | 3,446 | Apache-2.0 | Keep/harden | Already installed; align GenAI spans with current semantic conventions. |
| Environment contract | [T3 Env](https://github.com/t3-oss/t3-env) | 3,997 | MIT | Keep/extend | Already installed; move selected flags to typed bounded schemas. |
| Feature flags | [Vercel Flags](https://github.com/vercel/flags) | 617 | MIT | Defer | Requires provider/control-plane decisions; safety switches must remain fail-closed domain controls. |
| Feature flags | [Unleash](https://github.com/Unleash/unleash) | 13,761 | AGPL-3.0 | Defer | Self-hosted platform cost exceeds current rollout needs. |
| Experimentation | [GrowthBook](https://github.com/growthbook/growthbook) | 8,159 | NOASSERTION | Defer | No current experimentation volume that justifies a new exposure/metrics authority. |
| Search | [Typesense](https://github.com/typesense/typesense) | 26,481 | GPL-3.0 | Defer | Current catalog size and Supabase search do not justify a second stateful service. |
| Search | [Meilisearch](https://github.com/meilisearch/meilisearch) | 59,100 | NOASSERTION | Defer | Same operational duplication; detected license needs review. |
| CMS | [Directus](https://github.com/directus/directus) | 37,595 | NOASSERTION | Reject | Creates a second content and permission SSOT beside Supabase and existing admin workflows. |
| CMS | [Payload](https://github.com/payloadcms/payload) | 44,421 | MIT | Reject | Same duplicate-authority problem despite a permissive license. |
| Workflow | [Temporal](https://github.com/temporalio/temporal) | 22,544 | MIT | Defer | Existing Vercel Workflow plus DB outbox, leases, CAS, and proof ledgers already own durability. |
| Workflow | [Trigger.dev](https://github.com/triggerdotdev/trigger.dev) | 16,133 | Apache-2.0 | Defer | Would create a second scheduler/orchestrator and migration burden. |
| Workflow | [Inngest](https://github.com/inngest/inngest) | 5,765 | NOASSERTION | Defer | Same duplicate control-plane issue; no demonstrated reliability gap requiring replacement. |
| Browser testing | [Playwright](https://github.com/microsoft/playwright) | 95,172 | Apache-2.0 | Keep existing | Already installed and is the authority for mobile proof and customer-route canaries. |
| Web quality | [Lighthouse CI](https://github.com/GoogleChrome/lighthouse-ci) | 7,060 | Apache-2.0 | Keep existing | Existing manually triggered workflow is sufficient; promote only after route/data stability gates. |
| Accessibility | [axe-core](https://github.com/dequelabs/axe-core) | 7,446 | MPL-2.0 | Keep existing approach | Continue targeted accessibility checks with existing browser/UI tests before adding another mandatory gate. |
| Unit testing | [Vitest](https://github.com/vitest-dev/vitest) | 17,013 | MIT | Keep existing | Existing broad suite is the primary deterministic regression gate. |

## Implemented Batch

| Batch | Change | Guardrail |
|---|---|---|
| Supply chain | Immutable action pins, Gitleaks diff gate, OSV and Trivy advisory scanning | No floating action refs; findings cannot leak full secrets into logs. |
| External API | Minimal customer/partner DTOs, executable Zod contracts, generated OpenAPI/types, Pino request correlation | Internal hashes/revision policy remain private; route-local authentication fails as JSON. |
| Admin UI | Reusable sortable TanStack DataTable and first tenant-token migration | Headless table only; existing shadcn/Tailwind visual language remains authoritative. |
| AI evaluation | Promptfoo offline echo-provider challenger | Manual workflow; no provider/network/customer data; deterministic gate remains authoritative. |
| OCR | Provenance-safe Docling/Paddle shadow input contract | No runtime dependency, production write, automatic publication, or attraction creation. |
| Observability | Typed bounded flags, current OTel GenAI attributes, recursive Sentry scrubber | Safety/freeze/kill switches are not generic feature flags; raw prompts/responses remain excluded. |

## Revisit Triggers

- Add Scalar/Spectral when a stable external API has enough routes or partners to require an interactive portal and separate governance lint.
- Add an LLM observability platform only after deciding data residency, retention, redaction, tenant isolation, cost, and deletion ownership, and only if current OTel/Sentry/ledger queries cannot answer measured operational questions.
- Add a search service when catalog/content scale produces measured relevance or latency failures that Postgres/Supabase indexing cannot meet.
- Reconsider Temporal/Trigger.dev/Inngest only after a quantified failure mode cannot be solved by the current Workflow/outbox/lease architecture.
- Reconsider an experimentation platform when exposure assignment, metric ownership, and sample sizes support real controlled experiments.
- Promote an OCR challenger only after the frozen, independently reviewed source corpus proves accuracy gain, zero provenance loss, bounded cost, and no new publication authority.

## Conclusion

High GitHub stars did not justify broad dependency import. The optimal result is six bounded improvements and explicit non-adoption of duplicate platforms. This preserves Yeosonam's existing V6 publication authority, Supabase data authority, durable outbox/workflow model, design system, and fail-closed safety controls while addressing concrete gaps in CI, API contracts, admin tables, evaluation, OCR evidence, and telemetry hygiene.

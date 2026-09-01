# Feature Spec: Blog Autopilot V4 completion

## Goal

Complete the remaining Korean first-party blog SEO operations layer and make automatic generation runnable only after schema, benchmark, quality, preview, and rollout gates pass.

## Success Criteria

- [x] Four focused Yeosonam SEO skills are discoverable and validated.
- [x] SEO drift, topic cannibalization, content decay, GSC, CrUX, and PageSpeed observations share one durable weekly audit contract.
- [x] Crawl4AI, Docling, and Korean semantic duplicate adapters are executable but fail closed until their benchmark thresholds pass.
- [x] The legacy publisher delegates candidate, research, generation/repair, quality, preview, publication, and indexing responsibilities to named modules.
- [x] One generation schedule dispatches stable queue/version events through Inngest and publishing remains capped by the five-slot DB policy.
- [x] Staging and production mutations remain separately approval-gated and produce rollback evidence.

## In Scope

- Korean `/blog`, Google and Naver search delivery, automatic generation, SEO observation, and safe rollout.
- Production-ready code, migrations, tests, evaluation fixtures, diagnostics, and operator documentation.

## Out Of Scope

- External Naver Blog posting, multilingual generation/hreflang expansion, paid SEO data providers, or automatic deletion/unpublishing of existing posts.

## Users And Risks

- Primary audience: content operator and administrator.
- Risk tier: Tier 3.
- Sensitive surfaces: production DB/RLS, external search providers, AI providers, public publishing, and credentials.

## Open Questions

- [x] None. External production mutations require a separate explicit release gate even though implementation is authorized.

# Implementation Plan: OpenMontage draft sandbox

## Approach

Clone the official immutable revision only inside a restricted Docker build, keep runtime offline and non-root, and validate Yeosonam-owned JSON contracts before any media tool runs.

## Impact Areas

- Code: video draft contracts and validation
- Data/API: none
- UI: none
- Docs/tests: media SSOT, Docker contract check, synthetic policy fixtures

## Required SSOT

- `docs/media-generation-current-ssot.md`
- `docs/blog-autopublish-contract.md`
- `docs/product-registration-current-ssot.md`

## Data Flow

Approved blog/evidence hashes + reviewed media manifest → offline sandbox draft → ffprobe/rights/facts QA → private draft → VA decision.

## Risks And Guardrails

- Product misrepresentation: product scenes require verified internal product media.
- Licensing: per-asset rights and voice license fail closed.
- AGPL/network: no upstream modification or network service.
- External mutation: no credentials, DB writes, uploads, or publishers.

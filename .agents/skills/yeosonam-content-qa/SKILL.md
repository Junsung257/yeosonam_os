---
name: yeosonam-content-qa
description: Audit or repair Korean Yeosonam first-party blog drafts for evidence coverage, decision completeness, natural style, repetition, PII, unsupported claims, duplicate intent, and customer usefulness. Use before publication or when a quality gate fails; do not use as a technical SEO or search-indexing audit.
---

# Yeosonam Content QA

Use the production validators as the authority and explain failures in reader language.

## Audit order

1. Reject PII, contract violations, generated residue, missing source snapshots, and unsupported numeric or current-condition claims.
2. Verify every material claim maps to approved evidence and that the current claim hash matches the approved hash.
3. Check title promise, direct answer, decision completeness, destination-specific value, and next action.
4. Check opening family, repeated phrases, duplicated paragraphs/headings, generic destination substitution, excessive advertising, and unnatural Korean.
5. Check internal links against real public routes and representative ownership.

One claim-preserving repair is allowed. Re-run the deterministic and evidence validators afterward. If the same critical failure remains, quarantine or request review instead of weakening a threshold.

## Boundaries

- Do not add first-person experience unless it is evidenced.
- Do not change price, date, route, hotel, flight, visa, or product facts to improve prose.
- Do not treat an aggregate score as a pass when any hard dimension is below its floor.
- Follow `docs/blog-autopublish-contract.md`.

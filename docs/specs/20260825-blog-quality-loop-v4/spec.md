# Blog Quality Improvement Loop V4

## Scope

This release adds a deterministic control-plane contract above the existing Blog V4
quality, research, render, and publication gates. It does not replace those gates.

The loop is:

```text
observe 7/28/56d metrics
→ evaluate existing evidence-backed candidate
→ propose a bounded improvement
→ require editorial approval
→ apply only an approved non-claim-changing repair
→ verify public render and indexing evidence
→ measure again
```

## Safety contract

- `src/lib/blog-quality-improvement-v4.ts` is pure. It makes no AI calls and no
  Supabase, publication, indexing, or content mutations.
- Style proposals must preserve the atomic claim hash.
- Factual claim changes require the reviewed atomic replacement path and cannot
  be applied by the style-repair transition.
- Evidence references are mandatory for every proposal.
- `entry_requirements` and `travel_insurance` remain outside the low-risk
  automatic intent fixture set and retain human-review policy.
- Topic collision detection runs before generation for the same destination,
  intent, and audience representative.
- Bayesian threshold learning now emits a proposal. The cron cannot write active
  thresholds; `persistAdaptiveThresholds` requires explicit approval lineage.
- Learning snapshots are descriptive observations, not permission to lower a
  publish gate.

## Verification

```bash
npm run eval:blog-quality-v4
npx vitest run src/lib/blog-quality-improvement-v4.test.ts src/lib/blog-bayesian-optimizer.test.ts
```

The fixture evaluator reports `externalCalls=0` and `publicMutations=0`.
Production AI, database, migration, deployment, and publication operations are
not part of this contract test.

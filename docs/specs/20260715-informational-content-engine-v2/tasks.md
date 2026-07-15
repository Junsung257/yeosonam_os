# Tasks: Informational Content Engine V2

- [x] M0: inspect Git baseline, domain SSOT, current code paths, migrations, tests, and dirty files.
- [x] M1: complete informational publishing safeguards and review-state migration proof.
- [x] M2: add information/product boundary facade and dependency regression tests.
- [x] M3: implement complete validated planner output before writer execution.
- [x] M4: add informational source/evidence/claim registry and additive migration (SQL/static proof complete; local apply unavailable because Docker is not running).
- [x] M5: implement claim extraction and fail-closed publish validator.
- [x] M6: implement representative-key duplicate/upsert/canonical contract.
- [x] M7: implement contextual related-link ranking.
- [ ] M8: implement central informational CTA config, selector, renderer, and events.
- [ ] M9: enforce final-render SEO/reading-time/CTA QA.
- [ ] M10: add named sample E2E evaluation fixtures and reports.
- [ ] M11: add existing-post dry-run audit and owner handoff.
- [ ] Run full typecheck, changed-file lint, build, migration dry-run, information tests, and product baselines.
- [ ] Confirm no push, PR, deployment, remote DB mutation, secret output, or public-row mutation.

## Commit Boundary

Each M0-M11 milestone is a separate atomic commit using only explicitly staged files. Shared files are staged by hunk when work from different milestones coexists.

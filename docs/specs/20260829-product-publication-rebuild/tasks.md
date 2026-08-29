# Product Publication Rebuild Tasks

- [x] Baseline latest main, candidate PR, current customer routes, and DB contracts.
- [x] Add publication authority and truth read model.
- [x] Add typed source-price authority and atomic projections.
- [x] Add grounded customer-copy V3 validation and cost controls.
- [x] Add publication request API and durable workflow.
- [x] Add published-only public catalog and migrate every customer egress.
- [x] Replace dead admin approval UI with publication truth UI.
- [x] Add post-publish cache convergence and fail-closed live canary. Automatic old-pointer restoration remains intentionally out of scope until a separately authorized rollback command exists.
- [x] Add migration, role, race, null-safety, public-set parity, and mobile-proof contract tests.
- [x] Update SSOT and implementation evidence.

## Rollout work intentionally not executed

- [ ] Apply V162 migration to a disposable/staging Supabase database and run advisor/role checks.
- [ ] Capture authenticated admin and signed private-preview browser evidence against that database.
- [ ] Run a golden source through the complete staged workflow and compare `/packages` and `/lp` hashes.
- [ ] Obtain explicit approval before any production migration, deployment, pointer change, or cohort unfreeze.

# Feature Spec: Multi-Agent Stabilization

## Goal

Stabilize Yeosonam OS with parallel agents while preserving active worktrees and PRs. The operator should get safer verification, clearer risk reporting, and non-overlapping improvements without accidental merges, reverted work, or cross-session conflicts.

## Success Criteria

- [ ] Active worktrees and open PRs are snapshotted before edits.
- [ ] Each parallel agent has a disjoint write scope and reports changed files.
- [ ] Protected blog, RFQ, and product-registration work is not edited by unrelated agents.
- [ ] Verification tools produce actionable results instead of ambiguous local failures.
- [ ] Any security/secret finding is reported without exposing secret values.

## In Scope

- Coordination artifact for parallel stabilization.
- Validation-tool hardening for public critical-page and SELECT-column audits.
- Secret-surface audit report without raw secret values.
- Free-travel expectation alignment limited to free-travel/provider files.
- Read-only collision monitoring across active PRs and worktrees.

## Out Of Scope

- Merging, rebasing, deleting, or force-updating existing worktrees or branches.
- Editing active blog, RFQ, and product-registration protected zones.
- Rotating live credentials or mutating external provider accounts.
- Applying DB migrations or changing production money, booking, customer, or ad-spend state.

## Users And Risks

- Primary audience: operator, admin, and AI agents coordinating long-running work.
- Risk tier: Tier 2, with Tier 3 guardrails for secrets, PII, external publishing, bookings, and product-registration protected paths.
- Sensitive surfaces: credentials, PII, external publishing, booking expectations, and branch/worktree integrity.

## Open Questions

- [ ] None for Wave 0-1. Later domain waves depend on PR #554/#553/#453 status and protected worktree reconciliation.

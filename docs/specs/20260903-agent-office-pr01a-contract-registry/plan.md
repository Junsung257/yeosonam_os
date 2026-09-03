# Implementation Plan: Agent Office PR-01A

## Sequence

1. Start from the merged PR-00 commit in a clean worktree.
2. Read current Agent Workflow, Agent Office, AI Ops, and PR-00 decisions.
3. Add strict Zod contracts and content-addressed schema references.
4. Register only `research.technology_scout` with a disabled operational binding and a zero-tool profile.
5. Keep the Office Command Registry empty and expose legacy actions only through a non-executable compatibility view.
6. Add deterministic cross-reference, independence, uncertain-outcome, and boundary tests.
7. Run narrow-to-broad verification, publish one PR, and stop.

## Rollback

This slice has no runtime consumer or persistence. Reverting the PR removes the contract modules and SSOT note without data repair, compensation, or deployment migration.

## Next Gate

PR-01B requires a new explicit user decision after PR-01A review or merge. This plan does not authorize a migration.

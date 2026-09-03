# Implementation Plan: Agent Office PR-01C

## Sequence

1. Reconfirm the merged PR-01B baseline and clean worktree.
2. Read the current Agent Office, AI Ops, Research Node, and Foundation contracts.
3. Verify the current official Codex App Server protocol and local generated schema.
4. Add small Runtime types, Provider-policy wrapper, and stdio transport.
5. Implement the inactive Codex subscription adapter behind injected capability
   verification and artifact persistence.
6. Add deterministic negative security and protocol tests.
7. Run narrow-to-broad verification, publish one PR, and stop.

## Rollback

No caller or persistence owner imports the new runtime package. Reverting the PR
removes only inactive TypeScript, tests, and documentation. No data repair,
compensation, deployment, or migration rollback is required.

## Next Gate

PR-01D remains a separate human decision. It must add a manually controlled pilot,
fixed fixtures, behavior evals, and an explicit compatibility proof for the
installed Codex version before any real turn starts.

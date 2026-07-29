# Multi-Agent Stabilization Plan

1. Snapshot active worktrees and PRs before assigning work.
2. Give each worker a disjoint scope and protect blog, RFQ, and product-registration
   work owned by other sessions.
3. Run validation hardening, secret-surface audit, free-travel alignment, and
   collision monitoring independently.
4. Review evidence and integrate only non-overlapping accepted patches.
5. Run focused tests, security/PII checks, type-check, and local public/API proof.
6. Report deferred protected work without merging, deleting, rebasing, or
   force-updating other branches.

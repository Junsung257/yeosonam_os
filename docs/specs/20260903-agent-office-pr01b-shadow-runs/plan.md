# Implementation Plan: Agent Office PR-01B

## Sequence

1. Pin the merged PR-01A commit in a clean worktree and define the owned write surface.
2. Create the migration through the repository Supabase CLI.
3. Add the shadow-only Run table, immutable guard, service-only privileges, and exact-Run lease RPCs.
4. Add a registry-validating TypeScript writer with no runtime caller.
5. Add read-only Task/Trace reconciliation diagnostics.
6. Verify contracts, database privileges, lifecycle, fencing, concurrency, and no-wiring boundaries.
7. Commit, open one PR-01B, confirm CI/Preview evidence, and stop.

## Deliberate Omissions

- No queue claim, automatic dispatch, worker authorization, retry, compensation, or Command execution.
- No Runtime/Provider adapter implementation.
- No historical backfill.
- No KPI or Office read-model integration.
- No external package, Skill, MCP, binary, or service.
- No Production database application.

## Next Gate

PR-01C requires a new explicit decision after PR-01B review. This plan cannot enable any operational runtime.

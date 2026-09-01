# Feature Spec: Codebase Memory read-only pilot

## Goal

Add a pinned, locally contained code graph as an optional discovery aid without letting it become source authority or modify application state.

## Success Criteria

- [x] The official Windows binary and release archive have immutable hashes.
- [x] Secrets, private data, generated output, and graph artifacts are excluded before indexing.
- [x] Only the audit profile exposes an allowlisted MCP surface and manual indexing.
- [x] The 20-question structural benchmark reaches at least 18 correct with no sensitive path exposure or git mutation.
- [ ] Baseline context/tool-call comparison and answer-level false-authority review are recorded before adoption.

## In Scope

- Local binary, audit-profile configuration, repository guardrails, host validation, benchmark corpus and runner.

## Out Of Scope

- Auto installer, hooks, skills, UI, watcher, ADR writes, trace ingestion, shared graph commits, and production use.

## Users And Risks

- Primary audience: engineering agents
- Risk tier: Tier 2
- Sensitive surfaces: repository source and local tool configuration

## Open Questions

- [x] None; Windows freshness detection failed after reindex, so the implementation remains pilot-only and is not adopted in the normal profile.

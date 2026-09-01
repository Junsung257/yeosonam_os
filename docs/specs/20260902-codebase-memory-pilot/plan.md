# Implementation Plan: Codebase Memory read-only pilot

## Approach

Install the attested headless binary outside the repository, configure it only in the read-only audit profile, index manually into an external cache, and keep source-file verification authoritative.

## Impact Areas

- Code: agent host validation and benchmark runner
- Data/API: local graph cache only; no application API or DB change
- UI: disabled
- Docs/tests: MCP SSOT, deterministic host tests, 20-question corpus

## Required SSOT

- `AGENTS.md`
- `docs/agent-mcp-tooling.md`
- `docs/agent-workflow-current-ssot.md`

## Data Flow

Allowed repository files → manual local index → allowlisted structural query → actual source-file verification.

## Risks And Guardrails

- Secret indexing: fail-closed `.cbmignore` and sensitive-result checks.
- Stale or incorrect graph: manual coverage/reindex and mandatory source verification.
- Supply chain: attestation, archive hash, binary hash, exact version, no installer.

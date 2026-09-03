# Feature Spec: Agent Office PR-01D Technology Scout Shadow Pilot

## Goal

Prepare and evaluate the first manually triggered `research.technology_scout`
shadow pilot using pinned public official evidence, strict Work Products, and
independent review receipts. A real model turn is permitted only after the local
Codex App Server proves restricted readable roots.

## Implemented Preflight Scope

- Thirty real project cases with immutable repository, commit, README blob,
  license blob, and release evidence captured on 2026-09-03.
- Strict task inputs and content-addressed public evidence artifacts.
- Thirty schema-valid baseline Work Products and independent deterministic
  contract Review Receipts.
- Conjunctive acceptance evaluation for the Foundation Shadow Pilot gate.
- A protocol attestation gate that rejects a live turn when restricted readable
  roots are not supported.
- A manual offline evaluation command. It does not call a model, database,
  browser, external service, or Production surface.

## Hard Stop Triggered

The official current App Server contract exposes
`sandboxPolicy.readOnly.access.type=restricted` with `readableRoots`. The installed
`codex-cli 0.151.0-alpha.7.2` generated schema exposes only `type` and
`networkAccess` for `ReadOnlySandboxPolicy`. A real turn was therefore not
started.

PR-01D remains blocked until a separately reviewed App Server or operating-system
sandbox proves the same restricted-read boundary. Updating or installing a
binary is outside this PR.

## Authority Boundary

- `agent_tasks` remains Task SSOT.
- `agent_runs` remains an unapplied-to-Production, non-authoritative shadow ledger.
- The Runtime binding remains `contract_only` and `executionEnabled=false`.
- Baseline Work Products are fixtures, not model results and not Technology Radar
  decisions.
- Deterministic Review Receipts are contract evidence, not human review evidence.
- No source hypothesis can install, promote, publish, write, or create a Command.

## Non-Scope

- No live model turn or Codex usage charge.
- No automatic dispatch or delegation.
- No API, UI, Inngest function, scheduler, worker, or Office write.
- No Supabase or Production migration.
- No external package, Skill, MCP, Plugin, binary, or candidate installation.
- No repository modification or PR creation performed by the Scout.
- No Blog Provider or `AiProvider` change.

## Completion Rule

The offline preflight is complete when 30/30 contract fixtures pass and the
source corpus is reproducible. The full pilot is not complete until at least 20
live cases, three independent trials for one identical input, zero hard-gate
violations, complete reproducibility/evidence, and human review for every result
are all present.

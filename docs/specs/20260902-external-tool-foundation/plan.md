# Implementation Plan: external tool safety foundation

## Approach

Add a repository-owned JSON surface contract and external Skill registry with deterministic checks. Apply it prospectively through the Spec template and this task rather than inventing ownership for older active work.

## Impact Areas

- Code: harness scripts and canonical Skill directory
- Data/API: JSON contracts only; no runtime API or DB change
- UI: none
- Docs/tests: workflow SSOT, template, node:test coverage

## Required SSOT

- `AGENTS.md`
- `docs/agent-workflow-current-ssot.md`
- `docs/ai-agent-doc-automation.md`

## Data Flow

Spec map or external source record → deterministic validation → CI pass/fail evidence.

## Risks And Guardrails

- False global ownership: maps are task-local and opt-in through `surface_map_version`.
- Instruction supply chain: no approved status without immutable hash and eval suite.

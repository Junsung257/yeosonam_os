# Feature Spec: Agent Office PR-01A Contract Registry

## Goal

Add a code-owned, versioned contract registry for the first Agent Office role without adding an executor, database table, API, event, UI, provider route, or side effect.

The only registered role and task are `research.technology_scout`. The repository contract is separate from its operational binding; that binding is `contract_only` and `executionEnabled: false`.

## In Scope

- `RoleDefinition`, `TaskDefinition`, `RuntimeProfile`, `ToolProfile`, and `CommandDefinition` schemas.
- Work Product, Review Receipt, Runtime Result, Technology Scout input/output, Reason Code, and design-only Command Receipt schemas.
- Generated JSON Schema hashes bound into Task definitions.
- Exact compatibility mapping to existing `agent_type` and `specialist_id` without reclassifying unrelated legacy work.
- Compatibility-only views over existing `ACTION_REGISTRY` entries.
- Cross-registry and negative safety tests.

## Non-Negotiable Boundary

- Office Command Registry contains zero entries.
- `office.cancel_task` is not registered.
- Runtime operational binding cannot execute.
- Tool profile contains zero tools, credentials, network hosts, writes, destructive operations, or Production access.
- Existing `AiProvider`, Blog DeepSeek-only behavior, `ACTION_REGISTRY`, task persistence, and Inngest workflows are unchanged.
- No migration, external package, Skill, MCP, live model, worker, API, UI, deployment, or Production mutation.

## Success Criteria

- [x] Static registry cross-references validate with zero findings.
- [x] Schema hash tests detect schema drift.
- [x] Reviewer independence requires different Run, actor, and session; high-risk work also requires a different Role.
- [x] `unknown_outcome` cannot be treated as ordinary failure or success.
- [x] Legacy actions remain compatibility-only and cannot become Office Commands.
- [x] Focused tests, type check, Agent workflow checks, telemetry audit, and harness pass.
- [x] PR-01B is not started.

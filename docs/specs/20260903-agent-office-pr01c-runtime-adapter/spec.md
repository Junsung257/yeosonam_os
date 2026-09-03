# Feature Spec: Agent Office PR-01C Runtime/Provider Adapter

## Goal

Add an inactive, read-only Runtime boundary for the Codex subscription worker and
a credential-free compatibility wrapper over the existing AI Provider policy.
Nothing in this PR dispatches a Run or enables the PR-01A operational binding.

## In Scope

- The minimal `health()`, `start()`, and `cancel()` `AgentRuntimeAdapter` contract.
- A task-, Run-, tenant-, and expiry-bound capability-verifier boundary.
- A Codex App Server stdio JSONL client using the stable initialize, thread,
  turn, completion, and interrupt methods only.
- Ephemeral threads, `approvalPolicy` set to `never`, read-only sandboxing, network off,
  restricted read roots, a sanitized child environment, and disabled optional
  Tool/Skill/Plugin/App surfaces.
- Fail-closed detection of any Tool, command, file-change, permission, MCP,
  collaboration, browser, image, or external-write request.
- Strict structured-output validation followed by an injected shadow artifact
  sink. No sink implementation is added here.
- A compatibility adapter that returns a sanitized snapshot from
  `resolveAiPolicyRuntime()` without exposing a Provider credential.
- Deterministic tests with fake transports, verifiers, clocks, and sinks.

## Authority Boundary

- `agent_tasks` remains Task SSOT.
- `agent_runs` remains a non-authoritative, unapplied-to-Production shadow ledger.
- PR-01A Registry binding stays `contract_only` and `executionEnabled=false`.
- No API, workflow, queue selector, Runtime consumer, or automatic dispatch imports
  this adapter.
- `AiProvider` remains exactly `deepseek | claude | gemini`.
- The Blog DeepSeek-only lane never enters this adapter.

## Non-Negotiable Invariants

- The Codex child receives no Supabase, Provider, Vercel, payment, publishing,
  booking, customer, or arbitrary inherited secret environment variable.
- Capability secrets are validated host-side and never sent to App Server,
  output sinks, errors, or telemetry.
- Only `research.technology_scout@1.0.0`, public-classification input, the exact
  contract-only Runtime, and the zero-Office-tool profile are accepted.
- The configured working directory must be an explicit non-root directory within
  the verifier-granted readable roots.
- Runtime output is not successful until it passes the registered payload schema
  and an injected sink returns a valid opaque reference and SHA-256 hash.
- Cancellation only invokes `turn/interrupt`; it never rewrites Task status.
- No raw prompt, response, Tool argument, child stderr, or capability token is
  logged or persisted by the adapter.
- No experimental App Server API is enabled.
- Unknown server requests/items, foreign thread/turn events, and token/deadline
  overruns fail closed.

## Hard Stop

PR-01D must not start if the installed App Server cannot enforce the requested
read-only restricted-root policy, if any optional Tool surface remains active, or
if ChatGPT subscription authentication cannot be distinguished from API-key auth.

## Success Criteria

- [x] Runtime and Provider boundaries compile without changing existing policy.
- [x] Exact contract, tenant, TTL, path, environment, and output checks fail closed.
- [x] App Server messages use ephemeral read-only/no-network settings.
- [x] Tool or approval activity is interrupted and cannot become success.
- [x] Cancellation is runtime-only and idempotent for missing Runs.
- [ ] Focused tests, type check, Agent workflow checks, telemetry audit, and harness pass in CI.
- [x] PR-01D is not started.

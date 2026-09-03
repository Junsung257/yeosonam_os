# Review: Agent Office PR-01C

## Scope Result

- Added an inactive `AgentRuntimeAdapter` boundary with `health`, `start`, and
  Runtime-only `cancel`.
- Added a Codex App Server stdio JSONL transport and one Codex subscription
  Technology Scout adapter.
- Added a credential-free wrapper over the existing Provider policy resolver.
- Added no API, queue, workflow, sink, verifier implementation, automatic
  delegation, Production Command, Office write, migration, package, Skill, MCP,
  Provider-union change, or Blog routing change.
- Kept the operational binding `contract_only` and `executionEnabled=false`.

## Enforced Boundary

- The child environment is allowlisted and excludes Supabase, AI Provider,
  Vercel, payment, publication, booking, and customer Secrets. ChatGPT
  subscription state remains intentionally available through the Codex profile.
- The App Server request uses an ephemeral thread, sets `approvalPolicy` to `never`, and uses a
  read-only/no-network sandbox, one canonical restricted root, no MCP servers,
  and disabled optional Tool/Skill/Plugin/App surfaces.
- Host-verified claims must match the exact Run, Task, tenant, Role, data class,
  TTL, and readable roots. Evidence references, classification, size, and
  SHA-256 content are checked before the App Server opens.
- Every server request, non-allowlisted item type, model reroute, foreign
  thread/turn event, token-budget overrun, or deadline overrun fails closed and
  cannot persist a successful Artifact.
- Final text must parse as JSON and pass the registered Technology Radar schema.
  The injected sink must return a valid opaque Artifact reference and SHA-256.
- Cancellation acknowledges only `turn/interrupt`; it never changes Task state.

## Verification

| Check | Result |
|---|---|
| Runtime + Contract + Run-ledger Vitest | PASS — 43/43 |
| Scoped TypeScript compile | PASS |
| New Runtime TypeScript ESLint | PASS — zero warnings |
| Declared Agent write-surface check | PASS |
| Agent workflow strict check | PASS — zero findings |
| LLM telemetry strict audit | PASS — existing 30 callers, 2 traced, 28 grandfathered; no delta |
| Secret-access audit | PASS |
| Generated system inventory | PASS — current |
| Agent risk ratchet | PASS — new violations 0 |
| Full repository harness | PASS — deterministic contracts 30/30 and audit tests 29/29 |
| Whitespace/error-marker check | PASS |
| Codex Security final diff scan | PASS — 6/6 source files, reportable findings 0 |
| Full repository TypeScript compile | PENDING — fresh-dependency GitHub CI required |
| GitHub Build & Test / Code Quality / Security / Next build | PENDING |

Final security snapshot:

- scan: `068c0585-cf43-4439-b141-739474122058`
- digest: `codex-security-snapshot/v1:sha256:30f4aae49912fc584b536c9ba87a976595eaae7bef8aca81986860b43eb9bc0d`
- result: zero reportable findings

## Compatibility Gate and Residual Risk

The development host uses `codex-cli 0.151.0-alpha.7.2`. Its generated local
turn schema does not yet expose the official restricted
`access.readableRoots` request shape. The adapter deliberately sends the
stricter official shape, so this host must reject before a live turn can start.
PR-01D remains blocked until a compatible App Server enforces restricted roots
or an independently verified operating-system sandbox provides the equivalent.

The final static scan found no currently reachable vulnerability because this
package has no caller and its registry binding is disabled. Activation still
requires separate review of:

1. a durable PR-01B Lease/Fencing claim before `start`;
2. a capability bound to immutable task/evidence digests and a one-time Run;
3. concrete tenant-owning verifier, evidence-source, and canonical-hash sink;
4. task-bound cancellation authorization and terminal reconciliation;
5. an attested Codex executable/configuration and provider retention posture.

The local worktree reuses the original repository's existing dependency folder
without installing packages. Its full repository type check cannot resolve
dependencies added on newer `main` (including OpenAPI, Workflow, table,
document, Chromium, and logger packages). The PR-01C scoped compile is clean and
the full compile must pass in GitHub CI after a fresh dependency restore.

No live model turn, Production database, deployment, external write, or
Production Secret was used. PR-01D was not started.

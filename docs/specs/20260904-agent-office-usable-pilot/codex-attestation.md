# Codex protocol attestation (2026-09-04)

Command: `npm run attest:technology-scout-runtime`

Observed local result (no model turn):

- Codex `0.153.0-alpha.5`
- ChatGPT subscription account accepted
- `:read-only` permission profile listed and active
- ephemeral thread accepted
- `runtimeWorkspaceRoots` echoed to the requested worktree
- sandbox reported `readOnly` with `networkAccess=false`
- optional app/plugin/MCP/shell surfaces disabled by the worker arguments
- `turn/start` was not called

This attestation proves protocol compatibility only. It does not authorize a
Production worker, apply `agent_runs`, or satisfy the 20-case/3-trial/human-review
live Pilot gate.

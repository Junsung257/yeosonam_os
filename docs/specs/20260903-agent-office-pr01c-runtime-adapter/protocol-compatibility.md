# Codex App Server Protocol Compatibility

## Official Contract Used

The implementation follows the current official Codex App Server contract:

- stdio is the default newline-delimited JSON transport;
- one `initialize` request and `initialized` notification precede other calls;
- `thread/start`, `turn/start`, `turn/completed`, and `turn/interrupt` are the
  only lifecycle methods used;
- the root thread is requested as ephemeral;
- the turn sets `approvalPolicy` to `never`, uses a read-only/no-network sandbox, a
  restricted read root, and a JSON output schema;
- experimental API capability is explicitly disabled.

Primary source: <https://developers.openai.com/codex/app-server>

The official page recommends the Codex SDK for CI and job automation. PR-01C
keeps App Server because the approved Foundation decision explicitly selected
its stdio boundary. This is not a Production recommendation and remains open to
reconsideration before Runtime promotion.

## Local Compatibility Probe

The development host reported `codex-cli 0.151.0-alpha.7.2`. Its generated
`TurnStartParams` accepted read-only `networkAccess` but did not yet expose the
official restricted `access.readableRoots` shape. The generated schema was
inspected from a temporary directory and was not committed.

A no-turn stdio health probe using the sanitized environment completed the
initialize handshake and returned an authenticated `chatgpt` account type. The
probe did not start a thread, invoke a model, or print account identity fields.

The adapter still sends the stricter official shape. An older server must reject
that request before a model turn can start; the adapter converts that rejection
to a stable transport failure and cannot treat it as success.

The real PR-01D pilot is therefore blocked on one of these separately reviewed
proofs:

1. an installed App Server version accepts and enforces restricted read roots; or
2. an operating-system sandbox provides an equivalent independently verified
   boundary.

Updating Codex, changing the sandbox, or starting a live turn is not part of
PR-01C. No package, Skill, MCP, Plugin, or binary was installed.

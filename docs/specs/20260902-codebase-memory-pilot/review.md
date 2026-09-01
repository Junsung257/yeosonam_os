# Codebase Memory pilot review

## Evidence

- [x] Official v0.10.8 archive attestation verified; archive SHA-256 `b43ad982...f81c34d`, binary SHA-256 `b4b403b1...7a336a6`.
- [x] Manual fast index completed with 36,127 nodes, 151,792 edges, external cache, and no portable artifact.
- [x] Retrieval: 20/20 anchors, sensitive exposure 0, git mutation 0, median returned context estimate 1,242.5 tokens, one tool call, 129.5 ms warm stdio median.
- [x] Freshness: failed closed because all 35 expected source anchors were reported `metadata_changed` immediately after reindex; `structuralGatePassed=false`.
- [x] Host checks: repository-only and local audit-profile validation passed after restoring `ui_enabled=false`; no daemon or UI listener remains.
- [x] Harness checks passed (30/30 deterministic contracts, 23/23 harness audit tests, zero documentation findings). Repository-wide type-check was attempted but the shared pre-existing dependency tree lacks packages including `workflow`, `openapi-typescript`, and `@tanstack/react-table`; no CBM-changed TypeScript file exists.

## Remaining risk

- [x] v0.10.8 has no `watcher_enabled` setting; `auto_watch=false` plus manual-only indexing is enforced instead.
- [x] MCP configuration becomes active only in a newly started audit-profile session.
- [x] Baseline token/tool comparison, answer-level review, and reliable Windows freshness detection remain required before normal-profile adoption. `falseAuthoritativeAnswers` is deliberately `null`, not a fabricated zero.

# Marketing Ad OS 95 Scorecard Spec

Date: 2026-06-28

## Objective

Add a durable deep scorecard for the full marketing automation surface so the system can show current maturity, target every category at 95+, and generate an internal AI repair queue without mutating external ad platforms.

## In Scope

- 15 marketing domains with 70+ subcategories.
- Per-subcategory current score, target score, blockers, evidence, source refs, and repair action.
- A source-ledger package with at least 100 reviewed source records.
- Read-only deep scorecard API.
- Guarded repair-plan API that can persist internal rows only.
- Admin UI surface inside `/admin/ad-os`.
- Local verification script and unit tests.

## Out of Scope

- No live ad spend.
- No external provider mutation.
- No remote database migration application.
- No credential changes.
- No publishing to blog, Meta, Google, Naver, Kakao, or Threads.

## Safety Contract

- External API writes stay `false`.
- Live spend stays `0`.
- Full auto remains disabled.
- MCP is read-only evidence brokering only.
- Internal persistence is limited to score snapshots and repair queue rows.

# Jarvis Autopilot 95 Spec

## Goal

Build the first production-safe slice of Jarvis Autopilot:

- Jarvis prepares the decision, evidence, dry-run, risk, and recommended action.
- The owner reviews a single packet and clicks approve or reject.
- Mutations for money, bookings, customer data, policies, external publishing, credentials, and privacy remain human-approved.

## Scope

- Add a central action registry for mutating Jarvis tools and agent actions.
- Add decision packets for `agent_actions` so the approval UI can explain why an action is safe or risky.
- Add dry-run simulation before approval.
- Expand HITL coverage for mutating tools that were documented as approval-required but missing from the runtime list.
- Surface the packet in `/admin/jarvis` action approval flow.
- Add readiness/test coverage for registry completeness and approval-gated tools.

## Non-Goals

- No fully unattended execution for high-risk production mutations.
- No remote database migration application in this session.
- No external ad, payment, refund, booking, or PII mutation without the existing approval click.

## Acceptance

- `requiresHITL()` returns true for every mutating Jarvis tool listed in the registry.
- Agent action approval performs a dry-run check and stores a decision packet.
- Admin approval UI shows recommendation, risk, evidence, dry-run result, and rollback hint.
- Unknown action execution still fails closed through `executeAction`.
- Verification includes unit tests and Jarvis readiness/type checks.

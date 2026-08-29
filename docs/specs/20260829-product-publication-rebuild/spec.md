# Product Publication Rebuild Spec

Date: 2026-08-29
Base: `origin/main@579cbb245`
Risk tier: Tier 3

## Goal

Make product upload, canonical fact persistence, customer copy, mobile proof, and customer publication one observable pipeline while preserving fail-closed customer routes.

## Required behavior

- Registration, audit, sale operation, and publication remain separate state authorities.
- `approved` is an internal review decision and never a customer-visible publication state.
- Customer routes require a `published` pointer whose snapshot, package revision, source hash, render hash, proof, and release manifest all match.
- Admin users request publication through one idempotent command and never write public states directly.
- NET, supplier selling price, and request-only prices retain their source meaning; no synthetic NET value is reverse-calculated.
- Customer copy is generated only from source-backed canonical facts and is rejected when it is generic, cross-product, internally sensitive, or numerically inconsistent.
- Product hero/gallery media must be supplier, official, or otherwise verified documentary media; generated media and the brand logo are not publication-ready product evidence.
- Home, catalog, search, destination, detail, landing, sitemap, Jarvis, and marketing readers use one public-catalog authority.
- Cache refresh and live-domain canary are outbox work, not part of the database transaction.

## Safety boundaries

- No production database mutation, deployment, domain change, or auto-publish enablement in this implementation session.
- Existing user worktrees and uncommitted changes are preserved.
- PR #1163 is a reference implementation only; it must not be merged wholesale.
- Existing source preservation, source hashes, internal-information blocking, attraction SSOT, current-revision snapshots, browser proofs, CTA checks, and fail-closed routes must not be weakened.

## Acceptance

- Characterization, unit, migration-contract, RLS/role, race, public-egress, and mobile browser tests pass.
- A stale revision or stale proof cannot publish.
- A partial price/package write rolls back.
- Public surface product-id sets agree.
- Production writes remain zero and auto-publish remains off.

# Affiliate Critical Remediation

Date: 2026-08-08
Tier: 3 (affiliate, authentication, settlement, PII, and database contracts)
Owner branch: `affiliate-critical-remediation`

## Objective

Make the affiliate journey fail closed from application through authentication, publication, attribution, commission, settlement, payout, and correction. A click, booking, commission entry, settlement line, and payout must be explainable through stable identifiers and immutable evidence.

## Current Evidence

- The active production schema does not contain `affiliate_applications.has_invite_code`, while `POST /api/partner-apply` writes it.
- The repository contains an older additive migration for that column, but the active migration history does not show it as applied.
- All seven current affiliate rows contain a plaintext `portal_pin`; six also have a `pin_hash`.
- `GET /api/influencer/content` resolves a tenant from the caller-supplied referral code without authentication.
- `/with/[slug]` creates a new 72-hour deadline per request and renders unsupported verification, exclusivity, and `price * 0.95` discount claims.
- Authentication is split across legacy routes, uses `inf_token` without a server session, retains plaintext PIN compatibility, and includes development secret fallbacks.

These checks were read-only. No production money, booking, customer, credential, or schema mutation is authorized by this packet.

## Required Outcomes

1. Application submission and review use a schema-checked, idempotent contract.
2. Affiliate content reads require authentication and enforce tenant ownership.
3. Unsupported discount, scarcity, verification, and exclusivity claims never render.
4. Public URLs come from one validated application origin.
5. One affiliate session cookie is backed by revocable server-side sessions; suspended, terminated, or rotated partners lose access immediately.
6. Plaintext PIN login is removed after a staged credential rotation; no development secret fallback remains.
7. Creator attribution codes and real price discounts are separate contracts.
8. Publications are the stable source identifier for click and booking attribution.
9. Commission calculation is versioned and held when policy evidence is unavailable.
10. Settlement V2 freezes ledger lines and payout evidence; corrections use revisions and reversals.
11. The canonical `/partner` portal distinguishes data unavailable from true zero states and works at 320px and 200% zoom.

## Safety Boundaries

- Do not apply migrations to the remote production project in this work.
- Do not update production affiliate credentials, settlements, bookings, or payouts.
- Do not auto-migrate legacy settlement rows into V2.
- Every DDL change must be additive or have a documented down migration/rollback procedure.
- Existing public behavior is preserved unless it violates authentication, tenant isolation, financial evidence, or truthful-marketing invariants.
- Service-role credentials remain server-only.

## Out Of Scope Until Separate Approval

- Production credential rotation and invitation delivery.
- Production migration application or data backfill.
- Automated social publishing.
- Automated payout completion, voiding, or bank recovery.
- Policy choices listed in `docs/affiliate-data-contract-v2.md` that require business approval.


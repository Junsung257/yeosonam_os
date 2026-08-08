# Implementation Plan

## Delivery Units

1. **P0 contract hotfix**
   - Reconcile application schema drift with an additive migration and CI schema contract.
   - Authenticate and tenant-scope content reads.
   - Remove unsupported co-brand claims.
   - Introduce and adopt one validated public-origin builder on touched paths.

2. **Authentication foundation**
   - Add invitations, sessions, token version, revocation, and audit fields.
   - Move login/status/logout to the shared affiliate auth service.
   - Stop returning tokens to browser JavaScript and remove legacy local-storage use.
   - Stage plaintext PIN deprecation and document production rotation.

3. **Commission and promotion contract**
   - Separate creator codes from approved discount campaigns/redemptions.
   - Add versioned commission policies and mandatory system cap.
   - Freeze booking calculation evidence and hold on policy read failure.

4. **Publication attribution contract**
   - Add `affiliate_publications` and stable publication redirects.
   - Carry publication/link/content/event identifiers through touchpoints and booking attribution decisions.
   - Use atomic counters and explicit invalid/duplicate/bot states.

5. **Settlement ledger V2**
   - Add commission ledger, runs, lines, payouts, revisions, and disputes.
   - Freeze READY evidence and prohibit mutation of completed payouts.
   - Represent corrections as reversal entries and revisions.
   - Read PDFs from frozen lines.

6. **Canonical partner experience and metrics**
   - Add the partner catalog contract and clear unavailable/empty states.
   - Establish `/partner` as canonical and isolate route layouts.
   - Add onboarding, publication, earnings, and dispute surfaces in risk order.
   - Correct metric definitions and never turn query failures into zero.

## Rollout Order

For each unit: migration/schema contract -> server library -> API -> UI -> focused tests -> type/lint/build -> deployment checklist. Remote migration, credential rotation, and production data changes remain manual approval gates.


# Verification Contract

## Ordered Gates

1. **Applicability**: prove the current source-to-sink path and production/schema drift with read-only evidence.
2. **Security and financial closure**: run focused regression tests for each broken boundary.
3. **Preserved behavior**: run positive controls for the owning partner and valid public landing.
4. **Schema safety**: migration lint/dry run, RLS/grant review, schema drift check, and rollback review.
5. **Repository checks**: type check, lint, focused suites, affiliate Playwright E2E, and production build.

## Required Scenarios

- T39 through T68 from the remediation brief are required.
- Additional negative controls: invalid origin configuration, missing JWT secret, revoked session, token-version mismatch, tenant code mismatch, unauthenticated content read, unavailable policy, and attempted completed-payout mutation.

## Evidence Labels

Final reporting separates:

- implemented in source;
- verified by automated test;
- validated only by static/schema evidence;
- unverified because production data or external delivery was not mutated;
- blocked on a business-policy decision;
- manual before deployment.

## Remote Safety

All production SQL in this task is read-only. Applying migrations, rotating credentials, creating invitations, changing partner state, or changing settlement/payment data requires a separate explicit approval.


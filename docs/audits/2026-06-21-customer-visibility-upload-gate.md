# Customer Visibility Upload Gate Audit

Date: 2026-06-21

## Finding

An upload could return `success=true` and `gate=CLEAN` when the row was saved in a review-only package status. The admin upload verify endpoint could also report `clean` because it compared source facts only and did not check customer visibility status.

## Impact

Operators could see a saved upload as clean while the customer mobile URL still rendered the not-found page because `/packages/[id]` only exposes customer-visible statuses.

## Fix

- Upload responses now include `customerPublishable`, `customerPublishableCount`, `customerBlockedCount`, and blocked package summaries.
- Saved packages that are not customer-visible now promote the response gate from `CLEAN` to `REVIEW_NEEDED`.
- Upload verification adds `C13 customer visibility gate` and blocks non-visible or audit-blocked packages from being reported as clean.

## Verification

- `npx vitest run src/lib/product-registration/upload-response.test.ts src/lib/upload-verify.test.ts`
- `npm run type-check`


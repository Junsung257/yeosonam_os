# Open Readiness PR Notes (2026-05-30)

## Scope

- UX/UI audit outputs, customer CTA wording cleanup, admin design-token consolidation, PII surface hardening, event taxonomy checks, marketing/analytics readiness work, and dashboard contract audit scripts.
- The goal is to move the site toward soft-open readiness and prepare a reviewable PR before public advertising spend.

## Passed Gates

- `npm run type-check -- --pretty false` passed.
- `npm run lint` passed.
- `npm run audit:event-taxonomy` passed.
- `npm run audit:pii-surface:strict` passed with `strict_blockers=0`.
- Customer CTA wording scan passed for misleading pre-payment wording:
  `예약하기|카톡 예약하기|바로 예약|자세히 보기 / 예약하기|이 구성으로 예약하기|예약 가능 날짜|바로 예약 가능|여행 예약하기`.
- Admin exact card-shadow legacy pattern scan passed for:
  `bg-white rounded-admin-md border border-admin-border shadow-[0_1px_4px_rgba(0,0,0,0.04)]`.

## Remaining Open Gate

- `npm run build` is not yet a clean pass in the local Windows workspace.
- The first dirty `.next` run failed in Next generated route validation.
- After cleaning `.next`, standalone `npx tsc -p tsconfig.json --noEmit --pretty false --incremental false` passed, but `next build` later hung/terminated around the production build/type-validation phase without a stable application error.
- This must be re-run in CI/Vercel or a clean Linux build environment before paid advertising is launched.

## Launch Judgment

- Soft-open to internal users or a very small trusted audience: acceptable after PR review.
- Public paid-ad launch: hold until Vercel/CI production build passes and production smoke tests pass on `www.yeosonam.com`.
- Admin password used during the audit session must be rotated before any public campaign.

# P0 Security Verdicts

기준 HEAD는 `eb582cabd6d16b98bd26ca8fca8ddc740fb80845`, production SHA도 동일하다.
아래 FIXED는 이 브랜치의 코드와 focused test 기준이며, production 배포 완료를 뜻하지 않는다.

| Finding | Actor → source → control → sink | Baseline verdict | Branch result | Evidence |
|---|---|---|---|---|
| Cron query-string secret | internet caller → `?secret=` → shared-secret compare → privileged cron handler | CONFIRMED | FIXED | `src/lib/cron-auth.test.ts` |
| `x-vercel-cron` as credential | internet caller → forged header → cron handler | ALREADY_FIXED | NO_CHANGE_ALREADY_SAFE | `src/lib/cron-auth.test.ts` |
| Affiliate JWT fallback | influencer caller → predictable invite/default key → JWT issue/verify → affiliate session | CONFIRMED | FIXED | `src/lib/affiliate/jwt-auth.test.ts` |
| Affiliate PIN HMAC fallback | influencer caller → shared/hardcoded key → PIN hash → affiliate authentication | CONFIRMED | FIXED | `src/lib/affiliate/auth-service.test.ts` |
| Guidebook token fallback | public token holder → service-role/default key → token issue/verify → guidebook access | CONFIRMED | FIXED | `src/lib/guidebook-token.test.ts` |
| OAuth state `dev` fallback | internet caller → predictable state signature → OAuth callback → external account token storage | CONFIRMED | FIXED | `src/lib/oauth-state.test.ts`, route boundary test |
| Public passport OCR | anonymous caller → passport image → Gemini payload/client response → passport/MRZ exposure | CONFIRMED | FIXED | `src/app/api/public-pii-boundary.test.ts` |
| Public companion passport collection | token holder → passport/phone/birth input → plaintext `booking_companions` write | CONFIRMED | FIXED | `src/app/api/public-pii-boundary.test.ts` |
| Private-tour mock proof | anonymous visitor → `MOCK_FEED`, `120+` → production UI → false trust signal | CONFIRMED | FIXED | `src/app/private-tour/public-claims.test.ts` |
| Broad authenticated RLS | any Supabase authenticated user → global allow policy → bookings/customers/internal tables → cross-user PII/financial reads/writes | CONFIRMED | PARTIALLY_FIXED | additive migration + pgTAP contract; production apply pending |
| Raw internal errors | public API caller → provider/DB/config failure → raw `error.message` → customer response | CONFIRMED on reviewed P0 routes | PARTIALLY_FIXED | companion/influencer/passport/lead paths fixed; repository-wide inventory remains |

## RLS scope and limitation

`booking_companions`, `leads`, snapshots, attribution, and task tables were already service-role-only or
default-deny. `bookings`, `customers`, `qa_inquiries`, `raw_documents`, `secure_chats`, `tenants`,
`transactions`, and `ai_responses` had global authenticated policies.

All 88 bookings and 90 customers currently have `tenant_id IS NULL`. A tenant-only rewrite would therefore
break the legitimate current operator path without proving tenant isolation. The P0 migration quarantines
these tables behind `admin_users` membership while preserving service-role server flows. Tenant backfill and
real tenant A/B fixtures remain a later proof obligation.

## Deployment requirements

- Configure `AFFILIATE_JWT_SECRET`, `GUIDEBOOK_TOKEN_SECRET`, and `OAUTH_STATE_SECRET` before deploying.
- Review and apply the additive RLS migration through the normal Supabase migration workflow.
- Run `supabase test db supabase/tests/revenue_rescue_sensitive_rls.sql` against a local/branch database.

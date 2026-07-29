# Audit Reconciliation

| Claim | Original reported value | Current value | Evidence | Verdict | Confidence |
|---|---:|---:|---|---|---|
| Next.js version | 15.5.18 | 15.5.21 | `package.json`, lockfile | STALE | high |
| `travel_packages` count | 919 | 919 | `queries/01-core-row-counts.sql` | CONFIRMED | high |
| `products` count | 보고값 미제공 | 792 | `queries/01-core-row-counts.sql` | UNRESOLVED_ORIGINAL | high current / none original |
| `bookings` count | 보고값 미제공 | 88 | `queries/01-core-row-counts.sql` | UNRESOLVED_ORIGINAL | high current / none original |
| Public sellable offers exist | 0 | active snapshots 0, publishable decisions 0 | `queries/02-public-offer-readiness.sql` | CONFIRMED | high |
| Home has no sellable offers | “판매 중인 상품이 없습니다” | 동일 문구 재현 | production browser | CONFIRMED | high |
| Private-tour CTA redirects to login | login redirect | `/private-tour`, no login redirect | production browser, matching deployment SHA | ALREADY_FIXED | high |
| Cron trusts only `x-vercel-cron` | 단독 인증 | `src/lib/cron-auth.ts`는 사용하지 않음 | current HEAD source | ALREADY_FIXED | high |
| Cron accepts query `?secret=` | 허용 | 허용 | `src/lib/cron-auth.ts` | CONFIRMED | high |
| Private tour shows mock reception feed | `MOCK_FEED` | production에 노출 | source + browser | CONFIRMED | high |
| Private tour shows `120+` progress | 고정값 | production에 노출 | source + browser | CONFIRMED | high |
| Group RFQ validates first wedge | 0건 | 0건 | `queries/01-core-row-counts.sql` | NOT_SUPPORTED | high |
| Automation exceeds current revenue evidence | 다수 cron·agent·blog/ad automation | 24h cron 68회, success 38·error 2·partial failure 28; 상세 분류 진행 중 | DB + `vercel.json` | PARTIALLY_CONFIRMED | medium |
| RLS no-policy means broad access | 위험 | 50개, 기본 거부 | catalog + Supabase RLS semantics | NOT_REPRODUCIBLE | high |
| Production dependency vulnerabilities exist | 보고값 불명 | 0 | `npm audit --omit=dev --json` | STALE_OR_NOT_REPRODUCIBLE | high |

모든 current DB 값의 project ref는 `ixaxnvbmhzjvupissmly`, repository SHA는
`eb582cabd6d16b98bd26ca8fca8ddc740fb80845`다. 원 보고서의 exact 값·시각·query가 제공되지
않은 항목은 현재 값이 정확하더라도 원 claim과 일치 여부를 추정하지 않는다.

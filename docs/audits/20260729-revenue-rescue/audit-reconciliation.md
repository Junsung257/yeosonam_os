# Audit Reconciliation

| Claim | Original reported value | Current value | Evidence | Verdict | Confidence |
|---|---:|---:|---|---|---|
| Next.js version | 15.5.18 | 15.5.21 | `package.json`, lockfile | STALE | high |
| `travel_packages` count | 919 | 919 | `queries/01-core-row-counts.sql` | CONFIRMED | high |
| `products` count | 보고값 미제공 | 792 | `queries/01-core-row-counts.sql` | UNRESOLVED_ORIGINAL | high current / none original |
| `bookings` count | 보고값 미제공 | 88 | `queries/01-core-row-counts.sql` | UNRESOLVED_ORIGINAL | high current / none original |
| Public sellable offers exist | 0 | active snapshots 0, publishable decisions 0 | `queries/02-public-offer-readiness.sql` | CONFIRMED | high |
| 부산출발 상품 1개를 현재 가격·좌석으로 공개할 수 있음 | 가설 | 후보는 있으나 가격일 미확정·좌석 0·operator 미확인·publication blocked | `queries/11-busan-offer-candidates.sql`, `outputs/offer-candidate.json` | BLOCKED_OFFER_CANDIDATE | high |
| Home has no sellable offers | “판매 중인 상품이 없습니다” | 동일 문구 재현 | production browser | CONFIRMED | high |
| Private-tour CTA redirects to login | login redirect | `/private-tour`, no login redirect | production browser, matching deployment SHA | ALREADY_FIXED | high |
| Cron trusts only `x-vercel-cron` | 단독 인증 | `src/lib/cron-auth.ts`는 사용하지 않음 | current HEAD source | ALREADY_FIXED | high |
| Cron accepts query `?secret=` | 허용 | baseline에서 재현, branch에서 거부 | `src/lib/cron-auth.test.ts` | CONFIRMED_FIXED_IN_BRANCH | high |
| Private tour shows mock reception feed | `MOCK_FEED` | baseline production 재현, branch에서 제거 | source + browser + focused test | CONFIRMED_FIXED_IN_BRANCH | high |
| Private tour shows `120+` progress | 고정값 | baseline production 재현, branch에서 제거 | source + browser + focused test | CONFIRMED_FIXED_IN_BRANCH | high |
| Predictable JWT/HMAC fallbacks | 보고값 불명 | affiliate JWT/PIN, guidebook, OAuth state에서 재현 | `security-verdicts.md` | CONFIRMED_FIXED_IN_BRANCH | high |
| Public passport collection is safe | 안전성 불명 | OCR provider 전송·전체 MRZ 응답과 동행자 평문 write 재현 | `security-verdicts.md` | CONFIRMED_FIXED_IN_BRANCH | high |
| Authenticated users are tenant-isolated | 격리 필요 | 8개 민감 테이블에서 global authenticated policy 확인 | catalog + route review | CONFIRMED_PARTIAL_FIX | high |
| 익명 사용자는 고객 이벤트를 읽을 수 없음 | 보고값 불명 | baseline 정책은 `tenant_id IS NULL` 이벤트 SELECT 허용 | catalog policy definition | CONFIRMED_PARTIAL_FIX | high |
| Group RFQ validates first wedge | 0건 | 0건 | `queries/01-core-row-counts.sql` | NOT_SUPPORTED | high |
| Automation exceeds current revenue evidence | 다수 cron·agent·blog/ad automation | 24h cron 68회, success 38·error 2·partial failure 28; 상세 분류 진행 중 | DB + `vercel.json` | PARTIALLY_CONFIRMED | medium |
| RLS no-policy means broad access | 위험 | 50개, 기본 거부 | catalog + Supabase RLS semantics | NOT_REPRODUCIBLE | high |
| Production dependency vulnerabilities exist | 보고값 불명 | 0 | `npm audit --omit=dev --json` | STALE_OR_NOT_REPRODUCIBLE | high |

모든 current DB 값의 project ref는 `ixaxnvbmhzjvupissmly`, repository SHA는
`eb582cabd6d16b98bd26ca8fca8ddc740fb80845`다. 원 보고서의 exact 값·시각·query가 제공되지
않은 항목은 현재 값이 정확하더라도 원 claim과 일치 여부를 추정하지 않는다.

브랜치 수정 검증과 production baseline을 혼동하지 않는다. 상세 finding chain, 회귀 테스트,
배포 전 환경변수 및 RLS 적용 요구사항은 `security-verdicts.md`에 있다.

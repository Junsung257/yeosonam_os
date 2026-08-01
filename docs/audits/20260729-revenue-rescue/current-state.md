# Current State

## Locked baseline

| Item | Value |
|---|---|
| Main HEAD | `eb582cabd6d16b98bd26ca8fca8ddc740fb80845` |
| Production deployment SHA | `eb582cabd6d16b98bd26ca8fca8ddc740fb80845` |
| Main/production divergence | 없음 |
| Node.js | `v24.14.0` |
| npm | `11.9.0` |
| Next.js | `15.5.21` |
| package-lock SHA-256 | `244fa2bfb5a2eb7b9d7f81bcd64006cd87b7dbf217fdb63259cacb3e650dbf11` |
| Local latest migration file | `20260728223500_add_local_transport_information_intent.sql` |
| Production latest migration | `20260728231547 add_local_transport_information_intent` |
| API route files | 664 |
| Page route files | 208 |
| Middleware public allowlist rules | 229 (146 exact + 28 short exact + 55 prefix) |
| Vercel cron schedules | 90 |
| Production dependency vulnerabilities | 0 |

Public count is not a route-file count. It is the number of middleware literal rules, and a
single prefix rule may cover multiple runtime URLs.

로컬 migration filename timestamp와 production migration history version이 다르다. 이름은
같지만 history를 재작성하거나 동일하다고 가정하지 않는다.

## Exact production observations

Core count 관측 시각은 `2026-07-29T10:09:13.448868Z`다.

| Metric | Exact value |
|---|---:|
| `travel_packages` | 919 |
| `products` | 792 |
| `public_package_snapshots` | 0 |
| Active public snapshots | 0 |
| Latest publishable decisions | 0 |
| `leads` / recent 30 days | 11 / 0 |
| `qa_inquiries` / recent 30 days | 118 / 0 |
| `group_rfqs` | 0 |
| `bookings` / recent 30 days | 88 / 0 |
| Non-deleted bookings with `paid_amount > 0` | 39 |
| `transactions` | 0 |
| `bank_transactions` | 234 |
| `ledger_entries` | 61 |
| `settlements` | 1 |
| `content_attribution_events` | 0 |
| `meta_conversion_events` | 3 |
| `ad_os_performance_facts` | 1000 |
| Cron runs 24h: total / success / error / partial failure | 68 / 38 / 2 / 28 |

Empty-table 관측 시각은 `2026-07-29T09:58:31.699888Z`다. `public` 367개 테이블 중
178개가 exact count 0, 189개가 non-empty였다.

## RLS interpretation

`public` 367개 테이블 모두 RLS가 enabled다. 정책은 361개이며, 50개 테이블은 policy가
없다. 이는 일반적인 Postgres RLS 기본 거부이므로 “authenticated 전체 허용”으로 계산하지
않는다. `authenticated` role이 포함된 정책은 50개, `authenticated` 또는 `public`에
`USING true`가 포함된 읽기 정책은 14개다. 이 14개도 데이터 민감도와 실제 route를 검토하기
전에는 취약점으로 확정하지 않는다.

## Production browser observations

- 홈은 “판매 중인 상품이 없습니다”를 표시한다.
- 홈의 실제 “단독맞춤” 링크는 현재 `/private-tour`로 이동하며 로그인으로 redirect되지 않는다.
- `/private-tour`는 `MOCK_FEED` 기반 “최근 접수 현황”과 고정 `120+` 누적 진행을 노출한다.

따라서 과거 login redirect finding은 현재 production에서 재현되지 않지만, 공개 상품 부재와
허위 사회적 증거 finding은 현재도 재현된다.

## Continuation deployment observation

`2026-07-30T06:12:37.2540342Z`에 다시 조회한 결과, 시작 시점의 locked baseline 이후
production 배포가 변경됐다.

| Item | Continuation value |
|---|---|
| Current `origin/main` | `8b5ba2515714ca4545ddf43f16e98b040850ed77` |
| Latest production target deployment | `dpl_Eh6dNToTFKkg85dwoEvpEW7dTRoc` |
| Latest production target SHA | `62e08bc9dcb876a9f3cec8973f2b9f840cec3e13` |
| Deployment source ref | `codex/ai-operations-office-source-20260728` |
| Deployment metadata | `gitDirty=1` |
| Main/production divergence | 있음 |

이 continuation 관측은 시작 시점 baseline을 덮어쓰지 않는다. 현재 production 동작은
`origin/main` 또는 revenue-rescue PR 코드로 추정하지 않으며, production 배포 출처를 먼저
확정하기 전에는 이 PR을 production에 적용하지 않는다.

### Deployment drift resolution

`2026-07-30T10:01:03.8040443Z` 재확인 시 production은 다시 `main` 배포로 교체됐다.

| Item | Resolved value |
|---|---|
| Current `origin/main` | `c3d2e97c514ba8ddce65883dc281a652ea58b602` |
| Current production deployment | `dpl_96r5cJHbvztb2ZUeEwV6VBhWpsej` |
| Current production SHA | `c3d2e97c514ba8ddce65883dc281a652ea58b602` |
| Main/production divergence | 없음 |
| Recent production 5xx logs | 최근 30분 0건 |

블로그 복구 PR `#1000`, `#1001` 반영 뒤 revenue PR의 Open Readiness 재실행도
`2026-07-30T10:01:16Z`에 성공했다. 앞선 dirty non-main production 배포 사실은 시점
증거로 보존하되, 현재 blocker에서는 해제한다.

### Production recheck — 2026-08-01

읽기 전용으로 다시 확인한 결과는 `outputs/production-recheck-20260801.json`에 보관했다.

| Item | Recheck value |
|---|---|
| Production migration head | `20260731123649 destination_media_approval_audit` |
| Revenue Rescue migrations applied | 없음 |
| `travel_packages` / `products` | 919 / 792 |
| `public_package_snapshots` | 0 |
| `leads` / `bookings` | 11 / 127 |
| `content_attribution_events` / `customer_events` | 2 / 0 |
| Security advisors | 52 (INFO 50, WARN 2) |
| Non-production Supabase branch | 없음 (main only) |

예약 수가 locked baseline의 88건에서 127건으로 증가한 것은 현재 시점 차이로 기록한다.
이 숫자만으로 기존 예약 데이터의 삭제 여부를 단정하지 않는다. 현재 production의 `bookings_access`,
`customers_access`, `customer_events_tenant_select` 정책은 그대로 확인되었고, Revenue Rescue
RLS migration이 적용되기 전에는 tenant isolation 완료로 판정하지 않는다.

Advisor WARN 두 건은 별도 운영 조치가 필요하다. `public.match_bank_transaction_allocations`는
forward migration으로 search_path를 고정해야 하며, Auth leaked-password protection은 Supabase
Auth 보안 설정에서 활성화한 뒤 재검증해야 한다.

# Blog Quality Engine V3 staging rehearsal — 2026-08-12

## 결론

운영 데이터와 운영 스키마는 변경하지 않았다. `Yeosonam_OS`의 스키마만 추출해 데이터가 없는 Supabase preview branch에 복원한 뒤 V3 migration 5개를 순서대로 적용했다. 검증에 사용한 preview branch `blog-quality-v3-final-rehearsal-20260812` (`soaofvtvvqscdndzzqlq`)는 `with_data=false`, non-default, non-persistent임을 재확인한 후 지속 비용을 막기 위해 삭제했다.

최종 리허설 결과는 다음과 같다.

| 검증 | 결과 |
|---|---:|
| V3 migration 적용 | 5/5 PASS |
| 필수 runtime resource | 18/18 ready |
| RLS 대상 table | 14/14 enabled |
| SQL/TypeScript eligibility parity | 9/9 PASS |
| 공개 fixture | 1/1 visible |
| `changes_requested` fixture | 0 visible |
| 미승인 HIGH-risk fixture | 0 visible |
| current public snapshot | 1/1 |
| 익명 public view 접근 | denied |
| 익명 snapshot refresh RPC | denied |
| 블로그 Security Advisor warning | 0 |
| 블로그 Performance Advisor warning | 0 |
| migration safety | 5 files / 0 issues |
| 전체 Vitest | 682 files / 5,168 tests PASS |
| TypeScript / ESLint | 오류 0 / 경고·오류 0 |
| Next.js 15 production build | 389/389 static pages, postbuild PASS |

이는 migration과 API 계약의 staging 증거다. 운영 배포 성공, 운영 장애율 0, 운영 RUM 목표 달성을 뜻하지 않는다.

## source와 격리

- production project ref: `ixaxnvbmhzjvupissmly` — SELECT와 schema dump만 수행
- final preview project ref: `soaofvtvvqscdndzzqlq`
- preview cost: 시간당 USD 0.01344
- production schema counts: public tables 429, private application tables 32, public views/materialized views 44, public functions 234
- V3 적용 후 staging counts: public tables 443, private application tables 32, public views/materialized views 45, public functions 238
- fixture rows: `content_creatives` 3, representative 1, public snapshot 1
- staging migration history: 검증 완료 후 정확히 V3 5개 version만 `applied`로 기록
- 운영 DB INSERT/UPDATE/DELETE/migration apply: 0
- Vercel production deploy/env/domain 변경: 0
- 검증 종료 후 preview branch: 삭제 완료, 지속 비용 없음

schema dump에는 data `COPY`/`INSERT`, database password, service-role key, `DATABASE_URL`이 포함되지 않았음을 검사했다. dump와 fixture helper는 repository에 저장하지 않았고 검증 후 OS 임시 디렉터리에서도 제거했다.

## 리허설에서 발견해 수정한 결함

1. `public_blog_content_creatives`의 기존 column ordinal을 보존하지 않은 `CREATE OR REPLACE VIEW`가 `public_eligibility_lane`을 `title`로 rename하려 해 실패했다. 기존 51개 projection을 명시하고 V3 column을 뒤에 append하도록 변경했다. 최종 ordinal은 lane 51, title 52, reason 60이다.
2. snapshot refresh RPC의 조건 없는 `DELETE`가 Data API safe-update 정책에서 거부됐다. `facet_type is not null` 조건을 추가했고 service-role RPC 호출을 재검증했다.
3. 기존 reviewed replacement function의 `representative_key` 참조가 PL/pgSQL lint에서 모호했다. 배포된 정의의 정확한 fingerprint를 확인한 뒤 qualified reference로만 치환하고, 이미 치환된 재시도도 허용하도록 idempotent fail-closed repair로 바꿨다.
4. 빈 preview DB의 default function privileges가 네 개의 민감한 `SECURITY DEFINER` RPC에 anon/authenticated EXECUTE를 다시 부여했다. 마지막 migration이 네 function을 정확히 한 overload씩 확인하고 anon/authenticated/PUBLIC 권한을 제거한 뒤 service-role에만 부여하도록 수정했다. Advisor의 블로그 보안 warning은 8건에서 0건이 됐다.
5. production에서 동일 정의인 `idx_cc_public_blog_list_v2`는 3,883 scan, `idx_cc_published_blog_nulls_last`는 0 scan이었다. 후자만 `DROP INDEX CONCURRENTLY`하도록 migration에 포함했다. staging Performance Advisor의 블로그 warning은 1건에서 0건이 됐다.
6. Supabase Git 연동 branch 이름과 동일한 첫 preview에서는 백그라운드 migration과 수동 restore가 겹쳤다. 최종 branch는 원격 Git branch와 다른 이름으로 생성해 자동 migration 간섭을 제거했다.
7. PowerShell string pipe는 dump 안 정규식의 backslash를 psql meta-command로 오해하게 만들었다. 최종 복원은 read-only Docker bind mount와 `psql -f`, `ON_ERROR_STOP=1`, `--single-transaction`을 사용했다.

## 실행 증거

```text
FINAL_SCHEMA_RESTORE_OK
FINAL_APPLIED 20260811132017_blog_quality_v3_policy.sql
FINAL_APPLIED 20260811132023_blog_quality_v3_demand_evidence.sql
FINAL_APPLIED 20260811132031_blog_quality_v3_snapshots_media.sql
FINAL_APPLIED 20260811132037_blog_quality_v3_measurement.sql
FINAL_APPLIED 20260811210920_blog_quality_v3_reliability_followup.sql
FINAL_CLEAN_REHEARSAL_OK
```

```json
{
  "runtime_resources_total": 18,
  "runtime_resources_ready": 18,
  "rls_tables_total": 14,
  "rls_tables_enabled": 14,
  "view_security_invoker": true,
  "eligibility_function_security_invoker": true,
  "view_lane_ordinal": 51,
  "view_title_ordinal": 52,
  "view_reason_ordinal": 60
}
```

```text
npm run verify:blog-public-eligibility-parity-v3
fixtureCount=9, passed=true

npm run verify:blog-staging-runtime-v3
publicEligibleFixtures=1
currentSnapshots=1
anonymousViewAccessDenied=true
anonymousSnapshotRefreshDenied=true
```

추가 targeted regression은 17 files / 89 tests PASS였다. 최종 전체 Vitest는 682 files / 5,168 tests, `tsc --noEmit`, 전체 ESLint, `git diff --check`가 모두 통과했다. Next.js 15.5.21 production build는 490.9초, compile 2.4분, static pages 389/389와 postbuild artifact 검증까지 PASS했다. migration safety checker는 5 files / 0 issues였고 migration prefix audit은 전체 452 files, 기존 collision 16, 신규 collision 0이었다.

## Advisor와 lint 해석

- 최종 Security Advisor: 전체 기존 warning은 남아 있으나 블로그 관련 warning 0.
- 최종 Performance Advisor: 전체 WARN 4건은 entity master, product registration, content distribution, cron log의 기존 항목이며 블로그 관련 warning 0.
- `supabase db lint` CLI 2.113.0은 preview의 `plpgsql_check` 2.8 signature와 맞지 않아 `plpgsql_check_function(oid, format => unknown)` 단계에서 도구 자체가 실패했다. 첫 staging과 production read-only lint에서 확인된 기존 blog function 오류는 위 qualified repair 적용 후 사라졌고, 최종 function 정의와 ACL은 별도 SQL/Advisor로 재검증했다. 이 CLI 호환성 문제를 DB 품질 PASS로 숨기지 않는다.

## 보안 후속 조치

Supabase CLI의 `db dump --linked --dry-run`이 명령 preview에 production database credential을 출력하는 동작을 확인했다. 값은 repository와 이 보고서에 저장하지 않았고 이후 같은 명령을 사용하지 않았다. 운영 변경 금지 범위 때문에 이번 작업에서 credential rotation은 수행하지 않았다. 운영 반영 전 별도 change window에서 database password를 회전하고 Vercel/CI 연결값을 함께 갱신해야 한다.

## 남은 release gate

- production migration 5개 선택 적용 및 정확한 migration history 기록
- production snapshot 생성과 public eligibility count parity
- corpus disposition/redirect/410 편집 승인 및 dry-run 재확인
- provider-backed 24개 canary와 실제 source/image license 검수
- `BLOG_AUTOPUBLISH_MODE=draft_only`로 후보 배포 후 `/blog`, 상세, RSS/sitemap/image sitemap, IndexNow exclusion, DB fault injection 검증
- 24~72시간 production error/RUM/server-event 관찰

위 항목 전에는 `reviewed_only` 또는 `live`로 전환하지 않는다.

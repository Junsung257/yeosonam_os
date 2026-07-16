# 정보성 콘텐츠 엔진 V2 — R15 로컬 DB 검증

- 최종 검증일: 2026-07-16 KST
- 최종 상태: **PASS — LOCAL DB VERIFIED**
- 브랜치: `codex/informational-content-engine-v2-remediation`
- 기준 커밋: `7f94ab202d7150806ca263d11a9fab2c30769e5c`
- 작업 폴더: `C:\dev\yeosonam-os-info-v2-remediation`
- 원격 Supabase 접근/변경: **0건**
- 푸시, PR, 배포: **수행하지 않음**

## 1. 결론

빈 로컬 DB에서 전체 마이그레이션 체인을 재현할 수 없던 `DB-01`을 교정했다. 이후 빈 DB 재생성을 두 번 연속 통과했고, 최종 374개 마이그레이션과 정보성 콘텐츠 V2의 RLS·원자 발행·동시성·실패 롤백 계약을 실제 PostgreSQL에서 검증했다.

정보성 콘텐츠 엔진의 애플리케이션 회귀 검사도 모두 통과했다. 상품 파서, 상품 snapshot 구조, 상품 작성기, 상품 상세/랜딩 페이지는 변경하지 않았으며 관광지 자동 시드도 실행하지 않았다.

## 2. 교정 내용

1. `20260330000000_foundational_schema_baseline.sql`을 추가해 추적 중인 과거 마이그레이션들이 전제로 삼던 기반 스키마를 데이터 없이 복구했다.
2. 동일 버전 번호를 사용하던 16개 마이그레이션 그룹의 번호를 고유하게 정규화했다. SQL 본문의 의미는 유지했다.
3. 과거 수동 스키마 누락, 잘못된 컬럼/함수 참조, RLS 및 권한 계약, 함수 오버로드 충돌을 재생 가능한 마이그레이션으로 교정했다.
4. 정보성 콘텐츠 인덱스 마이그레이션을 Supabase CLI의 트랜잭션 재생 방식과 호환되게 변경했다.
5. 별도 관리되는 상품 스키마 선행조건이 없는 로컬 베이스라인에서는 상품 전용 RPC를 만들지 않도록 가드했다. 상품 데이터 구조나 런타임 구현은 변경하지 않았다.

## 3. 환경

| 구성요소 | 버전 |
| --- | --- |
| Windows | Microsoft Windows NT 10.0.26200.0 |
| Node.js / npm | v24.14.0 / 11.9.0 |
| Docker Client / Server | 29.6.1 / 29.6.1 |
| Supabase CLI | 2.109.1 |
| PostgreSQL | 17.6 |

모든 Supabase 명령 전 `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`, `DATABASE_URL`을 현재 프로세스에서 제거했다. `--linked`, `db push`, 원격 URL, `.env.prod`는 사용하지 않았다.

## 4. 마이그레이션 재현 결과

| 검사 | 결과 |
| --- | --- |
| 빈 볼륨 `supabase start` | PASS |
| `supabase db reset --local --no-seed` 1회차 | PASS |
| `supabase db reset --local --no-seed` 2회차 | PASS |
| 최종 마이그레이션 수 | 374 |
| 최종 마이그레이션 버전 | `20260716101000` |
| 중복 버전 그룹 | 0 |
| seed/관광지 자동 시드 | 실행하지 않음 |

정보성 콘텐츠 V2 관련 14개 마이그레이션이 순서대로 적용됐다.

1. `20260715082549_blog_information_evidence_model.sql`
2. `20260715084845_blog_information_representatives.sql`
3. `20260715113000_blog_information_review_state.sql`
4. `20260715223000_public_blog_content_eligibility_view.sql`
5. `20260715224000_blog_queue_content_lane.sql`
6. `20260715225000_blog_information_evidence_scope.sql`
7. `20260715226000_blog_information_source_versions.sql`
8. `20260715226500_blog_information_evidence_concurrent_indexes.sql`
9. `20260715227000_blog_information_review_workflow.sql`
10. `20260715227500_blog_information_representative_intents.sql`
11. `20260715227750_blog_information_review_queue_concurrent_index.sql`
12. `20260715228000_blog_information_atomic_publication.sql`
13. `20260715228500_blog_indexing_jobs_concurrent_index.sql`
14. `20260715229000_blog_information_cta_events.sql`

## 5. 실제 DB 계약 검사

`npx supabase test db --local supabase/tests` 결과:

| 파일 | 검증 영역 | 결과 |
| --- | --- | --- |
| `blog_information_publication_contract.sql` | 기본 발행 계약 | 20 PASS |
| `blog_information_atomic_runtime.sql` | 실제 성공·재시도·품질/근거 차단 | 17 PASS |
| `blog_information_failure_rollback.sql` | 9개 실패 경계와 전체 롤백 | 30 PASS |
| `blog_information_rls_matrix.sql` | 역할·권한·RLS·불변성 | 10 PASS |
| 합계 | 4개 파일 | **77 PASS, 0 FAIL, 0 SKIP** |

DB 린트는 종료 코드 0, 오류 0건이다. 기존 함수의 미사용/변수 가림 경고 14건만 남았으며 이번 정보성 발행 계약을 막는 항목은 없다.

### RLS와 권한

- 내부 정보성 테이블 11개 모두 RLS가 활성화됐다.
- `anon`, `authenticated`는 내부 테이블 읽기/쓰기와 발행·검수·CTA RPC 실행이 차단됐다.
- `service_role`은 필요한 SELECT/INSERT 및 운영 RPC를 실행할 수 있다.
- source version은 불변, review event는 append-only다.
- 공개 eligibility view는 `security_invoker`로 동작한다.

### 원자 발행과 동시성

- 성공 경로에서 글 발행, 대표 글 활성화, 감사 로그, 색인 outbox가 한 트랜잭션으로 생성됐다.
- 동일 idempotency key 재호출은 중복 없이 기존 결과를 반환했다.
- 실제 DB 세션 두 개로 동일 대표 키를 경쟁시켰다. advisory lock 대기 후 한 요청은 신규 발행, 다른 요청은 idempotent 재시도로 종료됐다.
- 최종 publication 1건, indexing outbox 1건, active representative 1건이며 deadlock은 없었다.

### 실패 주입과 롤백

검수 불가, 고위험 승인 누락, 품질 실패, 근거/주장 실패, 글 갱신 예외, 대표 활성화 예외, 색인 insert 예외, 감사 로그 insert 예외, idempotency 충돌을 검증했다. 모든 경우 중간 발행 상태나 고아 outbox가 남지 않았다.

## 6. 기존 DB 업그레이드 시뮬레이션

별도의 폐기 가능한 로컬 Supabase 스택에서 정보성 V2 이전 상태를 만들고 5개 기존 fixture를 보존한 채 이후 16개 마이그레이션을 적용했다.

- 정보성 legacy 글 4건과 `product_id`가 있는 상품 `auto_heal` 글 1건의 수가 유지됐다.
- slug, `product_id`, status, topic source, null review 상태가 그대로 유지됐다.
- 공개 view 분류는 `information_legacy` 4건, `product` 1건으로 정확했다.
- 대표 registry를 임의로 자동 채우지 않았다.
- 삭제, 병합, redirect, 상품→정보성 변환은 발생하지 않았다.

## 7. 애플리케이션 회귀 검사

| 검사 | 결과 |
| --- | --- |
| 정보성 타깃 Vitest | 24 files, 216 tests PASS |
| 안전 평가 `eval:blog-info-v2` | 10/10 PASS, 외부 API 0, 운영 write 0 |
| 전체 `npm test` | 511 files, 3,611 tests PASS |
| TypeScript | PASS |
| ESLint | PASS, warning 0 |
| Next.js production build | PASS, 390/390 pages |

초기 build 시 기본 6 GB 메모리 한도에서 시간이 초과됐고, 동일 코드에 Node heap 8 GB를 지정해 재실행한 최종 production build가 정상 완료됐다.

## 8. 상품 영역 경계

- `src/lib/product*`, 상품 파서, package publication 구현, 상품 페이지에는 diff가 없다.
- 상품 snapshot 구조, 상품 랜딩 페이지, 가격·출발일·항공·호텔·일정 데이터 파서를 변경하지 않았다.
- 기존 마이그레이션 중 상품 이름이 포함된 파일의 수정은 불완전한 로컬 기반 스키마에서 선택적 RPC 생성 실패를 방지하기 위한 가드뿐이다.
- 관광지 관련 자동 seed/매칭은 실행하지 않았다.

## 9. 출시 판단

| 단계 | 판단 | 비고 |
| --- | --- | --- |
| 로컬 DB 검증 | **GO** | 전체 재생성·77 DB 계약·회귀 검사 PASS |
| 로컬 커밋 | **GO** | 구현과 보고서를 분리 |
| push / PR | 미수행 | 사용자 요청 범위에 따라 로컬에서 종료 |
| staging DB 적용 | **조건부 NO-GO** | 원격 migration history 백업·번호 정합성 검토 후 진행 |
| production | **NO-GO** | staging 적용 및 실제 발행 smoke test 전에는 금지 |

과거 중복 버전 번호를 고유 번호로 바꿨으므로, 이미 운영 중인 Supabase의 migration history와 바로 대조하지 않고 `db push`하면 안 된다. 이는 로컬 구현 결함이 아니라 다음 배포 단계의 필수 안전 절차다.

## 10. 최종 판정

**PASS — LOCAL DB VERIFIED**

차단 결함은 없다. 원격 DB·운영 데이터·배포 상태는 이번 검증 범위에서 변경하거나 확인하지 않았다.

# 정보성 블로그 V2 운영 인수 안내

Last updated: 2026-07-15

이 문서는 개발자가 아닌 운영자가 정보성 블로그 V2를 안전하게 설정하고 검토하기 위한 안내다. 상품 등록, 상품 원문 evidence, final snapshot, 상품 상세/랜딩, 상품성 글 생성은 이 문서의 범위가 아니다.

## 1. 네이버 카페 URL 입력 위치

배포 환경의 서버 환경 변수에 `BLOG_NAVER_CAFE_URL`을 추가한다. 값은 운영자가 직접 확인한 공개 `https://` 전체 주소여야 한다.

- 주소가 없거나 확실하지 않으면 입력하지 않는다.
- 빈 값, `http://`, 로그인 전용 주소, 여러 후보 중 추정한 주소는 사용하지 않는다.
- 미설정 상태에서는 네이버 카페 CTA만 자동으로 숨겨진다.

설정 기준은 `docs/env-variables-reference.md`와 `docs/pending-settings-tracker.md`에 함께 기록돼 있다.

## 2. 해외특가방 URL 입력 위치

배포 환경의 서버 환경 변수에 `BLOG_DEAL_ROOM_URL`을 추가한다. 네이버 카페와 마찬가지로 운영자가 확인한 공개 `https://` 전체 주소만 사용한다.

정보성 글 전용 상담 주소가 따로 있으면 `BLOG_CONSULTATION_URL`을 선택적으로 입력한다. 없으면 유효한 `KAKAO_CHANNEL_ID`를 재사용할 수 있으며, 둘 다 없으면 상담 CTA가 숨겨진다.

## 3. CTA 활성·비활성 방법

- 활성: 해당 환경 변수에 검증된 HTTPS URL을 저장하고 새 배포에서 환경 변수를 반영한다.
- 비활성: 해당 환경 변수를 삭제하거나 빈 값으로 둔다.
- 안전 기본값: 외부 CTA가 모두 꺼져도 관련 정보성 글 링크만 표시된다.
- 고위험 글: 입국·비자·보험 글은 외부 판매 CTA보다 관련 글만 표시한다.
- 기존 글 본문에는 CTA 주소가 저장되지 않으므로 주소 변경 때문에 글을 다시 생성할 필요가 없다.

변경 후에는 모바일과 데스크톱에서 CTA가 보이는지, 새 창 링크인지, 한 글에 최대 2개인지 확인한다. 확인되지 않은 URL을 임시로 넣어 테스트하지 않는다.

## 4. 샘플 글 생성·평가 방법

운영 글을 만들지 않는 고정 평가를 먼저 실행한다.

```bash
npm run eval:blog-info-v2
```

정상 결과는 `PASS (11/11)`, 외부 API 호출 `0회`, 공개/운영 데이터 변경 `0건`이다. 라벨만 채운 11개 문서는 모두 차단되고, 같은 11개 주제의 구조화 fixture는 실제 검증 모듈을 통과해야 한다. 결과 파일은 다음 두 곳에 생긴다.

- `docs/specs/20260715-informational-content-engine-v2/reports/r14-safety-evaluation.json`
- `docs/specs/20260715-informational-content-engine-v2/reports/r14-safety-summary.md`

이 평가는 실제 모델 비용, 실제 발행, 캐시 갱신, sitemap, 색인 요청을 사용하지 않는다.

## 5. 검토 대기 글 확인 방법

1. 관리자 화면 `/admin/blog`을 연다.
2. 상태가 초안인 글을 선택해 `/admin/blog/[id]` 편집 화면에서 제목, 설명, 본문, 출처를 확인한다.
3. 자동 발행 큐의 고위험 후보는 `content_creatives.status=draft`, `review_status=pending_review`, `blog_topic_queue.status=pending_review`로 남아야 한다.
4. 검토 대기 글은 공개 블로그, sitemap, 색인 대기열에 나타나면 안 된다.

현재 검토 기록은 보호된 `/api/content-review` 계약을 사용한다. 별도 승인 화면이 연결되지 않은 운영 환경에서는 개발 담당자에게 검토 기록 등록을 요청하고, DB를 직접 수정하지 않는다.

## 6. 고위험 글 승인 방법

고위험 글은 아래를 모두 확인하기 전 승인하지 않는다.

1. 입국·비자·세관은 정부·대사관·출입국·세관의 공식 1차 출처가 있다.
2. 보험은 보험 약관·감독기관·법률 검토 자료가 있다.
3. 각 숫자·기간·정책 문장에 현재 유효한 evidence가 연결돼 있다.
4. 적용 국적, 대상, 기준일, 예외 조건이 글에 명시돼 있다.
5. 검토자가 `approved` 기록과 검토 메모를 남긴다.
6. 승인 후 관리자 글 편집 화면에서 `발행하기`를 눌러 현재 품질·claim·대표키 게이트를 다시 실행한다.

승인 기록만으로 자동 공개되지 않는다. 마지막 발행 동작에서도 모든 게이트를 다시 통과해야 한다.

## 7. 테스트 명령

최소 확인:

```bash
npm run eval:blog-info-v2
npm run audit:blog-info-v2
npm run type-check
```

배포 전 전체 확인:

```bash
npm test
npm run lint
npm run build
```

기존 글 감사는 기본적으로 저장소 fallback 표본만 읽는다. 로컬로 안전하게 내보낸 JSON 배열을 감사할 때만 다음처럼 입력한다.

```bash
npm run audit:blog-info-v2 -- --input .tmp/blog-public-snapshot.json --output-dir .tmp/blog-info-audit
```

감사기에는 `--apply` 모드가 없으며, `--apply`를 전달하면 중단한다.

## 8. migration 적용 순서

원격 운영 DB에는 이 작업 중 적용하지 않았다. 먼저 기존 기반 migration을 저장소의 정상 절차로 아래 타임스탬프 순서대로 적용한다.

1. `20260715082549_blog_information_evidence_model.sql`
2. `20260715084845_blog_information_representatives.sql`
3. `20260715113000_blog_information_review_state.sql`

그다음 이번 안전성 교정 migration을 타임스탬프 순서대로 적용한다.

1. `20260715223000_public_blog_content_eligibility_view.sql`
2. `20260715224000_blog_queue_content_lane.sql`
3. `20260715225000_blog_information_evidence_scope.sql`
4. `20260715226000_blog_information_source_versions.sql`
5. `20260715226500_blog_information_evidence_concurrent_indexes.sql`
6. `20260715227000_blog_information_review_workflow.sql`
7. `20260715227500_blog_information_representative_intents.sql`
8. `20260715227750_blog_information_review_queue_concurrent_index.sql`
9. `20260715228000_blog_information_atomic_publication.sql`
10. `20260715228500_blog_indexing_jobs_concurrent_index.sql`
11. `20260715229000_blog_information_cta_events.sql`

이름에 `concurrent_index` 또는 `concurrent_indexes`가 있는 3개 파일에는 명시적 `BEGIN/COMMIT`을 추가하지 않는다. 기존 테이블의 쓰기를 막지 않기 위한 `CREATE INDEX CONCURRENTLY` 파일이므로, 실제 적용 전에 disposable local Postgres에서 migration runner가 이를 트랜잭션으로 감싸지 않는지 반드시 확인한다.

적용 전에는 migration 안전 검사와 staging 백업을 확인한다. Docker가 실행되는 로컬 환경에서는 먼저 로컬 Supabase를 시작해 전체 migration을 적용하고, 4개 evidence/claim 테이블·대표키 테이블·`pending_review` 상태를 확인한다. 이 개발 세션에서는 Docker 엔진이 꺼져 있어 로컬 적용 증거를 만들지 못했으며 원격 DB로 대체하지 않았다.

Docker를 사용할 수 있게 된 뒤에는 저장소 루트에서 다음 명령을 순서대로 실행한다.

```bash
npx supabase start
npx supabase db reset --local --no-seed
npx supabase test db --local supabase/tests/blog_information_publication_contract.sql
npm run eval:blog-info-v2
npm test
```

`db reset` 또는 pgTAP 계약이 실패하면 staging migration과 배포를 진행하지 않는다. `--linked`나 원격 DB URL로 대체하지 않는다.

## 9. staging 배포 순서

1. staging DB 백업과 현재 migration 버전을 기록한다.
2. 위 기반 및 안전성 교정 migration을 타임스탬프 순서로 적용한다.
3. 외부 CTA 환경 변수는 우선 미설정 상태로 둔다.
4. 애플리케이션을 staging에 배포한다.
5. R14 실제 경로 평가, 정보성 테스트, 상품 회귀 테스트, typecheck, lint, build를 실행한다.
6. 저위험 정보 글 1개를 초안으로 만들어 planner·evidence·claim·render 결과를 확인한다.
7. 고위험 글 1개가 `pending_review` 비공개 상태인지 확인한다.
8. 공식 URL이 확정된 CTA 하나만 설정하고 모바일/데스크톱 노출·클릭 이벤트를 확인한다.
9. 승인된 저위험 글 1개만 발행해 canonical, sitemap, 색인 outbox를 확인한다.

## 10. 운영 배포 전 체크리스트

- [ ] R14 실제 경로 평가가 11/11 PASS다.
- [ ] M11 dry-run 보고서에 DB write와 외부 호출이 0이다.
- [ ] 기반 및 안전성 교정 migration이 staging에서 순서대로 적용됐다.
- [ ] 저위험 글의 필수 section/fact와 evidence coverage가 통과한다.
- [ ] 고위험 글이 승인 전 공개·색인되지 않는다.
- [ ] 같은 destination+intent+audience+locale 재생성이 새 URL을 만들지 않는다.
- [ ] 목록과 상세의 읽기 시간이 같다.
- [ ] raw Markdown, literal `\n`, 빈 section/table, placeholder가 없다.
- [ ] CTA URL은 운영자가 확인한 HTTPS 주소이며 미설정 CTA는 보이지 않는다.
- [ ] CTA impression/click 이벤트에 PII가 없다.
- [ ] 상품 등록·snapshot·파서·상세·랜딩·상품 writer 회귀 테스트가 통과한다.
- [ ] 공개 글 대량 rewrite, merge, redirect, delete 계획이 승인 없이 실행되지 않는다.

## 11. 롤백 방법

가장 먼저 애플리케이션 배포를 직전 정상 버전으로 되돌린다. DB migration은 additive이므로 테이블을 급히 삭제하지 않아도 이전 애플리케이션이 동작한다.

- CTA 문제: `BLOG_NAVER_CAFE_URL`, `BLOG_DEAL_ROOM_URL`, `BLOG_CONSULTATION_URL`을 제거하고 다시 배포한다.
- 정보성 발행 문제: 자동 발행을 중단하고 후보를 draft/pending_review로 유지한다. 공개 글을 일괄 삭제하거나 되돌리지 않는다.
- evidence/대표키 문제: 데이터를 보존하고 validator/registry 사용을 끄는 forward-fix를 만든다.
- migration rollback: 데이터가 한 건이라도 생긴 뒤에는 evidence·claim·대표키 테이블을 drop하지 않는다. 빈 staging에서만 의존성 역순 삭제를 검토한다.
- 기존 공개 URL: 자동 redirect, merge, delete를 하지 않는다. M11 보고서를 승인 목록으로만 사용한다.

## 12. 기존 글 정리 후속 프로젝트 시작 방법

1. 운영 DB를 직접 읽는 대신 승인된 읽기 전용 export를 JSON 배열로 만든다.
2. `npm run audit:blog-info-v2 -- --input ...`으로 dry-run 보고서를 만든다.
3. `HIGH_RISK_REVIEW` → `MERGE` → `REMOVE` → `REWRITE` → `KEEP` 순으로 사람이 검토한다.
4. 각 글의 권장 조치, 근거, canonical 대상, redirect 필요 여부를 별도 승인한다.
5. 승인된 소량만 새 브랜치·별도 PR·staging에서 처리한다.
6. rewrite와 redirect를 같은 일괄 작업으로 묶지 않는다.

현재 생성된 M11 보고서는 운영 DB가 아니라 저장소 fallback 표본 8건을 감사한 예시다. 운영 전체 글에 대한 결론으로 사용하면 안 된다.

## 13. 상품성 콘텐츠 미변경 확인 방법

다음 테스트가 통과해야 한다.

```bash
npx vitest run src/lib/blog-content-boundary.test.ts src/lib/blog-product-brief.test.ts src/lib/blog-product-consultant-writer.test.ts src/lib/blog-product-generated-canary.test.ts
```

또한 이 작업의 commit diff에 상품 parser, 상품 evidence/final snapshot, 상품 상세, 상품 landing, 상품 프롬프트 파일이 없어야 한다. 상품성 개선은 별도 프로젝트로 진행한다.

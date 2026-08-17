# Blog Live Operations Verification — 2026-08-15

기준 시각: 2026-08-15 18:16 KST  
범위: 운영 관리자 UI·공개 검색성과·자동발행 운영 상태의 읽기 전용 검증  
금지 사항 준수: 운영 DB 쓰기, migration 적용, 수동 발행, 운영 환경 변수 변경 없음

## 결론

운영 블로그 공개 화면은 동작하지만 V3 자동발행 체인은 정상 상태가 아니다. 관리자 화면에서 오늘 발행은 0건이며 publisher 최근 7일 성공률은 19.9%였다. 최신 publisher 실행은 성공 응답이었지만 발행은 0건이었다. 실패 37건 중 재시도 가능 25건, 수동 재작성 12건이 확인됐다.

## 브라우저 증거

| 화면 | 관측값 |
|---|---|
| `/admin/blog/system` | 오늘 0/5, 큐 37·실패 37, Canary 0/3, 크론 이상 2, queue pressure 32 |
| Publisher | 최신 실행 2026-08-15 09:05 KST, 30초, published 0, 최근 7일 성공률 19.9% |
| 실패 원인 | `BLOG_RESEARCH_GROUNDING_EMPTY`, `missing_sources,missing_evidence,missing_claims`, `information_plan:contract:unresolved_intent` |
| `/admin/blog/queue` | attention scope를 URL로 열어도 첫 렌더가 기본 scope로 고정되어 실패 큐를 숨김 |
| `/admin/blog/policy` | DB 정책 5건/일, 슬롯 09·12·15·18·21시. 실효 `BLOG_AUTOPUBLISH_MODE`와 환경 cap은 표시하지 않음 |
| `/admin/blog/keyword-growth` | `blog_keyword_families`, `blog_keyword_family_members` 미존재 경고 |
| 검색성과 14일 | Google 221 clicks, 12,738 impressions, tracked queries 120 |

## Linked DB·공개 surface 재검증

`npm run verify:blog-production-readiness-v3 -- --output=docs/audits/blog-production-readiness-live-2026-08-15.json`을 실행했다. verifier는 SELECT와 공개 HTTP GET만 사용하며 결과는 BLOCKED였다.

| 계약 | 결과 |
|---|---|
| 공개 surface | catalog, detail, sitemap, RSS, image sitemap 모두 HTTP 200 통과 |
| 공개 snapshot parity | public eligible 191, current snapshot 187 — 4건 불일치 |
| 공개 차단 상태 | published + review-blocked 8건 |
| 수요 근거 | queued without demand 0건 |
| 검색 측정 | 최근 30일 search performance 198건, rank history 1,507건 |
| 참여·RUM | 최근 7일 engagement 1,490건, web vitals 3,789건 |
| 서버 전환 측정 | 최근 30일 analytics server events 0건 — critical |
| 운영 schema | keyword-family 리소스 2개 누락 |

기계 판정은 `safeToEnableLive=false`, `deliveryReady=false`, `measurementReady=false`, `corpusReady=false`다. 원본 JSON은 `docs/audits/blog-production-readiness-live-2026-08-15.json`에 보존한다.

## 근본 원인

1. 생성 연구가 공식 근거·claim을 만들지 못해 fail-closed 게이트에서 멈춘다.
2. 운영 DB에 V3 keyword-family migration이 적용되지 않아 cannibalization/대표 키워드 계약이 불완전하다.
3. DB `publishing_policies.posts_per_day=5`가 환경 cap과 안전정지 모드보다 앞서 표시돼 운영자가 5건 발행 목표로 오해할 수 있다.
4. 큐 API가 `target_publish_at` 우선으로 500건을 잘라 최신 실패 37건을 관리자 목록 밖으로 밀어냈다.
5. queue page가 `scope` query를 첫 렌더에 반영하지 않아 system 화면과 queue 화면이 모순됐다.

## 이번 코드 조치

- 실효 공개 목표를 `mode + enabled + min(DB target, BLOG_DAILY_PUBLISH_CAP)`로 계산한다.
- `draft_only`에서는 공개 SLA 목표를 0으로 두고 안전정지로 명시한다.
- system/policy 화면에 DB 목표, 실효 cap, mode, 공개 허용 여부를 함께 표시한다.
- queue를 최신 생성 순서로 가져오고 URL scope를 서버 첫 렌더에 전달한다.
- keyword-family 두 테이블을 V3 runtime readiness 필수 리소스로 추가한다.
- 기존 broad RLS를 제거하는 service-role-only 후속 migration과 rollback SQL을 작성한다.

## 운영 반영 전 조건

1. 두 keyword-family 테이블 생성 migration과 service-role RLS hardening migration을 staging clone에서 순서대로 검증한다.
2. 운영 백업과 SQL diff 승인 뒤 migration을 적용한다.
3. production readiness가 누락 리소스 0을 보고하는지 확인한다.
4. 안전정지 상태에서 publisher dry-run과 3개 provider-backed canary를 통과시킨다.
5. 그 뒤에만 `BLOG_DAILY_PUBLISH_CAP=3`과 `BLOG_AUTOPUBLISH_MODE=live`를 같은 change window에 반영한다.

현재 단계에서 live 전환은 승인할 수 없다. DB 누락과 canary 0/3을 해소하지 않은 live 전환은 근거 없는 발행 재개가 된다.

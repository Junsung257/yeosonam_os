# Blog Orchestrator V4 DeepSeek-only Verification

기준일: 2026-08-16, Asia/Seoul

## 판정

후보 코드의 블로그 V4 연구 구조화, 초안, 2차 재작성, 최종 재작성, 모델 canary, 비용 원장은 모두 DeepSeek만 사용하도록 닫혔다. 실제 DeepSeek 호출 3/3, 전체 Vitest 731 files / 5,470 tests, 타입 검사, 린트, Next.js 15.5.21 프로덕션 빌드와 로컬 HTTP 검증을 통과했다.

판정은 **DeepSeek-only 후보 코드 PASS / 운영 반영 BLOCKED**다. 운영 배포, 운영 DB migration, 기존 글 UPDATE/DELETE, 색인 요청은 수행하지 않았다.

## DeepSeek-only 계약

| 단계 | 모델 | thinking | 실패 시 |
|---|---|---|---|
| 초안 | `deepseek-v4-flash` | disabled | 품질·근거 조건에 따라 Pro 재작성 또는 보류 |
| 2차 재작성 | `deepseek-v4-pro` | high | 미수렴 시 Pro max 3차 시도 |
| 3차 재작성 | `deepseek-v4-pro` | max | 미수렴 시 quarantine |
| 연구 자료 구조화 | `deepseek-v4-pro` | high | 원문 수집·구조화 실패 시 발행 차단 |

- Gemini/GPT/Claude 또는 범용 provider cascade는 V4 공개 발행 경로에서 호출되지 않는다.
- 자동 연구는 사전 검토된 원문 URL을 직접 연 뒤 그 추출문만 DeepSeek Pro로 구조화한다. 검색 snippet은 근거가 아니다.
- 3차 실패 뒤 다른 모델로 우회하지 않고 quarantine한다.
- DeepSeek 공백 응답, 잘린 JSON, token limit 종료, 비정상 finish reason은 부분 본문을 폐기하고 fail-closed 처리한다.
- DB provider constraint와 비용 reservation RPC도 `provider = 'deepseek'`만 허용한다.

## 실제 모델 연결 canary

DB write 없이 실제 공급자 연결을 호출했다.

| 단계 | provider/model | latency | finish | token in/out | 추정 비용 | 결과 |
|---|---|---:|---|---:|---:|---|
| draft_flash | DeepSeek V4 Flash | 632ms | stop | 38 / 1 | $0.00000560 | PASS |
| rewrite_pro_high | DeepSeek V4 Pro | 1,124ms | stop | 117 / 17 | $0.00006569 | PASS |
| rewrite_pro_max | DeepSeek V4 Pro | 1,131ms | stop | 130 / 17 | $0.00007134 | PASS |

세 응답은 모두 정확히 `OK`, 기대 provider/model/thinking, output token > 0을 만족했다.

## 검증 결과

| 검증 | 결과 |
|---|---|
| DeepSeek-only 정적 회귀 | V4 runtime/workflow/migration에서 Gemini rescue·모델·환경변수 0건 |
| 전체 Vitest | 731 files, 5,470 tests passed, 0 failed |
| `npm run type-check` | PASS |
| `npm run lint` | PASS, warning 0 |
| production build | PASS, Next.js 15.5.21, 390/390 static pages, `.next` verified |
| release bundle digest | PASS, 고정된 migration 9개 |
| 격리 Supabase dry-run | PASS, remote placeholder 509, pending 9, unexpected 0, DB write 0 |
| `git diff --check` | PASS |

로컬 production server 응답:

| 경로 | 상태 |
|---|---:|
| `/blog` | 200 |
| `/sitemap.xml` | 200 |
| `/api/rss` | 200 |
| `/blog/image-sitemap.xml` | 200 |
| `/api/cron/blog-generate` 무인증 | 401 JSON |
| `/api/cron/blog-publication-controller` 무인증 | 401 JSON |
| `/api/cron/blog-ai-model-canary` 무인증 | 401 JSON |
| 존재하지 않는 blog slug | 200 — registry migration 적용 전 예상 차단 항목 |

## 운영 반영 전 남은 차단 조건

- release migration 9개가 운영 DB에 0/9 적용 상태다.
- 공개 가능 191건 대비 durable snapshot 186건으로 5건이 부족하다.
- `published + review-blocked` 8건의 disposition이 아직 0건이다.
- 검증된 demand가 없는 due queue 13건이 남아 있다.
- GSC 최신 metric date는 2026-08-13이며 strict freshness gate를 통과하지 못한다.
- analytics synthetic canary readback 증거가 없다.
- 후보 V4 코드는 운영에 배포되지 않았으며 운영 immutable SHA도 아직 증명되지 않았다.
- slug registry migration 전에는 존재하지 않는 블로그 주소가 fail-open 200 shell로 응답한다.

따라서 현재 운영을 “완벽히 DeepSeek-only로 작동한다”고 판정할 수 없다. release runbook 순서대로 migration, corpus/snapshot 정리, draft-only canary, immutable 배포 검증을 완료한 뒤에만 `pilot_3`을 활성화한다.

## 무변경 보증

- production deploy: 수행하지 않음
- production DB migration: 수행하지 않음
- production DB UPDATE/DELETE/INSERT: 수행하지 않음
- IndexNow/indexing request: 수행하지 않음

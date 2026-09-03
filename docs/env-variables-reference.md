# 여소남 OS 환경변수 레퍼런스

## Blog Quality Engine V3 (2026-08-11)

| 변수 | 기본값 | 설명 |
|---|---:|---|
| `BLOG_AUTOPUBLISH_MODE` | `draft_only` | `draft_only`, `reviewed_only`, `live`; 누락/오타는 fail-closed |
| `BLOG_PRODUCTION_ALLOWED_GIT_REF` | `main` | Vercel production 자동발행을 허용할 유일한 Git ref. production에서 ref/SHA 증거가 없거나 다르면 자동으로 `draft_only` |
| `BLOG_DAILY_PUBLISH_CAP` | retired | V4에서 무시. 발행량은 DB `publishing_policies.posts_per_day`(운영 5)만 사용 |
| `BLOG_PUBLICATION_RAMP_STAGE` | `pilot_3` | 내구성 원장 호환/복구 메타데이터. V4 발행량을 낮추거나 높이지 않음 |
| `BLOG_AUTO_RAMP_ENABLED` | `false` | 기존 단계 원장 평가 호환용. V4에서는 DB 발행량 SSOT를 변경하지 않음 |
| `BLOG_AUTO_ROLLBACK_ENABLED` | `true` | 심각 사고는 즉시 동결·pilot 복귀, 일반 불건전 관측 2회 연속은 한 단계 강등 |
| `BLOG_DAILY_AI_COST_CAP_USD` | `2` | KST 일일 AI 비용 상한. 공급자 호출 전에 DB 원자 예약이 실패하거나 상한을 넘으면 호출 금지 |
| `BLOG_MAX_WEATHER_SHARE_30D` | `0.20` | 최근 30일 날씨 archetype 비중 상한 |
| `BLOG_MAX_SAME_ARCHETYPE_IN_LAST_10` | `2` | 최근 10개 same-archetype 상한 |
| `BLOG_REQUIRE_DEMAND_SIGNAL` | `true` | 관측·검증 demand signal 필수 |
| `DB_RESOURCE_SAVER_ALLOW_CRITICAL_CRONS` | 없음 | `1`일 때만 DB 절전 모드에서도 블로그 핵심 체인(`rank-tracking`, `blog-data-readiness`, `blog-generate`, `blog-publication-controller`, `blog-indexing-worker`, `blog-ai-model-canary`, `blog-analytics-canary`, `analytics-delivery`) 실행. 누락 시 전체 체인은 fail-closed |
| `BLOG_GENERATION_CRON_ENABLED` | 없음 (`false`) | `true`/`1`일 때만 야간 `blog-generate` cron이 모델 호출을 수행. 누락·오타는 pause이며, 승인된 수동 `force=true` 검증만 예외 |
| `INNGEST_BLOG_AUTOPILOT_ENABLED` | 없음 (`false`) | `true`/`1`일 때만 `blog_topic_queue` 이벤트를 Inngest V4 함수로 전환. 전환 전 기존 cron은 호환 진입점 |
| `INNGEST_EVENT_KEY` | 없음 | Inngest Cloud 이벤트 전송 키. 공식 Vercel 통합으로 주입하며 소스·로그에 기록 금지 |
| `INNGEST_SIGNING_KEY` | 없음 | Inngest Cloud 콜백 서명 검증 키. 공식 Vercel 통합으로 주입하며 소스·로그에 기록 금지 |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | 없음 | Deployment Protection이 적용된 배포에서 Inngest 워커가 서버 내부 cron API를 호출할 때만 쓰는 server-only 우회 키. Vercel 보호 설정의 현재 키와 함께 회전하며 client 노출 금지 |
| `BLOG_PREVIEW_SECRET` | `CRON_SECRET` fallback | 15분 이하 `noindex` 초안 미리보기 HMAC. 반드시 server-only |
| `BLOG_AUTOPILOT_INTERNAL_ORIGIN` | `NEXT_PUBLIC_SITE_URL` fallback | Inngest가 공통 cron 진입점을 호출할 HTTPS 원점. 로컬만 localhost HTTP 허용 |
| `BLOG_CRAWL4AI_ENDPOINT` / `BLOG_CRAWL4AI_BEARER_TOKEN` | 없음 | 기존 HTML 추출 실패 시에만 쓰는 self-hosted Crawl4AI `/crawl`. 30건 벤치마크 통과 원장이 없으면 설정돼 있어도 호출 금지 |
| `BLOG_DOCLING_ENDPOINT` / `BLOG_DOCLING_API_KEY` | 없음 | 기존 PDF·DOCX·XLSX·PPTX 추출 실패 시에만 쓰는 Docling `/v1/convert/source`. 30건 벤치마크 통과 원장이 없으면 호출 금지 |
| `BLOG_KOREAN_NLP_ENDPOINT` / `BLOG_KOREAN_NLP_BEARER_TOKEN` | 없음 | 후속 Kiwi/KSS worker 호환 예약 키. 현재 V4 운영 게이트는 버전 고정 로컬 임베딩과 100건 precision/recall 원장을 사용 |
| `BLOG_CORPUS_APPLY_CONFIRM` | 없음 | corpus quarantine apply 이중 확인; 평소 설정 금지 |
| `BLOG_SEARCH_IMPORT_APPLY_CONFIRM` | 없음 | 관측 검색성과 import apply 이중 확인; 평소 설정 금지 |
| `BLOG_SNAPSHOT_APPLY_CONFIRM` | 없음 | public snapshot DB refresh 이중 확인; 평소 설정 금지 |
| `BLOG_DETAIL_BUNDLE_MAX_AGE_HOURS` | `720` | DB 장애 시 LOW-risk 상세 본문 번들의 최대 허용 나이(30일); HIGH 24시간, MEDIUM 48시간 상한은 이 값보다 우선하며 만료 시 fail-closed |
| `BLOG_PUBLIC_CATALOG_LKG_URL` / `BLOG_PUBLIC_CATALOG_LKG_SHA256` | 없음 | SHA-256이 URL에 포함된 immutable catalog recovery artifact. HTTPS와 본문 hash가 모두 일치해야 사용 |
| `BLOG_PUBLIC_DETAIL_LKG_URL` / `BLOG_PUBLIC_DETAIL_LKG_SHA256` | 없음 | SHA-256이 URL에 포함된 immutable detail recovery artifact. HIGH-risk 만료 정책은 우회하지 않음 |
| `BLOG_IMAGE_PHASH_APPLY_CONFIRM` | 없음 | pHash DB backfill 이중 확인값; 평소 환경 변수로 저장 금지 |
| `BLOG_LOCAL_MIGRATION_REHEARSAL_CONFIRM` | 없음 | 로컬 임시 DB reset 전용 확인값; preview/production 설정 금지 |
| `NAVER_CLIENT_ID` / `NAVER_CLIENT_SECRET` | 없음 | Naver Search API와 DataLab 서버 자격증명; client 노출 금지 |
| `NAVER_API_HUB_CLIENT_ID` / `NAVER_API_HUB_CLIENT_SECRET` | 없음 | Naver API HUB Search 자격증명. 설정 시 HUB 우선, 장애 시 기존 `NAVER_CLIENT_*`로 fallback |
| `NAVER_ADS_API_KEY` / `NAVER_ADS_SECRET_KEY` / `NAVER_ADS_CUSTOMER_ID` | 없음 | Naver Search Ads Keyword Tool 월간검색량; 하나라도 없으면 volume은 `null` |
| `SERPAPI_KEY` | 없음 | 기존 선택형 rank tracking 전용; Blog SERP V3 생성에는 필요하지 않음 |
| `DEEPSEEK_API_KEY` | 없음 | Blog V4 Flash 초안과 Pro 재작성용 server-only key |
| `GOOGLE_AI_API_KEY` | 없음 | 다른 플랫폼 AI 기능 전용. Blog V4 발행 경로는 이 키를 읽지 않음 |
| `BLOG_GSC_CATCHUP_DAYS` | `7` | 매일 재수집하는 최근 GSC 날짜 수(최대 7) |
| `BLOG_GSC_BACKFILL_DAYS` | `90` | 보강할 GSC 전체 관측 기간(최대 90일) |
| `BLOG_GSC_BACKFILL_CHUNK_DAYS` | `7` | 한 번의 rank-tracking에서 추가로 보강할 과거 날짜 수(최대 7). 실패 시 cursor 전진 금지 |

운영 최초 반영은 반드시 `BLOG_AUTOPUBLISH_MODE=draft_only`로 시작합니다. DB 절전 모드가 운영 기본값인 동안에는 검증된 배포에서만 `DB_RESOURCE_SAVER_ALLOW_CRITICAL_CRONS=1`을 함께 설정하고, draft canary 전후의 발행·공개·색인 건수를 비교한 뒤 `live`를 승인합니다. apply confirmation 값은 상시 환경 변수로 두지 않고 승인된 일회성 change window에서만 사용합니다.

`INNGEST_BLOG_AUTOPILOT_ENABLED=1`만으로는 실행되지 않습니다. `INNGEST_EVENT_KEY`와 `INNGEST_SIGNING_KEY`가 모두 있고 후보 `/api/inngest`가 `cloud` 모드·필수 함수 수를 보고해야 자동 생성 준비로 판정합니다. Deployment Protection을 사용하는 운영 배포에서는 서버 전용 `VERCEL_AUTOMATION_BYPASS_SECRET`도 설정해 워커의 자기 배포 내부 호출이 보호 계층에서 차단되지 않게 합니다. 키가 빠지면 `blog-generate`는 명시적으로 중지하며 readiness는 차단됩니다. 생성·공개 일일 목표는 모두 DB `publishing_policies.posts_per_day`(운영 5)를 사용하고 별도 30건 후보 상한은 없습니다. 성공한 실행은 `approved_for_slot`에 저장되고, DB의 5개 슬롯에서만 `blog-publication-controller`가 원자 공개와 색인 아웃박스를 생성합니다. Crawl4AI·Docling·한국어 의미 중복기는 각각 최신 `blog_adapter_benchmarks` 통과 행이 있어야 활성화됩니다.

### V3 staging runtime verifier 전용

아래 값은 Vercel 환경 변수나 상시 `.env`에 저장하지 않습니다. 데이터 없는 Supabase preview에서 `npm run verify:blog-staging-runtime-v3`를 실행하는 한 번의 shell에만 주입하고 종료 후 제거합니다.

| 변수 | 설명 |
|---|---|
| `BLOG_STAGING_RUNTIME_VERIFY_CONFIRM` | 정확히 `STAGING_SNAPSHOT_REFRESH_ALLOWED`; snapshot 갱신이 포함됨을 명시적으로 승인 |
| `BLOG_STAGING_SUPABASE_BRANCH_NAME` | Management API가 확인할 preview branch 이름 |
| `BLOG_STAGING_SUPABASE_PROJECT_REF` | preview branch의 20자 project ref |
| `BLOG_PRODUCTION_SUPABASE_PROJECT_REF` | parent production project ref; 기본값 없이 반드시 명시 |
| `SUPABASE_ACCESS_TOKEN` | branch metadata 조회용 read-only token. `environment:read`와 branch read 권한만 허용 |
| `SUPABASE_URL` | `https://<preview-ref>.supabase.co` 형태의 직접 server origin |
| `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY` | 해당 preview 전용 key; production key 사용 금지 |

검증기는 Management API가 `parent_project_ref`와 target ref가 일치하고 `is_default=false`, `persistent=false`, `with_data=false`임을 증명하기 전에는 Supabase Data API client를 생성하지 않습니다.

> Vercel 프로젝트 환경변수 설정 가이드 — Production 배포 전 필수 확인

## 상품등록 통합 자동화 엔진 V6 (2026-08-11)

V6는 기본적으로 레거시 호환 또는 그림자 처리만 합니다. 운영 판매 정보는 앱과 DB authority가 모두 `kernel`이고, `PRODUCT_REGISTRATION_V6_PUBLISH_ENABLED=1`, `PRODUCT_REGISTRATION_PUBLICATION_FREEZE=0`이며 cohort gate가 통과할 때만 CAS 공개를 시도합니다.

| 변수 | 용도 | 안전한 기본값 |
|---|---|---|
| `PRODUCT_REGISTRATION_AUTHORITY_MODE` | `legacy`, `shadow`, `kernel` 중 등록 writer 권위 선택. `shadow`와 `kernel`은 V6 durable workflow를 사용하며 고객 공개는 `kernel`에서만 가능 | `legacy` |
| `PRODUCT_REGISTRATION_PLATFORM_TENANT_ID` | 플랫폼 자체 업로드·공개 surface의 명시적 tenant UUID. 신규 kernel 업로드에서는 필수 | 미설정 |
| `PRODUCT_REGISTRATION_V6_WORKFLOW_ENABLED` | 과거 호환 변수. 현재 workflow 권위는 `PRODUCT_REGISTRATION_AUTHORITY_MODE=shadow|kernel`에서만 결정하며 이 값만으로 켜지지 않음 | `0` |
| `PRODUCT_REGISTRATION_V6_SHADOW_ENABLED` | revision·검증·snapshot을 비공개로 생성 | `1` |
| `PRODUCT_REGISTRATION_V6_ANALYSIS_RECOVERY_PREVIEW_ENABLED` | PR-V6-01 분석 전용 정규화와 Recovery Target 탐지만 실행하고 Revision 이전에 안전 차단. PR-V6-02 복구 오케스트레이터 연결 전 운영 활성화 금지 | `0` |
| `PRODUCT_REGISTRATION_V6_PUBLISH_ENABLED` | verified/degraded 결과의 자동 CAS 공개 | `0` |
| `PRODUCT_REGISTRATION_PUBLICATION_FREEZE` | `1`이면 모든 신규 V6 공개 차단 | `1` |
| `PRODUCT_REGISTRATION_V6_BACKFILL_ENABLED` | 기존 `travel_packages`를 같은 Kernel로 비공개 재처리. migration·schema finalizer 이후 shadow에서만 켬 | `0` |
| `PRODUCT_REGISTRATION_V6_PUBLIC_READER_REQUIRED` | 고객 면에서 pointer로 지정된 immutable snapshot만 읽기 | canary 전 `0`, 전환 후 `1` |
| `PRODUCT_REGISTRATION_PROOF_SECRET` | snapshot·hash·package에 귀속된 proof URL HMAC secret | 무작위 32바이트 이상 |
| `PRODUCT_REGISTRATION_BROWSER_WS_ENDPOINT` | 운영 Chrome/CDP 원격 엔드포인트. 없으면 proof는 fail-closed | 미설정 |
| `PRODUCT_REGISTRATION_CHROME_EXECUTABLE_PATH` | 로컬/전용 worker Chrome 경로 | 미설정 |
| `PRODUCT_REGISTRATION_V6_OCR_ENABLED` | 스캔 PDF·이미지 OCR router 사용 | `0` |
| `PRODUCT_REGISTRATION_OCR_PROVIDER_MODE` | OCR 실행 모드. `local`은 로컬 PaddleOCR·Tesseract, `cloud`는 기존 CLOVA·Google | `local` |
| `PADDLEOCR_LOCAL_COMMAND`, `PADDLEOCR_LOCAL_ARGS_JSON`, `PADDLEOCR_LOCAL_VERSION` | PaddleOCR 구조화 JSON wrapper 실행기·버전. `{input}` 자리표시자에 임시 원본 경로가 주입됨 | 미설정 |
| `TESSERACT_LOCAL_COMMAND`, `TESSERACT_LOCAL_ARGS_JSON`, `TESSERACT_LOCAL_VERSION` | Tesseract 중요값 challenger 실행기·버전. `{input}` 자리표시자 지원 | 미설정 |
| `CLOVA_OCR_APIGW_URL`, `CLOVA_OCR_SECRET` | 한국어 표 1차 OCR | 미설정 |
| `CLOVA_OCR_COST_KRW_PER_CALL` | CLOVA 1회 예상 비용 | `0` |
| `GOOGLE_DOCUMENT_AI_PROJECT_ID`, `GOOGLE_DOCUMENT_AI_LOCATION`, `GOOGLE_DOCUMENT_AI_PROCESSOR_ID` | critical OCR 교차검증 | 미설정 |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Google Document AI 서비스 계정 JSON | 미설정 |
| `GOOGLE_DOCUMENT_AI_COST_KRW_PER_CALL` | Google Document AI 1회 예상 비용 | `0` |
| `OAG_SUBSCRIPTION_KEY`, `OAG_FLIGHT_INFO_URL` | 미래 항공 일정 1차 검증 | 미설정 |
| `OAG_COST_KRW_PER_CALL` | OAG 1회 예상 비용 | `0` |
| `CIRIUM_APP_ID`, `CIRIUM_APP_KEY`, `CIRIUM_SCHEDULES_URL` | 항공 시간 독립 2차 검증 | 미설정 |
| `CIRIUM_COST_KRW_PER_CALL` | Cirium 1회 예상 비용 | `0` |

외부 OCR 합계는 원문 문서당 2,000원을 넘으면 호출 전 차단합니다. 항공 시간은 현재 원문값을 덮어쓰지 않고, 누락값은 날짜·노선이 같은 두 독립 출처가 분 단위로 일치할 때만 보완합니다.

## 타입 안전 기능 플래그·관측성 (2026-08-27)

아래 플래그는 `src/env.ts`와 `src/lib/feature-flags.ts`에서 타입·기본값·범위를 함께 관리합니다. Vercel 환경 변수 변경은 새 배포부터 적용됩니다.

| 변수 | 안전한 기본값 | 용도 |
|---|---:|---|
| `JARVIS_STREAM_ENABLED` | `true` | 정확히 `false`일 때만 Jarvis SSE 엔드포인트를 503으로 중지 |
| `IR_CANARY_ENABLED` | `false` | 정확히 `true`일 때만 IR canary 표본 라우팅 허용 |
| `IR_CANARY_ROLLOUT_PCT` | `1` | 0~100 범위의 결정적 표본 비율. 잘못된 값은 1로 복귀 |
| `IR_CANARY_MULTI` | `1` | 정확히 `0`일 때만 복수상품 IR 분리를 중지 |
| `IR_CANARY_MAX_PRODUCTS` | `8` | 1~16 범위의 상품 분리 상한 |
| `IR_CANARY_CONCURRENCY` | `2` | 1~6 범위의 정규화 동시 실행 수 |
| `NEXT_PUBLIC_QA_CHAT_V2_ENABLED` | `false` | 공개 QA 위젯의 V2 SSE 우선 시도. `true`/`false`만 허용 |
| `NEXT_PUBLIC_PARTYTOWN` | `0` | 공개 분석 스크립트의 Partytown 실행. `0`/`1`만 허용 |

상품 공개 동결, 가격·결제·정산 권위, 외부 발행 승인 같은 안전 스위치는 범용 기능 플래그로 옮기지 않습니다. 해당 도메인 SSOT의 fail-closed 설정과 승인 절차를 그대로 사용합니다.

LLM trace는 원문 prompt/response를 속성에 저장하지 않고 `gen_ai.operation.name`, `gen_ai.provider.name`, `gen_ai.request.model`, token usage와 여소남 task/phase만 기록합니다. Sentry 전송 전에는 전화·이메일·여권·계좌·주민번호와 credential key를 재귀적으로 마스킹합니다.

## 조사 노드·Inngest 전환 안전 스위치 (2026-08-31)

| 변수 | 안전한 기본값 | 용도 |
|---|---:|---|
| `RESEARCH_NODE_INGEST_TOKEN` | 미설정 | 조사 노드가 `POST /api/internal/research/signals`에만 쓰는 32자 이상의 전용 bearer token. Production과 전용 조사 PC에만 설정하며 Supabase 키로 대체하지 않음 |
| `INNGEST_SCHEDULES_ENABLED` | `false` | 정기 Inngest 함수의 부작용 허용. 기존 Vercel Cron 소유권을 같은 배포에서 제거하고 Inngest 서명·이벤트 키를 검증한 뒤에만 `true` |
| `INNGEST_BILLING_ENABLED` | `false` | 월간 결제 작업의 별도 이중 승인. `INNGEST_SCHEDULES_ENABLED=true`와 안정적 order ID·결제 재시도 검증이 모두 필요 |

조사 PC에는 `RESEARCH_NODE_INGEST_TOKEN`과 intake URL 외의 Production 키를 주지 않습니다. 현재 Production에 Inngest 키가 없으므로 일일 마케팅을 포함한 정기 작업의 소유자는 Vercel Cron입니다.

## ⚠️ 시크릿 관리 정책 (중요)

1. **실제 시크릿 값은 Vercel Environment Variables에서만 관리합니다.**
2. `.env.prod`와 `.env.local`은 placeholder (`xxx`)만 포함합니다. git에 안전하게 커밋 가능합니다.
3. 로컬 개발이 필요하면 `vercel env pull` (`.env.vercel` 생성) 또는 수동으로 실제 값을 채우세요.
4. `.env.vercel`은 `.gitignore` 처리되어 git에 커밋되지 않습니다.
5. `NEXT_PUBLIC_*` 변수는 클라이언트에 노출되는 값이므로 민감한 정보를 담지 마세요.

## 🔑 필수 (Required) — 설정 안 하면 앱 작동 불가

| 키 | 용도 | 예시 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 프로젝트 URL | `https://ixaxnvbmhzjvupissmly.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase 공개키 (클라이언트, 현재 표준) | `sb_publishable_...` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | legacy 익명 키 (전환기 fallback, 신규 설정에는 사용하지 않음) | `eyJhbGciOi...` |
| `SUPABASE_SECRET_KEY` | Supabase 비밀키 (서버 전용, 현재 표준) | `sb_secret_...` |
| `SUPABASE_SERVICE_ROLE_KEY` | legacy 서비스 키 (서버 전용 fallback) | `eyJhbGciOi...` |
| `NEXT_PUBLIC_BASE_URL` | 사이트 루트 URL | `https://yeosonam.com` |
| `NEXT_PUBLIC_CONSULT_PHONE` | 고객 QA 채팅 **전화 상담** 버튼용 (`tel:`). 미설정 시 전화 버튼 숨김 | `0511234567` 또는 `+82511234567` |
| `CRON_SECRET` | 크론 작업 인증 Bearer 토큰 (Vercel Cron Jobs가 `Authorization: Bearer <CRON_SECRET>` 전송) | `랜덤 문자열` |
| `DB_RESOURCE_SAVER_MODE` | Supabase 압박 시 비필수 블로그/마케팅/광고/에이전트 크론을 스킵하고 cron DB 로깅을 중지합니다. Production 기본값은 보호 모드이며, DB 회복 후 `0`으로 꺼서 재개합니다. | `1` 또는 `0` |
| `DB_RESOURCE_SAVER_PUBLIC_READS` | Supabase 압박 중 공개 고객/탐색 페이지의 DB 읽기 허용 여부입니다. 장애 중에는 미설정/`0`으로 두어 홈, 상품상세, 여행지, 블로그 목적지, 명소 페이지의 비필수 DB 읽기를 막고, `/rest/v1` 및 SQL 헬스체크가 통과한 뒤에만 `1`로 엽니다. | `0` 또는 `1` |
| `DB_RESOURCE_SAVER_ALLOW_PRODUCT_CRONS` | Supabase 압박 중 상품등록 유지보수 크론 허용 여부입니다. 장애 중에는 미설정/`0`으로 두고, DB 회복 후 통제된 catch-up 실행이 필요할 때만 `1`로 엽니다. | `0` 또는 `1` |
| `GOOGLE_AI_API_KEY` | Gemini 2.5 Flash (블로그·카드뉴스·Pillar 생성) | `AIza...` |
| `SUPABASE_JWT_SECRET` | Supabase **JWT 서명용 시크릿** (대시보드 → Project Settings → API → JWT Secret) | Base64 시크릿 |
| `ADMIN_EMAILS` | **브라우저 쿠키 JWT**로 `/api` 어드민 호출 시 허용 이메일 (쉼표 구분, 대소문자 무시) | `admin@yeosonam.com` |

`ADMIN_EMAILS`가 비어 있으면 일반 로그인으로는 어드민 API가 거부됩니다. 서버 간 호출은 `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` 로 여전히 가능합니다.

운영 빌드는 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`(또는 legacy anon 키), `ADMIN_EMAILS`를 `npm run verify:admin-auth-env`로 검사합니다. `NEXT_PUBLIC_*`는 빌드 시 브라우저 번들에 포함되므로 값을 바꾼 뒤에는 반드시 새 Production 배포가 필요합니다.

## 📊 마케팅 측정·GTM·GA4

전체 placeholder 예시는 [`docs/analytics/env.example`](./analytics/env.example)을 사용합니다.

| 키 | 공개 여부 | 용도 |
|---|---|---|
| `NEXT_PUBLIC_ANALYTICS_ENABLED` | 공개 | `true`일 때만 측정 runtime 후보 활성화 |
| `NEXT_PUBLIC_ANALYTICS_DEBUG` | 공개 | 로컬 명시 디버그. Production에서는 일반 활성화 조건 적용 |
| `NEXT_PUBLIC_GTM_CONTAINER_ID` | 공개 | `GTM-...` 형식, 유효하지 않으면 로드 안 함 |
| `NEXT_PUBLIC_GA4_MEASUREMENT_ID` | 공개 | `G-...` 형식 |
| `NEXT_PUBLIC_GOOGLE_ADS_ID` | 공개 | `AW-...` 형식 |
| `NEXT_PUBLIC_CLARITY_PROJECT_ID` | 공개 | 선택적 GTM Clarity 설정용 |
| `NEXT_PUBLIC_SITE_URL` | 공개 | canonical/운영 hostname (`https://www.yeosonam.com`) |
| `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` | 공개 | Search Console URL-prefix meta 인증 token |
| `NEXT_PUBLIC_ATTRIBUTION_TTL_DAYS` | 공개 | attribution 보존일, 1~365, 기본 90 |
| `GA4_MEASUREMENT_PROTOCOL_API_SECRET` | **서버 비밀** | 서버 purchase/refund delivery. 절대 `NEXT_PUBLIC_` 금지 |
| `NEXT_PUBLIC_POSTHOG_KEY` | 공개 | 선택적 정산 작업대 익명 수동 이벤트 키. 미설정 시 no-op |
| `NEXT_PUBLIC_POSTHOG_HOST` | 공개 | PostHog 수집 호스트. 기본 `https://us.i.posthog.com` |

운영 전송은 `NODE_ENV=production`, `VERCEL_ENV=production`, 유효한 GTM ID, 운영 hostname, 사용자 동의를 모두 만족해야 한다. Preview에는 Production 변수 scope를 복사하지 않는다.

정산센터의 PostHog 연결은 자동 캡처, 페이지뷰, 개인 프로필, 세션 리플레이를 사용하지 않는다. 금액, 예약·고객·거래 식별자, 거래처, Clobe 메모는 전송 금지다.

## 📨 알림톡 (Solapi) — 배포 시점에 전부 없음, 추후 등록 필요

**⚠️ 현재 `.env.local` 에 Solapi 계열 키 0개.** 없어도 앱은 작동하지만, 알림톡은 skip + DB 로그만 남음.

| 키 | 용도 | 등록 필요도 |
|---|---|---|
| `SOLAPI_API_KEY` | Solapi API 키 | 🔴 알림톡 쓰려면 필수 |
| `SOLAPI_API_SECRET` | Solapi API Secret | 🔴 |
| `KAKAO_SENDER_NUMBER` | 발신번호 (예: 051-000-0000) | 🔴 |
| `KAKAO_TEMPLATE_REVIEW_REQUEST` | 리뷰 요청 (post-travel 크론) | 🔴 [가이드](./solapi-review-template-guide.md) |
| `KAKAO_TEMPLATE_BALANCE` | 잔금 안내 | 🟡 |
| `KAKAO_TEMPLATE_PASSPORT` | 여권 만료 경고 | 🟡 |
| `KAKAO_TEMPLATE_PREPARATION` | D-7 준비물 | 🟡 |
| `KAKAO_TEMPLATE_VOUCHER_ISSUED` | 바우처 발행 | 🟡 |
| `KAKAO_TEMPLATE_AFFILIATE_CELEBRATION` | 제휴 축하 | 🟢 |
| `KAKAO_CHANNEL_ID` | 서버용 채널 ID (`NEXT_PUBLIC_KAKAO_CHANNEL_ID` 와 같은 값) | 🟡 |
| `NEXT_PUBLIC_KAKAO_CHANNEL_ID` | 고객면 카카오 채널 pfId (`openKakaoChannel`, QA 에스컬레이션). 미설정 시 기본 `_xcFxkBG` | 🟡 |
| `KAKAO_CHANNEL_SECRET` | 카카오 챗봇 스킬 관리자센터의 정적 `x-api-key` 헤더값. 운영 스킬 URL과 Test URL 모두 같은 방식으로 설정 | 🔴 |

**승인 소요**: 각 템플릿 1~2일. 병렬로 여러 개 신청 가능.

## 🧭 정보성 블로그 CTA (선택, 미설정 시 안전하게 숨김)

| 키 | 용도 | 기본 동작 |
|---|---|---|
| `BLOG_NAVER_CAFE_URL` | 운영자가 확인한 공개 네이버 카페 CTA의 전체 HTTPS URL | 미설정·비HTTPS면 `NAVER_CAFE` 비활성 |
| `BLOG_DEAL_ROOM_URL` | 운영자가 확인한 공개 딜방/여행 소식 CTA의 전체 HTTPS URL | 미설정·비HTTPS면 `DEAL_ROOM` 비활성 |
| `BLOG_CONSULTATION_URL` | 정보성 글 전용 상담 CTA의 전체 HTTPS URL(선택) | 미설정 시 유효한 `KAKAO_CHANNEL_ID`를 재사용하고, 둘 다 없으면 비활성 |

`NAVER_CAFE_ID`는 마케팅 채널 운영용 식별자이며 공개 CTA URL로 자동 변환하지 않습니다. 외부 CTA가 모두 비활성인 경우 정보성 글은 관련 글 CTA만 표시합니다.

## 🤖 자기학습 (Self-Learning) — 블로그 프롬프트 자동 개선

| 키 | 용도 | 기본값 |
|---|---|---|
| `AUTO_APPROVE_LEARNING` | 학습 제안 자동 승인 | `false` (HITL 권장) |

**`true` 로 설정 시**: `blog-learn` 크론(매주 일 23시)이 성과 분석 후 즉시 `prompt_versions` 신규 활성화.
**`false` (기본)**: `/admin/agent-actions` 에 제안만 등록. 사장님 승인 필요.

## 🧠 플랫폼 AI 플라이휠 (`platform_learning_events`)

| 키 | 용도 | 기본값 |
|---|---|---|
| `PLATFORM_LEARNING_STORE_REDACTED_MESSAGE` | `true`이면 질문 전문을 휴리스틱 마스킹 후 `message_redacted`에 저장 | 미설정 (= 저장 안 함) |

동의·약관 정리 전에는 **미설정 권장**. `/admin/platform-learning` 에서 조회.

## 🧭 MAS 운영 토글 (Concierge PoC)

| 키 | 용도 | 기본값 |
|---|---|---|
| `AI_SHADOW_MODE` | `true`이면 고객 응답 대신 점검 메시지+에스컬레이션 안내만 노출(섀도우 검증 모드) | `false` |
| `CONCIERGE_EVAL_THRESHOLD` | 오프라인 평가(`npm run eval:concierge`) 합격선 | `0.95` |

## 🤖 AI 라우팅(전체/부분 전환)

| 키 | 용도 | 기본값 |
|---|---|---|
| `AI_DEFAULT_PROVIDER` | 기본 AI 제공자 (`deepseek`, `claude`, `gemini`) | `deepseek` |
| `AI_TASK_PROVIDER_OVERRIDES` | 태스크별 제공자 오버라이드. 형식: `task:provider,task:provider` | 빈 값 |
| `AI_TASK_MODEL_OVERRIDES` | 태스크별 모델 오버라이드. 형식: `task:model,task:model` | 빈 값 |
| `BLOG_AI_MODEL` | 블로그 생성 모델 강제 지정(선택) | `deepseek-v4-flash` |
| `BLOG_RESEARCH_MODEL` | V4에서는 사용하지 않음. 발행 연구 구조화 모델은 `deepseek-v4-pro`로 고정 | 없음 |
| `BLOG_RESEARCH_TIMEOUT_MS` | 정보성 블로그 자동 리서치 1회 제한 시간. 기본 `90000`, 허용 범위 20~120초 | `90000` |

예시:
- `AI_DEFAULT_PROVIDER=deepseek`
- `AI_TASK_PROVIDER_OVERRIDES=blog-generate:claude,qa-chat:deepseek`
- `AI_TASK_MODEL_OVERRIDES=blog-generate:claude-sonnet-4-6`

전환 명령:
- 전체 DeepSeek: `npm run ai:all:deepseek`
- 전체 Claude: `npm run ai:all:claude`
- 블로그만 DeepSeek: `npm run ai:blog:deepseek`
- 블로그만 Claude: `npm run ai:blog:claude`
- 카드뉴스만 DeepSeek: `npm run ai:card-news:deepseek`
- 카드뉴스만 Claude: `npm run ai:card-news:claude`
- 임의 태스크/모델 지정: `npm run ai:switch -- --task qa-chat=deepseek --model qa-chat=deepseek-v4-pro`

운영(프로덕션) 권장:
- `.env` 대신 `public.system_ai_policies` 테이블을 우선 사용합니다.
- `task='*'` 는 전역 기본값, `task='card-news'` 같은 개별 태스크가 전역보다 우선합니다.
- 필드 예시: `provider`, `model`, `fallback_provider`, `fallback_model`, `timeout_ms`, `enabled`

개발 가드:
- `npm run lint:secrets` 를 CI/로컬 훅에 연결해 비즈니스 코드에서 `process.env.*KEY/SECRET/TOKEN` 직접 접근을 차단하세요.
- 허용 파일은 `secret-registry`, `ai-provider-policy`, `supabase`로 제한합니다.

## ✉️ 알림 · 색인 API (선택)

| 키 | 용도 |
|---|---|
| `INDEXNOW_KEY` | 글로벌 + 네이버 IndexNow 공용 키. 네이버 호환을 위해 8~128자의 16진수/하이픈만 사용하며 값은 문서·로그에 기록하지 않는다. `indexing.ts` 참조 |
| `INDEXNOW_RECENT_TTL_MS` | 같은 런타임에서 최근 제출한 URL을 다시 IndexNow로 보내지 않는 캐시 시간. 기본 10분 |
| `INDEXNOW_PROVIDER_MIN_INTERVAL_MS` | IndexNow 제공자별 요청 사이 최소 간격. 기본 250ms |
| `INDEXNOW_MAX_URLS_PER_REQUEST` | IndexNow 한 요청에 담을 최대 URL 수. 기본 10,000 |
| `GSC_SERVICE_ACCOUNT_JSON` | Google Search Console 서비스 계정 JSON. 블로그 일반 글은 이 키로 Sitemap API 제출·URL Inspection·GSC 지표 수집을 수행 |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | 레거시 Google 서비스 계정 JSON. `GSC_SERVICE_ACCOUNT_JSON` 없을 때 fallback |
| `GSC_SITE_URL` | Search Console에 등록된 정확한 속성 URL (`https://yeosonam.com/` 등). www 유무 불일치 방지 |
| `GSC_URL_INSPECTION_MAX_PER_RUN` | URL Inspection 크론 1회 최대 검사 수. 기본 `25` |
| `GSC_URL_INSPECTION_MAX_PER_10M` | URL Inspection 최근 10분 최대 검사 수. 기본 `100` |
| `GSC_URL_INSPECTION_MAX_PER_DAY` | URL Inspection 최근 24시간 최대 검사 수. 기본 `1500` |
| `GSC_URL_INSPECTION_RETRY_AFTER_MINUTES` | Google 쿼터·속도 제한 감지 시 재시도 안내 분. 기본 `15` |
| `GOOGLE_INDEXING_API_FOR_BLOGS` | retired/무시. 일반 `/blog` URL은 값과 무관하게 Google Indexing API를 호출하지 않음 |
| `SLACK_WEBHOOK_URL` | Slack 범용 웹훅 (폴백·운영 알림 등) |
| `SLACK_SIGNING_SECRET` | Slack 앱의 Signing Secret. `/api/slack-webhook` raw-body HMAC 검증에 필수 |
| `SLACK_ALERT_WEBHOOK_URL` | 운영 경고 (`slack-alert`, payment-heartbeat 등) |
| `SLACK_ALERTS_WEBHOOK` | 어드민 알림 큐 critical/warning 푸시 (`admin-alerts`) |
| `SLACK_PAYMENTS_WEBHOOK_URL` | 결제·정산 전용 (`slack-notifier`, 우선순위) |
| `SLACK_GROUP_RFQ_WEBHOOK_URL` | 단체여행 RFQ 랜딩 문의 알림 |
| `SLACK_CHANNEL_ID` | `slack-gap-fill` 크론이 스캔할 Slack 채널 ID (`C…`) |
| `GOOGLE_ADS_CLIENT_ID` | Google Ads / Analytics OAuth 클라이언트 ID |
| `REVALIDATE_SECRET` | ISR 강제 무효화 시크릿 |

주의: 서버 비밀값이 `""` 또는 `''`처럼 빈 따옴표로 내려오면 `getSecret()`은 미설정으로 처리한다. Vercel에는 키 이름뿐 아니라 실제 값이 들어 있는지 확인한다.

## 📊 트래킹 · 광고 (선택)

| 키 | 용도 |
|---|---|
| `NEXT_PUBLIC_PARTYTOWN` | `1`이면 Meta·카카오 모먼트·Clarity 스크립트를 Partytown(웹 워커)로 격리. 미설정·그 외 값이면 메인 스레드에서 기존과 동일하게 로드 | `1` (성능 검증 후 켜기 권장) |
| `META_ACCESS_TOKEN` | Meta Ads 광고 API (배포 상태) |
| `META_AD_ACCOUNT_ID` | Meta 광고 계정 |
| `META_PAGE_ID` | Meta 페이지 |
| `THREADS_ACCESS_TOKEN` | Threads publish/insights 전용 토큰. 없으면 일부 경로에서 `META_ACCESS_TOKEN` fallback 사용 |
| `THREADS_USER_ID` | Threads 발행 대상 운영 계정 ID. `/admin/marketing/system-health`의 Threads publish config에서 확인 |
| `THREADS_KEYWORD_SEARCH_ENABLED` | `1`이면 keyword search scope 승인 완료로 간주해 운영 health에 표시. 승인 전에는 trend miner를 fallback/dry-run으로 운영 |
| `GOOGLE_ADS_*` | Google Ads API. Developer Token/Customer ID/OAuth 값은 서버 전용 값이며 `NEXT_PUBLIC_*`로 노출 금지 |
| `NAVER_ADS_*` | 네이버 검색광고 API. 서버 전용 값이며 `NEXT_PUBLIC_*`로 노출 금지 |

### 성능 — 서드파티 스크립트 격리 (선택)

| 키 | 용도 | 기본값 |
|---|---|---|
| `NEXT_PUBLIC_PARTYTOWN` | `1`이면 Meta·카카오 모먼트·Clarity 스크립트를 Partytown(웹 워커)로 격리. 켠 뒤 전환·픽셀 이벤트 QA 권장 | 미설정 (= 메인 스레드 로드) |

### 광고 자동 최적화 런타임 토글

| 키 | 용도 | 기본값 |
|---|---|---|
| `AD_OPTIMIZER_APPLY_CHANGES` | `true`/`1`이면 `ad-optimizer`가 키워드 상태/입찰을 실제 DB에 반영. 아니면 dry-run | `false` |
| `AD_OPTIMIZER_APPLY_EXTERNAL_ADS` | `true`/`1`이면 `keyword_performances.external_keyword_id`가 있는 행에 한해 네이버/구글 광고 API에도 입찰·정지를 반영 | `false` |
| `AD_OPTIMIZER_APPLY_OFFPEAK_RULE` | `true`/`1`이면 `ad-optimizer`에서 새벽 감액 규칙도 반영 | `false` |
| `SEARCH_ADS_AUTO_DAILY_BUDGET_KRW` | 상품 승인 시 생성되는 검색광고 키워드 플랜의 기본 일 예산 | `30000` |
| `SEARCH_ADS_MAX_DAILY_BUDGET_KRW` | 자동 플랜/발행에서 허용하는 상품별 최대 일 예산 상한 | `50000` |
| `SEARCH_ADS_AUTO_PUBLISH_NAVER` | `true`/`1`이면 검색광고 플랜을 live 발행 후보로 표시. 실제 외부 생성 API 연결 전까지는 draft-first 유지 권장 | `false` |
| `MARKETING_RULES_APPLY_BID_UPDATES` | `true`/`1`이면 `marketing-rules`에서 off-peak 감액 반영 | `false` |
| `AD_OFFPEAK_BID_FACTOR` | off-peak 감액 배수 | `0.85` |
| `AD_MIN_BID_KRW` | 감액 시 하한 입찰가(원) | `70` |
| `AD_FLAG_UP_BID_FACTOR` | `FLAGGED_UP` 시 입찰 상향 배수 | `1.1` |
| `MARKETING_RULES_VERBOSE` | `1`일 때 정책 로그 상세 출력 | `0` |

운영 권장:
- off-peak 감액은 **한쪽 크론만** 실반영하세요. 보통 `MARKETING_RULES_APPLY_BID_UPDATES=true`, `AD_OPTIMIZER_APPLY_OFFPEAK_RULE=false` 조합을 권장합니다.
- 첫 적용은 dry-run(`*_APPLY_* = false`)으로 1~2일 로그 확인 후 전환하세요.

### 발행/귀속 자동 보강 토글

| 키 | 용도 | 기본값 |
|---|---|---|
| `PUBLISH_ORCHESTRATION_WRITE_LOGS` | `true`/`1`이면 블로그 자동 발행 성공 시 `marketing_logs` 기록 | `false` |
| `BOOKING_ATTRIBUTION_AUTOFIX` | `true`/`1`이면 귀속 신호가 있는 예약의 비어있는 UTM을 보수적으로 자동 보강 | `false` |

## 🔄 외부 API (선택)

| 키 | 용도 |
|---|---|
| `OPENAI_API_KEY` | 기존 텍스트/기타 API 연동용 서버 secret. 구독형 공용 미디어 생성에는 사용하지 않음 |
| `MEDIA_CODEX_WORKER_TOKEN` | Vercel 내부 API와 Windows Codex 워커가 공유하는 32자 이상 전용 Bearer secret. 브라우저·Git·로그 공개 금지 |
| `MEDIA_CODEX_API_BASE_URL` | 로컬 워커 전용 서버 URL. 기본 `https://www.yeosonam.com`; localhost 외 HTTPS만 허용 |
| `MEDIA_CODEX_ENABLED` | `true`일 때만 구독형 Codex 이미지 작업 enqueue/claim 허용. 기본 비활성 |
| `MEDIA_CODEX_DAILY_LIMIT` | KST 일일 Codex 작업 claim 상한. 기본 `6`, 허용 `1`~`30` |
| `MEDIA_CODEX_JOB_LEASE_MINUTES` | claim lease 시간. 기본 `30`, 허용 `5`~`90` |
| `MEDIA_CODEX_BLOG_ROLLOUT_PERCENT` | 블로그 커버의 안정 해시 canary 비율 `0`~`100`. 기본 `0` |
| `MEDIA_CODEX_CARD_NEWS_ROLLOUT_PERCENT` | 정보형 카드뉴스 배경 canary 비율 `0`~`100`. 기본 `0` |
| `MEDIA_ASSET_BUCKET` | 영구 미디어 Storage bucket. 기본 `media-assets` |
| `MEDIA_LEGACY_PEXELS_FALLBACK` | `true`이고 호출부도 명시 opt-in일 때만 Pexels 복구 경로 허용. 기본 비활성 |
| `PEXELS_API_KEY` | 관광지 사진과 명시적 legacy 복구용. 블로그·카드뉴스 정상 자동 fallback에는 사용하지 않음 |
| `GEMINI_API_KEY` | 기존 Gemini 연동용. 신규 공용 미디어 생성에는 사용하지 않음 |
| `AI_IMAGE_GEN_ENABLED` | 레거시 API 이미지 토글. 구독형 공용 미디어에는 사용하지 않음 |
| `BLOG_IMAGE_MODEL` | 레거시 API 이미지 모델. 구독형 공용 미디어에는 사용하지 않음 |
| `ANTHROPIC_API_KEY` | Claude API (IR 파이프라인용) |
| `CLOBE_MCP_URL` | Clobe MCP 엔드포인트. 미설정 시 `https://api.clobe.ai/mcp`. 인증은 `/admin/settings/integrations`의 Clobe OAuth 로그인으로 저장 |
| `CLOBE_MCP_TRANSACTIONS_TOOL` | 거래 조회 도구 이름을 자동 탐색할 수 없을 때 지정하는 선택값 |

### 🤖 AI 운영실 Preview Shadow Pilot (기본 잠금)

| 키 | 용도 | 기본값 |
|---|---|---|
| `AGENT_OFFICE_SHADOW_PILOT_ENABLED` | `1`일 때만 Vercel Preview/로컬에서 수동 Technology Scout 1건 실행 허용. Production에서는 코드로 영구 차단 | 미설정(잠금) |
| `AGENT_OFFICE_SHADOW_WORKSPACE_ROOT` | Preview Codex read-only Runtime이 읽을 수 있는 격리 workspace 절대 경로. 미설정 시 프로세스 workspace | 미설정 |
| `CODEX_AGENT_OFFICE_MODEL` | Shadow Pilot에 사용할 Codex 모델 식별자. Provider 정책·Production 업무와 분리 | `gpt-5.4-mini` |

Shadow Pilot은 `agent_runs` Preview migration과 ChatGPT Codex App Server가 모두 확인된 경우에만 실행됩니다. 이 토글은 자동 위임·Command·게시·Production DB migration을 활성화하지 않습니다.

## 🔍 미매칭 관광지 큐·크론 (선택)

| 키 | 용도 | 기본값 |
|---|---|---|
| `UNMATCHED_AUTO_RESOLVE_MIN_SCORE` | `/api/cron/unmatched-auto-resolve` 가 alias 자동 적립·해결에 쓰는 최소 유사도 점수 | `95` |
| `UNMATCHED_BOOTSTRAP_MIN_OCCURRENCES` | 어드민 집계「고빈도 대기」·`GET /api/unmatched?bootstrap=1` 후보의 최소 등장 횟수 | `3` |
| `UNMATCHED_BOOTSTRAP_SCORE_MIN` | 부트스트랩 후보 점수 하한 (크론 자동해결보다 낮은 애매 구간) | `75` |
| `UNMATCHED_BOOTSTRAP_SCORE_MAX` | 부트스트랩 후보 점수 상한 | `94` |

미설정 시 위 기본값이 적용됩니다. `?bootstrap=1` 요청의 쿼리 파라미터(`min_occurrences`, `score_min`, `score_max`)가 있으면 env보다 우선합니다.

## 🏗 배포 (Vercel 자동 관리)

| 키 | 설정 |
|---|---|
| `VERCEL_URL` | Vercel 자동 주입 |
| `NODE_ENV` | `production` / `preview` 자동 |

---

## Marketing CAPI / Command Center additions (2026-05-30)

| Variable | Purpose |
|---|---|
| `META_CAPI_ACCESS_TOKEN` | Meta Conversions API server-event token. Falls back to `META_ACCESS_TOKEN` or `META_ADS_ACCESS_TOKEN` when unset. |
| `META_GRAPH_API_VERSION` | Optional Meta Graph API version for CAPI calls. Defaults to `v23.0`; bump this when Meta deprecates old versions. |
| `META_PIXEL_ID` | Server-side CAPI Pixel ID. Falls back to `NEXT_PUBLIC_META_PIXEL_ID` when unset. |
| `NEXT_PUBLIC_META_PIXEL_ID` | Browser Meta Pixel ID and fallback Pixel ID for server CAPI. |
| `GSC_SITE_URL` | Exact Google Search Console property URL used by GSC sitemap submit, page metrics, and URL Inspection. |
| `GSC_SERVICE_ACCOUNT_JSON` | Dedicated Search Console service account JSON. Falls back to `GOOGLE_SERVICE_ACCOUNT_JSON`. |

New DB migrations that must be applied for full persistence:

- `supabase/migrations/20260530090000_marketing_recommendations_ledger.sql`
- `supabase/migrations/20260530091000_marketing_capi_and_asset_snapshots.sql`

## 🚨 누락 시 영향도

| 누락 변수 | 영향 |
|---|---|
| `ADMIN_EMAILS` 없음 | 브라우저에서 로그인한 상태로 어드민 API·정책 API 등 `isAdminRequest` 경로 거부 |
| `SUPABASE_JWT_SECRET` 없음 (Production) | `sb-access-token` 검증 실패 → 어드민·일부 보호 API 동작 불가 |
| `GOOGLE_AI_API_KEY` 없음 | 정보성 블로그의 근거 조사 preflight 실패. 근거 없는 fallback 글은 발행하지 않음 |
| `SOLAPI_*` 없음 | 알림톡 발송 실패, DB 로그만 남음 |
| `KAKAO_TEMPLATE_REVIEW_REQUEST` 없음 | 리뷰 요청 알림톡 skip. 콘솔 경고만 |
| `AUTO_APPROVE_LEARNING=false` | 자기학습 수동 승인 필요 (권장 모드) |
| `MEDIA_CODEX_WORKER_TOKEN` 없음 | 로컬 Codex 워커 내부 API 인증 실패. 발행물은 코드형 브랜드 커버로 정상 유지 |
| `MEDIA_CODEX_ENABLED` 없음/false | 구독형 작업 enqueue/claim을 중지하고 코드형 브랜드 카드·기존 검증 이미지 유지 |
| `PEXELS_API_KEY` 없음 | 관광지 사진 동기화와 명시적 legacy 복구만 사용할 수 없음. 블로그 정상 생성에는 영향 없음 |
| `NEXT_PUBLIC_CONSULT_PHONE` 없음 | QA 채팅 에스컬레이션에서 **전화** 버튼 미표시 (카카오톡만) |
| `*_APPLY_*` 토글 미설정 | 광고/발행 자동화가 dry-run 중심으로 동작(안전 모드) |

## 🤝 제휴·추천 쿠키 (`aff_ref`) — 선택

| 키 | 용도 | 기본 |
|---|---|---|
| `AFFILIATE_REF_STRICT_MARKETING_CONSENT` | `true`이면 `ys_marketing_consent=true` 일 때만 `aff_ref` 30일, 아니면 세션 쿠키만 | 미설정 = 항상 30일 |
| `AFFILIATE_INVITE_CODES` | 파트너 신청 Invite-only 코드 목록 (쉼표 구분). 설정 시 코드 없는 신청 차단 | 미설정 = 공개 신청 |
| `AFFILIATE_ATTRIBUTION_MODEL` | 멀티터치 재계산 기본 모델 (`last_touch` / `first_touch` / `linear`) | `last_touch` |
| `AFFILIATE_LIFETIME_EXPERIMENT_RATE` | Lifetime 0.5% 실험군 배정 비율 (0~1) | `0.3` |

자세한 운영 기준: [`docs/affiliate-attribution.md`](./affiliate-attribution.md)

## 📝 로컬 개발용 .env.local 예시

```bash
# 필수
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_publishable_key
SUPABASE_SECRET_KEY=your_secret_key
ADMIN_EMAILS=admin@example.com
NEXT_PUBLIC_BASE_URL=http://localhost:3000
# NEXT_PUBLIC_CONSULT_PHONE=051-000-0000  # QA 채팅 전화 상담 버튼 (없으면 카톡만)
GOOGLE_AI_API_KEY=your_gemini_key
SUPABASE_JWT_SECRET=your_jwt_secret_from_supabase_dashboard
ADMIN_EMAILS=admin@yeosonam.com

# Solapi (있을 시)
SOLAPI_API_KEY=your_solapi_key
SOLAPI_API_SECRET=your_solapi_secret
SOLAPI_SENDER_NUMBER=051-000-0000
KAKAO_TEMPLATE_REVIEW_REQUEST=TEMPLATE_ID_FROM_SOLAPI

# 외부 API
PEXELS_API_KEY=your_pexels_key
GEMINI_API_KEY=your_gemini_key
# AI_IMAGE_GEN_ENABLED=false
# BLOG_IMAGE_MODEL=gemini-3.1-flash-image
ANTHROPIC_API_KEY=your_claude_key

# 선택
AUTO_APPROVE_LEARNING=false
REVALIDATE_SECRET=your_random_secret
# AD_OPTIMIZER_APPLY_CHANGES=false
# AD_OPTIMIZER_APPLY_OFFPEAK_RULE=false
# MARKETING_RULES_APPLY_BID_UPDATES=false
# AD_OFFPEAK_BID_FACTOR=0.85
# AD_MIN_BID_KRW=70
# AD_FLAG_UP_BID_FACTOR=1.1
# MARKETING_RULES_VERBOSE=1
# PUBLISH_ORCHESTRATION_WRITE_LOGS=false
# BOOKING_ATTRIBUTION_AUTOFIX=false
# AFFILIATE_REF_STRICT_MARKETING_CONSENT=true  # PIPA 대비 시만
# AFFILIATE_INVITE_CODES=HEIZE2026,PARTNERVIP
# AFFILIATE_ATTRIBUTION_MODEL=last_touch
# AFFILIATE_LIFETIME_EXPERIMENT_RATE=0.3

# 미매칭 관광지 (선택 — 미설정 시 기본값)
# UNMATCHED_AUTO_RESOLVE_MIN_SCORE=95
# UNMATCHED_BOOTSTRAP_MIN_OCCURRENCES=3
# UNMATCHED_BOOTSTRAP_SCORE_MIN=75
# UNMATCHED_BOOTSTRAP_SCORE_MAX=94
```

---

## 🆕 작업 완료 후 신규 추가된 환경변수 (2026-05-24)

아래 변수들은 마케팅 자동화 전면 활성화 작업 중 새로 추가되었거나, 기존 코드에서 사용 중이나 `.env.local`/Vercel에 누락된 항목입니다.

### 필수 — 광고/소셜 게시 활성화하려면 반드시 설정

| 키 | 용도 | 출처/발급처 |
|---|---|---|
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Google Ads API Developer Token (서버 전용) | [Google Ads 개발자 토큰](https://developers.google.com/google-ads/api/docs/first-call/dev-token) |
| `GOOGLE_ADS_CUSTOMER_ID` | Google Ads 계정 ID (예: `123-456-7890`, 서버 전용) | Google Ads 대시보드 |
| `GOOGLE_ADS_CLIENT_ID` | Google Ads OAuth 클라이언트 ID | Google Cloud Console |
| `GOOGLE_ADS_CLIENT_SECRET` | Google Ads OAuth 클라이언트 Secret | Google Cloud Console |
| `NAVER_ADS_API_KEY` | 네이버 검색광고 API Key | [네이버 SearchAd 매니저](https://manage.searchad.naver.com) → 도구 → API Key |
| `NAVER_ADS_SECRET_KEY` | 네이버 검색광고 Secret Key (HMAC 서명용) | 위와 동일 |
| `NAVER_ADS_CUSTOMER_ID` | 네이버 검색광고 고객 ID (숫자) | 위와 동일 |
| `TWITTER_BEARER_TOKEN` | Twitter/X API v2 Bearer Token | [Twitter Developer Portal](https://developer.twitter.com) → Projects → Keys and tokens |
| `NAVER_CAFE_ID` | 네이버 카페 고유 ID (카페 URL에서 숫자 부분) | 네이버 카페 관리 페이지 |
| `INSTAGRAM_BUSINESS_ACCOUNT_ID` | Instagram 비즈니스 계정 ID (IG User ID와 다를 수 있음) | Meta Business Suite → Instagram 계정 설정 |
| `OAUTH_STATE_SECRET` | OAuth state 서명·CSRF 방어용 서버 전용 고엔트로피 시크릿 | Secret Manager (development/preview/production 모두 필수) |

### 선택 — 광고 안전 장치 (기본값 dry-run)

| 키 | 용도 | 기본값 |
|---|---|---|
| `META_ADS_DRY_RUN` | `1`이면 Meta/Google 광고 API 실제 호출 안 함 (DB 로그만) | `1` |
| `META_ADS_TEST_MODE` | `1`이면 Meta 광고를 PAUSED 상태로 생성 | `1` |
| `NEXT_PUBLIC_DEFAULT_TENANT_ID` | 플랫폼 공용 마케팅 작업이 사용할 기본 테넌트 UUID | 유효한 tenant UUID (문자열 `default` 금지) |
| `AFFILIATE_JWT_SECTET` | 제휴 JWT 서명용 시크릿 | fallback: `'yeosonam-dev-jwt-secret-fallback'` |
---
### Phase 1 — 키워드 최적화 API (2026-05-24)

`CRON_SECRET`과 `SUPABASE_SERVICE_ROLE_KEY`는 위 「필수」 항목에 문서화되어 있습니다. Phase 1에서 추가된 Cron Job:

```json
{
  "path": "/api/admin/optimization",
  "schedule": "0 21 * * *"
}
```

- 매일 **21:00 UTC (= 06:00 KST)** 키워드 최적화 루프 실행
- 키워드 성과 수집 → Search Terms 분석 → negative 자동 추가 → 입찰 최적화
- Vercel이 `Authorization: Bearer $CRON_SECRET` 자동 전송

새로운 API 엔드포인트:

| 엔드포인트 | 용도 | 인증 |
|---|---|---|
| `POST /api/admin/optimization` | 최적화 루프 수동/크론 실행 | `Bearer $CRON_SECRET` |
| `GET /api/admin/optimization` | 상태 확인 | `Bearer $CRON_SECRET` |
| `GET /api/admin/keyword-stats` | 키워드 성과 요약 | `Bearer $CRON_SECRET` |
| `GET /api/admin/keyword-stats/top` | 성과 상위/하위 키워드 | `Bearer $CRON_SECRET` |
| `GET /api/admin/keyword-stats/search-terms` | 검색어 현황 + negative 추천 | `Bearer $CRON_SECRET` |

---

## Runtime Env Readiness Contract

This section is checked by `npm run verify:runtime-env-docs`. Keep it in sync with
`src/config/runtime-env-readiness.json`.

### Critical keys

These keys are required for the open-readiness gate to prove connected search,
Naver API, and cron integrations. If they are missing, local checks can still
run, but the readiness result stays `blocked`.

| Key | Purpose |
|---|---|
| `SERPAPI_KEY` | SerpAPI fallback/provider key for search rank checks. |
| `NAVER_CLIENT_ID` | Naver API client ID for search, seasonal, OAuth, and rank flows. |
| `NAVER_CLIENT_SECRET` | Naver API client secret paired with `NAVER_CLIENT_ID`. |
| `CRON_SECRET` | Bearer secret used by cron and server-to-server jobs. |

### Optional integration keys

These keys enable social, ads, Slack, and community integrations. They are
tracked by readiness, but missing values are warnings rather than release
blockers because blog autopublishing can operate without them.

| Key | Purpose |
|---|---|
| `BAND_RSS_URL` | Band RSS source URL for marketing/social ingestion. |
| `TWITTER_BEARER_TOKEN` | Twitter/X API bearer token for social publishing and reads. |
| `NAVER_CAFE_ID` | Naver Cafe ID for cafe/community marketing checks. |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Google Ads developer token. |
| `GOOGLE_ADS_CUSTOMER_ID` | Google Ads customer account ID. |
| `GOOGLE_ADS_CLIENT_ID` | Google Ads OAuth client ID. |
| `GOOGLE_ADS_CLIENT_SECRET` | Google Ads OAuth client secret. |
| `GOOGLE_PLACES_API_KEY` | Server-only Google Places Text Search key for attraction/entity verification. Does nothing unless `GOOGLE_PLACES_ENABLED=true` and a positive daily limit are set. |
| `GOOGLE_PLACES_ENABLED` | Optional Google Places verification switch. Default is off/false so Google calls are 0 even when a key exists. |
| `GOOGLE_PLACES_DAILY_LIMIT` | Maximum billable Google Places verification attempts per UTC day. Default is `0`. |
| `GOOGLE_PLACES_MAX_QUERIES_PER_CANDIDATE` | Maximum Google Places Text Search queries for one entity candidate. Default is `1`. |
| `SLACK_WEBHOOK_URL` | Slack operations webhook for marketing/readiness alerts. |

### Warn-default keys

These keys have safe defaults but should still be set explicitly in staging and
production so bid behavior is intentional.

| Key | Default |
|---|---|
| `AD_FLAG_UP_BID_FACTOR` | `1.1` |
| `AD_OFFPEAK_BID_FACTOR` | `0.85` |
| `AD_MIN_BID_KRW` | `70` |

## Operational Readiness Input Audit

Run this before staging/production open-readiness checks:

```bash
npm run discover:operational-inputs -- --json \
  --out=.tmp/operational-readiness-discovered.env

npm run verify:operational-inputs -- --json \
  --env-file=.tmp/operational-readiness-discovered.env \
  --template-out=.tmp/operational-readiness-inputs.env.example \
  --plan-out=.tmp/operational-readiness-action-plan.md \
  --apply-script-out=.tmp/operational-readiness-apply-inputs.sh \
  --vercel-script-out=.tmp/operational-readiness-vercel-env.sh \
  --node-apply-script-out=.tmp/operational-readiness-apply-inputs.mjs \
  --node-vercel-script-out=.tmp/operational-readiness-vercel-env.mjs
```

`npm run verify:local-release -- --json` also runs this audit and writes the
fill-in template to `.tmp/local-release-operational-inputs.env.example` and
the action plan to `.tmp/local-release-operational-inputs-action-plan.md`.
It also writes a GitHub CLI apply script to
`.tmp/local-release-operational-inputs-apply.sh` and a Vercel CLI runtime-env
apply script to `.tmp/local-release-operational-inputs-vercel-env.sh`.
Cross-platform Node variants are also written to
`.tmp/local-release-operational-inputs-apply.mjs` and
`.tmp/local-release-operational-inputs-vercel-env.mjs` by default. Use
`--skip-operational-inputs` only for narrow development smoke checks where
external readiness is intentionally out of scope.
`verify:local-release` also attempts
`discover:operational-inputs` first when no `--operational-env-file` is passed,
then loads `.tmp/local-release-operational-inputs-discovered.env` into the
remaining readiness steps. Disable that behavior with
`--skip-operational-discovery` for narrow smoke checks. When validating a
filled template through the local release gate, pass
`--operational-env-file=.tmp/operational-readiness-inputs.env.example`.
`npm run verify:marketing-release -- --json` provides the marketing-only release
gate. It attempts operational discovery by default, writes
`.tmp/marketing-release-operational-inputs-discovered.env`, and then runs the
marketing automation contracts, operational input audit, local marketing runtime
probe, build, and bundle checks unless the matching `--skip-*` flags are used.
The `Marketing Release Readiness` GitHub workflow runs the same gate and renders
the summary, attention-item issue body, and generated operational input artifacts.
When Supabase service-role credentials are available, prefer
`npm run discover:operational-inputs -- --out=.tmp/operational-readiness-discovered.env`
first and pass that file to `verify:operational-inputs` or `verify:local-release`.
The discovery script only writes non-secret probe identifiers:
`OPEN_CHECK_PACKAGE_ID`, `OPEN_CHECK_REF_CODE`, `OPEN_CHECK_BLOG_SLUG`,
`MARKETING_CHECK_CARD_NEWS_ID`, and `MARKETING_CHECK_VARIANT_GROUP_ID`.

Rendered readiness summaries and tracked attention-item issues include
`Missing Inputs` for blockers and `Release Warnings` for values that are safe
locally but should be explicit in staging/production.

The audit covers:

| Group | Keys |
|---|---|
| Public data probes | `OPEN_CHECK_PACKAGE_ID`, `OPEN_CHECK_REF_CODE`, `OPEN_CHECK_BLOG_SLUG` |
| Marketing dynamic page probes | `MARKETING_CHECK_CARD_NEWS_ID`, `MARKETING_CHECK_VARIANT_GROUP_ID` |
| Protected ops probes | `CRON_SECRET`, or `OPEN_CHECK_AUTH_COOKIE` for cookie-authenticated staging checks |
| External management APIs | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `VERCEL_TOKEN` |
| Runtime integrations | The critical keys listed in `src/config/runtime-env-readiness.json` |
| Optional runtime integrations | The optional integration keys listed in `src/config/runtime-env-readiness.json` |
| Runtime tunable defaults | The warn-default keys listed in `src/config/runtime-env-readiness.json` |
| Blog quality data | `BLOG_QUALITY_SOURCE_READY` or a usable `SUPABASE_SERVICE_ROLE_KEY` |

Use the generated `.tmp/operational-readiness-inputs.env.example` as the fill-in
template for GitHub Actions variables/secrets or local staging smoke runs.
After filling the generated template, run
`npm run verify:operational-inputs -- --json --env-file=.tmp/operational-readiness-inputs.env.example`
to confirm the file satisfies the readiness audit. Then run
`node .tmp/operational-readiness-apply-inputs.mjs --env-file=.tmp/operational-readiness-inputs.env.example`
to apply repository variables/secrets with GitHub CLI and
`node .tmp/operational-readiness-vercel-env.mjs --env-file=.tmp/operational-readiness-inputs.env.example`
to apply runtime integration keys and explicit bid defaults to Vercel
Production/Preview environments. Exported shell values still work and take
precedence over the file. The generated `.sh` files provide the same flow for
Bash-based shells, for example
`bash .tmp/operational-readiness-apply-inputs.sh --env-file=.tmp/operational-readiness-inputs.env.example`.
Use `OPERATIONAL_APPLY_DRY_RUN=1` first to print redacted GitHub/Vercel
commands without changing external settings. The dry-run path is checked by
`npm run verify:operational-apply-scripts -- --json`. The env-file audit also
warns on unknown keys, duplicate keys, empty values, and invalid lines so typos
are visible before applying external configuration.

## Clobe Settlement Selection

| Variable | Purpose |
|---|---|
| `CLOBE_COMPANY_ID` | Optional Clobe company ID when one OAuth account exposes multiple companies. Leave unset for a single-company connection. |

## Product Registration V4 OCR

| Variable | Purpose |
|---|---|
| `PRODUCT_REGISTRATION_V4_OCR_ENABLED` | Optional, fail-closed image OCR profile. Set to `1` only after the OCR provider, cost ceiling, and golden-corpus review are approved. Unset/other values route image uploads to `needs_review`. |

## Product Registration V5 Shadow

| Variable | Description |
|---|---|
| `PRODUCT_REGISTRATION_V5_SHADOW` | Optional. Set to `1` to persist immutable V5 candidate revisions, segments, and claim/evidence links from the V4 canonical worker. Customer publication still uses the existing V4/V3 compatibility writer until the dual-write diff and CAS publication gates are complete. |
| `PRODUCT_REGISTRATION_V5_AUTHORITATIVE` | Optional and disabled by default. Set to `1` only for a controlled admin canary using the V5 CAS publication endpoint; normal approval remains on the compatibility writer. |

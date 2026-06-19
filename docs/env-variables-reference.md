# 여소남 OS 환경변수 레퍼런스

> Vercel 프로젝트 환경변수 설정 가이드 — Production 배포 전 필수 확인

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
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase 익명 키 (클라이언트) | `eyJhbGciOi...` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase 서비스 키 (서버) | `eyJhbGciOi...` |
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

**승인 소요**: 각 템플릿 1~2일. 병렬로 여러 개 신청 가능.

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
| `INDEXNOW_KEY` | Bing/Yandex/Seznam IndexNow 키 (색인 요청). `indexing.ts` 참조 |
| `GSC_SERVICE_ACCOUNT_JSON` | Google Search Console 서비스 계정 JSON. 블로그 일반 글은 이 키로 Sitemap API 제출·URL Inspection·GSC 지표 수집을 수행 |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | 레거시 Google 서비스 계정 JSON. `GSC_SERVICE_ACCOUNT_JSON` 없을 때 fallback |
| `GSC_SITE_URL` | Search Console에 등록된 정확한 속성 URL (`https://yeosonam.com/` 등). www 유무 불일치 방지 |
| `GOOGLE_INDEXING_API_FOR_BLOGS` | `true`일 때만 일반 블로그에도 Google Indexing API 직접 호출을 허용. 기본은 미사용(공식 지원 범위가 JobPosting/BroadcastEvent 중심) |
| `SLACK_WEBHOOK_URL` | Slack 범용 웹훅 (폴백·운영 알림 등) |
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
| `PEXELS_API_KEY` | 이미지 fallback (블로그·카드뉴스) |
| `ANTHROPIC_API_KEY` | Claude API (IR 파이프라인용) |

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
| `GOOGLE_AI_API_KEY` 없음 | 블로그 자동 생성 fallback (하드코딩 시즌 토픽만 사용) |
| `SOLAPI_*` 없음 | 알림톡 발송 실패, DB 로그만 남음 |
| `KAKAO_TEMPLATE_REVIEW_REQUEST` 없음 | 리뷰 요청 알림톡 skip. 콘솔 경고만 |
| `AUTO_APPROVE_LEARNING=false` | 자기학습 수동 승인 필요 (권장 모드) |
| `PEXELS_API_KEY` 없음 | 이미지 없이 블로그 생성 (품질 저하) |
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
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_key
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

### 선택 — 광고 안전 장치 (기본값 dry-run)

| 키 | 용도 | 기본값 |
|---|---|---|
| `META_ADS_DRY_RUN` | `1`이면 Meta/Google 광고 API 실제 호출 안 함 (DB 로그만) | `1` |
| `META_ADS_TEST_MODE` | `1`이면 Meta 광고를 PAUSED 상태로 생성 | `1` |
| `NEXT_PUBLIC_DEFAULT_TENANT_ID` | 마케팅 파이프라인 기본 테넌트 ID | `default` |
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

These keys are required for the open-readiness gate to prove the currently
connected core marketing runtime: search, Meta/Threads social, Supabase-backed
data, and cron. If they are missing, local checks can still run, but the
readiness result stays `blocked`.

| Key | Purpose |
|---|---|
| `SERPAPI_KEY` | SerpAPI fallback/provider key for search rank checks. |
| `NAVER_CLIENT_ID` | Naver API client ID for search, seasonal, OAuth, and rank flows. |
| `NAVER_CLIENT_SECRET` | Naver API client secret paired with `NAVER_CLIENT_ID`. |
| `META_AD_ACCOUNT_ID` | Meta ad account ID used by marketing and Ad OS status checks. |
| `META_ACCESS_TOKEN` | Meta API access token; some routes can also use `META_ADS_ACCESS_TOKEN`. |
| `META_APP_ID` | Meta app ID for OAuth and token refresh flows. |
| `META_APP_SECRET` | Meta app secret paired with `META_APP_ID`. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only Supabase service role key for operational data checks. |
| `CRON_SECRET` | Bearer secret used by cron and server-to-server jobs. |

### Optional channel keys

These keys enable specific live channels. Missing values should be shown as
channel-readiness warnings, not as proof that the core Vercel runtime is
unconfigured.

| Key | Purpose |
|---|---|
| `BAND_RSS_URL` | Band RSS source URL for marketing/social ingestion. |
| `TWITTER_BEARER_TOKEN` | Twitter/X API bearer token for X publishing and reads. |
| `NAVER_CAFE_ID` | Naver Cafe ID for cafe/community publishing. |
| `NAVER_ADS_API_KEY` | Naver Search Ads API key. |
| `NAVER_ADS_SECRET_KEY` | Naver Search Ads secret key. |
| `NAVER_ADS_CUSTOMER_ID` | Naver Search Ads customer ID. |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Google Ads developer token. |
| `GOOGLE_ADS_CUSTOMER_ID` | Google Ads customer account ID. |
| `GOOGLE_ADS_CLIENT_ID` | Google Ads OAuth client ID. |
| `GOOGLE_ADS_CLIENT_SECRET` | Google Ads OAuth client secret. |
| `GOOGLE_ADS_REFRESH_TOKEN` | Google Ads OAuth refresh token. |
| `GOOGLE_ADS_CONVERSION_ACTION_ID` | Google Ads conversion action ID. |
| `THREADS_ACCESS_TOKEN` | Threads publish/insights token. Some read paths can use `META_ACCESS_TOKEN` fallback. |
| `THREADS_USER_ID` | Threads publishing account ID for live Threads publishing. |
| `SLACK_WEBHOOK_URL` | Slack operations webhook for marketing/readiness alerts. |
| `SLACK_ALERT_WEBHOOK_URL` | Slack alert webhook alternative. |
| `SLACK_ALERTS_WEBHOOK` | Legacy Slack alert webhook alternative. |

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
If the correct Supabase credentials live in Vercel rather than the local env
file, run `npm run discover:operational-inputs:vercel -- --json`; it pulls the
selected Vercel environment into a temporary file, discovers the non-secret
probe identifiers, and removes the temporary env file afterward.
To verify the marketing runtime against the linked Vercel environment variables
without keeping a local env file, run
`npm run verify:marketing-runtime:vercel -- --json`. The command pulls Vercel
env values into a temporary file, discovers non-secret operational probe IDs,
runs the local marketing runtime check with dynamic probes required, and removes
the temporary files.
When no `card_news.variant_group_id` row exists, run
`npm run ensure:operational-variant-group -- --from-vercel --json` first to
dry-run the repair. Add `--apply` only when it is acceptable to create two
`[READINESS]` DRAFT card-news rows used solely for dynamic page verification.
The discovery script only writes non-secret operational identifiers:
`OPEN_CHECK_PACKAGE_ID`, `OPEN_CHECK_REF_CODE`,
`MARKETING_CHECK_CARD_NEWS_ID`, `MARKETING_CHECK_VARIANT_GROUP_ID`, and
`SUPABASE_PROJECT_REF`.

Rendered readiness summaries and tracked attention-item issues include
`Missing Inputs` for blockers and `Release Warnings` for values that are safe
locally but should be explicit in staging/production.

The audit covers:

| Group | Keys |
|---|---|
| Public data probes | `OPEN_CHECK_PACKAGE_ID`, `OPEN_CHECK_REF_CODE` |
| Marketing dynamic page probes | `MARKETING_CHECK_CARD_NEWS_ID`, `MARKETING_CHECK_VARIANT_GROUP_ID` |
| Protected ops probes | `CRON_SECRET`, or `OPEN_CHECK_AUTH_COOKIE` for cookie-authenticated staging checks |
| External management APIs | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `VERCEL_TOKEN` |
| Runtime integrations | The critical keys listed in `src/config/runtime-env-readiness.json` |
| Runtime tunable defaults | The warn-default keys listed in `src/config/runtime-env-readiness.json` |
| Blog quality data | `BLOG_QUALITY_SOURCE_READY` or a usable `SUPABASE_SERVICE_ROLE_KEY` |

Use the generated `.tmp/operational-readiness-inputs.env.example` as the fill-in
template for GitHub Actions variables/secrets or local staging smoke runs.
`npm run generate:full-operational-inputs` inspects local env files, Vercel env
names, GitHub Actions secret/variable names, and local Vercel/Supabase CLI auth
without printing secret values, so externally configured values are reported
separately from values loaded into the current process. Local CLI auth is enough
for a developer-machine smoke check, but scheduled GitHub workflows still need
`VERCEL_TOKEN` and `SUPABASE_ACCESS_TOKEN` as repository secrets.
Run `npm run bootstrap:ci-management-secrets -- --json` to check whether those
two CI-only management secrets can be sourced from the current machine's Vercel
and Supabase CLI auth without printing token values. Add `--apply` only when you
intend to write the available tokens into GitHub Actions secrets; the script
passes values to `gh secret set` through stdin and keeps the default mode as a
dry-run.
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

# 여소남 OS 환경변수 레퍼런스

> Vercel 프로젝트 환경변수 설정 가이드 — Production 배포 전 필수 확인

## 🔑 필수 (Required) — 설정 안 하면 앱 작동 불가

| 키 | 용도 | 예시 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 프로젝트 URL | `https://ixaxnvbmhzjvupissmly.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase 익명 키 (클라이언트) | `eyJhbGciOi...` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase 서비스 키 (서버) | `eyJhbGciOi...` |
| `NEXT_PUBLIC_BASE_URL` | 사이트 루트 URL | `https://yeosonam.com` |
| `NEXT_PUBLIC_CONSULT_PHONE` | 고객 QA 채팅 **전화 상담** 버튼용 (`tel:`). 미설정 시 전화 버튼 숨김 | `0511234567` 또는 `+82511234567` |
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

## ✉️ 알림 · 색인 API (선택)

| 키 | 용도 |
|---|---|
| `INDEX_NOW_KEY` | Bing/네이버 IndexNow API 키 |
| `GOOGLE_INDEXING_CREDENTIALS` | Google Indexing API 서비스 계정 JSON |
| `SLACK_WEBHOOK_URL` | Slack 어드민 알림 |
| `REVALIDATE_SECRET` | ISR 강제 무효화 시크릿 |

## 📊 트래킹 · 광고 (선택)

| 키 | 용도 |
|---|---|
| `META_ACCESS_TOKEN` | Meta Ads 광고 API (배포 상태) |
| `META_AD_ACCOUNT_ID` | Meta 광고 계정 |
| `META_PAGE_ID` | Meta 페이지 |
| `GOOGLE_ADS_*` | Google Ads API (미구현, 향후) |
| `NAVER_AD_*` | 네이버 검색광고 API (미구현, 향후) |

### 광고 자동 최적화 런타임 토글

| 키 | 용도 | 기본값 |
|---|---|---|
| `AD_OPTIMIZER_APPLY_CHANGES` | `true`/`1`이면 `ad-optimizer`가 키워드 상태/입찰을 실제 DB에 반영. 아니면 dry-run | `false` |
| `AD_OPTIMIZER_APPLY_OFFPEAK_RULE` | `true`/`1`이면 `ad-optimizer`에서 새벽 감액 규칙도 반영 | `false` |
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

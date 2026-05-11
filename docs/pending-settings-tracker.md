# 여소남 OS 미설정 항목 트래커

> **규칙**: 설정 완료 즉시 해당 줄 삭제. 체크 표시 X — 줄 자체 제거. 카테고리 항목 0개면 섹션도 삭제.
> **소스**: `docs/deploy-checklist.md` + `docs/env-variables-reference.md`
> **레이블**: 🤖 자동실행 가능 | 🔑 값 제공 후 자동 설정 | 👤 외부서비스/수동

---

---

## 🔑 환경변수 — 미설정 (Vercel Production)

### 알림톡 (Solapi) — 값 제공 시 즉시 설정
- 🔑 `SOLAPI_API_KEY` — Solapi 대시보드 > API 키
- 🔑 `SOLAPI_API_SECRET` — Solapi 대시보드 > API Secret
- 🔑 `KAKAO_SENDER_NUMBER` — 발신번호 (예: 051-000-0000)
- 🔑 `KAKAO_CHANNEL_ID` — 카카오 채널 pfId (서버용)
- 🔑 `NEXT_PUBLIC_KAKAO_CHANNEL_ID` — 카카오 채널 pfId (클라이언트용)

### 카카오 알림톡 템플릿 ID (Solapi 심사 승인 후 입력)
- 🔑 `KAKAO_TEMPLATE_REVIEW_REQUEST` — 리뷰 요청 템플릿 ID
- 🔑 `KAKAO_TEMPLATE_BALANCE` — 잔금 안내 템플릿 ID
- 🔑 `KAKAO_TEMPLATE_PASSPORT` — 여권 만료 경고 템플릿 ID
- 🔑 `KAKAO_TEMPLATE_PREPARATION` — D-7 준비물 템플릿 ID
- 🔑 `KAKAO_TEMPLATE_VOUCHER_ISSUED` — 바우처 발행 템플릿 ID
- 🔑 `KAKAO_TEMPLATE_AFFILIATE_CELEBRATION` — 제휴 축하 템플릿 ID

### 🔍 Google 색인 (블로그 SEO 핵심)
- ✅ `NEXT_PUBLIC_BASE_URL` = `https://www.yeosonam.com` — 설정 완료, www 카노니컬 통일 배포
- ✅ `INDEXNOW_KEY` = `2bf8a3e4yeosonam7c1d9f6e0b5a` — 키 파일 공개 접근 허용, 25개 글 일괄 제출 완료
- 👤 Google Indexing API — SA가 Search Console에서 **소유자(Owner)** 권한 없음 → 403 오류. Google Search Console → 설정 → 사용자 및 권한 → SA 이메일 추가 (Owner). 완료 후 `POST /api/blog/bulk-reindex` (Bearer SUPABASE_SERVICE_ROLE_KEY) 재실행
- 🔑 `GSC_SERVICE_ACCOUNT_JSON` — `/api/cron/gsc-index-rank` 신규 크론 (2026-05-15)이 사용. 미설정 시 `GOOGLE_SERVICE_ACCOUNT_JSON` 으로 자동 fallback. 별도 SA 분리 시에만 신규 키 주입.

### 외부 API
- 🔑 `ANTHROPIC_API_KEY` — Claude API (IR 파이프라인용, 기존 키 만료됨)
- 🔑 `SLACK_WEBHOOK_URL` — 어드민 에러 알림
- 🔑 `NEXT_PUBLIC_CONSULT_PHONE` — QA 채팅 전화 상담 버튼 (없으면 카톡만)

### Meta 광고 (미확인 — 이미 설정됐으면 삭제)
- 🔑 `META_ACCESS_TOKEN` — Meta Ads API 토큰
- 🔑 `META_AD_ACCOUNT_ID` — Meta 광고 계정 ID
- 🔑 `META_PAGE_ID` — Meta 페이지 ID

### Session 2/3: 멀티테넌트 OAuth + 마케팅 파이프라인
- 🔑 `GOOGLE_ADS_CLIENT_ID` — Google Cloud Console → OAuth 2.0 클라이언트 ID (Ads + Analytics scope)
- 🔑 `GOOGLE_ADS_CLIENT_SECRET` — Google OAuth 앱 시크릿
- 🔑 `RESEND_FROM_EMAIL` — 리타겟 이메일 발신 주소 (예: noreply@yeosonam.com, Resend에서 도메인 인증 필요)

### Sprint 2-A (Naver OAuth) + Sprint 4-B (TossPayments) + Inngest
- 🔑 `NAVER_CLIENT_ID` — 네이버 개발자센터 > 애플리케이션 ID (블로그 API 스코프)
- 🔑 `NAVER_CLIENT_SECRET` — 네이버 개발자센터 > Client Secret
- 🔑 `TOSS_SECRET_KEY` — TossPayments 대시보드 > 개발 > API 키 > 시크릿 키
- 🔑 `INNGEST_EVENT_KEY` — Inngest 대시보드 > 앱 > Event Key
- 🔑 `INNGEST_SIGNING_KEY` — Inngest 대시보드 > 앱 > Signing Key

### Rate Limiting (Upstash Redis) — P0-1 2026-05-10 추가
> 코드 통합 완료. 키만 주입하면 자동으로 분산 rate limit 활성화. 미설정 시 in-memory fallback 동작.
> 권장: Vercel Marketplace → Upstash Redis 1-click 프로비저닝 (무료 티어 10K req/day)
- 🔑 `UPSTASH_REDIS_REST_URL` — Upstash 콘솔 > Database > REST API > URL
- 🔑 `UPSTASH_REDIS_REST_TOKEN` — Upstash 콘솔 > Database > REST API > Token

---

## ⚙️ 광고/발행 토글 — 대표님 승인 후 dry-run→실운영 전환

> 현재 전부 `false` (안전 모드). 1~2일 dry-run 로그 확인 후 순서대로 전환.

- 🔑 `MARKETING_RULES_APPLY_BID_UPDATES=true` — off-peak 감액 실반영 (먼저 켤 것)
- 🔑 `PUBLISH_ORCHESTRATION_WRITE_LOGS=true` — 블로그 발행 성공 시 marketing_logs 기록
- 🔑 `BOOKING_ATTRIBUTION_AUTOFIX=true` — UTM 비어있는 예약 자동 보강
- 🔑 `AD_OPTIMIZER_APPLY_CHANGES=true` — ad-optimizer DB 실반영 (선택, 안정화 후)
- 🔑 `PLATFORM_LEARNING_STORE_REDACTED_MESSAGE=true` — 약관 정리 완료 후만

---

## ⏰ Vercel Cron 확인
> Vercel Dashboard > Project > Settings > Crons 에서 수동 확인

- 👤 15개 크론 전부 ENABLED 상태 확인
  - `/api/cron/blog-lifecycle` (매일 01:30 KST)
  - `/api/cron/blog-scheduler` (매주 월 00:00 KST)
  - `/api/cron/blog-publisher` (매시간)
  - `/api/cron/blog-learn` (매주 일 23:00 KST)
  - `/api/cron/marketing-rules`
  - `/api/cron/booking-attribution-audit`
  - 기타 9개 기존 크론 (meta-optimize, auto-archive, post-travel 등)

---

## 📊 외부 모니터링 (수동)

- 👤 Google Search Console — `https://yeosonam.com` 등록 + `sitemap.xml` 제출
- 👤 네이버 웹마스터도구 — `https://yeosonam.com` 등록 + 사이트맵 제출
- 👤 Vercel Analytics — Dashboard에서 활성 확인
- 👤 Solapi 알림톡 템플릿 — 심사 신청 (승인 1~2일 소요, 병렬 신청 가능)

---

## 🧠 외부 트렌드 학습 시스템 (PR-1 ~ PR-6, 2026-05-10 박제)

> **상태**: 코드 + 마이그레이션 모두 출고 완료. 자동 발행은 **OFF** 디폴트로 안전 출고.
> **비용**: ~$50/월 (Threads API 무료 + IG Graph 무료 + Gemini Vision ~$10).

### 🔑 Meta 권한 추가 (사장님 직접)
- 🔑 Meta for Developers → 우리 앱 → **Threads API** → `threads_keyword_search` 스코프 활성화
- 🔑 Meta for Developers → 우리 앱 → **Instagram Graph API** → `ig_hashtag_search` + `pages_read_engagement` 스코프 활성화 (Business Discovery용)
- 🔑 (확인) `META_IG_USER_ID` Vercel 환경변수에 IG 비즈니스 계정 ID 들어있는지 — `/api/cron/ig-trend-miner` 동작에 필요
- 🔑 (확인) `THREADS_ACCESS_TOKEN` 또는 `META_ACCESS_TOKEN` 둘 중 하나는 keyword_search 스코프 포함 토큰이어야 함

### 👤 자동 발행 활성화 (PR-5/6 검증 후 — 1주 dry-run 추천)
1주일간 dry-run으로 critic 결정 로그 모니터링 → 거부율 5~15% 정상 범위 확인 후:
- 👤 Supabase SQL Editor에서 한 번에 토글:
  ```sql
  UPDATE card_news_publish_guards
  SET auto_publish_dry_run = false,
      auto_publish_enabled  = true,
      min_predicted_er      = 0.0150
  WHERE scope_label = 'global';
  ```
- 👤 첫 24시간 발행률·취소율 직접 모니터링 (어드민 → 카드뉴스 → 발행 결정 로그)
- 👤 이상치 자동 정지 작동 확인 (post_engagement_snapshots 24h avg < baseline 30%)

### 👤 어드민 노출 (시간 나면)
- 👤 `/admin/marketing/content-hub` 페이지에 두 view 차트 추가:
  - `engagement_by_archetype_hook` — hook_type × palette_category × layout 30일 평균 ER
  - `trending_hooks_7d` — 키워드별 7일 top hook 패턴 + sample first lines
- 👤 `card_news_publish_decisions` 일일 리포트 페이지 (거부율·예측 ER 분포)
- 👤 `bandit_arms` 어드민 페이지 (arm별 alpha/beta/total_pulls 시각화)

### 🤖 자동 처리 항목 (이미 출고됨)
- ✅ vercel.json에 4개 cron 등록 (threads-trend-miner, ig-trend-miner, design-archetype-update, auto-publish-loop)
- ✅ 마이그레이션 5개 적용 완료 (Supabase MCP 직접): `card_news_publish_guards`, `external_trend_posts`, `design_archetypes_and_hashtag_pool`, `engagement_trend_score`, `bandit_arms`
- ✅ 룰 박제: 7-10 슬라이드 sweet spot, hook 6단어/Threads 10-20단어, blue/warm palette 카테고리 분기, engagement-bait 블랙리스트, slide당 단일 감정, 9번째 contrarian 슬라이드 권장
- ✅ 안전 가드 4중: bait blacklist + 일일 한도 + critic gate + anomaly auto-pause

### 👤 (선택) 추가 통합
- 👤 Slack `SLACK_ALERTS_WEBHOOK` — anomaly_paused / 거부율 급증 시 자동 통지 연결
- 👤 카드뉴스 generation 단계에 bandit arm 적용 (지금은 critic + auto-publish만 적용 — 다음 PR 후보)
- 👤 IG `META_IG_USER_ID` 별도 검증 IG 계정 분리 (현재 운영 계정으로 IG Hashtag Search 호출 시 quota 공유)

---

## 💡 사용법

대표님이 이 파일 내용을 Claude에 붙여넣고 **"설정해줘"** 하면:
1. 🤖 항목 → MCP 도구로 즉시 자동 실행
2. 🔑 항목 → 값 없는 것만 묶어서 한 번에 요청, 제공받으면 즉시 Vercel 설정
3. 👤 항목 → 단계별 가이드 1회 제공
4. 완료된 항목 → 해당 줄 즉시 삭제

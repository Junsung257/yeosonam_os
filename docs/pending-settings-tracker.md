# 여소남 OS 미설정 항목 트래커

> **규칙**: 설정 완료 즉시 해당 줄 삭제. 체크 표시 X — 줄 자체 제거. 카테고리 항목 0개면 섹션도 삭제.
> **소스**: `docs/deploy-checklist.md` + `docs/env-variables-reference.md`
> **레이블**: 🤖 자동실행 가능 | 🔑 값 제공 후 자동 설정 | 👤 외부서비스/수동

---

## 🗄 DB 마이그레이션
> `mcp__supabase__apply_migration` 으로 자동 실행 가능

- 🤖 `db/blog_autopublish_v1.sql` 적용
- 🤖 `db/blog_ad_integration_v1.sql` 적용
- 🤖 `db/blog_featured_pillar_v1.sql` 적용

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

### 외부 API
- 🔑 `REVALIDATE_SECRET` — ISR 강제 무효화용 (아무 긴 랜덤 문자열)
- 🔑 `PEXELS_API_KEY` — 이미지 fallback (블로그·카드뉴스)
- 🔑 `ANTHROPIC_API_KEY` — Claude API (IR 파이프라인용, 기존 키 만료됨)
- 🔑 `SLACK_WEBHOOK_URL` — 어드민 에러 알림
- 🔑 `INDEX_NOW_KEY` — Bing/네이버 IndexNow 색인 API 키
- 🔑 `GOOGLE_INDEXING_CREDENTIALS` — Google Indexing API 서비스 계정 JSON
- 🔑 `NEXT_PUBLIC_CONSULT_PHONE` — QA 채팅 전화 상담 버튼 (없으면 카톡만)

### Meta 광고 (미확인 — 이미 설정됐으면 삭제)
- 🔑 `META_ACCESS_TOKEN` — Meta Ads API 토큰
- 🔑 `META_AD_ACCOUNT_ID` — Meta 광고 계정 ID
- 🔑 `META_PAGE_ID` — Meta 페이지 ID

---

## ⚙️ 광고/발행 토글 — 대표님 승인 후 dry-run→실운영 전환

> 현재 전부 `false` (안전 모드). 1~2일 dry-run 로그 확인 후 순서대로 전환.

- 🔑 `MARKETING_RULES_APPLY_BID_UPDATES=true` — off-peak 감액 실반영 (먼저 켤 것)
- 🔑 `PUBLISH_ORCHESTRATION_WRITE_LOGS=true` — 블로그 발행 성공 시 marketing_logs 기록
- 🔑 `BOOKING_ATTRIBUTION_AUTOFIX=true` — UTM 비어있는 예약 자동 보강
- 🔑 `AD_OPTIMIZER_APPLY_CHANGES=true` — ad-optimizer DB 실반영 (선택, 안정화 후)
- 🔑 `PLATFORM_LEARNING_STORE_REDACTED_MESSAGE=true` — 약관 정리 완료 후만

---

## 🔒 보안 · RLS 확인
> `mcp__supabase__execute_sql` 로 확인 가능

- 🤖 `ad_landing_mappings` RLS 정책 `allow_all_alm` 활성 여부 확인
- 🤖 `/api/reviews` POST `booking_id` 검증 로직 존재 확인

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

## 🌐 라우팅 확인
> Grep + 코드 확인으로 자동 가능

- 🤖 `middleware.ts` PUBLIC_PATHS에 `/blog`, `/destinations`, `/review`, `/api/reviews`, `/api/cron/blog-*` 포함 확인
- 🤖 `robots.txt` (또는 `/robots.ts`) 에 `/destinations` allow 포함 확인
- 🤖 `sitemap.xml` (또는 `/sitemap.ts`) 에 `/destinations`, `/destinations/[city]` 포함 확인

---

## 📊 외부 모니터링 (수동)

- 👤 Google Search Console — `https://yeosonam.com` 등록 + `sitemap.xml` 제출
- 👤 네이버 웹마스터도구 — `https://yeosonam.com` 등록 + 사이트맵 제출
- 👤 Vercel Analytics — Dashboard에서 활성 확인
- 👤 Solapi 알림톡 템플릿 — 심사 신청 (승인 1~2일 소요, 병렬 신청 가능)

---

## 💡 사용법

대표님이 이 파일 내용을 Claude에 붙여넣고 **"설정해줘"** 하면:
1. 🤖 항목 → MCP 도구로 즉시 자동 실행
2. 🔑 항목 → 값 없는 것만 묶어서 한 번에 요청, 제공받으면 즉시 Vercel 설정
3. 👤 항목 → 단계별 가이드 1회 제공
4. 완료된 항목 → 해당 줄 즉시 삭제

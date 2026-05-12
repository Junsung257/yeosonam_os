# 배포 전 체크리스트 (Deploy Checklist)

> 프로덕션 배포 직전 반드시 확인할 항목 리스트

---

## 🗄 1. 데이터베이스 (Supabase)

- [ ] 3개 마이그레이션 순서대로 적용됨:
  - [ ] `db/blog_autopublish_v1.sql`
  - [ ] `db/blog_ad_integration_v1.sql`
  - [ ] `db/blog_featured_pillar_v1.sql`
- [ ] 확인 쿼리 실행:
  ```sql
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_name='content_creatives'
    AND column_name IN ('featured','pillar_for','destination','landing_enabled','view_count','publish_scheduled_at');
  -- 예상 결과: 6
  ```
- [ ] `SELECT * FROM active_destinations;` — 활성 destination 목록 표시 확인
- [ ] `SELECT * FROM prompt_versions WHERE is_active=true;` — v1.0 활성 확인

---

## 🔑 2. 환경변수 (Vercel)

[`docs/env-variables-reference.md`](./env-variables-reference.md) 참조.

### 필수 확인
- [ ] `NEXT_PUBLIC_SUPABASE_URL`
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- [ ] `SUPABASE_SERVICE_ROLE_KEY`
- [ ] `NEXT_PUBLIC_BASE_URL=https://yeosonam.com` (localhost 아님!)
- [ ] `GOOGLE_AI_API_KEY` (Gemini 2.5 Flash)

### 선택 (없으면 해당 기능만 비활성)
- [ ] `SOLAPI_*` (알림톡 발송 없으면 DB 로그만)
- [ ] `KAKAO_TEMPLATE_REVIEW_REQUEST` ([가이드](./solapi-review-template-guide.md) 참조)
- [ ] `PEXELS_API_KEY` (이미지 fallback)
- [ ] `REVALIDATE_SECRET` (ISR 강제 무효화용, 아무 긴 문자열)
- [ ] `AUTO_APPROVE_LEARNING=false` (권장, 수동 승인)

### 이번 세션 추가 토글 (권장 기본: dry-run)
- [ ] `AD_OPTIMIZER_APPLY_CHANGES=false`
- [ ] `AD_OPTIMIZER_APPLY_OFFPEAK_RULE=false`
- [ ] `MARKETING_RULES_APPLY_BID_UPDATES=false`
- [ ] `PUBLISH_ORCHESTRATION_WRITE_LOGS=false`
- [ ] `BOOKING_ATTRIBUTION_AUTOFIX=false`
- [ ] `AD_OFFPEAK_BID_FACTOR=0.85`
- [ ] `AD_MIN_BID_KRW=70`
- [ ] `AD_FLAG_UP_BID_FACTOR=1.1`

운영 전환 권장 순서:
1) 1~2일 dry-run 관찰 (`*_APPLY_* = false`)
2) `MARKETING_RULES_APPLY_BID_UPDATES=true`만 먼저 켜서 off-peak 단일 경로 적용
3) 안정화 후 필요 시 `AD_OPTIMIZER_APPLY_CHANGES=true` 전환

---

## ⏰ 3. Vercel Cron 등록 확인

[`vercel.json`](../vercel.json) 에 등록된 크론 15개 확인:

- [ ] `/api/cron/blog-lifecycle` — 매일 01:30 KST
- [ ] `/api/cron/blog-scheduler` — 매주 월 00:00 KST
- [ ] `/api/cron/blog-publisher` — 매시간 정각
- [ ] `/api/cron/blog-learn` — 매주 일 23:00 KST
- [ ] 기타 11개 기존 크론 (meta-optimize, auto-archive, post-travel 등) 유지
- [ ] `/api/cron/marketing-rules` — 등록/ENABLED 확인
- [ ] `/api/cron/booking-attribution-audit` — 등록/ENABLED 확인

Vercel Dashboard > Project > Settings > Crons 에서 전부 ENABLED 확인.

---

## 🌐 4. 라우팅 · 퍼블릭 경로

- [ ] `middleware.ts` 의 `PUBLIC_PATHS` 에 다음 포함 확인:
  - `/blog`
  - `/destinations`
  - `/review`
  - `/api/reviews`
  - `/api/cron/blog-*`
- [ ] `robots.txt` (`/robots.ts`) 에 `/destinations` allow 확인
- [ ] `sitemap.xml` (`/sitemap.ts`) 에 `/destinations` + `/destinations/[city]` 포함 확인

---

## 🔒 5. 보안 · 인증

- [ ] `SUPABASE_SERVICE_ROLE_KEY` 는 **서버 환경변수만** (NEXT_PUBLIC_ 접두사 X)
- [ ] 어드민 라우트 (`/admin/*`) 는 미들웨어에서 인증 체크
- [ ] `ad_landing_mappings` RLS 정책 활성 (`allow_all_alm`)
- [ ] 리뷰 API `/api/reviews` POST 는 `booking_id` 검증

---

## 🧪 6. 스모크 테스트 (배포 후 5분 내)

### 공개 페이지
- [ ] `https://yeosonam.com/` → 홈 "추천 여행지 TOP 4" 섹션 표시
- [ ] `https://yeosonam.com/blog` → Featured + 2축 필터 + 목적지 허브 링크 표시
- [ ] `https://yeosonam.com/destinations` → 여행지 그리드 17개 표시
- [ ] `https://yeosonam.com/destinations/다낭` → Pillar 페이지 렌더 (빈 내용이어도 OK)
- [ ] `https://yeosonam.com/destinations/다낭/rss.xml` → XML 피드 응답

### 스키마 검증
- [ ] [Google Rich Results Test](https://search.google.com/test/rich-results) 에 `/destinations/다낭` 입력
  - TouristDestination ✅
  - BreadcrumbList ✅
  - AggregateRating (리뷰 있을 때) ✅
- [ ] `/blog` → CollectionPage + WebSite+SearchAction
- [ ] `/blog/[slug]` → BlogPosting + FAQPage + BreadcrumbList

### 어드민
- [ ] `/admin/blog/queue` → 큐 관리 UI 정상
- [ ] `/admin/blog/ads` → 광고 매핑 UI 정상 (UTM URL 발급 테스트)
- [ ] `/admin/blog/write` → 수동 작성 UI 정상

### 크론 수동 실행
- [ ] `curl https://yeosonam.com/api/cron/blog-scheduler` → 200 + `pillars: { queued: N }` 응답
- [ ] `curl https://yeosonam.com/api/cron/blog-publisher` → 200 + `processed: N` 응답
- [ ] `curl https://yeosonam.com/api/cron/blog-lifecycle` → 200 응답
- [ ] `curl https://yeosonam.com/api/cron/marketing-rules` → 200 + `apply_bid_updates` 확인
- [ ] `curl https://yeosonam.com/api/cron/ad-optimizer` → 200 + `apply_db_changes` 확인
- [ ] `curl https://yeosonam.com/api/cron/booking-attribution-audit` → 200 + `autofix_enabled` 확인

---

## 📊 7. 모니터링 설정

- [ ] Vercel Analytics 활성 (Core Web Vitals 자동 수집)
- [ ] Google Search Console 에 `https://yeosonam.com` 등록 + `sitemap.xml` 제출
- [ ] 네이버 웹마스터도구에 동일하게 등록
- [ ] (선택) Slack 웹훅 설정 (`SLACK_WEBHOOK_URL`) — 에러 알림

---

## 🚨 8. 롤백 준비

배포 후 문제 발생 시:

### DB 롤백 불필요
전부 `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS` 로 추가만 함.
신규 컬럼 NULL이어도 기존 로직 안 깨짐.

### 코드 롤백
```bash
# 이전 커밋으로:
git revert <hash>
# Vercel이 자동 재배포
```

### 자동 생성 일시 중지 (긴급 시)
Supabase SQL Editor:
```sql
-- 큐 전체 일시 중지
UPDATE blog_topic_queue SET status='skipped' WHERE status='queued';

-- 또는 크론 자체 disable:
-- Vercel Dashboard > Crons > 해당 크론 toggle OFF
```

---

## ✅ 배포 승인 기준

아래 전부 ✓ 이면 배포 승인:

- [ ] DB 마이그레이션 3개 적용
- [ ] 환경변수 필수 5개 설정
- [ ] Vercel Cron 15개 등록
- [ ] 타입체크 통과 (`npx tsc --noEmit` — 기존 무관 에러 제외)
- [ ] 스모크 테스트 공개 페이지 5개 통과
- [ ] robots.txt + sitemap 정합성
- [ ] 롤백 절차 숙지

---

## 📞 배포 후 4시간 집중 관찰

첫 4시간은 크론 1~2회 자동 실행됨. 그 때 확인:

- [ ] 첫 `blog-publisher` 실행 로그 → 에러 0건
- [ ] 생성된 블로그 실제 URL 접근 → 깨진 링크 없음
- [ ] 광고 매핑 UTM URL 테스트 → 클릭 시 리디렉션 + 트래킹 정상
- [ ] `/admin/blog/queue` → 실시간 상태 변화 관찰

문제 발견 시 → 위 "롤백 준비" 섹션대로 대응 + 해당 섹션 TODO 로 기록.

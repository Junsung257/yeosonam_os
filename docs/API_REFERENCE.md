# 여소남OS API Reference

> Auto-generated from `src/app/api/**/route.ts`
> Run `node scripts/generate-api-docs.js` to regenerate.

**Total endpoints:** 289
**Categories:** 1

## Table of Contents

- [api](#api) (289 endpoints)

---

## api

### `GET` src/app/api/admin/affiliate-analytics

**Status Codes:** 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/admin/applications

**Query Parameters:**
- `status` (string, optional)

**Status Codes:** 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/admin/applications

**Request Body:** JSON

**Status Codes:** 400, 404, 409, 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/admin/booking-tasks

**Query Parameters:**
- `priority_max` (string, optional)
- `limit` (string, optional)
- `offset` (string, optional)

**Status Codes:** 200, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/admin/booking-tasks/{id}/resolve

**Path Parameters:**
- `id` (string, required)

**Request Body:** JSON

**Status Codes:** 200

---

### `POST` src/app/api/admin/booking-tasks/{id}/snooze

**Path Parameters:**
- `id` (string, required)

**Request Body:** JSON

**Status Codes:** 200

---

### `POST` src/app/api/admin/booking-tasks/run-now

**Request Body:** JSON

**Status Codes:** 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/admin/bookings/{id}/dispute

**Path Parameters:**
- `id` (string, required)

**Request Body:** JSON

**Status Codes:** 200

---

### `GET` src/app/api/admin/dashboard

사장의 관제실 대시보드 API
Query params:
?date=YYYY-MM-DD  (기본: 오늘)
?platform=naver|google|meta  (기본: 전체)
?filter=revenue_generating|spending_only|insufficient_data|all  (기본: all)
Response:
kpis: { total_spend, total_revenue, total_net_profit, overall_roas_pct }
ad_accounts: 플랫폼별 잔액 현황 + low_balance 경고 플래그
keywords: { revenue_generating[], spending_only[], insufficient_data[], all[] }

**Query Parameters:**
- `date` (string, optional)
- `platform` (string, optional)
- `filter` (string, optional)

**Status Codes:** 200

---

### `GET` src/app/api/admin/jarvis/bot-profile

**Query Parameters:**
- `tenantId` (string, optional)

**Status Codes:** 400, 403, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `PUT` src/app/api/admin/jarvis/bot-profile

**Request Body:** JSON

**Status Codes:** 400, 403, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/admin/jarvis/usage

**Query Parameters:**
- `tenantId` (string, optional)
- `months` (string, optional)

**Status Codes:** 400, 403

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/admin/mock-configs

**Status Codes:** 200

---

### `PUT` src/app/api/admin/mock-configs

**Request Body:** JSON

**Status Codes:** 400, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `PUT` src/app/api/admin/mock-configs/{name}

**Path Parameters:**
- `name` (string, required)

**Request Body:** JSON

**Status Codes:** 200

---

### `GET` src/app/api/affiliates

**Query Parameters:**
- `id` (string, optional)
- `showBankInfo` (string, optional)

**Status Codes:** 404, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `PATCH` src/app/api/affiliates

**Request Body:** JSON

**Status Codes:** 400, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/affiliates

**Request Body:** JSON

**Status Codes:** 201, 400, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/affiliates/leaderboard

**Query Parameters:**
- `period` (string, optional)
- `anonymized` (string, optional)
- `limit` (string, optional)

**Status Codes:** 500

**Response:**
- data-wrapped: `{ data: T }`
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/agent-actions

**Query Parameters:**
- `status` (string, optional)
- `agent_type` (string, optional)
- `page` (string, optional)
- `limit` (string, optional)

**Status Codes:** 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `PATCH` src/app/api/agent-actions

**Request Body:** JSON

**Status Codes:** 400, 404, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/agent-actions

**Request Body:** JSON

**Status Codes:** 400, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/agent/prompt-optimizer

**Status Codes:** 500

---

### `POST` src/app/api/agent/prompt-optimizer

**Request Body:** JSON
*Validated with zod schema*

**Status Codes:** 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `DELETE` src/app/api/attractions

**Query Parameters:**
- `id` (string, optional)

**Status Codes:** 400, 500

**Response:**
- error-wrapped: `{ error: string }`
- success-wrapped: `{ success: boolean }`

---

### `GET` src/app/api/attractions

**Query Parameters:**
- `country` (string, optional)
- `region` (string, optional)
- `badge_type` (string, optional)
- `search` (string, optional)
- `limit` (string, optional)
- `photos_only` (string, optional)

**Status Codes:** 200

---

### `PATCH` src/app/api/attractions

**Request Body:** JSON

**Status Codes:** 400, 500

**Response:**
- error-wrapped: `{ error: string }`
- success-wrapped: `{ success: boolean }`

---

### `POST` src/app/api/attractions

**Request Body:** JSON

**Status Codes:** 201, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `PUT` src/app/api/attractions

**Request Body:** JSON

**Status Codes:** 400, 500

**Response:**
- error-wrapped: `{ error: string }`
- success-wrapped: `{ success: boolean }`

---

### `PATCH` src/app/api/attractions/photos

PATCH /api/attractions/photos — 선택한 사진을 관광지에 저장
body: { id: string, photos: Array<{pexels_id, src_medium, src_large, photographer}> }

**Request Body:** JSON

**Status Codes:** 400, 500

**Response:**
- error-wrapped: `{ error: string }`
- success-wrapped: `{ success: boolean }`

---

### `POST` src/app/api/attractions/photos

POST /api/attractions/photos — Pexels에서 사진 검색
body: { keyword: string, per_page?: number }
반환: 선택 가능한 사진 목록

**Request Body:** JSON

**Status Codes:** 400, 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/audit-logs

**Query Parameters:**
- `targetType` (string, optional)
- `targetId` (string, optional)
- `limit` (string, optional)

**Status Codes:** 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/audit-logs

**Request Body:** JSON

**Status Codes:** 201, 400, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/audit-pkg-to-ir

**Request Body:** JSON

**Status Codes:** 400

---

### `POST` src/app/api/auth/refresh

**Request Body:** JSON

**Status Codes:** 401, 500, 502

**Response:**
- error-wrapped: `{ error: string }`
- success-wrapped: `{ success: boolean }`

---

### `DELETE` src/app/api/auth/session

**Status Codes:** 200

**Response:**
- success-wrapped: `{ success: boolean }`

---

### `POST` src/app/api/auth/session

**Request Body:** JSON

**Status Codes:** 400, 500

**Response:**
- error-wrapped: `{ error: string }`
- success-wrapped: `{ success: boolean }`

---

### `GET` src/app/api/bank-transactions

**Query Parameters:**
- `status` (string, optional)
- `aggregate` (string, optional)
- `months` (string, optional)
- `booking_id` (string, optional)
- `match_status` (string, optional)

**Status Codes:** 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `PATCH` src/app/api/bank-transactions

**Request Body:** JSON

**Status Codes:** 400, 500

**Response:**
- error-wrapped: `{ error: string }`
- success-wrapped: `{ success: boolean }`

---

### `POST` src/app/api/bank-transactions

**Request Body:** JSON

**Status Codes:** 400, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `PUT` src/app/api/bank-transactions

**Request Body:** JSON

**Status Codes:** 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/blog

공개 블로그 API — 발행된(published) 블로그 글만 반환
GET /api/blog          → 목록 (페이지네이션)
GET /api/blog?slug=xxx → 단건 조회

**Query Parameters:**
- `slug` (string, optional)
- `id` (string, optional)
- `page` (string, optional)
- `limit` (string, optional)
- `destination` (string, optional)
- `admin` (string, optional)
- `status` (string, optional)

**Status Codes:** 404, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `PATCH` src/app/api/blog

**Request Body:** JSON

**Status Codes:** 400, 404, 500, 503

**Response:**
- error-wrapped: `{ error: string }`
- success-wrapped: `{ success: boolean }`

---

### `POST` src/app/api/blog

**Request Body:** JSON

**Status Codes:** 201, 400, 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `DELETE` src/app/api/blog-categories

**Query Parameters:**
- `id` (string, optional)

**Status Codes:** 400, 500, 503

**Response:**
- error-wrapped: `{ error: string }`
- success-wrapped: `{ success: boolean }`

---

### `GET` src/app/api/blog-categories

블로그 카테고리 CRUD
- GET    /api/blog-categories?scope=info|product|both
- POST   /api/blog-categories       신규 생성
- PATCH  /api/blog-categories       수정
- DELETE /api/blog-categories?id=   삭제 (soft: is_active=false)

**Query Parameters:**
- `scope` (string, optional)
- `include_inactive` (string, optional)

**Status Codes:** 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `PATCH` src/app/api/blog-categories

**Request Body:** JSON

**Status Codes:** 400, 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/blog-categories

**Request Body:** JSON

**Status Codes:** 201, 400, 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/blog-engagement

블로그 체류 시간 / 스크롤 깊이 / CTA 클릭 수집
- BlogTracker에서 beforeunload/sendBeacon 호출

**Request Body:** JSON

**Status Codes:** 400, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `DELETE` src/app/api/blog/ad-mapping

**Query Parameters:**
- `id` (string, optional)

**Status Codes:** 400, 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/blog/ad-mapping

블로그 ↔ 광고 캠페인 매핑 관리
GET  /api/blog/ad-mapping?content_creative_id=xxx    → 해당 블로그의 매핑 목록
GET  /api/blog/ad-mapping                            → 전체 목록 (필터)
POST /api/blog/ad-mapping                            → 매핑 신규 + UTM URL 자동 생성
PATCH /api/blog/ad-mapping                           → 활성/비활성, DKI 헤드라인 수정
DELETE /api/blog/ad-mapping?id=xxx

**Query Parameters:**
- `content_creative_id` (string, optional)
- `platform` (string, optional)
- `active` (string, optional)

**Status Codes:** 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `PATCH` src/app/api/blog/ad-mapping

**Request Body:** JSON

**Status Codes:** 400, 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/blog/ad-mapping

**Request Body:** JSON

**Status Codes:** 201, 400, 404, 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/blog/bulk-generate

동일 상품으로 N개 블로그를 일괄 생성 (긴꼬리 SEO 전략)
- 각 블로그는 같은 앵글 but 다른 서브 키워드를 타겟
- 중복 콘텐츠 리스크 방지: 각 글마다 고유 focus 섹션 강조
- 최대 5개 (6개 이상은 SEO 페널티 리스크)

**Request Body:** JSON

**Status Codes:** 400, 404, 500, 503

**Response:**
- error-wrapped: `{ error: string }`
- success-wrapped: `{ success: boolean }`

---

### `POST` src/app/api/blog/from-card-news

카드뉴스를 기반으로 블로그 자동 생성 (하이브리드 이미지)
입력:
- card_news_id: 기준 카드뉴스 ID
- slide_image_urls: 클라이언트에서 캡처해 Storage에 업로드한 PNG URLs (길이 = 슬라이드 수)
흐름:
1. 카드뉴스 조회 (mode, topic, category, package 또는 주제)
2. 상품 모드: 기존 generateBlogPost + attractions 사진
3. 정보성 모드: AI가 주제 기반 블로그 생성 + Pexels 맥락 이미지
4. 카드뉴스 PNG를 주요 섹션에, Pexels/attractions는 관광지/맥락 섹션에 배치
5. content_creatives 신규 INSERT (draft)
6. card_news.linked_blog_id 업데이트

**Request Body:** JSON

**Status Codes:** 201, 400, 404, 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/blog/generate

블로그 AI 초안 생성 API
- 상품 기반: product_id → 기존 content-hub/generate 위임
- 정보성 글: topic + category → Gemini로 직접 생성

**Request Body:** JSON

**Status Codes:** 400, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `DELETE` src/app/api/blog/queue

**Query Parameters:**
- `id` (string, optional)

**Status Codes:** 400, 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/blog/queue

블로그 자동 발행 큐 관리 API
GET  /api/blog/queue              → 큐 목록 (status 필터)
POST /api/blog/queue   (action=run_scheduler)     → 스케줄러 즉시 실행
POST /api/blog/queue   (action=run_publisher)     → 발행자 즉시 실행
PATCH /api/blog/queue  { id, priority?, status? } → 항목 수정
DELETE /api/blog/queue?id=xxx                     → 큐에서 제거

**Query Parameters:**
- `status` (string, optional)
- `limit` (string, optional)

**Status Codes:** 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `PATCH` src/app/api/blog/queue

**Request Body:** JSON

**Status Codes:** 400, 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/blog/queue

**Request Body:** JSON

**Status Codes:** 400, 404, 409, 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/blog/reindex

POST /api/blog/reindex
관리자가 수동으로 특정 블로그를 재색인 요청.
Body:
{ id?: string; slug?: string; }
- id 또는 slug 중 하나 필수
Response:
{ report: IndexingReport }

**Request Body:** JSON

**Status Codes:** 400, 404, 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/bookings

**Query Parameters:**
- `id` (string, optional)
- `status` (string, optional)
- `customerId` (string, optional)
- `departure_from` (string, optional)
- `departure_to` (string, optional)
- `include_deleted` (string, optional)

**Status Codes:** 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `PATCH` src/app/api/bookings

**Request Body:** JSON

**Status Codes:** 400, 404, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/bookings

**Request Body:** JSON

**Status Codes:** 400, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/bookings/{id}

**Path Parameters:**
- `id` (string, required)

**Status Codes:** 200

---

### `PATCH` src/app/api/bookings/{id}

**Path Parameters:**
- `id` (string, required)

**Request Body:** JSON

**Status Codes:** 200

---

### `POST` src/app/api/bookings/{id}/cancel

**Path Parameters:**
- `id` (string, required)

**Request Body:** JSON

**Status Codes:** 200

---

### `GET` src/app/api/bookings/{id}/timeline

**Path Parameters:**
- `id` (string, required)

**Status Codes:** 200

---

### `POST` src/app/api/bookings/{id}/timeline

**Path Parameters:**
- `id` (string, required)

**Request Body:** JSON

**Status Codes:** 200

---

### `POST` src/app/api/bookings/{id}/transition

**Path Parameters:**
- `id` (string, required)

**Request Body:** JSON

**Status Codes:** 200

---

### `GET` src/app/api/brand-kits

**Query Parameters:**
- `code` (string, optional)

**Status Codes:** 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/campaigns/creatives

**Query Parameters:**
- `channel` (string, optional)
- `creative_type` (string, optional)
- `status` (string, optional)
- `product_id` (string, optional)
- `limit` (string, optional)

**Status Codes:** 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `PATCH` src/app/api/campaigns/creatives

**Request Body:** JSON

**Status Codes:** 400, 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/campaigns/generate

**Request Body:** JSON

**Status Codes:** 201, 400, 500

**Response:**
- error-wrapped: `{ error: string }`
- success-wrapped: `{ success: boolean }`

---

### `POST` src/app/api/campaigns/launch

POST /api/campaigns/launch
선택된 소재를 Meta/네이버/구글에 배포

**Request Body:** JSON

**Status Codes:** 400, 404, 500

**Response:**
- error-wrapped: `{ error: string }`
- success-wrapped: `{ success: boolean }`

---

### `GET` src/app/api/campaigns/performance

**Query Parameters:**
- `creative_id` (string, optional)
- `type` (string, optional)
- `destination_type` (string, optional)

**Status Codes:** 400

**Response:**
- error-wrapped: `{ error: string }`

---

### `DELETE` src/app/api/capital

**Status Codes:** 400, 500

**Response:**
- error-wrapped: `{ error: string }`
- success-wrapped: `{ success: boolean }`

---

### `GET` src/app/api/capital

**Status Codes:** 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/capital

**Request Body:** JSON

**Status Codes:** 400, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/card-news

**Query Parameters:**
- `status` (string, optional)
- `package_id` (string, optional)
- `limit` (string, optional)

**Status Codes:** 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/card-news

**Request Body:** JSON

**Status Codes:** 201, 400, 404, 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `DELETE` src/app/api/card-news/{id}

**Path Parameters:**
- `id` (string, required)

**Status Codes:** 200

---

### `GET` src/app/api/card-news/{id}

**Path Parameters:**
- `id` (string, required)

**Status Codes:** 200

---

### `PATCH` src/app/api/card-news/{id}

**Path Parameters:**
- `id` (string, required)

**Request Body:** JSON

**Status Codes:** 200

---

### `POST` src/app/api/card-news/{id}/confirm

**Path Parameters:**
- `id` (string, required)

**Request Body:** JSON

**Status Codes:** 200

---

### `POST` src/app/api/card-news/{id}/create-variant

**Path Parameters:**
- `id` (string, required)

**Request Body:** JSON

**Status Codes:** 200

---

### `POST` src/app/api/card-news/{id}/publish-instagram

POST /api/card-news/[id]/publish-instagram
Body:
when: 'now' | 'scheduled'
scheduled_for?: ISO string (when='scheduled'일 때 필수)
caption: string
image_urls?: string[]  // 생략 시 card_news.slides[].bg_image_url 또는 슬라이드 캡처 URL 사용
동작:
- when='now' → 즉시 Meta Graph API 호출 (동기 처리, 60~90초 소요 가능)
- when='scheduled' → DB에 queued 저장만, 크론(/api/cron/agent-executor)이 처리
실패 시 card_news.ig_publish_status='failed', ig_error 저장.

**Path Parameters:**
- `id` (string, required)

**Request Body:** JSON

**Status Codes:** 200

---

### `GET` src/app/api/card-news/pexels

Pexels 이미지 검색 서버사이드 프록시
- PEXELS_API_KEY를 클라이언트에 노출하지 않기 위한 프록시
- 인증 필요 (middleware JWT 체크)

**Query Parameters:**
- `keyword` (string, optional)
- `page` (string, optional)
- `per_page` (string, optional)

**Status Codes:** 400, 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/card-news/render

POST /api/card-news/render
카드뉴스 슬라이드를 Satori로 서버 렌더 → PNG → Supabase Storage 업로드.
클라이언트 html-to-image 대체 경로.
Body: { card_news_id: string }
Response: { urls: string[] | null, errors: string[] }
주의:
- `isSatoriSupported`가 false인 슬라이드는 urls[i] = null로 반환 → 클라이언트가 fallback 실행
- 폰트 로드 실패 / 템플릿 렌더 예외 시 해당 슬라이드는 null + errors에 이유 push

**Request Body:** JSON

**Status Codes:** 400, 404, 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/card-news/render-v2

**Request Body:** JSON

**Status Codes:** 400, 404, 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/checkout/complete

POST /api/checkout/complete
결제 완료 후 프론트엔드에서 호출하는 통합 처리 엔드포인트.
처리 순서:
1. ConversionLog 기록 (/api/tracking — session + UTM 포함)
2. 마일리지 자동 적립 (net_profit × 5%)
3. Voucher 생성 트리거 (/api/voucher)
프론트엔드 호출 예시 (결제 완료 페이지에서):
```ts
await fetch('/api/checkout/complete', {
method: 'POST',
body: JSON.stringify({
session_id,           // tracker.getSessionId()
booking_id,
user_id,
final_sales_price,    // 판매가 (고객 결제액)
base_cost,            // 원가 (서버 계산값 — 클라이언트 미노출)
raw_voucher_data,     // VoucherGenerator용 원시 데이터 (선택)
customer_phone,       // 알림톡 발송용 (선택)
})
});
```
※ base_cost(원가)는 서버에서만 처리하며 클라이언트 응답에 절대 포함되지 않는다.

**Request Body:** JSON

**Status Codes:** 400

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/competitor-ads

**Query Parameters:**
- `brand` (string, optional)
- `destination` (string, optional)
- `limit` (string, optional)

**Status Codes:** 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/competitor-ads

**Request Body:** JSON

**Status Codes:** 400, 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `DELETE` src/app/api/concierge/cart

**Status Codes:** 400

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/concierge/cart

**Status Codes:** 400

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/concierge/cart

**Request Body:** JSON

**Status Codes:** 400

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/concierge/checkout

**Request Body:** JSON

**Status Codes:** 202, 400, 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/concierge/search

**Request Body:** JSON

**Status Codes:** 400, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/concierge/transactions

**Status Codes:** 200

---

### `GET` src/app/api/concierge/transactions/{id}

**Path Parameters:**
- `id` (string, required)

**Status Codes:** 200

---

### `POST` src/app/api/concierge/transactions/{id}

**Path Parameters:**
- `id` (string, required)

**Request Body:** JSON

**Status Codes:** 200

---

### `GET` src/app/api/content-analytics

콘텐츠 성과 분석 API
GET /api/content-analytics — 발행된 블로그 글별 트래픽/전환/ROAS 데이터

**Query Parameters:**
- `limit` (string, optional)
- `destination` (string, optional)

**Status Codes:** 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/content-brief

POST /api/content-brief
역할: Content Brief 생성 (Call 1만)
Body:
mode: 'product' | 'info'  — 자동 유추 가능
package_id?: string       — product 모드
angle?: string            — product 모드
topic?: string            — info 모드
category?: string         — info 모드
slide_count?: number      — default 6
tone?: string             — default 'professional'
extra_prompt?: string
Response:
{ brief: ContentBrief }

**Request Body:** JSON

**Status Codes:** 200, 400, 404, 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/content-gaps

콘텐츠 갭 분석 API — "블로그가 없는 고전환 상품" 자동 감지

**Status Codes:** 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `DELETE` src/app/api/content-hub

**Query Parameters:**
- `id` (string, optional)

**Status Codes:** 400, 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/content-hub

**Query Parameters:**
- `product_id` (string, optional)
- `status` (string, optional)
- `limit` (string, optional)

**Status Codes:** 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `PATCH` src/app/api/content-hub

**Request Body:** JSON

**Status Codes:** 400, 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/content-hub/generate

**Request Body:** JSON

**Status Codes:** 201, 400, 404, 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/content-hub/publish

**Request Body:** JSON

**Status Codes:** 400, 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/content-queue

VA 콘텐츠 검수 API
GET  — 검수 대기 목록 (draft 블로그)
POST — 승인(publish) / 반려(reject)

**Query Parameters:**
- `status` (string, optional)
- `limit` (string, optional)

**Status Codes:** 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/content-queue

**Request Body:** JSON

**Status Codes:** 400, 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/content/blog-body

**Request Body:** JSON

**Status Codes:** 400, 404, 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/content/cover-critic

**Request Body:** JSON

**Status Codes:** 400, 404, 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/content/generate-all

**Query Parameters:**
- `product_id` (string, optional)

**Status Codes:** 400, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/content/generate-all

**Request Body:** JSON

**Status Codes:** 400, 404, 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/content/google-ads-rsa

**Request Body:** JSON

**Status Codes:** 400, 404, 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/content/instagram-caption

**Request Body:** JSON

**Status Codes:** 400, 404, 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/content/kakao-channel

**Request Body:** JSON

**Status Codes:** 400, 404, 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/content/meta-ads

**Request Body:** JSON

**Status Codes:** 400, 404, 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/content/threads-post

**Request Body:** JSON

**Status Codes:** 400, 404, 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/cron/ad-optimizer

GET /api/cron/ad-optimizer
AI 마케팅 자율 주행 스케줄러 — 1시간 단위 실행
처리 흐름:
1. 광고 계정 잔액 동기화 (Mock → 실제 API 교체 가능)
2. 잔액 부족 시 긴급 알림 발생
3. 키워드 성과 분석 → PAUSED / FLAGGED_UP / NO_CHANGE 분류
4. 실제 광고 플랫폼 API로 키워드 상태 반영 (TODO 주석)
5. 롱테일 키워드 발굴 실행
vercel.json 등록:
{ "path": "/api/cron/ad-optimizer", "schedule": "0 * * * *" }  ← 매시 정각

---

### `GET` src/app/api/cron/affiliate-anomaly-detect

**Status Codes:** 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/cron/affiliate-dormant

**Query Parameters:**
- `secret` (string, optional)
- `force` (string, optional)

**Status Codes:** 401, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/cron/affiliate-settlement-draft

**Status Codes:** 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/cron/agent-executor

**Query Parameters:**
- `force` (string, optional)

**Status Codes:** 401

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/cron/auto-archive

자동 아카이브 크론 — 매일 0시 실행
조건 (OR):
1. 발권기한(ticketing_deadline)이 지난 상품
2. 마지막 출발일(price_tiers 내 departure_dates)이 모두 지난 상품
대상: status가 approved, active, pending인 상품만

**Status Codes:** 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/cron/blog-learn

블로그 자기학습 크론 — 매주 일요일 23시 실행 (KST 월요일 스케줄러 직전)
3가지 작업:
A) Featured 자동 재선정 (NEW) — 30일 내 조회수·노출 상위 Top 3 → featured=true
B) prompt-optimizer 호출 — 성과 분석 → agent_actions 제안 등록
C) (옵션) AUTO_APPROVE_LEARNING=true → prompt_versions 자동 활성화

**Status Codes:** 500

---

### `GET` src/app/api/cron/blog-lifecycle

블로그 라이프사이클 크론 — 매일 1:30 KST 실행
수행:
1) status='published' AND product_id IS NOT NULL 인 블로그 스캔
2) 연결된 travel_packages 가 archived 이거나 모든 출발일+발권기한 지났으면
→ content_creatives.status='archived' 전환
3) ISR 캐시 무효화
설계 의도:
상품 블로그는 상품 수명과 함께 죽는다.
정보성 블로그(product_id IS NULL)는 절대 건드리지 않는다 (영구 SEO 자산).

**Status Codes:** 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/cron/blog-scheduler

블로그 스케줄러 크론 — 매주 월요일 0시 실행
수행:
1) 시즌 토픽 재생성 (분기별 AI 시즌 캘린더 업데이트)
2) 이번 주 큐 충전 (정보성 70% + 상품 30%)
3) 각 항목에 target_publish_at 슬롯 할당 (하루 6개, 2시간 간격)

**Status Codes:** 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/cron/booking-tasks-runner

**Query Parameters:**
- `force` (string, optional)

**Status Codes:** 401, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/cron/dlq-replay

**Status Codes:** 401, 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/cron/embed-products

**Status Codes:** 401, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/cron/journey-scheduler

고객 여정 타임머신 스케줄러
Vercel Cron: 매일 UTC 00:00 (KST 09:00) 자동 실행
강제 실행: GET /api/cron/journey-scheduler?force=true
D-15: deposit_paid → waiting_balance 전이 + BALANCE_NOTICE 로그
D-3:  출발 확정서 안내 (CONFIRMATION_GUIDE) 로그
D+1:  귀국 해피콜 (HAPPY_CALL) 로그

**Query Parameters:**
- `force` (string, optional)

**Status Codes:** 401, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/cron/meta-optimize

Vercel Cron 엔트리포인트
스케줄: 0 0 * * * (UTC 00:00 = KST 09:00)
vercel.json에서 설정
Vercel은 CRON_SECRET 환경변수가 설정된 경우
Authorization: Bearer <CRON_SECRET> 헤더를 자동으로 첨부합니다.

**Status Codes:** 401, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/cron/payment-heartbeat

**Status Codes:** 401, 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/cron/post-travel

GET /api/cron/post-travel
사후 관리 스케줄러 — 여행 종료 +1일 후 만족도 조사 알림톡 자동 발송
호출 방법:
1. Vercel Cron (vercel.json에 "crons" 등록):
{ "path": "/api/cron/post-travel", "schedule": "0 9 * * *" }  ← 매일 오전 9시
2. 또는 외부 cron 서비스 (GitHub Actions, EasyCron 등):
curl https://yeosonam.com/api/cron/post-travel
(Authorization: Bearer CRON_SECRET 헤더 검증 권장)
처리 흐름:
1. vouchers 테이블에서 end_date <= yesterday AND review_notified = false 조회
2. 각 voucher에 대해 sendReviewRequestAlimtalk() 호출
3. 발송 완료 후 review_notified = true 업데이트
── 스케줄러 확장 아이디어 (주석) ──────────────────────────────
// TODO: 출발 D-7 준비물 안내 알림톡
// vouchers WHERE departure_date = today + 7 days AND d7_notified = false
// → sendPreparationGuide() 호출
// TODO: 잔금 납부 D-3 알림톡
// bookings WHERE payment_due_date = today + 3 days AND balance_notified = false
// → sendBalanceNotice() 호출
// TODO: 여권 만료 임박 알림톡
// customers WHERE passport_expiry BETWEEN today AND today + 180 days
//   AND passport_warning_sent = false
// → sendPassportExpiryNotice() 호출
// TODO: C2C 공유 전환율 집계
// 알림톡 공유 링크 클릭 후 신규 예약 연결 → 추천인 보상(마일리지) 지급

**Status Codes:** 401

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/cron/publish-scheduled

**Status Codes:** 401, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/cron/rfq-timeout

**Status Codes:** 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/cron/settlement-auto

2026-04-15 변경: 자비스 기안 전용 모드 기본값.
ENABLE_DIRECT_SETTLEMENT=true 환경변수가 있을 때만 기존 방식으로 직접 READY 마감.
기본은 /api/cron/affiliate-settlement-draft가 agent_actions 기안 → 사장님 결재함 승인.

**Status Codes:** 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/cron/slack-gap-fill

**Status Codes:** 401, 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/cron/sync-creative-performance

**Status Codes:** 401, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/cron/sync-engagement

**Status Codes:** 401, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/cron/visual-baseline-monitor

**Status Codes:** 401, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `DELETE` src/app/api/customers

**Query Parameters:**
- `id` (string, optional)

**Status Codes:** 400, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/customers

**Query Parameters:**
- `id` (string, optional)
- `phone` (string, optional)
- `page` (string, optional)
- `limit` (string, optional)
- `search` (string, optional)
- `sortBy` (string, optional)
- `sortDir` (string, optional)
- `trashed` (string, optional)
- `minSales` (string, optional)
- `maxSales` (string, optional)
- `minBookings` (string, optional)
- `maxBookings` (string, optional)
- `grade` (string, optional)
- `status` (string, optional)

**Status Codes:** 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `PATCH` src/app/api/customers

**Request Body:** JSON

**Status Codes:** 400, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/customers

**Request Body:** JSON

**Status Codes:** 400, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/customers/{id}/mileage-history

GET /api/customers/[id]/mileage-history */

**Path Parameters:**
- `id` (string, required)

**Status Codes:** 200

---

### `POST` src/app/api/customers/{id}/mileage-history

POST /api/customers/[id]/mileage-history
수동 마일리지 조정 (CS용)
body: { delta: number, reason: string }

**Path Parameters:**
- `id` (string, required)

**Request Body:** JSON

**Status Codes:** 200

---

### `DELETE` src/app/api/customers/{id}/notes

**Path Parameters:**
- `id` (string, required)

**Status Codes:** 200

---

### `GET` src/app/api/customers/{id}/notes

**Path Parameters:**
- `id` (string, required)

**Status Codes:** 200

---

### `POST` src/app/api/customers/{id}/notes

**Path Parameters:**
- `id` (string, required)

**Request Body:** JSON

**Status Codes:** 200

---

### `GET` src/app/api/dashboard

**Status Codes:** 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/dashboard/chart

**Status Codes:** 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/departing-locations

**Status Codes:** 200

---

### `PATCH` src/app/api/departing-locations

**Request Body:** JSON

**Status Codes:** 400, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/departing-locations

**Request Body:** JSON

**Status Codes:** 400

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/exchange-rate

**Status Codes:** 200

---

### `POST` src/app/api/generate

**Request Body:** JSON

**Status Codes:** 400, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/influencer/assets

**Query Parameters:**
- `code` (string, optional)
- `package_id` (string, optional)

**Status Codes:** 400, 404, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/influencer/dashboard

**Request Body:** JSON

**Status Codes:** 400, 401, 404, 429, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/influencer/links

**Query Parameters:**
- `code` (string, optional)

**Status Codes:** 400, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/influencer/links

**Request Body:** JSON

**Status Codes:** 201, 400, 404, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/influencer/track

**Query Parameters:**
- `ref` (string, optional)
- `pkg` (string, optional)
- `sub` (string, optional)

**Status Codes:** 400, 404

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/itinerary/{id}/screenshot

POST /api/itinerary/[id]/screenshot
Body: { mode: 'summary' | 'detail', departureDate?: '2026-04-05' }
Returns: { jpgs: string[] }  — base64-encoded JPEG strings
summary  → 1장 (요금표 + 일정 개요)
detail   → 2장 (요금표 + 상세 일정표)

**Path Parameters:**
- `id` (string, required)

**Request Body:** JSON

**Status Codes:** 200

---

### `POST` src/app/api/jarvis

**Request Body:** JSON

**Status Codes:** 400, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/jarvis/approve

**Request Body:** JSON

**Status Codes:** 400, 404, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/jarvis/bulk-process

**Request Body:** JSON

**Status Codes:** 400, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/jarvis/kakao-inbox

**Status Codes:** 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/jarvis/stream

**Request Body:** JSON

**Status Codes:** 400, 409, 503

---

### `GET` src/app/api/land-operators

**Status Codes:** 200

---

### `PATCH` src/app/api/land-operators

**Request Body:** JSON

**Status Codes:** 400, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/land-operators

**Request Body:** JSON

**Status Codes:** 400

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/leads

**Request Body:** JSON

**Status Codes:** 400, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/margin

**Query Parameters:**
- `packageId` (string, optional)

**Status Codes:** 400, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/margin

**Request Body:** JSON

**Status Codes:** 400, 500

**Response:**
- error-wrapped: `{ error: string }`
- success-wrapped: `{ success: boolean }`

---

### `DELETE` src/app/api/marketing-logs

**Query Parameters:**
- `id` (string, optional)

**Status Codes:** 400, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/marketing-logs

**Query Parameters:**
- `product_id` (string, optional)
- `package_id` (string, optional)
- `all` (string, optional)

**Status Codes:** 400, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/marketing-logs

**Request Body:** JSON

**Status Codes:** 201, 400, 422, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/master/ledger

**Query Parameters:**
- `month` (string, optional)
- `category` (string, optional)

**Status Codes:** 200

---

### `GET` src/app/api/meta/campaigns

**Query Parameters:**
- `package_id` (string, optional)
- `status` (string, optional)
- `page` (string, optional)
- `limit` (string, optional)

**Status Codes:** 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/meta/campaigns

**Request Body:** JSON

**Status Codes:** 201, 400, 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `DELETE` src/app/api/meta/campaigns/{id}

**Path Parameters:**
- `id` (string, required)

**Status Codes:** 200

---

### `GET` src/app/api/meta/campaigns/{id}

**Path Parameters:**
- `id` (string, required)

**Status Codes:** 200

---

### `PATCH` src/app/api/meta/campaigns/{id}

**Path Parameters:**
- `id` (string, required)

**Request Body:** JSON

**Status Codes:** 200

---

### `GET` src/app/api/meta/creatives

**Query Parameters:**
- `package_id` (string, optional)
- `campaign_id` (string, optional)
- `platform` (string, optional)

**Status Codes:** 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/meta/creatives

**Request Body:** JSON

**Status Codes:** 201, 400, 404, 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/meta/creatives/deploy

**Request Body:** JSON

**Status Codes:** 400, 404, 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/meta/optimize

**Request Body:** JSON

**Status Codes:** 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/meta/performance

**Query Parameters:**
- `campaign_id` (string, optional)
- `from` (string, optional)
- `to` (string, optional)
- `type` (string, optional)
- `months` (string, optional)

**Status Codes:** 400, 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/meta/performance

**Request Body:** JSON

**Status Codes:** 400, 404, 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/notify/alimtalk

**Query Parameters:**
- `type` (string, optional)

**Request Body:** JSON

**Status Codes:** 400, 401, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `DELETE` src/app/api/packages

**Query Parameters:**
- `id` (string, optional)

**Status Codes:** 400, 500

**Response:**
- error-wrapped: `{ error: string }`
- success-wrapped: `{ success: boolean }`

---

### `GET` src/app/api/packages

**Query Parameters:**
- `id` (string, optional)
- `status` (string, optional)
- `category` (string, optional)
- `q` (string, optional)
- `destination` (string, optional)
- `page` (string, optional)
- `limit` (string, optional)
- `aggregate` (string, optional)

**Status Codes:** 404, 500

**Response:**
- data-wrapped: `{ data: T }`
- error-wrapped: `{ error: string }`

---

### `PATCH` src/app/api/packages

**Request Body:** JSON

**Status Codes:** 400, 500

**Response:**
- error-wrapped: `{ error: string }`
- success-wrapped: `{ success: boolean }`

---

### `POST` src/app/api/packages

**Request Body:** JSON

**Status Codes:** 201, 400, 409, 500

**Response:**
- error-wrapped: `{ error: string }`
- success-wrapped: `{ success: boolean }`

---

### `PATCH` src/app/api/packages/{id}/approve

audit_status === 'warnings' 상품을 강제 승인할 때 true */

**Path Parameters:**
- `id` (string, required)

**Request Body:** JSON

**Status Codes:** 200

---

### `GET` src/app/api/packages/{id}/inventory

**Path Parameters:**
- `id` (string, required)

**Status Codes:** 200

---

### `POST` src/app/api/packages/{id}/regenerate-copies

**Path Parameters:**
- `id` (string, required)

**Request Body:** JSON

**Status Codes:** 200

---

### `GET` src/app/api/packages/{id}/terms

GET /api/packages/:id/terms?surface=mobile|a4|booking_guide
해당 상품의 4-level 머지된 약관을 해소하여 반환.
클라이언트(예: PosterStudio)에서 A4 프리뷰 시 사용.

**Path Parameters:**
- `id` (string, required)

**Status Codes:** 200

---

### `POST` src/app/api/packages/inquiry

**Request Body:** JSON

**Status Codes:** 400

**Response:**
- error-wrapped: `{ error: string }`
- success-wrapped: `{ success: boolean }`

---

### `POST` src/app/api/packages/kakao-copy

POST /api/packages/kakao-copy
카톡방용 마케팅 문구 생성

**Request Body:** JSON

**Status Codes:** 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/packages/reextract

**Request Body:** JSON

**Status Codes:** 400, 404, 500

**Response:**
- error-wrapped: `{ error: string }`
- success-wrapped: `{ success: boolean }`

---

### `POST` src/app/api/partner-apply

**Request Body:** JSON

**Status Codes:** 201, 400, 409, 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `DELETE` src/app/api/policies

**Query Parameters:**
- `id` (string, optional)

**Status Codes:** 400, 500, 503

**Response:**
- error-wrapped: `{ error: string }`
- success-wrapped: `{ success: boolean }`

---

### `GET` src/app/api/policies

**Query Parameters:**
- `category` (string, optional)
- `active` (string, optional)

**Status Codes:** 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `PATCH` src/app/api/policies

**Request Body:** JSON

**Status Codes:** 400, 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/policies

**Request Body:** JSON

**Status Codes:** 201, 400, 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `DELETE` src/app/api/products

**Query Parameters:**
- `id` (string, optional)

**Status Codes:** 400, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/products

**Query Parameters:**
- `id` (string, optional)
- `status` (string, optional)
- `supplier_code` (string, optional)
- `destination_code` (string, optional)
- `page` (string, optional)
- `limit` (string, optional)
- `departure_date` (string, optional)

**Status Codes:** 404, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `PATCH` src/app/api/products

**Request Body:** JSON

**Status Codes:** 400, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/products

**Request Body:** JSON

**Status Codes:** 201, 400, 409, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/products/review

**Status Codes:** 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/products/review

**Query Parameters:**
- `action` (string, optional)

**Request Body:** JSON

**Status Codes:** 400, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/products/scan

**Request Body:** JSON

**Status Codes:** 400, 422, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `DELETE` src/app/api/push/subscribe

**Status Codes:** 400, 500, 503

**Response:**
- error-wrapped: `{ error: string }`
- success-wrapped: `{ success: boolean }`

---

### `POST` src/app/api/push/subscribe

**Request Body:** JSON

**Status Codes:** 400, 401, 500, 503

**Response:**
- error-wrapped: `{ error: string }`
- success-wrapped: `{ success: boolean }`

---

### `GET` src/app/api/qa

**Query Parameters:**
- `status` (string, optional)

**Status Codes:** 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `PATCH` src/app/api/qa

**Request Body:** JSON

**Status Codes:** 400, 500

**Response:**
- error-wrapped: `{ error: string }`
- success-wrapped: `{ success: boolean }`

---

### `POST` src/app/api/qa

**Request Body:** JSON

**Status Codes:** 400, 500

**Response:**
- error-wrapped: `{ error: string }`
- success-wrapped: `{ success: boolean }`

---

### `POST` src/app/api/qa/chat

**Request Body:** JSON
*Validated with zod schema*

**Status Codes:** 400, 500

---

### `GET` src/app/api/recommendations

**Query Parameters:**
- `customer_id` (string, optional)
- `destination` (string, optional)
- `algorithm` (string, optional)

**Status Codes:** 200

**Response:**
- success-wrapped: `{ success: boolean }`

---

### `POST` src/app/api/recommendations

**Request Body:** JSON

**Status Codes:** 200

**Response:**
- success-wrapped: `{ success: boolean }`

---

### `POST` src/app/api/recommendations/convert

**Request Body:** JSON

**Status Codes:** 200

**Response:**
- success-wrapped: `{ success: boolean }`

---

### `POST` src/app/api/register-via-ir

**Request Body:** JSON

**Status Codes:** 400, 422, 500

---

### `POST` src/app/api/revalidate

**Request Body:** JSON

**Status Codes:** 400, 401, 500

**Response:**
- error-wrapped: `{ error: string }`
- success-wrapped: `{ success: boolean }`

---

### `GET` src/app/api/reviews

**Query Parameters:**
- `package_id` (string, optional)
- `status` (string, optional)
- `limit` (string, optional)

**Status Codes:** 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/reviews

고객 리뷰 제출 API
POST /api/reviews
- booking_id 로 identity 검증 (bookings.lead_customer_id 와 매칭)
- post_trip_reviews INSERT (status='pending' — 어드민 승인 후 노출)
- 완료 후 refresh_package_rating RPC 로 avg_rating 캐시 갱신
익명 후기 허용 (고객명 부분 마스킹은 표시 단계에서).

**Request Body:** JSON

**Status Codes:** 201, 400, 404, 409, 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/rfq

**Query Parameters:**
- `status` (string, optional)

**Status Codes:** 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/rfq

**Request Body:** JSON

**Status Codes:** 201, 400, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/rfq/{id}

**Path Parameters:**
- `id` (string, required)

**Status Codes:** 200

---

### `PATCH` src/app/api/rfq/{id}

**Path Parameters:**
- `id` (string, required)

**Request Body:** JSON

**Status Codes:** 200

---

### `GET` src/app/api/rfq/{id}/analyze

**Path Parameters:**
- `id` (string, required)

**Status Codes:** 200

---

### `POST` src/app/api/rfq/{id}/analyze

**Path Parameters:**
- `id` (string, required)

**Request Body:** JSON

**Status Codes:** 200

---

### `GET` src/app/api/rfq/{id}/bid

**Path Parameters:**
- `id` (string, required)

**Status Codes:** 200

---

### `POST` src/app/api/rfq/{id}/bid

**Path Parameters:**
- `id` (string, required)

**Request Body:** JSON

**Status Codes:** 200

---

### `GET` src/app/api/rfq/{id}/bid/{bidId}/proposal

**Path Parameters:**
- `id` (string, required)
- `bidId` (string, required)

**Status Codes:** 200

---

### `PATCH` src/app/api/rfq/{id}/bid/{bidId}/proposal

**Path Parameters:**
- `id` (string, required)
- `bidId` (string, required)

**Request Body:** JSON

**Status Codes:** 200

---

### `POST` src/app/api/rfq/{id}/bid/{bidId}/proposal

**Path Parameters:**
- `id` (string, required)
- `bidId` (string, required)

**Request Body:** JSON

**Status Codes:** 200

---

### `GET` src/app/api/rfq/{id}/contract

**Path Parameters:**
- `id` (string, required)

**Status Codes:** 200

---

### `GET` src/app/api/rfq/{id}/messages

**Path Parameters:**
- `id` (string, required)

**Status Codes:** 200

---

### `POST` src/app/api/rfq/{id}/messages

**Path Parameters:**
- `id` (string, required)

**Request Body:** JSON

**Status Codes:** 200

---

### `GET` src/app/api/rfq/{id}/proposals

**Path Parameters:**
- `id` (string, required)

**Status Codes:** 200

---

### `POST` src/app/api/rfq/{id}/select

**Path Parameters:**
- `id` (string, required)

**Request Body:** JSON

**Status Codes:** 200

---

### `POST` src/app/api/rfq/interview

**Request Body:** JSON

**Status Codes:** 400, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/rss

**Status Codes:** 200

---

### `GET` src/app/api/secure-chat

**Query Parameters:**
- `bookingId` (string, optional)
- `rfqId` (string, optional)
- `viewAs` (string, optional)

**Status Codes:** 400

**Response:**
- error-wrapped: `{ error: string }`

---

### `PATCH` src/app/api/secure-chat

**Request Body:** JSON

**Status Codes:** 400

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/secure-chat

**Request Body:** JSON

**Status Codes:** 201, 400, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/settlements

**Query Parameters:**
- `affiliateId` (string, optional)
- `period` (string, optional)

**Status Codes:** 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `PATCH` src/app/api/settlements

**Request Body:** JSON

**Status Codes:** 400, 404, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/settlements

**Request Body:** JSON

**Status Codes:** 400, 404, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/settlements/{id}/pdf

**Path Parameters:**
- `id` (string, required)

**Status Codes:** 200

---

### `GET` src/app/api/share

**Query Parameters:**
- `code` (string, optional)

**Status Codes:** 400, 404, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/share

**Request Body:** JSON

**Status Codes:** 400, 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/slack-webhook

**Request Body:** JSON
*Validated with zod schema*

**Status Codes:** 400, 401

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/sms/payments

**Status Codes:** 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `PATCH` src/app/api/sms/payments

**Request Body:** JSON

**Status Codes:** 400, 500

**Response:**
- error-wrapped: `{ error: string }`
- success-wrapped: `{ success: boolean }`

---

### `POST` src/app/api/sms/receive

**Request Body:** JSON

**Status Codes:** 400, 401, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/tax

**Query Parameters:**
- `month` (string, optional)

**Status Codes:** 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `PUT` src/app/api/tax/{id}

**Path Parameters:**
- `id` (string, required)

**Request Body:** JSON

**Status Codes:** 200

---

### `GET` src/app/api/tax/export

**Query Parameters:**
- `month` (string, optional)

**Status Codes:** 200, 500, 503

---

### `GET` src/app/api/tenant/inventory

**Query Parameters:**
- `tenant_id` (string, optional)
- `product_id` (string, optional)
- `from` (string, optional)
- `to` (string, optional)

**Status Codes:** 400

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/tenant/inventory

**Request Body:** JSON

**Status Codes:** 201, 400, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `PUT` src/app/api/tenant/inventory

**Request Body:** JSON

**Status Codes:** 400, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/tenant/products

**Query Parameters:**
- `tenant_id` (string, optional)

**Status Codes:** 400

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/tenant/products

**Request Body:** JSON

**Status Codes:** 201, 400, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `PUT` src/app/api/tenant/products

**Request Body:** JSON

**Status Codes:** 400, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/tenant/rfqs

**Query Parameters:**
- `tenant_id` (string, optional)

**Status Codes:** 400, 404, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/tenant/rfqs/{rfqId}

**Path Parameters:**
- `rfqId` (string, required)

**Status Codes:** 200

---

### `GET` src/app/api/tenant/settlements

**Query Parameters:**
- `tenant_id` (string, optional)
- `month` (string, optional)

**Status Codes:** 400

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/tenants

**Status Codes:** 200

---

### `POST` src/app/api/tenants

**Request Body:** JSON

**Status Codes:** 201, 400, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/tenants/{id}

**Path Parameters:**
- `id` (string, required)

**Status Codes:** 200

---

### `PUT` src/app/api/tenants/{id}

**Path Parameters:**
- `id` (string, required)

**Request Body:** JSON

**Status Codes:** 200

---

### `GET` src/app/api/terms-templates

**Query Parameters:**
- `tier` (string, optional)
- `land_operator_id` (string, optional)
- `include_inactive` (string, optional)

**Status Codes:** 500

**Response:**
- data-wrapped: `{ data: T }`
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/terms-templates

**Request Body:** JSON

**Status Codes:** 400, 500, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `DELETE` src/app/api/terms-templates/{id}

**Path Parameters:**
- `id` (string, required)

**Status Codes:** 200

---

### `GET` src/app/api/terms-templates/{id}

**Path Parameters:**
- `id` (string, required)

**Status Codes:** 200

---

### `PATCH` src/app/api/terms-templates/{id}

**Path Parameters:**
- `id` (string, required)

**Request Body:** JSON

**Status Codes:** 200

---

### `POST` src/app/api/tracking

**Request Body:** JSON

**Status Codes:** 202, 400

**Response:**
- error-wrapped: `{ error: string }`

---

### `GET` src/app/api/unmatched

GET /api/unmatched — 미매칭 목록 조회 (관리자용)
?status=pending (기본)

**Query Parameters:**
- `status` (string, optional)

**Status Codes:** 200

---

### `PATCH` src/app/api/unmatched

PATCH /api/unmatched — 상태 변경 또는 별칭 연결
body: { id, status } — 단순 상태 변경
body: { id, action: 'link_alias', attractionId: 'uuid' } — 기존 관광지에 alias 연결

**Request Body:** JSON

**Status Codes:** 400, 404, 409, 500

**Response:**
- error-wrapped: `{ error: string }`
- success-wrapped: `{ success: boolean }`

---

### `POST` src/app/api/unmatched

POST /api/unmatched — 미매칭 관광지 자동 수집
랜딩페이지 로드 시 미매칭 activity 목록 전송 → upsert
body: { items: Array<{ activity, package_id?, package_title?, day_number?, country?, region? }> }

**Request Body:** JSON

**Response:**
- success-wrapped: `{ success: boolean }`

---

### `POST` src/app/api/upload

**Request Body:** JSON
*Validated with zod schema*

**Status Codes:** 400, 500

**Response:**
- error-wrapped: `{ error: string }`
- success-wrapped: `{ success: boolean }`

---

### `GET` src/app/api/voucher

**Query Parameters:**
- `id` (string, optional)
- `bookingId` (string, optional)
- `html` (string, optional)

**Status Codes:** 400, 404, 503

**Response:**
- error-wrapped: `{ error: string }`

---

### `PATCH` src/app/api/voucher

**Request Body:** JSON

**Status Codes:** 400, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/voucher

**Request Body:** JSON

**Status Codes:** 201, 400, 500

**Response:**
- error-wrapped: `{ error: string }`

---

### `POST` src/app/api/webhooks/kakao

**Request Body:** JSON
*Validated with zod schema*

**Status Codes:** 401

**Response:**
- error-wrapped: `{ error: string }`

---


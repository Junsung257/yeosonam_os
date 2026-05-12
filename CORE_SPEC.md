# CORE_SPEC — 여소남 OS 통합 구조·스펙

> **목적:** Gemini 등 외부 모델·협업자와 아키텍처·DB·상태머신·AI 파이프라인을 빠르게 공유하기 위한 단일 분석 문서.  
> **SSOT(최신 사실 원본):** 루트 `CURRENT_STATUS.md`(날짜 확인), 구현 레시피 `.claude/CLAUDE.md`, 에이전트 진입 `AGENTS.md`.  
> **생성 기준일:** 2026-05-03 (레포 스냅샷 기준 자동 추출 + 수동 구조화).

---

## 1. 폴더 구조 및 아키텍처

### 1.1 기술 스택·배치 원칙

- **프레임워크:** Next.js App Router (`src/app/`).
- **비즈니스 로직:** `src/lib/` (UI·페이지에 로직 집중 금지 — 레포 규칙).
- **DB 스키마 이력:** `supabase/migrations/*.sql` (핵심 테이블의 최초 `CREATE`는 초기 마이그레이션이 레포 밖/이전 히스토리에 있을 수 있음 — 운영 DB 또는 `CURRENT_STATUS`가 사실 기준).
- **백엔드 API:** `src/app/api/**/route.ts` — **314개 이상**의 Route Handler 파일 존재(하위 도메인별 세분화).

### 1.2 디렉터리 맵 (요약)

| 경로 | 역할 |
|------|------|
| `src/app/(고객·랜딩)` | `/`, `/packages`, `/itinerary`, `/with/[code]`, `/concierge` 등 |
| `src/app/admin/**` | 운영·상품·마케팅·재무·AI 어드민 UI |
| `src/app/api/**` | REST형 API: 예약, 결제, 업로드, 크론, 자비스, 블로그, 카드뉴스 등 |
| `src/lib/` | Supabase 클라이언트, 파서, 결제 매칭, 제휴, 자비스, 스코어링, 콘텐츠 엔진 |
| `src/components/` | 고객·어드민 공용 UI |
| `src/types/database.ts` | `products` 등 일부 테이블 TypeScript 계약(마이그레이션 파일명 주석에 SSOT 힌트) |
| `docs/` | 제휴, 자비스, 블로그, 배포, 환경변수 등 주제별 런북 |

### 1.3 API·기능 클러스터 (대표 경로)

| 도메인 | 대표 엔드포인트·경로 |
|--------|----------------------|
| 예약 | `GET/POST /api/bookings`, `PATCH /api/bookings`, `POST /api/bookings/[id]/transition`, `POST /api/bookings/[id]/restore` |
| 패키지 | `PATCH /api/packages/[id]/approve`, `GET /api/packages`, 크론·재추출 등 |
| 업로드·파싱 | `POST /api/upload` |
| 결제·원장 | Slack/SMS 수신, `update_booking_ledger` RPC 연동 (`src/lib/slack-ingest.ts` 등) |
| 카드뉴스 | `POST /api/card-news`, `src/app/api/card-news/**` (렌더, HTML, 확정, SNS 발행) |
| 블로그 | `POST /api/blog/from-card-news`, `POST /api/blog/queue`, `GET /api/cron/blog-publisher` |
| 자비스·QA | `src/lib/jarvis/**`, `/api/qa/chat` 등 (상세: `docs/jarvis-orchestration.md`) |
| 크론·오케스트레이션 | `src/app/api/cron/**`, `src/app/api/orchestrator/**` |

---

## 2. DB 스키마 (ERD 수준 텍스트) — 61개+ 테이블

### 2.1 규모·출처

- `CURRENT_STATUS.md` **섹션 2**에 **번호 매긴 핵심 목록 1~61** (bookings ~ pin_attempts) 및 **「기타 테이블」** 확장 목록이 정리되어 있다.
- 본 문서에서는 **관계 중심 서술**에 집중하고, 컬럼 단위 전체 목록은 SSOT 파일을 따른다.

### 2.2 ERD 서술 (엔터티 그룹)

1. **판매·예약 축:** `travel_packages`(노출·일정·가공 패키지) ↔ `bookings`(예약 팩트) ↔ `customers`(고객). 예약은 `booking_passengers`로 고객 N:M, `booking_segments`로 PNR형 세그먼트, `message_logs`로 커뮤니케이션 타임라인.
2. **ERP·SKU 축:** `products`(PK `internal_code`, 랜드사·출발지·가격·AI 태그) ↔ `product_prices`(날짜/요일별 가격). 문서 중복 방지 `document_hashes` 등과 연동.
3. **제휴·정산:** `affiliates`, `affiliate_applications`, `influencer_links`, `settlements` + 커미션 조정·터치포인트 관련 마이그레이션 테이블.
4. **재무:** `bank_transactions`, `sms_payments`, `ledger_entries`, `payment_command_log`, `land_settlements` 등 (Phase 2a 원장·정산).
5. **광고·성과:** `ad_*`, `keyword_performances`, `creative_performance`, 유입·전환 로그 테이블군.
6. **콘텐츠:** `card_news`, `content_creatives`, `content_distributions`, `blog_topic_queue`(마이그레이션·크론에서 사용), `marketing_logs` 등.
7. **RFQ·테넌트·컨시어지:** `group_rfqs`, `rfq_*`, `tenants`, `transactions`, `api_orders`, `vouchers` 등.
8. **AI·대화:** `conversations`, `intents`, `qa_inquiries`, `ai_responses`, `platform_learning_events`, 자비스 RAG `jarvis_knowledge_chunks` 등.
9. **정책·감사:** `os_policies`, `audit_logs`, `error_patterns` 등.

### 2.3 `travel_packages` · `products` · `bookings` 연결 로직 (핵심)

| 엔티티 | 식별자 | 역할 |
|--------|--------|------|
| **travel_packages** | UUID `id` | 사이트·카드뉴스·블로그·자비스 RAG가 주로 참조하는 **패키지 마스터**. `internal_code`로 ERP SKU와 동기화. |
| **products** | 문자열 PK `internal_code` | 업로드 파이프라인·검수 QA가 다루는 **내부 상품 카탈로그**. `land_operator_id`, `departing_location_id` FK. |
| **bookings** | UUID `id`, `booking_no` | 예약 본문. **`package_id` → `travel_packages.id`**(여행 상품 연결). **`product_id` → `products.internal_code`**(SKU/스마트매칭·표시명·랜드사 연동). |

**동기화·일관성 패턴 (코드 기준):**

- **승인(`PATCH /api/packages/[id]/approve`):** `travel_packages.status → active` 후, 같은 레코드의 `internal_code`가 있으면 `products`도 `active`로 맞춤(실패해도 패키지 승인은 유지 — 비중단 경고).
- **예약 수정(`PATCH /api/bookings` + `sku_code`):** `products`에서 `internal_code` 조회 → `bookings`에 `product_id`, `package_title`, `land_operator_id`, `departing_location_id` 등 원자적 반영.
- **삭제 정리(`src/lib/supabase.ts`):** 패키지 삭제 시 `travel_packages`의 `internal_code`로 `document_hashes` 정리 후 패키지 행 삭제.
- **카드뉴스·콘텐츠:** `card_news.package_id`는 `travel_packages.id`를 가리킴. `content_creatives.product_id` 등은 문맥상 패키지 UUID 또는 내부 참조 필드가 혼재 — 실제 조회 시 라우트별 `from()` 테이블 확인 필요.

**주의:** `booking-state-machine`의 **journey `status`**와 DB 트리거의 **`payment_status`(미입금/일부입금/완납)**는 연관되지만 **별도 차원**이다. 레거시 `confirmed`/`completed`는 여전히 코드·데이터에 존재.

---

## 3. 비즈니스 상태 머신 (예약)

### 3.1 여정 상태 (Journey) — 애플리케이션 단

- **정의 파일:** `src/lib/booking-state-machine.ts`
- **정식 흐름:** `pending` → `waiting_deposit` → `deposit_paid` → `waiting_balance` → `fully_paid`
- **레거시:** `confirmed`(≈ `deposit_paid`), `completed`(≈ `fully_paid`) — 전이 맵에 별도 분기 존재
- **취소:** 설계상 어느 단계에서든 `cancelled` 가능하나, `ALLOWED_TRANSITIONS` 맵에는 명시적 `→ cancelled` 엣지가 비어 있음 — 실제 취소는 다른 API/DB 경로일 수 있음 (**구현·데이터 일치 점검 여지**).

### 3.2 전이 API·부가 로직

| 트리거 | 파일 | 동작 요약 |
|--------|------|-----------|
| 허용 전이 검증 | `src/lib/booking-state-machine.ts` | `isValidTransition`, `ALLOWED_TRANSITIONS` |
| 관리자/시스템 전이 | `POST /api/bookings/[id]/transition` | DB `bookings.status` 갱신, `getNotificationAdapter()`로 알림·`message_logs`, `fully_paid` 시 Web Push |
| 계약금 안내 게이트 | 동일 + `PATCH /api/bookings` | `deposit_notice_blocked`가 true면 `pending → waiting_deposit` 전이 거부(409) |
| 입금·원장 | `src/lib/slack-ingest.ts`, `POST /api/bookings` 내 소급 매칭 등 | `update_booking_ledger` RPC로 `paid_amount`·`payment_status` 원자 갱신 |
| 수동 입금액 | `PATCH /api/bookings` | `record_manual_paid_amount_change` RPC 후 `payment_status`·레거시 `status`를 `completed`로 맞추는 분기 존재 |

### 3.3 DB 트리거 (결제·마진)

- **파일 예:** `supabase/migrations/20260429000000_fix_booking_triggers.sql`
- **`update_payment_status()`:** 인원·단가·유류할증 등 **판매가 합산**과 `paid_amount` 비교 → `payment_status` 자동 설정 (`total_price` fallback 포함).
- **`calc_booking_margin()`:** revenue/cost 대칭 산식, `cost_snapshot_krw` 우선, `margin` 갱신.

### 3.4 이벤트·로그 타입

- `message_logs.event_type`: `DEPOSIT_NOTICE`, `DEPOSIT_CONFIRMED`, `BALANCE_NOTICE`, `BALANCE_CONFIRMED`, `CONFIRMATION_GUIDE`, `HAPPY_CALL`, `CANCELLATION`, `MANUAL_MEMO` 등 — `CURRENT_STATUS.md` 섹션 3-4 표 참고.

---

## 4. AI·콘텐츠 파이프라인

### 4.1 상품 업로드·파서 (PDF/이미지 → 패키지·SKU)

| 단계 | 위치 | 설명 |
|------|------|------|
| HTTP 진입 | `src/app/api/upload/route.ts` | 멀티파트 업로드, `parseDocument`, 신뢰도, 게이트, Gemini 보정, `travel_packages`/`products` upsert |
| 코어 파서 | `src/lib/parser/**`, `src/lib/upload-validator.ts` | 추출·검증·상태 판정 |
| 정규화·해시 | `src/lib/parser/upload-text-hash.ts`, `computeNormalizedContentHash` | 중복·검수 큐 |
| 검수 DLQ | `upload_review_queue` 테이블 | 실패·BLOCKED 건 비동기 적재 (`scheduleUploadReviewInsert`) |
| 구조화 JSON (패키지 마스터) | `src/lib/package-schema.ts` | Zod SSOT — `travel_packages` 정합성 |
| 마케팅 카피·보조 AI | `src/lib/ai.ts` 등 | 업로드 응답 내 카피 생성 |

**상품 요약 파서(카드뉴스·랭킹용 경량 파싱):** `src/lib/creative-engine/parse-product.ts` — `travel_packages` 원문 해시·캐시, Gemini로 `parsed_data` 유사 구조 생성.

### 4.2 카드뉴스 생성 엔진

| 단계 | 위치 | 설명 |
|------|------|------|
| 생성(슬라이드) | `POST /api/card-news` | `travel_packages` 조회 → `buildAutoSlides` → `card_news` upsert (`DRAFT`) |
| HTML 모드 | `POST /api/card-news/generate-html` | Claude 등으로 HTML 생성 → `card_news` 컬럼 저장 |
| 확정·연계 | `src/app/api/card-news/[id]/confirm/route.ts` 등 | 상태 전이, 블로그·큐 연동 |
| 렌더·PNG | `render`, `render-v2`, `render-html-to-png` | 블로그·SNS용 이미지 |
| 변형·A/B | `generate-variants`, `variants/.../decide-winner` | 카드뉴스 실험 파이프라인 |
| DB 헬퍼 | `src/lib/db/card-news.ts` | 타입·CRUD |

### 4.3 블로그 자동 발행 큐

| 단계 | 위치 | 설명 |
|------|------|------|
| 큐 적재 | `POST /api/blog/queue` | `blog_topic_queue` insert, 카드뉴스에서 `enqueue_from_card_news` 등 |
| 카드뉴스→블로그 본문 | `POST /api/blog/from-card-news` | 상품/정보 모드 분기, Brief, HTML 생성, `publisher_bridge` 시 draft INSERT 생략(크론 전용) |
| 크론 퍼블리셔 | `src/app/api/cron/blog-publisher/route.ts` | 큐 항목 락(`generating`), pillar/card_news/product/정보성 분기, `content_creatives` 반영, 실패 시 `error_patterns` 연동 |
| 보조 크론 | `blog-lifecycle`, `trend-topic-miner`, `publish-scheduled` 등 | 주제·라이프사이클·예약 발행 |

### 4.4 패키지 승인 후 자동 마케팅 (정책·오케스트레이션)

- `PATCH /api/packages/[id]/approve`: MRT 호텔 인텔 동기화, `recomputeGroupForPackage`, `indexPackage`(자비스 RAG), `revalidatePath`, **정책 기반** drip·카드뉴스·오케스트레이터 트리거 (`blog-scheduler`, `orchestrator` 연동 코드 존재).
- **중복 코드 주의:** 동일 파일 내 MRT 동기화 블록이 두 번 연속 호출되는 구간이 있음(비중단 try/catch) — 유지보수 시 통합 권장.

### 4.5 기타 AI 진입점

- **자비스:** `src/lib/jarvis/**`, `src/lib/jarvis/v2-dispatch.ts` (도메인 확장 TODO 명시)
- **콘텐츠 허브:** `src/app/api/content-hub/generate/route.ts`, 어드민 `content-hub`
- **콘텐츠 팩토리:** `content_factory_jobs` 마이그레이션, `src/app/api/content-factory/**`

---

## 5. 미구현·부실 설계·기술 부채 (전문가 관점)

### 5.1 코드 내 TODO·스텁 (대표)

| 영역 | 파일 | 내용 |
|------|------|------|
| 광고 API | `src/lib/ad-controller.ts`, `src/lib/search-ads-api.ts`, `src/app/api/cron/ad-optimizer/route.ts` | 네이버·구글·Meta 실제 API 연동 미구현(주석 TODO) |
| OTA 어댑터 | `src/lib/travel-providers/agoda.ts`, `yeosonam.ts` | Agoda·직판 조회/예약 라우팅 Phase 1~2 TODO |
| 알림 | `src/lib/kakao.ts`, `src/app/api/cron/post-travel/route.ts` | Solapi·알림톡 시나리오 일부 TODO |
| 입금 SMS | `src/app/api/sms/receive/route.ts` | 기입금 tracking 반영 TODO |
| 자비스 라우팅 | `src/lib/jarvis/v2-dispatch.ts` | products/finance/marketing 등 Phase 2 확장 TODO |

(프롬프트 템플릿·마스킹용 문자열 "XXX"는 TODO가 아님 — `rg TODO` 시 필터 필요.)

### 5.2 아키텍처·도메인 리스크

1. **이중 상품 모델:** `travel_packages`(UUID) vs `products`(SKU 문자열) — 이점은 분리된 라이프사이클이나 병행 운영이지만, **예약·콘텐츠·광고**가 어느 쪽 FK를 쓰는지 혼재 → 온보딩·버그 조사 시 항상 양쪽 확인 필요.
2. **상태 차원 혼합:** `bookings.status`(여정), `payment_status`(입금), 레거시 `confirmed`/`completed` — UI·리포트·제휴 축하 로직(`affiliate/celebrate.ts` 등) 간 **의미 정렬** 지속 필요.
3. **상태머신 vs 취소:** `ALLOWED_TRANSITIONS`에 `cancelled` 진입이 비어 보임 — 실제 취소 경로와 단일화 여부 확인 권장.
4. **계약금 확인:** `deposit_paid`/`fully_paid` 전이에 **Mock 플래그**(`isMock`) — 운영 입금 연동 시 실제 이벤트로 교체 필요.
5. **API 표면적 폭:** Route Handler 300개 이상 — 도메인 경계·공통 미들웨어·OpenAPI 부재 시 신규 기여자 비용 큼.
6. **승인 라우트 중복:** `approve/route.ts` 내 중복 MRT 호출 — 불필요 이중 실행·로그 노이즈.

### 5.3 권장 후속 문서화

- 예약 취소·환불의 **단일 시퀀스 다이어그램**(API + RPC + 트리거).
- `content_creatives.product_id` vs `travel_packages` 참조 규칙 표준화.

---

## 6. 참조 파일 빠른 색인

```
src/lib/booking-state-machine.ts
src/app/api/bookings/[id]/transition/route.ts
src/app/api/bookings/route.ts
src/lib/supabase.ts
src/app/api/upload/route.ts
src/lib/creative-engine/parse-product.ts
src/lib/package-schema.ts
src/app/api/packages/[id]/approve/route.ts
src/app/api/card-news/route.ts
src/app/api/blog/from-card-news/route.ts
src/app/api/blog/queue/route.ts
src/app/api/cron/blog-publisher/route.ts
src/lib/slack-ingest.ts
supabase/migrations/20260429000000_fix_booking_triggers.sql
CURRENT_STATUS.md
AGENTS.md
```

---

*끝. 상세 메뉴·테이블 컬럼 전체는 `CURRENT_STATUS.md`를 열어 날짜와 함께 확인할 것.*

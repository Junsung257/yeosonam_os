# 여소남 OS — 전체 기능 및 DB 스키마 현황 (2026-04-01 기준)

---

## 1. 어드민 사이드바 메뉴 + 세부 기능

### 1-1. 운영 (Operations)

| 메뉴 | 경로 | 세부 기능 |
|------|------|-----------|
| **대시보드** | `/admin` | 월매출·확정출발·예약KPI, 6개월 캐시플로 예측, 패키지 승인현황, 예약 단계별 분포 |
| **예약 관리** | `/admin/bookings` | 예약 목록(상태별 필터·페이지네이션), 신규예약 생성(`/new`), 예약 상세(`/[id]`), 예약 수정(`/[id]/edit` — 가격변경 사유 추적), 상태 머신 전이(pending→fully_paid), 타임라인(message_logs) |
| **고객 관리** | `/admin/customers` | 고객 CRUD, 마일리지 이력, 예약 내역, 여권·생년월일, 메모, CRM 등급(신규~VVIP), 상태(잠재고객~여행완료) |
| **입금 관리** | `/admin/payments` | 입금 확인·매칭, 신한은행 SMS 파싱, bank_transactions 자동매칭 |
| **예약 안내문** | `/admin/booking-guide` | 예약확인서 템플릿, 인쇄/PDF 내보내기 |

### 1-2. 상품 (Products)

| 메뉴 | 경로 | 세부 기능 |
|------|------|-----------|
| **상품 관리** | `/admin/packages` | 패키지 CRUD, 마케팅 도구(AI SNS 카피·포스터 스튜디오·카드뉴스·광고성과 대시보드·Meta 자동발행) |
| **상품 검수** | `/admin/products/review` | QA 관제탑 — DRAFT/REVIEW_NEEDED 상태, AI 신뢰도 점수, 공급사 코드 매핑, 셀링포인트 추출 |
| **업로드** | `/admin/upload` | PDF/JPG/HWP 일괄 업로드, 큐 처리, 벌크 모드, 텍스트 직접입력, confidence 점수 |
| **랜드사 관리** | `/admin/land-operators` | 랜드사 CRUD, 인라인 편집, 소프트 삭제/복원 |
| **출발지 관리** | `/admin/departing-locations` | 출발지 CRUD, 인라인 편집, 소프트 삭제/복원 |
| **관광지 관리** | `/admin/attractions` | 관광지 DB, Pexels 사진 연동, 뱃지(tour/special/shopping/meal/optional/hotel/restaurant/golf), 벌크 사진 싱크, 미매칭 활동 관리(`/unmatched`) |

### 1-3. 영업 (Sales)

| 메뉴 | 경로 | 세부 기능 |
|------|------|-----------|
| **제휴/인플루언서** | `/admin/affiliates` | 제휴 관리, 등급(Bronze→Diamond), 커미션율, 지급유형(개인/사업자), 추천코드 생성, 상세(`/[id]` — 정산내역·커미션 이력·등급 진행) |
| **제휴 분석** | `/admin/affiliate-analytics` | 퍼널 분석(클릭→전환→매출→커미션), 월간 트렌드, 파트너 성과 랭킹 |
| **파트너 신청** | `/admin/applications` | 신청 심사 워크플로(PENDING/APPROVED/REJECTED), 자동 제휴 생성, 거절 사유 |
| **단체 RFQ** | `/admin/rfqs` | 단체 견적 관리, 상태(draft→contracted), KPI 카드, 입찰 추적, 상세(`/[id]` — 체크리스트·입찰·제안서·상태전이) |
| **컨시어지** | `/admin/concierge` | Mock API 설정(Agoda/Klook/Cruise), 트랜잭션 상태(PENDING→COMPLETED), SAGA 이벤트 로그, 바우처, 환불 처리 |
| **테넌트 관리** | `/admin/tenants` | 테넌트 CRUD, 커미션율, 상태(active/inactive/suspended), 월간 정산 통계 |

### 1-4. 재무 (Finance)

| 메뉴 | 경로 | 세부 기능 |
|------|------|-----------|
| **통합 장부** | `/admin/ledger` | 은행거래 매칭, AI 이상탐지(중복·대액·소액), 월별 수입/지출 차트, 자본 항목, match_status |
| **정산 관리** | `/admin/settlements` | 제휴 정산(기간 선택, PENDING→COMPLETED), 이월잔액, 세금공제(3.3%), PDF |
| **세무 관리** | `/admin/tax` | 월별 세무(이체상태, 현금영수증 ISSUED/NOT_ISSUED/NOT_REQUIRED, 부가세 추정, 문서 업로드) |

### 1-5. 마케팅 (Marketing)

| 메뉴 | 경로 | 세부 기능 |
|------|------|-----------|
| **마케팅 대시보드** | `/admin/marketing` | Meta 캠페인 개요, ROAS 등급, 월간 성과, 캠페인 링크 빌더, 분석 대시보드 |
| **크리에이티브** | `/admin/marketing/creatives` | 광고 소재 생성(carousel/single_image/text_ad/short_video), 채널별(Meta/Naver/Google), 상태 관리, hook 유형 |
| **카드뉴스** | `/admin/marketing/card-news` | 카드뉴스 목록·생성(패키지 기반 자동생성), 슬라이드 에디터(`/[id]` — 이미지 오버레이·비율 프리셋·내보내기) |
| **콘텐츠 허브** | `/admin/content-hub` | 3단계 콘텐츠 생성(패키지 선택 → AI 생성(앵글/채널/비율) → 슬라이드 편집/발행) |
| **검색광고** | `/admin/search-ads` | 키워드 관리(Naver/Google), 키워드 티어(core/mid/longtail/negative), 성과 싱크, 입찰 최적화 |

### 1-6. AI

| 메뉴 | 경로 | 세부 기능 |
|------|------|-----------|
| **자비스 AI** | `/admin/jarvis` | AI 대화형 운영 인터페이스, 빠른 명령(예약현황·상품추천·고객조회), 액션카드(예약/고객 생성·수정) |
| **AI 생성** | `/admin/generate` | OpenAI/Claude/Gemini 콘텐츠 생성(설명·제목·혜택 추출·모델 비교) |
| **Q&A 챗봇** | `/admin/qa` | 고객 Q&A 챗봇, 패키지 추천, 상담원 에스컬레이션 |

### 1-7. 시스템 (System)

| 메뉴 | 경로 | 세부 기능 |
|------|------|-----------|
| **OS 관제탑** | `/admin/control-tower` | 비즈니스 정책 엔진(9개 카테고리: pricing/mileage/booking/notification/display/product/operations/marketing/saas), 트리거/액션 설정, 우선순위 |
| **에스컬레이션** | `/admin/escalations` | AI 미해결 문의 관리, 문의 유형 분류, 해결 워크플로 |

### 1-8. 공개(비로그인) 페이지

| 경로 | 설명 |
|------|------|
| `/` | 메인 홈 |
| `/packages`, `/packages/[id]` | 패키지 목록·상세 |
| `/influencer/[code]` | 인플루언서 전용 랜딩 (PIN 인증) |
| `/itinerary/[id]`, `/itinerary/[id]/print` | 일정표 뷰·인쇄 |
| `/lp/[id]` | 랜딩페이지 |
| `/concierge` | 컨시어지 (Agoda/Klook/Cruise) |
| `/group-inquiry`, `/rfq` | 단체문의·RFQ |
| `/tenant` | 테넌트 입점 |
| `/share` | 공유 일정표 |

---

## 2. 전체 DB 테이블 목록 (61개+) + 주요 컬럼

### 핵심 (Core)

| # | 테이블 | 주요 컬럼 | 설명 |
|---|--------|-----------|------|
| 1 | **bookings** | `id`, `booking_no`(UNIQUE), `package_id`(FK), `lead_customer_id`(FK), `adult_count/price/cost`, `child_count/price/cost`, `infant_count/price`, `total_cost`(GEN), `total_price`(GEN), `status`(상태머신), `departure_date`, `affiliate_id`(FK), `referral_code`, `land_operator_id`(FK), `flight_out/in`, `is_ticketed`, `local_expenses`(JSONB), `surcharge_breakdown`(JSONB), `paid_amount`, `deposit_amount`, `utm_*`, `departing_location_id`(FK) | 예약 중심 팩트 테이블 |
| 2 | **travel_packages** | `id`, `title`, `destination`, `country`, `duration`, `nights`, `price`, `cost_price`, `raw_text`, `parsed_data`(JSONB), `itinerary`(TEXT[]), `inclusions`(TEXT[]), `confidence`, `status`, `category`, `price_tiers`(JSONB), `surcharges`(JSONB), `tenant_id`(FK), `land_operator_id`(FK), `seats_held/confirmed/ticketed`, `is_airtel` | 여행 패키지 마스터 |
| 3 | **customers** | `id`, `name`, `phone`, `passport_no`, `passport_expiry`, `birth_date`, `mileage`, `total_spent`, `booking_count`, `tags`(TEXT[]), `memo`, `status`(잠재~여행완료), `grade`(신규~VVIP), `source`, `cafe_sync_data`(JSONB) | 고객 마스터 |
| 4 | **products** | `internal_code`(PK, SKU), `display_name`, `departure_region`, `supplier_name/code`, `destination`, `net_price`, `margin_rate`, `selling_price`(GEN), `status`, `departure_date`, `ai_tags`(TEXT[]), `public_itinerary`(JSONB), `highlights`(TEXT[]) | 내부 ERP 상품 카탈로그 |

### 예약 관련

| # | 테이블 | 주요 컬럼 | 설명 |
|---|--------|-----------|------|
| 5 | **booking_passengers** | `booking_id`(FK), `customer_id`(FK), `passenger_type`(adult/child_n/child_e/infant), `seat_number`, `ticket_number` | 예약-고객 N:M 연결 |
| 6 | **booking_segments** | `id`, `booking_id`(FK), `segment_type`(flight/hotel/transport/activity/meal/guide), `sequence_no`, `cost_price`, `sell_price`, `margin`(GEN), `status`, `details`(JSONB) | 예약 구성 세그먼트(PNR) |
| 7 | **message_logs** | `id`, `booking_id`(FK), `log_type`(system/kakao/mock/scheduler/manual), `event_type`(DEPOSIT_NOTICE/CONFIRMED 등), `title`, `content`, `is_mock`, `created_by` | 예약별 커뮤니케이션 타임라인 |

### CRM / 마일리지

| # | 테이블 | 주요 컬럼 | 설명 |
|---|--------|-----------|------|
| 8 | **customer_notes** | `id`, `customer_id`(FK), `content`, `channel`(phone/kakao/email/visit/cafe/sms) | 고객 상담 메모 |
| 9 | **customer_unified_profile** | `id`, `customer_id`(FK, UNIQUE), `rfm_r/f/m`(1-5), `rfm_segment`, `ltv_estimate`, `preferred_destinations`(TEXT[]), `lifecycle_stage`, `churn_risk_level`, `propensity_scores`(JSONB), `next_best_action` | 고객 360° 프로필 |
| 10 | **mileage_history** | `id`, `customer_id`(FK), `booking_id`(FK), `delta`(±), `reason`, `balance_after` | 마일리지 적립/사용 원장 |
| 11 | **mileage_transactions** | `id`, `user_id`(FK), `booking_id`(FK), `amount`, `type`(EARNED/USED/CLAWBACK), `margin_impact`, `mileage_rate`(5%), `ref_transaction_id`(자기참조) | 수익 기반 마일리지 회계 |
| 12 | **customer_mileage_balances** | `user_id`, `balance`, `total_earned`, `total_used`, `total_clawback` | (View) 마일리지 잔액 |

### 제휴 / 인플루언서

| # | 테이블 | 주요 컬럼 | 설명 |
|---|--------|-----------|------|
| 13 | **affiliates** | `id`, `name`, `phone`, `email`, `referral_code`(UNIQUE), `grade`(1-5), `bonus_rate`, `commission_rate`, `payout_type`(PERSONAL/BUSINESS), `is_active`, `pin`, `logo_url` | 제휴 파트너 |
| 14 | **affiliate_applications** | `id`, `name`, `phone`, `channel_type/url`, `follower_count`, `business_type`, `status`(PENDING/APPROVED/REJECTED) | 파트너 신청 |
| 15 | **influencer_links** | `id`, `affiliate_id`(FK), `referral_code`, `package_id`, `short_url`, `click_count`, `conversion_count` | 추천 링크 성과 |
| 16 | **settlements** | `id`, `affiliate_id`(FK), `settlement_period`, `total_amount`, `carryover_balance`, `tax_deduction`(3.3%), `final_payout`, `status`(PENDING→COMPLETED), `pdf_url` | 월간 정산 |

### 재무 / 결제

| # | 테이블 | 주요 컬럼 | 설명 |
|---|--------|-----------|------|
| 17 | **bank_transactions** | `id`, `slack_event_id`(UNIQUE, 멱등성), `raw_message`, `transaction_type`(입금/출금), `amount`, `counterparty_name`, `booking_id`(FK), `match_status`(auto/review/unmatched/manual), `match_confidence` | 은행 거래 원장(불변) |
| 18 | **sms_payments** | `id`, `raw_sms`, `sender_name`, `amount`, `booking_id`(FK), `match_confidence`, `status` | SMS 입금 파싱 |
| 19 | **capital_entries** | 코드 참조 | 자본/경비 항목 |
| 20 | **price_history** | `id`, `package_id`(FK), `price`, `cost_price`, `seats_total/booked`, `occupancy_rate`(GEN), `change_reason` | 가격 변동 이력 |
| 21 | **margin_settings** | `id`, `package_id`(FK), `base_price`, `vip/regular/bulk_margin_percent` | 패키지별 마진율 |

### 광고 / 퍼포먼스 (10개)

| # | 테이블 | 주요 컬럼 | 설명 |
|---|--------|-----------|------|
| 22 | **ad_accounts** | `id`, `platform`(naver/google/meta), `account_name`, `current_balance`, `daily_budget`, `is_active` | 광고 계정 |
| 23 | **ad_campaigns** | `id`, `package_id`(FK), `meta/naver/google_campaign_id`, `channel`, `status`(DRAFT/ACTIVE/PAUSED/ARCHIVED), `daily_budget_krw`, `total_spend_krw` | 광고 캠페인 |
| 24 | **ad_creatives** | `id`, `product_id`(FK), `campaign_id`(FK), `creative_type`(carousel/single_image/text_ad/short_video), `channel`, `hook_type`, `tone`, `slides`(JSONB), `status` | 광고 소재 |
| 25 | **ad_performance_snapshots** | `id`, `campaign_id`(FK), `snapshot_date`, `impressions`, `clicks`, `spend_krw`, `attributed_bookings`, `net_roas_pct`, `raw_meta_json`(JSONB) | 캠페인 일일 성과 |
| 26 | **ad_traffic_logs** | `id`, `session_id`, `user_id`(FK), `source`, `medium`, `campaign_name`, `keyword`, `gclid`, `fbclid`, `current_cpc` | 광고 유입 세션 |
| 27 | **ad_search_logs** | `id`, `session_id`, `user_id`(FK), `search_query`, `search_category`, `result_count` | 유입 후 검색 행동 |
| 28 | **ad_engagement_logs** | `id`, `session_id`, `user_id`(FK), `event_type`(page_view/product_view/cart_added/checkout_start), `product_id` | 유입 후 인게이지먼트 |
| 29 | **ad_conversion_logs** | `id`, `session_id`, `user_id`(FK), `final_booking_id`(FK), `final_sales_price`, `base_cost`, `allocated_ad_spend`, `net_profit`(GEN), `attributed_source` | 광고→예약 전환 |
| 30 | **keyword_performances** | `id`, `platform`, `keyword`, `ad_account_id`(FK), `total_spend/revenue/cost`, `net_profit`(GEN), `roas_pct`(GEN), `clicks`, `impressions`, `current_bid`, `status`, `is_longtail` | 키워드별 성과 |
| 31 | **creative_performance** | `id`, `creative_id`(FK), `channel`, `date`, `impressions`, `clicks`, `spend`, `cpc`, `ctr`, `roas`, UNIQUE(creative_id,channel,date) | 소재별 일일 성과 |

### 콘텐츠 / 마케팅

| # | 테이블 | 주요 컬럼 | 설명 |
|---|--------|-----------|------|
| 32 | **card_news** | `id`, `package_id`(FK), `campaign_id`(FK), `title`, `status`(DRAFT/CONFIRMED/LAUNCHED/ARCHIVED), `slides`(JSONB), `meta_creative_id` | 카드뉴스 에디터 |
| 33 | **content_creatives** | `id`, `tenant_id`(FK), `product_id`(FK), `angle_type`, `target_audience`, `channel`, `image_ratio`, `slides`(JSONB), `blog_html`, `tracking_id`(UNIQUE), `status` | 멀티채널 콘텐츠 |
| 34 | **content_performance** | `id`, `creative_id`(FK), `date`, `impressions`, `clicks`, `conversions`, `spend`, `ctr`, `cpa`, `roas`, UNIQUE(creative_id,date) | 콘텐츠 일일 성과 |
| 35 | **content_insights** | `id`, `destination`, `angle_type`, `channel`, `avg_ctr`, `avg_conversions`, `confidence_score` | 콘텐츠 인사이트(자동집계) |
| 36 | **winning_patterns** | `id`, `destination_type`, `channel`, `target_segment`, `hook_type`, `creative_type`, `avg_ctr`, `avg_roas`, `best_headline`, `best_body` | AI 학습 — 우승 패턴 |
| 37 | **creative_edits** | `id`, `creative_id`(FK), `slide_index`, `field`, `before_value`, `after_value`, `edited_by` | 소재 수정 이력 |
| 38 | **marketing_logs** | `id`, `product_id`, `travel_package_id`(FK), `platform`(blog/instagram/cafe/threads), `url`, `va_id`(FK) | 마케팅 발행 이력 |

### 마스터 데이터

| # | 테이블 | 주요 컬럼 | 설명 |
|---|--------|-----------|------|
| 39 | **land_operators** | `id`, `name`(UNIQUE), `contact`, `regions`(TEXT[]), `memo` | 랜드사 |
| 40 | **departing_locations** | `id`, `name`(UNIQUE), `is_active` | 출발지(부산/인천/청주 등) |
| 41 | **attractions** | `id`, `name`(UNIQUE), `short_desc`, `country`, `region`, `category`, `emoji`, `mention_count`, `is_special`, `badge_type` | 관광지 DB |
| 42 | **app_settings** | `key`(PK), `value`(JSONB) | 시스템 설정(commission_rate, vacation_mode 등) |

### 단체 RFQ (5개)

| # | 테이블 | 주요 컬럼 | 설명 |
|---|--------|-----------|------|
| 43 | **group_rfqs** | `id`, `rfq_code`(UNIQUE), `customer_id`(FK), `destination`, `departure_date_from/to`, `budget_per_person`, `status`(draft→completed), `max_proposals`, `ai_interview_log`(JSONB) | 단체 견적 요청 |
| 44 | **rfq_bids** | `id`, `rfq_id`(FK), `tenant_id`(FK), `status`(locked/submitted/selected/rejected), `locked_at`, `submit_deadline`, UNIQUE(rfq_id,tenant_id) | 입찰 슬롯(선착순) |
| 45 | **rfq_proposals** | `id`, `rfq_id`(FK), `bid_id`(FK), `tenant_id`(FK), `proposal_title`, `total_cost/selling_price`, `checklist`(JSONB), `ai_review`(JSONB), `rank`, `status` | 제안서 |
| 46 | **rfq_messages** | `id`, `rfq_id`(FK), `proposal_id`(FK), `sender_type`(customer/tenant/ai/system), `raw_content`, `processed_content`, `pii_detected/blocked`, `is_visible_to_*` | PII 안전 RFQ 소통 |
| 47 | **secure_chats** | `id`, `booking_id`(FK), `rfq_id`(FK), `sender_type`, `sender_id`, `receiver_type`, `raw_message`, `masked_message`, `is_filtered`, `is_unmasked`, `unmasked_at` | PII 마스킹 채팅 |

### 컨시어지 / 마켓플레이스

| # | 테이블 | 주요 컬럼 | 설명 |
|---|--------|-----------|------|
| 48 | **tenants** | `id`, `name`, `contact_name/phone/email`, `commission_rate`(18%), `status`(active/inactive/suspended), `tier`(GOLD/SILVER/BRONZE), `reliability_score`(100) | SaaS 테넌트(랜드사) |
| 49 | **transactions** | `id`, `idempotency_key`(UNIQUE), `session_id`, `status`(PENDING→COMPLETED), `total_cost/price`, `net_margin`(GEN), `saga_log`(JSONB), `vouchers`(JSONB), `tenant_cost_breakdown`(JSONB) | Saga 트랜잭션 |
| 50 | **api_orders** | `id`, `transaction_id`(FK), `api_name`(agoda_mock/klook_mock/cruise_mock/tenant_product), `product_type`, `cost`, `price`, `quantity`, `status`, `tenant_id`(FK) | 개별 API 주문 |
| 51 | **carts** | `id`, `session_id`, `items`(JSONB) | 장바구니 |
| 52 | **inventory_blocks** | `id`, `tenant_id`(FK), `product_id`(FK), `date`, `total_seats`, `booked_seats`, `available_seats`(GEN), `price_override`, `status`(OPEN/CLOSED/SOLDOUT), UNIQUE(product_id,date) | 날짜별 좌석 재고 |
| 53 | **mock_api_configs** | `id`, `api_name`(UNIQUE), `mode`(success/fail/timeout), `delay_ms` | Mock API 설정 |
| 54 | **vouchers** | `id`, `booking_id`(FK), `rfq_id`(FK), `customer_id`(FK), `land_agency_id`(FK→tenants), `parsed_data`(JSONB), `upsell_data`(JSONB), `pdf_url`, `status`(draft/issued/sent/cancelled) | 바우처 |

### AI / Q&A / 채팅

| # | 테이블 | 주요 컬럼 | 설명 |
|---|--------|-----------|------|
| 55 | **conversations** | `id`, `customer_id`(FK), `channel`(default 'web'), `source`, `messages`(JSONB) | 고객 대화 세션 |
| 56 | **intents** | `id`, `conversation_id`(FK), `destination`, `travel_dates`(DATERANGE), `party_size`, `budget_range`(INT4RANGE), `priorities`(TEXT[]), `booking_stage` | 대화에서 추출한 여행 의도 |
| 57 | **qa_inquiries** | `id`, `question`, `inquiry_type`(product_recommendation/price_comparison/general_consultation), `related_packages`(UUID[]), `customer_name/email/phone`, `status`(pending/answered/closed) | Q&A 문의 |
| 58 | **ai_responses** | `id`, `inquiry_id`(FK→qa_inquiries), `response_text`, `ai_model`(openai/claude/gemini), `confidence`, `used_packages`(UUID[]), `approved` | AI 응답 |

### 시스템 / 감사

| # | 테이블 | 주요 컬럼 | 설명 |
|---|--------|-----------|------|
| 59 | **os_policies** | `id`, `category`(9종), `name`, `trigger_type`(condition/schedule/event/cron/always), `trigger_config`(JSONB), `action_type`, `action_config`(JSONB), `target_scope`(JSONB), `is_active`, `priority` | 비즈니스 정책 엔진 |
| 60 | **audit_logs** | `id`, `user_id`, `action`, `target_type/id`, `before_value/after_value`(JSONB) | 감사 로그 |
| 61 | **pin_attempts** | `id`, `identifier`(referral_code_ip), `attempted_at` | PIN 브루트포스 방어 |

### 기타 테이블

| 테이블 | 설명 |
|--------|------|
| **user_profiles** | `id`(FK→auth.users), `role`(admin/va), `name` — 사용자 프로필·역할 |
| **archive_docs** | `id`, `file_hash`(SHA-256), `raw_content`, `metadata`(JSONB) — PDF 문서 아카이브 |
| **shared_itineraries** | `id`, `share_code`(8자), `share_type`(DYNAMIC/FIXED), `items`(JSONB) — 공유 일정표 |
| **partners** | `id`, `name`, `category`, `api_endpoint`, `api_key` — 전략 파트너 |
| **leads** | 리드 트래킹 |
| **user_actions** | `session_id`, `customer_id`(FK), `action_type`, `context`(JSONB) — 행동 로그 |
| **unmatched_activities** | 미매칭 활동 |
| **product_prices** | 상품 가격 |
| **recommendation_logs** | AI 추천 로그 |
| **ai_training_logs** | AI 학습 로그 |
| **document_hashes** | 문서 중복 방지 |

---

## 3. 채팅 / Conversations 관련 테이블 상세 스키마

### 3-1. conversations (고객 대화 세션)

```sql
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id),
  channel TEXT DEFAULT 'web',
  source TEXT,
  messages JSONB DEFAULT '[]',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_conversations_customer ON conversations(customer_id);
CREATE INDEX idx_conversations_created ON conversations(created_at);
```

**사용처:**
- `POST /api/qa/chat` — 대화 저장·메시지 히스토리 누적
- `POST /api/bookings` — 예약 생성 시 session → customer_id 연결

### 3-2. intents (대화에서 추출한 여행 의도)

```sql
CREATE TABLE IF NOT EXISTS intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id),
  destination TEXT,
  travel_dates DATERANGE,
  party_size INTEGER,
  budget_range INT4RANGE,
  priorities TEXT[],
  booking_stage TEXT,
  extracted_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_intents_conversation ON intents(conversation_id);
CREATE INDEX idx_intents_destination ON intents(destination);
```

**사용처:** `/api/qa/chat` — AI가 대화에서 여행 의도(목적지·일정·인원·예산·우선순위) 자동 추출

### 3-3. secure_chats (PII 마스킹 보안 채팅)

```sql
CREATE TABLE IF NOT EXISTS secure_chats (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      UUID REFERENCES bookings(id) ON DELETE CASCADE,
  rfq_id          UUID REFERENCES group_rfqs(id) ON DELETE CASCADE,
  sender_type     TEXT NOT NULL CHECK (sender_type IN ('customer','land_agency','system')),
  sender_id       TEXT NOT NULL,
  receiver_type   TEXT NOT NULL CHECK (receiver_type IN ('customer','land_agency','admin')),
  raw_message     TEXT NOT NULL,         -- 원본 (서버 전용)
  masked_message  TEXT NOT NULL,         -- PII 마스킹 버전
  is_filtered     BOOLEAN DEFAULT FALSE,
  filter_detail   TEXT,
  is_unmasked     BOOLEAN DEFAULT FALSE, -- 결제 완료 후 해제
  unmasked_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_secure_chat_booking ON secure_chats(booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX idx_secure_chat_rfq ON secure_chats(rfq_id) WHERE rfq_id IS NOT NULL;
CREATE INDEX idx_secure_chat_sender ON secure_chats(sender_id);
```

**TypeScript 함수:**
- `createSecureChat()` — 메시지 삽입
- `getSecureChats()` — booking_id/rfq_id/receiver_type 기준 조회
- `unmaskChatsForBooking()` — 결제 완료 시 일괄 마스크 해제

### 3-4. message_logs (예약별 커뮤니케이션 타임라인)

```sql
CREATE TABLE IF NOT EXISTS message_logs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  log_type   TEXT NOT NULL CHECK (log_type IN ('system','kakao','mock','scheduler','manual')),
  event_type TEXT NOT NULL,
  title      TEXT NOT NULL,
  content    TEXT,
  is_mock    BOOLEAN DEFAULT false,
  created_by TEXT DEFAULT 'system',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_message_logs_booking ON message_logs(booking_id, created_at DESC);
CREATE INDEX idx_message_logs_event_type ON message_logs(event_type);
```

**event_type 목록:**
| event_type | 설명 | 트리거 |
|------------|------|--------|
| `DEPOSIT_NOTICE` | 예약금 안내 발송 | 예약 생성 시 |
| `DEPOSIT_CONFIRMED` | 예약금 입금 확인 | 입금 매칭 시 |
| `BALANCE_NOTICE` | 잔금 안내 | D-15 자동 또는 수동 |
| `BALANCE_CONFIRMED` | 잔금 입금 확인 | 입금 매칭 시 |
| `CONFIRMATION_GUIDE` | 출발 확인 안내 | D-3 자동 |
| `HAPPY_CALL` | 귀국 후 만족도 | D+1 자동 |
| `CANCELLATION` | 예약 취소 | 취소 처리 시 |
| `MANUAL_MEMO` | 관리자 수동 메모 | 수동 |

### 3-5. qa_inquiries + ai_responses (Q&A 문의·AI 응답)

```sql
CREATE TABLE qa_inquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question TEXT NOT NULL,
  inquiry_type VARCHAR(50),  -- product_recommendation, price_comparison, general_consultation
  related_packages UUID[] DEFAULT '{}',
  customer_name VARCHAR(255),
  customer_email VARCHAR(255),
  customer_phone VARCHAR(20),
  status VARCHAR(50) DEFAULT 'pending',  -- pending, answered, closed
  created_at TIMESTAMP DEFAULT NOW(),
  answered_at TIMESTAMP,
  answered_by UUID
);

CREATE TABLE ai_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inquiry_id UUID REFERENCES qa_inquiries(id) ON DELETE CASCADE,
  response_text TEXT NOT NULL,
  ai_model VARCHAR(50),  -- openai, claude, gemini
  confidence FLOAT DEFAULT 0,
  used_packages UUID[] DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  admin_feedback TEXT,
  approved BOOLEAN DEFAULT FALSE
);
```

### 3-6. rfq_messages (RFQ AI 중개 메시지)

```sql
CREATE TABLE IF NOT EXISTS rfq_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id UUID NOT NULL REFERENCES group_rfqs(id) ON DELETE CASCADE,
  proposal_id UUID REFERENCES rfq_proposals(id),
  sender_type TEXT NOT NULL CHECK (sender_type IN ('customer','tenant','ai','system')),
  sender_id TEXT NOT NULL,
  raw_content TEXT NOT NULL,
  processed_content TEXT,
  pii_detected BOOLEAN DEFAULT FALSE,
  pii_blocked BOOLEAN DEFAULT FALSE,
  recipient_type TEXT CHECK (recipient_type IN ('customer','tenant','admin')),
  is_visible_to_customer BOOLEAN DEFAULT TRUE,
  is_visible_to_tenant BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

---

## 4. 기술 스택 요약

| 영역 | 기술 |
|------|------|
| **프레임워크** | Next.js 15 (App Router) |
| **언어** | TypeScript |
| **DB** | Supabase (PostgreSQL) + RLS |
| **인증** | JWT 로컬 검증 (middleware.ts) |
| **AI** | OpenAI (gpt-4o) / Anthropic (claude-3-5-sonnet) / Google Gemini 2.5 Flash |
| **알림** | Solapi (카카오 알림톡) + MockAdapter 이중화 |
| **파일 파싱** | PDF/HWP/JPG 텍스트 추출 |
| **광고** | Meta Marketing API / Naver / Google Ads 연동 |
| **배포** | Vercel |
| **결제** | 신한은행 SMS 파싱 + Slack 웹훅 자동매칭 |

---

## 5. 핵심 아키텍처 패턴

| 패턴 | 적용 |
|------|------|
| **예약 상태 머신** | `pending → waiting_deposit → deposit_paid → waiting_balance → fully_paid` (+ cancelled) |
| **Saga 패턴** | 컨시어지 트랜잭션: 멀티벤더 주문 보상 트랜잭션 |
| **PII 마스킹** | secure_chats / rfq_messages — 결제 전까지 개인정보 마스킹 |
| **멱등성** | bank_transactions(slack_event_id), transactions(idempotency_key) — ON CONFLICT 무시 |
| **소프트 삭제** | is_active 플래그, UI에서 [비활성] 뱃지 |
| **정책 엔진** | os_policies — 40+ 비즈니스 룰 (가격/마일리지/알림/디스플레이 등) |
| **AI Fallback** | API 키 미설정 시 dummy 콘텐츠 반환, 전체 파이프라인 중단 금지 |
| **알림 이중화** | KakaoNotificationAdapter(알림톡+DB) / MockNotificationAdapter(DB만) |

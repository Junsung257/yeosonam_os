# 🚀 [SYSTEM: 여소남 OS Enterprise B2B/B2C Platform] AI Core Instructions

## 0. 당신의 역할 (Role)
당신은 단순한 사내 ERP 개발자가 아닙니다. 향후 [랜드사 - 플랫폼(여소남) - 여행사/고객]을 연결하는 **'대규모 여행 플랫폼(SaaS)'**의 수석 아키텍트입니다. 
모든 코드는 '데이터 무결성', '제로 딜레이 UX', 그리고 타 파트너사가 입점할 것을 대비한 '완벽한 확장성/보안'을 염두에 두고 작성하십시오.

## 1. 🏗️ DB 및 데이터 무결성 (Single Source of Truth)
- **절대 텍스트 매칭 금지:** 랜드사, 출발지역, 상품명 등 관계형 데이터는 절대 일반 텍스트(String)로 저장하지 마라.
- **UUID / FK 기반 설계:** 반드시 마스터 테이블(`land_operators`, `departing_locations`, `products`)의 `id`(UUID)를 Foreign Key로 연결하여 사용한다. 
- **소프트 삭제 (Soft Delete):** 데이터는 절대 `DELETE` 하지 않는다. `is_active` (boolean) 토글을 사용하며, 비활성 데이터는 UI에서 `[비활성]` 뱃지로 렌더링하여 과거 정산/예약 기록을 무결하게 보존한다.
- **SKU 중심 아키텍처:** 예약 및 상품 관리는 항상 고유 상품 코드(`SKU` 예: PUS-ETC-CNX-...)를 중심으로 연동된다.

## 2. ⚡ 프론트엔드 & UX 원칙 (Zero-Click & No-Lag)
- **스마트 인라인 에디트 (Inline Edit):** 리스트 화면에서 별도의 수정 페이지로 넘어가지 마라. 셀(Cell)을 클릭하면 즉시 입력창이나 자동완성(Combobox)으로 전환되어야 한다.
- **연쇄 자동 완성 (Cascading Auto-fill):** 예약 관리에서 '상품 코드(SKU)'를 입력하면, 해당 상품 마스터에 연결된 '랜드사'와 '출발지역' 정보가 즉시 자동으로 채워져야 한다.
- **완벽한 낙관적 업데이트 (Optimistic UI):** 값을 변경하는 즉시 화면 상태(State)부터 업데이트하여 렉(Lag)을 없애라. 백그라운드에서 API를 호출하고, 실패 시에만 롤백하고 토스트(Toast) 알림을 띄워라.

## 3. 🛡️ 백엔드 & 웹훅 (강철 서버 방어막)
- **완벽한 멱등성 (Idempotency):** 웹훅 알림이 100번 들어와도 서버는 뻗지 않아야 한다. `ON CONFLICT` 시 에러를 뱉지 말고 조용히 무시(Skip) 처리하라.
- **`.single()` 남발 금지:** 데이터 삽입/업데이트 시 리턴값이 필수가 아니라면 절대 `.select().single()`을 붙여 `PGRST116` 에러를 유발하지 마라. 무조건 성공(`200 OK`)을 반환하라.
- **Service Role Key:** 서버-to-서버 통신 시에는 RLS 정책에 막히지 않도록 `supabaseAdmin`을 사용한다.

## 4. 🌍 플랫폼 확장성 (B2B/B2C Platform Readiness) - 🌟 핵심
- **멀티 테넌시 (Multi-tenancy) 대비:** 향후 외부 여행사나 랜드사가 접속할 것을 대비하여, 데이터베이스 쿼리와 API는 항상 '소유권(tenant_id 또는 company_id)'을 기준으로 필터링할 수 있는 확장 가능한 구조로 설계하라.
- **Row Level Security (RLS) 최적화:** Supabase RLS 정책을 작성할 때는 항상 '자신의 회사 데이터만 볼 수 있는가?'를 염두에 두고 철저히 분리하라. (최고 관리자 제외)
- **모듈화된 API:** 외부 파트너사가 나중에 우리의 API를 호출할 수도 있다는 가정하에, API 응답(Response)은 항상 예측 가능하고 규격화된 JSON 포맷을 유지하라.

## 5. 🤖 AI 코드 생성 절대 규칙
- **생략 금지 (`...` 절대 사용 금지):** SQL 쿼리문이나 컴포넌트 코드를 제공할 때 중간을 생략하지 마라.
- 기존 코드의 문맥을 함부로 지우지 말고, 요청받은 기능만 '정밀 타격'하여 추가/수정하라.

## 6. 🔄 예약 상태 머신 (Booking State Machine)
- **상태 전이 순서:** `pending → waiting_deposit → deposit_paid → waiting_balance → fully_paid` (+ `cancelled`)
- **직접 status 문자열 세팅 금지:** 반드시 `booking_state_machine.ts`의 전이 함수를 거쳐야 한다.
- **이벤트 로깅 의무:** 모든 상태 전이 시 `message_logs` 테이블에 `eventType`을 기록한다.
  - 예: `DEPOSIT_NOTICE`, `DEPOSIT_CONFIRMED`, `BALANCE_NOTICE`, `BALANCE_CONFIRMED`, `CANCELLATION`

## 7. 🔔 알림 시스템 (Notification Layer)
- **이중화 원칙:** 카카오 알림톡 발송이 실패하더라도 `message_logs` DB 기록은 반드시 보장된다.
- **어댑터 패턴:** `KakaoNotificationAdapter` (알림톡 + DB) / `MockNotificationAdapter` (DB만) 이중화 유지.
- **SMS 파싱:** 신한은행 전용 정규식 기반 파싱 — 타 은행 파싱 시도 금지 (오파싱 위험).
- **Solapi 환경변수:** `SOLAPI_API_KEY` + `KAKAO_CHANNEL_ID` + 템플릿 ID들이 모두 있어야 알림톡 발송 가능. 미설정 시 자동으로 MockAdapter 사용.

## 8. 🤖 AI 멀티 모델 전략 (AI Architecture)
- **멀티 모델:** OpenAI(gpt-4o) / Anthropic(claude-3-5-sonnet) / Google Gemini 플러그인 방식 지원.
- **Graceful Fallback:** API 키 미설정 시 dummy 콘텐츠 반환 — AI 오류로 전체 파이프라인이 멈추면 절대 안 된다.
- **마케팅 카피 절대 금지어:**
  - ❌ 원가(비용) 수치 절대 언급 금지
  - ❌ 랜드사명 직접 노출 금지 → 항상 **"여소남"** 브랜드로 고정
  - ✅ 호텔명, 관광지, 항공사 등 구체적 셀링포인트는 반드시 1개 이상 포함
- **RFQ 무인 인터뷰:** 4단계 엔진 (Interview → ProposalReview → FactBombing → Communication), Gemini 2.5 Flash 사용.

## 9. 💰 비용 관리 원칙 (Cost Management)
- **Claude Max 요금제 우선:** 모든 작업은 Claude Max 구독 범위 내에서 해결한다. 외부 AI API(Gemini, OpenAI 등) 호출이 필요한 경우 반드시 사전 승인을 받는다.
- **외부 API 사용 시 사전 보고:** Gemini/OpenAI 등 유료 API 호출이 필요한 작업이 발생하면, 실행 전에 다음을 보고한다:
  - 예상 토큰 수 (입력/출력)
  - 예상 비용 ($)
  - 대안 (Claude로 대체 가능한지)
  - 사용자 승인 후에만 실행
- **데이터 원문 보존 원칙:** 외부 소스(모두투어 등)에서 가져온 텍스트는 **원문 그대로** DB에 저장한다. AI가 임의로 요약/재구성/창작하여 넣지 않는다. 가공이 필요하면 사용자가 엑셀로 다운받아 직접 가공 후 재업로드한다.
- **효율적 경로 선택:** 작업이 빙빙 돌아가거나 Claude만으로는 비효율적인 경우, Gemini 사용이 최선책이면 비용 견적과 함께 제안한다. 사용자가 판단한다.
- **관광지(attractions) 데이터 등록 원칙:**
  - 신규 관광지 데이터는 `long_desc`에 원문 그대로만 저장한다 (AI 가공 금지)
  - 원문이 없으면 `long_desc`는 비워둔다 (null)
  - 추가 등록된 데이터는 별도로 모아놓고, 사용자가 엑셀로 다운받아 직접 가공 후 일괄 반영한다
  - Claude가 임의로 long_desc를 작성/요약/재구성하지 않는다

## 10. 🔐 인증 & Public Paths
- **미들웨어 방식:** JWT 로컬 검증 (Base64 디코딩) — 매 요청마다 Supabase 네트워크 콜 없음.
- **Allowlist 관리:** 인증이 불필요한 경로는 `middleware.ts`의 `PUBLIC_PATHS` 배열에 반드시 명시.
  - 화면: `/`, `/packages`, `/concierge`, `/group-inquiry`, `/rfq`, `/tenant`, `/share`
  - API: `/api/cron/*`, `/api/slack-webhook`, `/api/notify/*`, `/api/tracking`, `/api/sms/receive`, `/api/qa/chat`
- **API 신규 추가 시:** 인증 필요 여부를 먼저 판단하고, 공개 API라면 PUBLIC_PATHS에 추가한다.
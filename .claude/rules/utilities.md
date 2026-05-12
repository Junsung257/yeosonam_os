---
description: 여소남 OS — src/lib 유틸리티 카탈로그. 새 함수 만들기 전에 기존 도구 먼저 확인.
paths:
  - "src/lib/**/*.ts"
  - "src/lib/**/*.tsx"
  - "src/components/**/*.tsx"
  - "src/app/**/*.tsx"
  - "src/app/**/route.ts"
  - "db/**/*.js"
  - "db/**/*.ts"
---

# 유틸리티 카탈로그 — "이미 있는 도구를 먼저 찾아라"

새 함수를 만들기 전에 아래 목록을 확인하세요. **80%의 작업은 기존 도구 조합으로 해결됩니다.**

## 핵심 유틸리티 (`src/lib/`)

| 이런 작업이 필요하면 | 이 함수/모듈을 사용 | 위치 |
|---|---|---|
| DB 읽기/쓰기 | `supabaseAdmin.from('table')` | `supabase.ts` |
| DB 설정 여부 체크 | `isSupabaseConfigured` | `supabase.ts` |
| 관광지 매칭 | `matchAttraction(activity, attractions, destination)` | `attraction-matcher.ts` |
| 관광지 매칭 (인덱스 사전 구축, 반복 호출 고속) | `buildAttractionIndex()` + `matchAttractionIndexed()` | `attraction-matcher.ts` |
| itinerary 배열 추출 | `normalizeDays(pkg.itinerary_data)` | `attraction-matcher.ts` |
| 출발요일 정규화 (JSON/배열/평문 → "월/수") | `formatDepartureDays(val)` | `admin-utils.ts` |
| 선택관광 라벨 공통 생성 ("2층버스 (싱가포르)") | `normalizeOptionalTourName(tour)` | `itinerary-render.ts` |
| 선택관광 region별 그룹핑 | `groupOptionalToursByRegion(tours)` | `itinerary-render.ts` |
| **A4/모바일 공통 렌더 계약 (CRC)** — 항공헤더·써차지 병합·쇼핑 출처·선택관광 | `renderPackage(pkg)` → `CanonicalView` | `render-contract.ts` |
| **IATA 코드 → 항공사명 (A4·모바일 통합)** | `getAirlineName(flightCode)` | `render-contract.ts` |
| **excludes 평탄화 (괄호·숫자콤마 보호)** | `flattenItems(items)` / `classifyExcludes(items)` | `render-contract.ts` |
| **flight/city 활동 파서 (A4·Mobile 공통)** | `parseFlightActivity(act)` / `parseCityFromActivity(act)` / `formatFlightLabel(code)` | `render-contract.ts` |
| **Package 정규 Zod 스키마 (SSOT)** | `PackageCoreSchema` / `PackageStrictSchema` | `package-schema.ts` |
| **레거시 DB → 정규 변환 (Anti-Corruption Layer)** | `normalizePackage(raw)` / `normalizePhotos()` / `normalizeOptionalTours()` | `package-acl.ts` |
| **LLM Structured Output 스키마 변환** | `zodToGeminiSchema()` / `zodToClaudeSchema()` | `llm-structured-output.ts` |
| **LLM 호출 자동 재시도 (backoff)** | `withRetry(fn, { maxAttempts: 3 })` | `llm-retry.ts` |
| **LLM + Zod refine + feedback loop (instructor 패턴)** | `callWithZodValidation({ schema, fn })` / `parseWithValidation({ basePrompt, caller, schema })` | `llm-validate-retry.ts` |
| **CoVe claim-by-claim 검증 (post-audit E6, Gemini opt-in)** | `runCoVeAudit(pkg)` | `db/cove_audit.js` |
| **API 필드 drift 감사 (ERR-20260418-10 재발 방지)** | `npm run audit:api-drift[:ci]` | `db/audit_api_field_drift.js` |
| **Schema drift 전수 감사** | `npm run audit:drift` | `db/audit_schema_drift.js` |
| **Visual + Text Regression 테스트** | `npm run test:visual` | `tests/visual/*.spec.ts` |
| **ISR 캐시 즉시 무효화** | `POST /api/revalidate { paths, secret }` | `src/app/api/revalidate/route.ts` |
| 가격/날짜 계산 | `getEffectivePriceDates()`, `groupForPoster()` | `price-dates.ts` |
| 카카오 채팅 열기 | `openKakaoChannel()` | `kakaoChannel.ts` |
| 예약 상태 전이 | `ALLOWED_TRANSITIONS[currentStatus]` | `booking-state-machine.ts` |
| 입금 매칭 | `matchPaymentToBookings(amount, name, bookings)` | `payment-matcher.ts` |
| 고객 등급 계산 | `calcGrade(totalSpent, cafeScore)` | `mileage.ts` |
| 금액 포맷팅 | `fmt만(n)`, `fmtK(n)` | `admin-utils.ts` |
| 날짜 포맷팅 | `fmtDate(d)` | `admin-utils.ts` |
| 알림 발송 | `getNotificationAdapter().send(payload)` | `notification-adapter.ts` |
| AI 파싱 검증 | `validateExtractedProduct(data)` | `upload-validator.ts` |
| 텍스트 정제 | `sanitizeText(raw, rules)` | `text-sanitizer.ts` |
| 데이터 암호화 | `encrypt(plaintext)` / `decrypt(cipher)` | `encryption.ts` |
| 정책/설정 조회 | `getActivePolicies(category)` | `policy-engine.ts` |
| 유입 추적 | `initTracker()`, `trackContentView(id)` | `tracker.ts` |
| **플랫폼 AI 이벤트(비PII 학습 축)** | `recordPlatformLearningEvent()` | `platform-learning.ts` |
| **공개 QA 제휴 스코프 UUID 해석** | `resolveAffiliateScopeId()` | `affiliate-scope.ts` |
| **대화 기반 고객 여정 스냅샷** | `advanceCustomerJourney()` | `customer-journey.ts` |

## 비즈니스 로직의 집 — `src/lib/`

파싱, 매칭, 계산, 정산 같은 **비즈니스 로직은 항상 `src/lib/` 안에 살아야 합니다.**
UI 컴포넌트(`.tsx`)는 이 모듈을 import해서 결과만 렌더링합니다.

```typescript
// 컴포넌트에서 로직을 사용하는 올바른 패턴
import { matchAttraction, normalizeDays } from '@/lib/attraction-matcher';
import { getEffectivePriceDates } from '@/lib/price-dates';

const days = normalizeDays(pkg.itinerary_data);
const attr = matchAttraction(item.activity, attractions, pkg.destination);
```

## 타입 정의의 집 — `src/types/`

| 타입 | 위치 | 용도 |
|---|---|---|
| `Product`, `ProductInsert`, `ProductPublic` | `database.ts` | 상품 CRUD |
| `BookingStatus`, `MessageEventType` | `booking-state-machine.ts` | 예약 상태 머신 |
| `AttractionData` | `attraction-matcher.ts` | 관광지 매칭 |
| `PriceDate`, `MonthGroup` | `price-dates.ts` | 가격/날짜 |
| `NotificationPayload` | `notification-adapter.ts` | 알림 발송 |

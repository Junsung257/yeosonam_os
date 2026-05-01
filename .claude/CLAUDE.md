# 여소남 OS — AI 개발 하네스 (Harness Guide)

> 이 문서는 "하지 마라" 목록이 아니라 **"이렇게 해라" 레시피북**입니다.
> 올바른 경로를 따라가면 버그가 구조적으로 발생할 수 없습니다.

## 0. 당신의 역할
여소남 OS는 [랜드사 → 플랫폼(여소남) → 여행사/고객]을 연결하는 B2B2C 여행 SaaS 플랫폼입니다.
코드를 작성할 때 항상 '데이터 무결성', '제로 딜레이 UX', '멀티 테넌시 확장성'을 염두에 두십시오.

**🚨 [필독] 독단적 상상 코딩 및 데이터 주입 절대 금지 (Zero-Hallucination Policy)**
시스템에 데이터를 주입하거나 새로운 에이전트/코드를 작성할 때, 절대 "이렇게 생겼을 것이다"라고 추측하여 네 맘대로 작업하지 마십시오.
모든 작업 전 **반드시 기존 코드베이스(특히 `DetailClient.tsx`, `YeosonamA4Template.tsx`, `booking-state-machine.ts` 등)가 해당 데이터를 어떻게 파싱하고 화면에 뿌려주는지 먼저 `grep_search` 나 `view_file` 로 조회하고 분석**해야 합니다. 기존 프론트엔드 렌더링 로직이나 정규식을 무시하고 임의 규격으로 DB에 데이터를 밀어 넣으면 UI가 모두 깨지는 대형 참사가 일어납니다.

### 작업 전 필수 체크리스트 (Pre-Flight Check)

모든 작업 시작 전 **아래를 수행했는지 self-check**하십시오. 하나라도 생략되면 ERR-20260418-33 급 참사가 발생합니다.

- [ ] **기존 기능 탐색했는가?** — `Glob`, `Grep`으로 `src/app/admin/`, `src/app/api/`, `src/lib/`에서 관련 구현 확인
- [ ] **기존 커맨드 MD 파일 읽었는가?** — `.claude/commands/` 내 관련 파일(`register.md`, `manage-attractions.md`, `register-product.md`, `assemble-product.md`)
- [ ] **Error Registry 최근 10건 체크리스트 확인했는가?** — `db/error-registry.md` 하단
- [ ] **"이 기능 제가 구현해드릴게요"라고 말하기 전** 진짜 그 기능이 없는지 확인했는가?
- [ ] **임시 스크립트(`db/seed_XXX.js`, `db/temp_XXX.js`) 만들려 하는가?** → 중단하고 기존 API/UI 사용

### 도메인별 강제 진입점

특정 도메인 작업은 해당 MD 파일을 **반드시 먼저 Read**:

| 도메인 | 필수 Read 파일 |
|-------|--------------|
| 상품 등록 | `.claude/commands/register.md` |
| 서안 등 어셈블러 지역 | `.claude/commands/assemble-product.md` |
| **관광지(attractions) 관리** | **`.claude/commands/manage-attractions.md`** |
| **등록 후 상품 검증** | **`.claude/commands/validate-product.md`** (원문 ↔ A4 ↔ 모바일 3자 대조) |
| **A4/모바일 렌더링 로직 추가·수정** | **`src/lib/render-contract.ts` 의 `renderPackage()` 출력에 추가** (렌더러는 `view.*` 만 소비, pkg 직접 파싱 금지 — ERR-KUL-05) |
| **DB 필드에 내용 넣기 전** | **`db/FIELD_POLICY.md`** — 고객 노출 vs 내부 필드 구분. 커미션/정산 메모는 special_notes 금지 (ERR-FUK-customer-leaks) |
| 예약 상태 변경 | `src/lib/booking-state-machine.ts` |

**이 강제 진입점을 무시하고 추측으로 진행하면 즉시 중단하십시오.**

### 🚨 프로세스 완수 메타 규칙 (ERR-process-violation)

사용자가 `/register` 또는 다른 절차 지시 시:
- **"INSERT 성공 = 완료" 아님.** `/register`의 모든 Step (0~7)을 끝까지 자동 실행.
- **Step 7 자동 감사(`post_register_audit.js`)는 MANDATORY.** 사용자에게 "나중에 직접 실행하세요" 안내 금지.
- **경고 발생 시 자동 수정 가능한 것은 DB UPDATE까지 실행** (예: 과거 출발일 필터, itinerary_data.meta 추가).
- **최종 보고는 항상 "한 화면" 리포트**로 출력 — 감사 결과, 수정 내역, 사용자가 해야 할 마지막 단계(어드민 승인) 포함.
- **예외: 사용자가 명시적으로 "INSERT만", "감사는 건너뛰어" 라고 지시한 경우만 스킵.**

---

## 1. 유틸리티 카탈로그 — "이미 있는 도구를 먼저 찾아라"

새 함수를 만들기 전에 아래 목록을 확인하세요. **80%의 작업은 기존 도구 조합으로 해결됩니다.**

### 핵심 유틸리티 (`src/lib/`)
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
| **🆕 A4/모바일 공통 렌더 계약 (CRC)** — 항공헤더·써차지 병합·쇼핑 출처·선택관광 | `renderPackage(pkg)` → `CanonicalView` | `render-contract.ts` |
| **🆕 IATA 코드 → 항공사명 (A4·모바일 통합)** | `getAirlineName(flightCode)` | `render-contract.ts` |
| **🆕 excludes 평탄화 (괄호·숫자콤마 보호)** | `flattenItems(items)` / `classifyExcludes(items)` | `render-contract.ts` |
| **Package 정규 Zod 스키마 (SSOT)** | `PackageCoreSchema` / `PackageStrictSchema` | `package-schema.ts` |
| **레거시 DB → 정규 변환 (Anti-Corruption Layer)** | `normalizePackage(raw)` / `normalizePhotos()` / `normalizeOptionalTours()` | `package-acl.ts` |
| **LLM Structured Output 스키마 변환** | `zodToGeminiSchema()` / `zodToClaudeSchema()` | `llm-structured-output.ts` |
| **LLM 호출 자동 재시도 (backoff)** | `withRetry(fn, { maxAttempts: 3 })` | `llm-retry.ts` |
| **🆕 LLM + Zod refine + feedback loop (instructor 패턴)** | `callWithZodValidation({ schema, fn })` / `parseWithValidation({ basePrompt, caller, schema })` | `llm-validate-retry.ts` |
| **🆕 CoVe claim-by-claim 검증 (post-audit E6, Gemini opt-in)** | `runCoVeAudit(pkg)` | `db/cove_audit.js` |
| **🆕 flight/city 활동 파서 (A4·Mobile 공통)** | `parseFlightActivity(act)` / `parseCityFromActivity(act)` / `formatFlightLabel(code)` | `render-contract.ts` |
| **🆕 API 필드 drift 감사 (ERR-20260418-10 재발 방지)** | `npm run audit:api-drift[:ci]` | `db/audit_api_field_drift.js` |
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

### 비즈니스 로직의 집 — `src/lib/`

파싱, 매칭, 계산, 정산 같은 **비즈니스 로직은 항상 `src/lib/` 안에 살아야 합니다.**
UI 컴포넌트(`.tsx`)는 이 모듈을 import해서 결과만 렌더링합니다.

```typescript
// 컴포넌트에서 로직을 사용하는 올바른 패턴
import { matchAttraction, normalizeDays } from '@/lib/attraction-matcher';
import { getEffectivePriceDates } from '@/lib/price-dates';

const days = normalizeDays(pkg.itinerary_data);
const attr = matchAttraction(item.activity, attractions, pkg.destination);
```

### 타입 정의의 집 — `src/types/`
| 타입 | 위치 | 용도 |
|---|---|---|
| `Product`, `ProductInsert`, `ProductPublic` | `database.ts` | 상품 CRUD |
| `BookingStatus`, `MessageEventType` | `booking-state-machine.ts` | 예약 상태 머신 |
| `AttractionData` | `attraction-matcher.ts` | 관광지 매칭 |
| `PriceDate`, `MonthGroup` | `price-dates.ts` | 가격/날짜 |
| `NotificationPayload` | `notification-adapter.ts` | 알림 발송 |

---

## 2. 레시피: DB 작업

### 2-1. 관계형 데이터는 UUID FK로 연결
랜드사, 출발지역, 상품명 등은 마스터 테이블(`land_operators`, `departing_locations`, `products`)의 UUID를 FK로 사용합니다.

### 2-2. 데이터 조회 — 안전한 패턴
```typescript
// 단건 조회: .limit(1) + 배열 접근 (0행이면 null)
const { data } = await supabaseAdmin
  .from('travel_packages')
  .select('id, title, destination')
  .eq('id', id)
  .limit(1);
const pkg = data?.[0] ?? null;

// 목록 조회: 페이지네이션 + 필터 체이닝
let query = supabaseAdmin
  .from('bookings')
  .select('*, customers!lead_customer_id(name, phone)', { count: 'exact' })
  .order('created_at', { ascending: false })
  .range(offset, offset + limit - 1);

if (status) query = query.eq('status', status);
const { data, count, error } = await query;
if (error) throw error;
```

**`.single()` 사용 가이드:** INSERT 후 반환값이 반드시 필요한 경우에만 `.select().single()`을 쓰되, **반드시 try/catch로 감싸세요.**

### 2-3. 소프트 삭제
데이터는 `DELETE`하지 않습니다. `is_active` boolean 토글을 사용합니다.
```typescript
await supabaseAdmin.from('land_operators').update({ is_active: false }).eq('id', id);
```

### 2-4. GENERATED 컬럼 주의
`products.selling_price`는 DB가 자동 계산합니다. INSERT/UPDATE에 포함하면 에러납니다.

### 2-5. 네이밍 컨벤션
| 영역 | 규칙 | 예시 |
|---|---|---|
| DB 컬럼 | `snake_case` | `ai_confidence_score`, `total_paid_out` |
| TS 변수 | `camelCase` | `aiConfidenceScore` |
| 컴포넌트 | `PascalCase` | `BookingDrawer` |
| 파일 (유틸) | `kebab-case.ts` | `payment-matcher.ts` |
| API 라우트 | `kebab-case/` | `/api/card-news` |

---

## 3. 레시피: API 라우트

### 3-1. 표준 API 라우트 템플릿
모든 API 라우트는 이 뼈대를 따릅니다:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ data: [] });

  try {
    const { searchParams } = request.nextUrl;
    // ... 파라미터 파싱 + 쿼리 실행
    const { data, error } = await supabaseAdmin.from('table').select('*');
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '처리 실패' },
      { status: 500 },
    );
  }
}
```

### 3-2. 공개 경로 관리
인증이 불필요한 경로는 `middleware.ts`의 `PUBLIC_PATHS`에 추가합니다.
새 공개 API를 만들 때 첫 번째로 할 일: **PUBLIC_PATHS에 추가**.

현재 공개 경로:
- 화면: `/`, `/packages`, `/blog`, `/concierge`, `/group-inquiry`, `/rfq`, `/tenant`, `/share`, `/influencer`
- API: `/api/cron/*`, `/api/slack-webhook`, `/api/notify/*`, `/api/tracking`, `/api/blog`, `/api/sms/receive`, `/api/qa/chat`

### 3-3. 멱등성
웹훅/크론은 동일 요청이 여러 번 와도 안전해야 합니다. `ON CONFLICT DO NOTHING`을 활용하세요.

---

## 4. 레시피: 프론트엔드

### 4-1. UX 원칙
- **인라인 에디트:** 리스트에서 셀 클릭 → 즉시 편집 가능 (별도 수정 페이지 불필요)
- **연쇄 자동완성:** SKU 입력 → 랜드사/출발지 자동 채움
- **낙관적 업데이트:** 화면 먼저 업데이트 → 백그라운드 API 호출 → 실패 시만 롤백 + 토스트

### 4-2. 서버 vs 클라이언트 컴포넌트
| 구분 | 판단 기준 | 라이브러리 사용 |
|---|---|---|
| 서버 컴포넌트 | `'use client'` 없음 | `isomorphic-dompurify`, Node.js API 가능 |
| 클라이언트 컴포넌트 | `'use client'` 있음 | `dompurify` (브라우저 전용만), `jsdom` 포함 패키지 사용 불가 |

### 4-3. HTML 렌더링 안전 패턴
`dangerouslySetInnerHTML` 사용 시 반드시 DOMPurify를 거칩니다:
```typescript
// 서버 컴포넌트
import DOMPurify from 'isomorphic-dompurify';
<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }} />

// 클라이언트 컴포넌트
import DOMPurify from 'dompurify';
<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }} />
```

마크다운이 포함될 수 있는 경우:
```typescript
import { marked } from 'marked';
const safeHtml = DOMPurify.sanitize(
  /<[a-z][\s\S]*>/i.test(rawText) ? rawText : marked.parse(rawText) as string
);
```

### 4-4. 고객 페이지 성능
고객이 보는 페이지에서 매 조회마다 API를 호출하는 useEffect는 서버사이드(SSR/ISR)로 옮겨주세요.
데이터 수집/분석 로직은 `page.tsx`(서버 컴포넌트)에서 ISR 빌드 시 1회만 실행합니다.

---

## 5. 레시피: 외부 API 연동

### 5-1. 순차 호출 패턴
Pexels, Meta, Solapi, Gemini 등 외부 API는 Rate Limit이 있습니다.
```typescript
// 여러 건 호출 시: 순차 + 딜레이
for (const item of items) {
  const result = await callExternalApi(item);
  results.push(result);
  await new Promise(r => setTimeout(r, 300)); // Rate Limit 방어
}
```

### 5-2. 실패 격리
외부 API 하나가 실패해도 전체가 멈추면 안 됩니다:
```typescript
// Pexels 이미지 실패 → 해당 슬라이드만 기본 이미지로 대체
try {
  const photo = await fetchPexels(query);
  slide.bgImage = photo.src.large;
} catch {
  slide.bgImage = '/default-travel.jpg'; // fallback
}
```

### 5-3. AI API 비용 관리
- Claude Max 구독 범위 내에서 작업합니다.
- Gemini/OpenAI 등 유료 API 호출 전에 예상 비용을 보고하고 승인을 받습니다.
- AI 키 미설정 시 dummy 콘텐츠를 반환합니다 (전체 파이프라인이 멈추면 안 됨).

---

## 6. 도메인 레시피: 예약 시스템

### 예약 상태 머신
상태 전이는 반드시 `booking-state-machine.ts`의 `ALLOWED_TRANSITIONS`를 통해서만 합니다.
```
pending → waiting_deposit → deposit_paid → waiting_balance → fully_paid
                                                              ↓
                                                          cancelled
```
모든 전이 시 `message_logs` 테이블에 이벤트를 기록합니다:
`DEPOSIT_NOTICE`, `DEPOSIT_CONFIRMED`, `BALANCE_NOTICE`, `BALANCE_CONFIRMED`, `CANCELLATION`

### 입금 매칭
`payment-matcher.ts`의 `matchPaymentToBookings()`를 사용합니다.
- `AUTO_THRESHOLD = 0.90` → 자동 매칭
- `REVIEW_THRESHOLD = 0.60` → 수동 확인
- 신한은행 SMS 파싱만 지원 (타 은행 오파싱 위험)

---

## 7. 도메인 레시피: 알림 시스템

알림은 **어댑터 패턴**으로 분리되어 있습니다:
```typescript
const adapter = getNotificationAdapter(); // 환경변수에 따라 자동 선택
// Solapi 키 있음 → KakaoNotificationAdapter (알림톡 + DB)
// Solapi 키 없음 → MockNotificationAdapter (DB만)
await adapter.send(payload);
```
카카오 알림톡이 실패해도 `message_logs` DB 기록은 반드시 보장됩니다.

---

## 8. 도메인 레시피: 마케팅 카피

### 고객에게 보이는 텍스트 규칙
- 원가/비용 수치는 노출하지 않습니다
- 랜드사명 대신 **"여소남"** 브랜드를 사용합니다
- 호텔명, 관광지, 항공사 등 구체적 셀링포인트를 1개 이상 포함합니다

### AI 콘텐츠 생성
- RFQ 무인 인터뷰: 4단계 (Interview → ProposalReview → FactBombing → Communication), Gemini 2.5 Flash 사용
- 외부 원문 데이터는 **그대로 보존** — AI가 요약/재구성하지 않습니다
- `attractions.long_desc`는 원문만 저장, 없으면 null

---

## 9. 플랫폼 확장성

### 멀티 테넌시 대비
- DB 쿼리에 `tenant_id` 필터를 확장할 수 있는 구조로 설계합니다
- RLS 정책: "자신의 회사 데이터만 볼 수 있는가?"를 기준으로 설계합니다
- API 응답은 예측 가능한 JSON 포맷을 유지합니다

---

## 10. 수정 작업 가이드

1. **요청받은 파일만 수정합니다.** 관련 파일을 건드려야 할 때는 영향 범위를 먼저 보고합니다.
2. **기존 코드의 문맥을 유지합니다.** 요청받은 기능만 정밀하게 추가/수정합니다.
3. **수정 후 변경된 파일 목록을 명시합니다.**
4. **확신이 없으면 먼저 질문합니다.**
5. **코드를 생략(`...`)하지 않습니다.** SQL, 컴포넌트 코드를 제공할 때 전체를 작성합니다.

---

## 11. Claude Code 토큰 효율 — 자동 최적화 규칙 (필수 준수)

> 이 섹션은 Claude Code 자신의 컨텍스트 창과 외부 AI API 비용을 자동으로 아끼는 규칙입니다.
> 매 세션 설정 없이 **항상** 아래 규칙을 따릅니다.

### 11-1. 탐색 위임 — 직접 스캔 금지 기준

| 상황 | 처리 방법 |
|------|---------|
| 파일 3개 이상 조회 | `Explore` 서브에이전트에 위임 (직접 Read 금지) |
| "이 기능이 구현됐는지 모름" | `Explore` 서브에이전트에 위임 |
| LLM 호출 패턴·API 라우트 전수조사 | `Explore` 서브에이전트에 위임 |
| 알고 있는 파일 1~2개 수정 | 직접 Read → Edit |
| 특정 심볼 1개 검색 | `Grep` 직접 사용 |

**금지**: 탐색 목적으로 5개 이상 파일을 내 컨텍스트에 직접 로드하는 행위.

### 11-2. 작업 복잡도별 접근 방식 자동 결정

```
단순 (파일 1~2개, 명확한 요구사항)
  → 직접 Read + Edit. Plan/Agent 불필요.

중간 (파일 3~5개 연관, 도메인 파악 필요)
  → Explore 에이전트로 파악 → 내가 직접 수정.

복잡 (멀티파일 설계 변경, 아키텍처 결정)
  → Plan 모드 진입 → 사용자 승인 → 실행.

병렬 독립 작업 (서로 의존성 없는 작업 2개+)
  → 단일 메시지에 Agent 여러 개 동시 실행.
```

### 11-3. 큰 파일 읽기 규칙

- 300줄 이상 파일: `offset + limit` 파라미터로 필요한 범위만 Read.
- 방금 Edit 한 파일: 다시 Read 하지 않음 (Edit 성공 = 반영됨).
- 서브에이전트 결과: 핵심 요약만 메인 컨텍스트에 가져옴 (전체 출력 X).

### 11-4. 외부 AI API 모델 선택 자동 기준

새 AI 호출 코드를 작성할 때 아래 기준을 자동 적용:

| 작업 | 모델 | 이유 |
|------|------|------|
| 라우팅·분류·메타 추출 | `claude-haiku-4-5-20251001` 또는 `gemini-2.5-flash` | 단순, 속도 우선 |
| 블로그·카드뉴스·카피 생성 | `gemini-2.5-flash` | 창작, 비용 우선 |
| 상품 정규화 (복잡) | `claude-sonnet-4-6` (Prompt Cache 필수) | 정확도, 규칙 복잡 |
| 환각 교차검증 | `gemini-2.5-flash` | 감사 전용, 저비용 |
| JARVIS 에이전트 루프 | `gemini-2.5-flash` executor + `gemini-2.5-pro` advisor (막힐 때 1회) | Advisor 패턴 |
| RAG 컨텍스트 생성·인덱싱 | `claude-haiku-4-5-20251001` + system cache | 반복 호출, 캐시 필수 |
| 고객 실시간 상담 | `gemini-3.1-flash-lite-preview` | 스트리밍, 최저비용 |

**절대 금지**: 단순 분류·추출·라우팅에 Sonnet/Pro 사용.
**신규 Claude 호출 시 필수**: `cache_control: { type: 'ephemeral' }` system + tools에 항상 적용.

### 11-5. llm-gateway.ts 사용 강제

`src/lib/` 에서 AI를 새로 호출할 때:
- `llmCall({ task: '...' })` 를 먼저 찾아 맞는 task 타입 있으면 재사용.
- 없으면 새 task 타입을 `llm-gateway.ts`의 `ROUTING` 테이블에 추가 후 사용.
- 직접 `new Anthropic()` / `new GoogleGenerativeAI()` 인스턴스 생성은 전문 모듈(normalize-with-llm, gemini-agent-loop-v2 등)에서만 허용.

### 11-6. 반복 허가 요청 자동 해결

아래 명령은 `.claude/settings.json` 에 이미 허가되어 있으므로 즉시 실행:
- `git status`, `git diff`, `git log` (읽기 전용 git)
- `node db/post_register_audit.js` (감사 스크립트)
- `npx tsc --noEmit` (타입 체크)
- `node -e "..."` (인라인 Node.js)

새 반복 패턴이 3회 이상 허가 요청되면: settings.json `permissions.allow` 에 추가 제안.

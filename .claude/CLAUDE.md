# 여소남 OS — AI 개발 하네스 (Harness Guide)

> 이 문서는 "하지 마라" 목록이 아니라 **"이렇게 해라" 레시피북**입니다.
> 올바른 경로를 따라가면 버그가 구조적으로 발생할 수 없습니다.

## 0. 당신의 역할
여소남 OS는 [랜드사 → 플랫폼(여소남) → 여행사/고객]을 연결하는 B2B2C 여행 SaaS 플랫폼입니다.
코드를 작성할 때 항상 '데이터 무결성', '제로 딜레이 UX', '멀티 테넌시 확장성'을 염두에 두십시오.

---

## 1. 유틸리티 카탈로그 — "이미 있는 도구를 먼저 찾아라"

새 함수를 만들기 전에 아래 목록을 확인하세요. **80%의 작업은 기존 도구 조합으로 해결됩니다.**

### 핵심 유틸리티 (`src/lib/`)
| 이런 작업이 필요하면 | 이 함수/모듈을 사용 | 위치 |
|---|---|---|
| DB 읽기/쓰기 | `supabaseAdmin.from('table')` | `supabase.ts` |
| DB 설정 여부 체크 | `isSupabaseConfigured` | `supabase.ts` |
| 관광지 매칭 | `matchAttraction(activity, attractions, destination)` | `attraction-matcher.ts` |
| itinerary 배열 추출 | `normalizeDays(pkg.itinerary_data)` | `attraction-matcher.ts` |
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

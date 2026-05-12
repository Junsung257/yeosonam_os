---
description: Supabase DB 작업 안전 패턴 — UUID FK·단건/목록 조회·소프트 삭제·GENERATED 컬럼 함정.
paths:
  - "src/lib/supabase.ts"
  - "src/app/api/**/*.ts"
  - "supabase/migrations/**/*"
  - "db/**/*.js"
  - "db/**/*.ts"
---

# 레시피: DB 작업 (Supabase)

## 1. 관계형 데이터는 UUID FK로 연결
랜드사·출발지역·상품명 등은 마스터 테이블(`land_operators`, `departing_locations`, `products`)의 UUID를 FK로 사용.

## 2. 데이터 조회 — 안전한 패턴
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

**`.single()` 사용 가이드**: INSERT 후 반환값이 반드시 필요한 경우에만 `.select().single()`을 쓰되, **반드시 try/catch로 감싸세요**.

## 3. 소프트 삭제
데이터는 `DELETE`하지 않습니다. `is_active` boolean 토글을 사용:
```typescript
await supabaseAdmin.from('land_operators').update({ is_active: false }).eq('id', id);
```

## 4. GENERATED 컬럼 주의
`products.selling_price`는 DB가 자동 계산. INSERT/UPDATE에 포함하면 에러.

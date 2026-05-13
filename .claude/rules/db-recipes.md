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

## 5. RLS 정책 — 사일런트 실패 방지 (2026-05-13)

신규 테이블을 `CREATE TABLE` + `ENABLE ROW LEVEL SECURITY` 할 때 **정책을 깜빡하면 사일런트 차단 폭탄**이 됩니다. `destination_climate` 회귀(2026-05-13): RLS ON + 정책 0개 → service_role은 통과하지만 anon fallback 시 row 0개 반환 → 모바일 페이지에 시차·날씨 카드 0개 표시.

### 신규 테이블 RLS 체크리스트

1. **이 테이블은 공개 페이지(`page.tsx` 서버 컴포넌트)에서 anon으로 SELECT되는가?**
   - YES → `CREATE POLICY "Anyone can read X" ON X FOR SELECT TO anon, authenticated USING (true);`
   - NO → 정책 없이 RLS ON 유지 (PostgreSQL default deny로 anon 차단됨)

2. **client component(`'use client'`)에서 직접 `from('X')` 호출되는가?**
   - YES → anon 정책 필요. 또는 API 라우트(`supabaseAdmin`) 경유로 변경.

3. **API 라우트만 `supabaseAdmin`으로 조회하는가?**
   - YES → 정책 없이도 안전. `supabaseAdmin`은 service_role 키로 RLS 우회.

### 폭탄 발굴 SQL (재발 의심 시)
```sql
SELECT c.relname, COUNT(p.policyname) as policies
FROM pg_class c
LEFT JOIN pg_policies p ON p.tablename = c.relname AND p.schemaname = 'public'
WHERE c.relkind = 'r' AND c.relnamespace = 'public'::regnamespace
  AND c.relrowsecurity = true
GROUP BY c.relname
HAVING COUNT(p.policyname) = 0;
```

### 핵심: `supabaseAdmin` fallback 위험
`src/lib/supabase.ts:71` `getSupabaseAdmin()`은 service_role 키 미설정 시 **anon 키로 fallback**. .env 누락 + RLS 정책 0개 조합이 가장 위험. 신규 환경 구축 시 `SUPABASE_SERVICE_ROLE_KEY` 필수 체크.

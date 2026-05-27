-- ============================================================
-- 여소남 OS — Supabase RLS 보안 강화 마이그레이션 v1
-- Supabase Dashboard > SQL Editor 에서 실행하세요.
--
-- 수정 내용:
--   1. Security Definer View 2건 → Security Invoker 전환
--   2. RLS 미적용 테이블 40건 → RLS 활성화 + authenticated 정책 추가
--   3. Sensitive Columns Exposed → RLS 활성화로 자동 해소
--
-- ✅ 멱등성 보장 — 이미 실행한 환경에서 재실행해도 안전합니다.
-- ⚠️  service_role(supabaseAdmin)은 RLS를 항상 우회하므로
--     기존 API routes 동작에 영향 없습니다.
-- ============================================================

-- ── Step 1: Security Definer Views → Security Invoker ────────────────────────
-- Postgres 15+에서 지원하는 security_invoker 옵션으로 전환.
-- 뷰 조회자의 권한·RLS 정책이 적용되어 SECURITY DEFINER 우회 차단.

ALTER VIEW IF EXISTS public.booking_settlement       SET (security_invoker = on);
ALTER VIEW IF EXISTS public.customer_mileage_balances SET (security_invoker = on);

-- ── Step 2: 40개 테이블 RLS 활성화 + authenticated 정책 생성 ─────────────────
-- 패턴:
--   · ENABLE ROW LEVEL SECURITY  — anon 키를 통한 직접 쿼리 차단
--   · DROP POLICY IF EXISTS       — 멱등성 확보
--   · CREATE POLICY "authenticated_access" FOR ALL TO authenticated
--       USING (true) WITH CHECK (true)
--       → authenticated(로그인) 사용자는 제한 없이 접근 허용
--       → 기존 RLS 테이블(bank_transactions, customers 등)과 동일한 패턴

DO $rls_block$
DECLARE
  tbl TEXT;
  tables TEXT[] := ARRAY[
    -- 핵심 비즈니스
    'bookings',
    'tenants',
    'transactions',
    'vouchers',
    'carts',
    -- 광고 / 마케팅
    'ad_engagement_logs',
    'ad_search_logs',
    'ad_traffic_logs',
    'ad_conversion_logs',
    'ad_accounts',
    'keyword_performances',
    -- 상품 / 패키지
    'travel_packages',
    'raw_documents',
    'parsed_packages',
    'package_pricings',
    'surcharge_dates',
    'airline_exclusions',
    'inventory_blocks',
    -- 파트너 / 제휴
    'partners',
    'partner_sales',
    -- RFQ / 단체 견적
    'group_rfqs',
    'rfq_bids',
    'rfq_proposals',
    'rfq_messages',
    -- 고객 여정
    'booking_passengers',
    'shared_itineraries',
    'capital_entries',
    'external_bookings',
    'secure_chats',
    'mileage_transactions',
    -- 시스템 / 설정
    'app_settings',
    'margin_settings',
    'mock_api_configs',
    -- AI / QA
    'qa_inquiries',
    'ai_responses',
    'message_logs',
    'api_orders'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    -- 테이블 존재 여부 확인 후 처리 (존재하지 않으면 건너뜀)
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      -- RLS 활성화
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);

      -- 기존 동명 정책 제거 (멱등성)
      EXECUTE format(
        'DROP POLICY IF EXISTS "authenticated_access" ON public.%I', tbl
      );

      -- authenticated 사용자에게 전체 접근 허용 (기존 RLS 테이블과 동일 패턴)
      EXECUTE format(
        $policy$
          CREATE POLICY "authenticated_access"
            ON public.%I
            FOR ALL
            TO authenticated
            USING (true)
            WITH CHECK (true)
        $policy$,
        tbl
      );

      RAISE NOTICE '[RLS 완료] %', tbl;
    ELSE
      RAISE NOTICE '[SKIP] 테이블 없음: %', tbl;
    END IF;
  END LOOP;
END
$rls_block$;

-- ── Step 3: 검증 쿼리 ────────────────────────────────────────────────────────
-- 실행 후 아래 결과를 확인하세요:
--   rowsecurity = true 이고 policyname = 'authenticated_access' 가 있어야 함

SELECT
  t.tablename,
  t.rowsecurity,
  p.policyname,
  p.roles,
  p.cmd
FROM pg_tables t
LEFT JOIN pg_policies p
  ON p.tablename = t.tablename
 AND p.schemaname = 'public'
 AND p.policyname = 'authenticated_access'
WHERE t.schemaname = 'public'
  AND t.tablename = ANY(ARRAY[
    'bookings', 'tenants', 'transactions', 'vouchers', 'carts',
    'mileage_transactions', 'booking_passengers', 'secure_chats',
    'travel_packages', 'partners', 'group_rfqs', 'qa_inquiries',
    'app_settings', 'ad_accounts', 'api_orders'
  ])
ORDER BY t.tablename;

-- ── View 검증 ────────────────────────────────────────────────────────────────
-- security_invoker = on 이어야 합니다.
-- reloptions 컬럼에 'security_invoker=on' 이 포함돼 있어야 성공.

SELECT
  c.relname AS viewname,
  c.reloptions
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('booking_settlement', 'customer_mileage_balances')
  AND c.relkind = 'v';

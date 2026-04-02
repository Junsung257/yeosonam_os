-- ============================================================
-- 여소남 OS: 추천 시스템 V1 (간단한 협업 필터링)
-- Migration: 20260401180000
--
-- 함수:
--   get_trending_packages() — 최근 인기 상품 (폴백용)
--   get_simple_recommendations(customer_id) — 유사 고객 기반 추천
--   get_personalized_by_destination(customer_id, destination) — 목적지 기반 개인화
--
-- 테이블:
--   recommendation_logs — 추천 A/B 테스트 로그
--
-- pg_cron:
--   매일 02:00 UTC RFM 자동 계산
--
-- 수정사항 (사용자 SQL 대비):
--   - cup.rfm_recency_score → rfm_r (실제 컬럼명)
--   - cup.rfm_frequency_score → rfm_f
--   - b.customer_id → b.lead_customer_id
--   - tp.name → tp.title (실제 컬럼명)
--   - b.status = 'confirmed' → 실제 상태머신 값
--   - tp.status = 'active' → IN ('active','approved')
--   - tp.price → INTEGER (DECIMAL 아님)
--   - cron.unschedule 호출 추가 (중복 방지)
-- ============================================================

BEGIN;

-- ============================================================
-- 1. 트렌딩 상품 (폴백용, 먼저 정의)
-- ============================================================
CREATE OR REPLACE FUNCTION get_trending_packages()
RETURNS TABLE(
  package_id UUID,
  package_name TEXT,
  destination TEXT,
  price INTEGER,
  score NUMERIC,
  reason TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    tp.id,
    tp.title,
    tp.destination,
    tp.price,
    (COALESCE(tp.view_count, 0)::NUMERIC / 100.0 +
     COUNT(DISTINCT b.id)::NUMERIC * 2) AS score,
    '최근 인기 상품'::TEXT AS reason
  FROM travel_packages tp
  LEFT JOIN bookings b ON tp.id = b.package_id
    AND b.created_at > NOW() - INTERVAL '30 days'
    AND b.status IN ('deposit_paid','waiting_balance','fully_paid','confirmed','completed')
    AND b.is_deleted = false
  WHERE tp.status IN ('active','approved')
  GROUP BY tp.id, tp.title, tp.destination, tp.price, tp.view_count
  ORDER BY score DESC
  LIMIT 20;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 2. 유사 고객 기반 추천
-- ============================================================
CREATE OR REPLACE FUNCTION get_simple_recommendations(p_customer_id UUID DEFAULT NULL)
RETURNS TABLE(
  package_id UUID,
  package_name TEXT,
  destination TEXT,
  price INTEGER,
  score NUMERIC,
  reason TEXT
) AS $$
BEGIN
  IF p_customer_id IS NOT NULL THEN
    RETURN QUERY
    WITH similar_customers AS (
      SELECT cup2.customer_id AS id
      FROM customer_unified_profile cup1
      JOIN customer_unified_profile cup2 ON
        ABS(COALESCE(cup1.rfm_r, 3) - COALESCE(cup2.rfm_r, 3)) <= 1
        AND ABS(COALESCE(cup1.rfm_f, 3) - COALESCE(cup2.rfm_f, 3)) <= 1
        AND cup2.customer_id != p_customer_id
      WHERE cup1.customer_id = p_customer_id
      LIMIT 100
    ),
    popular_among_similar AS (
      SELECT
        tp.id,
        tp.title,
        tp.destination,
        tp.price,
        COUNT(DISTINCT b.id) AS booking_count
      FROM similar_customers sc
      JOIN bookings b ON sc.id = b.lead_customer_id
      JOIN travel_packages tp ON b.package_id = tp.id
      WHERE b.status IN ('deposit_paid','waiting_balance','fully_paid','confirmed','completed')
        AND b.is_deleted = false
        AND tp.status IN ('active','approved')
      GROUP BY tp.id, tp.title, tp.destination, tp.price
      ORDER BY booking_count DESC
      LIMIT 10
    )
    SELECT
      p.id,
      p.title,
      p.destination,
      p.price,
      (p.booking_count::NUMERIC / 10.0),
      '유사 고객이 선택한 상품'::TEXT
    FROM popular_among_similar p;

    -- 결과 없으면 트렌딩으로 폴백
    IF NOT FOUND THEN
      RETURN QUERY
      SELECT * FROM get_trending_packages();
    END IF;
  ELSE
    RETURN QUERY
    SELECT * FROM get_trending_packages();
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 3. 목적지 기반 개인화 추천
-- ============================================================
CREATE OR REPLACE FUNCTION get_personalized_by_destination(
  p_customer_id UUID,
  p_destination TEXT
)
RETURNS TABLE(
  package_id UUID,
  package_name TEXT,
  destination TEXT,
  price INTEGER,
  score NUMERIC,
  reason TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    tp.id,
    tp.title,
    tp.destination,
    tp.price,
    (COALESCE(tp.view_count, 0)::NUMERIC / 50.0 +
     COUNT(DISTINCT b.id)::NUMERIC * 3) AS score,
    format('%s 인기 상품', p_destination)::TEXT AS reason
  FROM travel_packages tp
  LEFT JOIN bookings b ON tp.id = b.package_id
    AND b.created_at > NOW() - INTERVAL '90 days'
    AND b.status IN ('deposit_paid','waiting_balance','fully_paid','confirmed','completed')
    AND b.is_deleted = false
  WHERE tp.destination ILIKE '%' || p_destination || '%'
    AND tp.status IN ('active','approved')
  GROUP BY tp.id, tp.title, tp.destination, tp.price, tp.view_count
  ORDER BY score DESC
  LIMIT 10;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 4. 추천 로그 (A/B 테스트)
-- ============================================================
CREATE TABLE IF NOT EXISTS recommendation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  recommended_packages UUID[] DEFAULT '{}',
  algorithm TEXT CHECK (algorithm IN ('similar_customers','trending','personalized','hybrid')),
  clicked_package_id UUID REFERENCES travel_packages(id) ON DELETE SET NULL,
  converted BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rec_logs_session ON recommendation_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_rec_logs_customer ON recommendation_logs(customer_id);
CREATE INDEX IF NOT EXISTS idx_rec_logs_algorithm ON recommendation_logs(algorithm);
CREATE INDEX IF NOT EXISTS idx_rec_logs_converted ON recommendation_logs(converted) WHERE converted = true;

COMMENT ON TABLE recommendation_logs IS '추천 알고리즘 성과 측정용 로그 (A/B 테스트)';

-- RLS
ALTER TABLE recommendation_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_access" ON recommendation_logs;
CREATE POLICY "authenticated_access" ON recommendation_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMIT;

-- ============================================================
-- 5. pg_cron: RFM 매일 자동 계산 (트랜잭션 외부)
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- 기존 스케줄 정리
    PERFORM cron.unschedule('calculate-rfm-daily');
    PERFORM cron.unschedule('weekly-rfm-calculation');

    -- 매일 02:00 UTC (11:00 KST)
    PERFORM cron.schedule(
      'calculate-rfm-daily',
      '0 2 * * *',
      'SELECT calculate_rfm_scores()'
    );
  ELSE
    RAISE NOTICE 'pg_cron 미활성 — 수동 실행: SELECT calculate_rfm_scores()';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron 스케줄 실패 (무시): %', SQLERRM;
END $$;

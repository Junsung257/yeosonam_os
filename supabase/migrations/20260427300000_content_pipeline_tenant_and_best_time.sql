-- ============================================================
-- 콘텐츠 파이프라인 멀티테넌트 보강 + Best Time to Post
-- 마이그레이션: 20260427300000
-- ============================================================
-- 목적
-- 1) content_distributions / blog_topic_queue 에 tenant_id (NULL=여소남 본사)
-- 2) post_engagement_snapshots 기반 best_publish_slots view
--    → 시간대별 평균 engagement 로 발행 시각 동적 결정 (Buffer "Best Time" 자체 구현)
-- 3) recommend_publish_slot() RPC — 추천 발행 시각 1건 반환
-- 4) Programmatic SEO 인덱스 (attractions/destination, packages/destination)
-- ============================================================

BEGIN;

-- ── 1) 멀티테넌트 컬럼 ───────────────────────────────────
ALTER TABLE content_distributions
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_cd_tenant ON content_distributions(tenant_id);
COMMENT ON COLUMN content_distributions.tenant_id IS '테넌트 격리. NULL=여소남 본사';

ALTER TABLE blog_topic_queue
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_btq_tenant ON blog_topic_queue(tenant_id);
COMMENT ON COLUMN blog_topic_queue.tenant_id IS '테넌트 격리. NULL=여소남 본사';

-- ── 2) Best Time to Post view ───────────────────────────
-- 발행 후 첫 24h 내 첫 snapshot 의 가중 engagement 로 시간대 점수 산출
-- (likes + comments*3 + shares*5 + saves*4)
CREATE OR REPLACE VIEW best_publish_slots AS
WITH first_snapshots AS (
  SELECT
    pes.platform,
    pes.external_id,
    pes.tenant_id,
    pes.captured_at,
    COALESCE(pes.likes, 0)
      + COALESCE(pes.comments, 0) * 3
      + COALESCE(pes.shares, 0) * 5
      + COALESCE(pes.saves, 0) * 4 AS engagement_total,
    COALESCE(pes.reach, 0) AS reach,
    MIN(pes.captured_at) OVER (PARTITION BY pes.platform, pes.external_id) AS first_seen_at
  FROM post_engagement_snapshots pes
  WHERE pes.captured_at >= now() - INTERVAL '90 days'
),
publish_hour_scores AS (
  SELECT
    platform,
    tenant_id,
    EXTRACT(DOW FROM first_seen_at AT TIME ZONE 'Asia/Seoul')::INT AS dow,
    EXTRACT(HOUR FROM first_seen_at AT TIME ZONE 'Asia/Seoul')::INT AS hour,
    AVG(engagement_total)::NUMERIC(10,2) AS avg_engagement,
    AVG(NULLIF(reach, 0))::NUMERIC(10,2) AS avg_reach,
    COUNT(DISTINCT external_id) AS sample_count
  FROM first_snapshots
  WHERE captured_at = first_seen_at
  GROUP BY platform, tenant_id, dow, hour
)
SELECT
  platform,
  tenant_id,
  dow,
  hour,
  avg_engagement,
  avg_reach,
  sample_count,
  CASE
    WHEN sample_count >= 5 THEN avg_engagement
    ELSE avg_engagement * (sample_count::NUMERIC / 5)
  END AS confidence_adjusted_score
FROM publish_hour_scores;

COMMENT ON VIEW best_publish_slots IS
  '플랫폼·요일·시간대별 평균 engagement. 발행 시각 동적 결정. tenant_id 격리.';

-- ── 3) 추천 발행 시각 RPC ───────────────────────────────
CREATE OR REPLACE FUNCTION recommend_publish_slot(
  p_platform TEXT,
  p_tenant_id UUID DEFAULT NULL,
  p_after TIMESTAMPTZ DEFAULT now(),
  p_horizon_hours INT DEFAULT 72
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_slot TIMESTAMPTZ;
BEGIN
  WITH candidates AS (
    SELECT
      (date_trunc('hour', p_after AT TIME ZONE 'Asia/Seoul') + (n || ' hours')::INTERVAL)
        AT TIME ZONE 'Asia/Seoul' AS candidate_at
    FROM generate_series(1, p_horizon_hours) AS n
  ),
  scored AS (
    SELECT
      c.candidate_at,
      COALESCE(b.confidence_adjusted_score, 0) AS score,
      COALESCE(b.sample_count, 0) AS samples
    FROM candidates c
    LEFT JOIN best_publish_slots b
      ON b.platform = p_platform
     AND (b.tenant_id IS NOT DISTINCT FROM p_tenant_id)
     AND b.dow = EXTRACT(DOW FROM c.candidate_at AT TIME ZONE 'Asia/Seoul')::INT
     AND b.hour = EXTRACT(HOUR FROM c.candidate_at AT TIME ZONE 'Asia/Seoul')::INT
  )
  SELECT candidate_at INTO v_slot
  FROM scored
  WHERE samples >= 3
  ORDER BY score DESC, candidate_at ASC
  LIMIT 1;

  -- 데이터 부족 → 다음 평일 19시 KST 기본
  IF v_slot IS NULL THEN
    v_slot := (date_trunc('day', p_after AT TIME ZONE 'Asia/Seoul') + INTERVAL '1 day' + INTERVAL '19 hours');
    WHILE EXTRACT(DOW FROM v_slot)::INT IN (0, 6) LOOP
      v_slot := v_slot + INTERVAL '1 day';
    END LOOP;
    v_slot := v_slot AT TIME ZONE 'Asia/Seoul';
  END IF;

  RETURN v_slot;
END $$;

COMMENT ON FUNCTION recommend_publish_slot IS
  '플랫폼별 최적 발행 시각. engagement 시계열 기반. 데이터 부족 시 평일 19시 KST 기본';

-- ── 4) Programmatic SEO 인덱스 ──────────────────────────
-- attractions 는 destination/deleted_at 컬럼 없음. region/category 사용 (실 스키마)
CREATE INDEX IF NOT EXISTS idx_attractions_region_category
  ON attractions(region, category);

-- travel_packages 는 is_active 없음. status='approved'|'active' 가 노출 조건 (실 스키마)
CREATE INDEX IF NOT EXISTS idx_packages_destination_status
  ON travel_packages(destination, status);

COMMIT;

NOTIFY pgrst, 'reload schema';

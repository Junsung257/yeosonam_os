-- ============================================================
-- Blog Featured + Pillar v1 (2026-04-22)
-- Phase A+B 지원: featured 선정 / content_type / pillar / 평점 캐시
-- ============================================================

-- 1) content_creatives 확장
ALTER TABLE content_creatives
  ADD COLUMN IF NOT EXISTS featured            BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS featured_order      INTEGER,                   -- 1=최우선
  ADD COLUMN IF NOT EXISTS content_type        TEXT   DEFAULT 'guide',    -- guide | tip | review | package_intro | pillar
  ADD COLUMN IF NOT EXISTS pillar_for          TEXT;                      -- destination pillar인 경우 도시명 (NULL = 일반 글)

CREATE INDEX IF NOT EXISTS idx_cc_featured ON content_creatives(featured, featured_order) WHERE featured = TRUE;
CREATE INDEX IF NOT EXISTS idx_cc_content_type ON content_creatives(content_type);
CREATE INDEX IF NOT EXISTS idx_cc_pillar_for ON content_creatives(pillar_for) WHERE pillar_for IS NOT NULL;

-- 2) blog_topic_queue 에 pillar source 허용
ALTER TABLE blog_topic_queue DROP CONSTRAINT IF EXISTS blog_topic_queue_source_check;
ALTER TABLE blog_topic_queue ADD CONSTRAINT blog_topic_queue_source_check
  CHECK (source IN ('seasonal','coverage_gap','user_seed','product','card_news','pillar'));

-- 3) travel_packages 평점 캐시 (aggregateRating Schema 용)
ALTER TABLE travel_packages
  ADD COLUMN IF NOT EXISTS avg_rating    NUMERIC(3,2),
  ADD COLUMN IF NOT EXISTS review_count  INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_tp_avg_rating ON travel_packages(avg_rating) WHERE avg_rating IS NOT NULL;

-- 4) 활성 destination 집계 뷰 (/destinations 허브 + 홈 TOP 4 에서 사용)
CREATE OR REPLACE VIEW active_destinations AS
SELECT
  destination,
  COUNT(*) FILTER (WHERE status IN ('approved','active')) AS package_count,
  AVG(avg_rating) FILTER (WHERE avg_rating IS NOT NULL) AS avg_rating,
  SUM(review_count) AS total_reviews,
  MIN(price) AS min_price
FROM travel_packages
WHERE destination IS NOT NULL AND status IN ('approved','active')
GROUP BY destination
HAVING COUNT(*) > 0;

-- 5) 리뷰 제출/승인 시 호출 — avg_rating + review_count 캐시 갱신
CREATE OR REPLACE FUNCTION refresh_package_rating(p_package_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE travel_packages
  SET
    avg_rating = (
      SELECT ROUND(AVG(overall_rating)::numeric, 2)
      FROM post_trip_reviews
      WHERE booking_id IN (SELECT id FROM bookings WHERE product_id = p_package_id)
        AND overall_rating IS NOT NULL
    ),
    review_count = (
      SELECT COUNT(*)
      FROM post_trip_reviews
      WHERE booking_id IN (SELECT id FROM bookings WHERE product_id = p_package_id)
    )
  WHERE id = p_package_id;
END;
$$ LANGUAGE plpgsql;

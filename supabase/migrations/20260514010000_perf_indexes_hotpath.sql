-- ============================================================================
-- 핫패스 복합 인덱스 추가 (2026-05-11 audit 결과)
--
-- 기존 마이그레이션 (20260505_query_optimization_indexes, 20260512_travel_packages_indexes,
-- 20260512_hot_table_composite_indexes) 에 이미 박혀 있는 단일/2-컬럼 인덱스는 건드리지 않는다.
-- 본 마이그레이션은 DB 감사에서 식별된 "복합 3-컬럼" 또는 "정렬 포함" 누락분만 박제.
--
-- IF NOT EXISTS 로 idempotent. 모든 인덱스가 적당히 작은 테이블 가정 (수십만 건 이하)
-- → 트랜잭션 안에서 일반 CREATE INDEX 가능. 향후 100만 건 넘으면 CONCURRENTLY 별도 PR.
-- ============================================================================

-- 1) content_distributions: 중복 체크 (product × platform × status) 빈번 — generate-all 라우트
CREATE INDEX IF NOT EXISTS idx_cd_product_platform_status
  ON content_distributions(product_id, platform, status);

-- 2) recommendation_logs: 세션·고객·시간 결합 — /api/recommendations POST 에서 직전 N개 조회
CREATE INDEX IF NOT EXISTS idx_rec_logs_session_customer_created
  ON recommendation_logs(session_id, customer_id, created_at DESC);

-- 3) post_trip_reviews: 상품별 노출 리뷰 정렬 — /packages/[id] 상세에서 자주 호출
CREATE INDEX IF NOT EXISTS idx_post_trip_reviews_package_status_created
  ON post_trip_reviews(package_id, status, created_at DESC);

-- 4) customer_notes: 고객 상세에서 노트 시간순 — 인덱스 부재
-- 테이블이 존재할 때만 박제 (일부 환경에서 컬럼명 다를 수 있어 안전 가드)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'customer_notes'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'customer_notes' AND column_name = 'customer_id'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'customer_notes' AND column_name = 'created_at'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_customer_notes_customer_created
             ON customer_notes(customer_id, created_at DESC)';
  END IF;
END $$;

-- 5) content_creatives: status × channel × product — 분석/배포 라우트 빈번
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'content_creatives'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'content_creatives' AND column_name = 'channel'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_content_creatives_status_channel_product
             ON content_creatives(status, channel, product_id)';
  END IF;
END $$;

-- 6) card_news: 발행 큐 — status × created_at (tenant 분리 없는 단순 큐 조회 가속)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'card_news'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'card_news' AND column_name = 'status'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_card_news_status_created
             ON card_news(status, created_at DESC)';
  END IF;
END $$;

COMMENT ON INDEX idx_cd_product_platform_status IS
  '2026-05-11 perf audit: content/generate-all 중복 체크 가속';
COMMENT ON INDEX idx_rec_logs_session_customer_created IS
  '2026-05-11 perf audit: /api/recommendations POST 직전 N개 조회 가속';
COMMENT ON INDEX idx_post_trip_reviews_package_status_created IS
  '2026-05-11 perf audit: /packages/[id] 노출 리뷰 정렬 가속';

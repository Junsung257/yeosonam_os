-- ============================================================
-- Blog SEO v5 missing schemas — PR-A 박제
--   v3·v4·v5 메모리에는 박제됐으나 실제 마이그레이션이 부재했던
--   7개 테이블/제약을 한 번에 정합화한다. 코드는 fallback으로 가동 중.
--
-- 포함:
--   1. content_creatives.slug UNIQUE 보장 (FK 가능하게)
--   2. publishing_policies — 발행 정책 (어드민 조절)
--   3. topical_clusters — Pillar↔Cluster 매핑 (PostgREST !cluster_slug join)
--   4. programmatic_seo_topics — destination × angle × month 매트릭스
--   5. rank_history — GSC 일일 순위 누적
--   6. rank_alerts — 5계단 이상 하락 경보
--   7. inp_measurements — Core Web Vitals INP 모니터링 (PR-D)
--   8. package_review_digests — 리뷰 1줄 요약 캐싱 (PR-F)
-- ============================================================

BEGIN;

-- ─── 1) content_creatives.slug UNIQUE (FK 대상) ──────────
-- 주의: 부분 unique index 는 FK 참조 대상 자격이 없음.
-- PostgreSQL 의 일반 UNIQUE 는 NULL 값을 distinct 로 취급하므로 다수 NULL 허용 → 안전.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'content_creatives'
      AND indexname = 'content_creatives_slug_unique'
  ) THEN
    CREATE UNIQUE INDEX content_creatives_slug_unique
      ON content_creatives(slug);
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'content_creatives.slug unique skip: %', SQLERRM;
END$$;

-- ─── 2) publishing_policies ────────────────────────────────────
CREATE TABLE IF NOT EXISTS publishing_policies (
  scope                            TEXT PRIMARY KEY,
  enabled                          BOOLEAN NOT NULL DEFAULT TRUE,
  posts_per_day                    INT     NOT NULL DEFAULT 8,
  per_destination_daily_cap        INT     NOT NULL DEFAULT 2,
  slot_times                       TEXT[]  NOT NULL DEFAULT ARRAY['08:00','10:00','12:00','14:00','16:00','18:00','20:00','22:00'],
  product_ratio                    NUMERIC(3,2) NOT NULL DEFAULT 0.40,
  multi_angle_count                INT     NOT NULL DEFAULT 5,
  multi_angle_gap_days             INT     NOT NULL DEFAULT 3,
  auto_trigger_card_news           BOOLEAN NOT NULL DEFAULT FALSE,
  auto_trigger_orchestrator        BOOLEAN NOT NULL DEFAULT FALSE,
  auto_regenerate_underperformers  BOOLEAN NOT NULL DEFAULT TRUE,
  daily_summary_webhook            TEXT,
  meta                             JSONB   NOT NULL DEFAULT '{}'::jsonb,
  created_at                       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO publishing_policies (scope) VALUES ('global')
ON CONFLICT (scope) DO NOTHING;

ALTER TABLE publishing_policies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "publishing_policies service" ON publishing_policies;
CREATE POLICY "publishing_policies service" ON publishing_policies
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─── 3) topical_clusters ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS topical_clusters (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pillar_slug     TEXT NOT NULL,
  cluster_slug    TEXT NOT NULL,
  destination     TEXT,
  relation_type   TEXT NOT NULL DEFAULT 'related',
  rank            INT  NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT topical_clusters_unique UNIQUE (pillar_slug, cluster_slug)
);

-- FK: PostgREST embedding 'content_creatives!cluster_slug(...)' 의존
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'topical_clusters_cluster_slug_fk'
  ) THEN
    ALTER TABLE topical_clusters
      ADD CONSTRAINT topical_clusters_cluster_slug_fk
      FOREIGN KEY (cluster_slug)
      REFERENCES content_creatives(slug)
      ON DELETE CASCADE
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'topical_clusters FK skip: %', SQLERRM;
END$$;

CREATE INDEX IF NOT EXISTS idx_topical_clusters_pillar  ON topical_clusters(pillar_slug);
CREATE INDEX IF NOT EXISTS idx_topical_clusters_cluster ON topical_clusters(cluster_slug);
CREATE INDEX IF NOT EXISTS idx_topical_clusters_dest    ON topical_clusters(destination);

ALTER TABLE topical_clusters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "topical_clusters service" ON topical_clusters;
CREATE POLICY "topical_clusters service" ON topical_clusters
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "topical_clusters read" ON topical_clusters;
CREATE POLICY "topical_clusters read" ON topical_clusters
  FOR SELECT USING (true);

-- ─── 4) programmatic_seo_topics ────────────────────────────────
CREATE TABLE IF NOT EXISTS programmatic_seo_topics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  destination     TEXT NOT NULL,
  angle           TEXT NOT NULL,
  month           INT,
  topic_template  TEXT NOT NULL,
  primary_keyword TEXT NOT NULL,
  expected_tier   TEXT,
  priority        INT  NOT NULL DEFAULT 50,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','queued','skipped','published','dropped')),
  topic_queue_id  UUID,
  promoted_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- NULL-safe UNIQUE: month IS NULL인 행도 destination+angle 단위 1개로 제한
CREATE UNIQUE INDEX IF NOT EXISTS programmatic_seo_topics_uniq
  ON programmatic_seo_topics (destination, angle, COALESCE(month, -1));

CREATE INDEX IF NOT EXISTS idx_pseo_status   ON programmatic_seo_topics(status);
CREATE INDEX IF NOT EXISTS idx_pseo_priority ON programmatic_seo_topics(priority DESC);
CREATE INDEX IF NOT EXISTS idx_pseo_dest     ON programmatic_seo_topics(destination);

ALTER TABLE programmatic_seo_topics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pseo service" ON programmatic_seo_topics;
CREATE POLICY "pseo service" ON programmatic_seo_topics
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─── 5) rank_history ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rank_history (
  id           BIGSERIAL PRIMARY KEY,
  slug         TEXT NOT NULL,
  query        TEXT NOT NULL,
  date         DATE NOT NULL,
  position     NUMERIC(6,2),
  impressions  INT  NOT NULL DEFAULT 0,
  clicks       INT  NOT NULL DEFAULT 0,
  ctr          NUMERIC(5,4),
  page_url     TEXT,
  source       TEXT NOT NULL DEFAULT 'gsc',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT rank_history_unique UNIQUE (slug, query, date, source)
);

CREATE INDEX IF NOT EXISTS idx_rank_history_slug  ON rank_history(slug);
CREATE INDEX IF NOT EXISTS idx_rank_history_date  ON rank_history(date DESC);
CREATE INDEX IF NOT EXISTS idx_rank_history_query ON rank_history(query);

ALTER TABLE rank_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rank_history service" ON rank_history;
CREATE POLICY "rank_history service" ON rank_history
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─── 6) rank_alerts ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rank_alerts (
  id            BIGSERIAL PRIMARY KEY,
  slug          TEXT NOT NULL,
  query         TEXT NOT NULL,
  prev_position NUMERIC(6,2),
  curr_position NUMERIC(6,2),
  delta         NUMERIC(6,2),
  meta          JSONB NOT NULL DEFAULT '{}'::jsonb,
  detected_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_rank_alerts_unresolved
  ON rank_alerts(detected_at DESC) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_rank_alerts_slug ON rank_alerts(slug);

ALTER TABLE rank_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rank_alerts service" ON rank_alerts;
CREATE POLICY "rank_alerts service" ON rank_alerts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─── 7) inp_measurements (PR-D) ────────────────────────────────
CREATE TABLE IF NOT EXISTS inp_measurements (
  id                BIGSERIAL PRIMARY KEY,
  url               TEXT NOT NULL,
  device            TEXT NOT NULL DEFAULT 'mobile'
                    CHECK (device IN ('mobile','desktop')),
  inp_ms            INT,
  lcp_ms            INT,
  cls               NUMERIC(6,4),
  ttfb_ms           INT,
  fcp_ms            INT,
  performance_score INT,
  raw               JSONB NOT NULL DEFAULT '{}'::jsonb,
  measured_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inp_measurements_url ON inp_measurements(url, measured_at DESC);
CREATE INDEX IF NOT EXISTS idx_inp_measurements_exceeded
  ON inp_measurements(measured_at DESC) WHERE inp_ms > 200;

ALTER TABLE inp_measurements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "inp service" ON inp_measurements;
CREATE POLICY "inp service" ON inp_measurements
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─── 8) package_review_digests (PR-F) ──────────────────────────
CREATE TABLE IF NOT EXISTS package_review_digests (
  package_id    UUID PRIMARY KEY,
  destination   TEXT,
  digest_quotes JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_count  INT   NOT NULL DEFAULT 0,
  avg_rating    NUMERIC(3,2),
  model         TEXT,
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  meta          JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_review_digests_dest ON package_review_digests(destination);
CREATE INDEX IF NOT EXISTS idx_review_digests_gen  ON package_review_digests(generated_at DESC);

ALTER TABLE package_review_digests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "review_digests read" ON package_review_digests;
CREATE POLICY "review_digests read" ON package_review_digests
  FOR SELECT USING (true);
DROP POLICY IF EXISTS "review_digests service" ON package_review_digests;
CREATE POLICY "review_digests service" ON package_review_digests
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMIT;

-- ───────── 검증 쿼리 (수동) ─────────
-- SELECT scope, posts_per_day FROM publishing_policies;
-- SELECT count(*) AS expected_8 FROM information_schema.tables
--  WHERE table_schema='public' AND table_name IN (
--   'publishing_policies','topical_clusters','programmatic_seo_topics',
--   'rank_history','rank_alerts','inp_measurements','package_review_digests');

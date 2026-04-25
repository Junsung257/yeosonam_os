-- ============================================================
-- Blog Auto-Publish v1 (2026-04-22)
-- 자동 발행 큐 · 예약 발행 · 내부 조회수 · 프롬프트 버전 관리
-- ============================================================

-- 1) content_creatives 확장 컬럼 (IF NOT EXISTS 로 안전 적용)
ALTER TABLE content_creatives
  ADD COLUMN IF NOT EXISTS publish_scheduled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS view_count           INTEGER      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quality_gate         JSONB        DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS prompt_version       TEXT         DEFAULT 'v1.0',
  ADD COLUMN IF NOT EXISTS topic_source         TEXT,   -- 'seasonal'|'coverage_gap'|'user_seed'|'product'|'manual'
  ADD COLUMN IF NOT EXISTS generation_meta      JSONB        DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_cc_publish_scheduled
  ON content_creatives(publish_scheduled_at)
  WHERE status = 'draft' OR status = 'scheduled';

-- status CHECK 확장: 'scheduled', 'failed', 'skipped' 추가
ALTER TABLE content_creatives DROP CONSTRAINT IF EXISTS content_creatives_status_check;
ALTER TABLE content_creatives ADD CONSTRAINT content_creatives_status_check
  CHECK (status IN ('draft','scheduled','published','archived','failed','skipped'));

-- 2) 자동 토픽 큐
CREATE TABLE IF NOT EXISTS blog_topic_queue (
  id                  UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  topic               TEXT         NOT NULL,
  source              TEXT         NOT NULL
    CHECK (source IN ('seasonal','coverage_gap','user_seed','product')),
  priority            INTEGER      NOT NULL DEFAULT 50,   -- user_seed=90 / seasonal=60 / coverage_gap=40 / product=80
  destination         TEXT,
  angle_type          TEXT,
  product_id          UUID         REFERENCES travel_packages(id) ON DELETE SET NULL,
  category            TEXT,                                 -- 정보성 글이면 travel_tips / local_info 등
  target_publish_at   TIMESTAMPTZ,
  status              TEXT         NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','generating','published','failed','skipped')),
  attempts            INTEGER      NOT NULL DEFAULT 0,
  last_error          TEXT,
  content_creative_id UUID         REFERENCES content_creatives(id) ON DELETE SET NULL,
  meta                JSONB        DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_btq_status ON blog_topic_queue(status);
CREATE INDEX IF NOT EXISTS idx_btq_target ON blog_topic_queue(target_publish_at)
  WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_btq_priority ON blog_topic_queue(priority DESC);
CREATE INDEX IF NOT EXISTS idx_btq_destination ON blog_topic_queue(destination);

-- 3) 프롬프트 버전 관리 (자기학습 루프 연결)
CREATE TABLE IF NOT EXISTS prompt_versions (
  id              UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  domain          TEXT         NOT NULL,   -- 'blog_style_guide' | 'blog_generate' | 'blog_seasonal'
  version         TEXT         NOT NULL,   -- 'v1.0', 'v1.1', ...
  content         TEXT         NOT NULL,
  change_notes    TEXT,
  source          TEXT         DEFAULT 'manual',  -- 'manual' | 'auto_learning'
  source_action_id UUID,                           -- agent_actions.id 참조 (자동 개선이면)
  is_active       BOOLEAN      NOT NULL DEFAULT FALSE,
  activated_at    TIMESTAMPTZ,
  performance_baseline JSONB   DEFAULT '{}'::jsonb,   -- 활성화 시점 기준 평균 지표
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(domain, version)
);

CREATE INDEX IF NOT EXISTS idx_pv_active ON prompt_versions(domain, is_active);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pv_one_active_per_domain
  ON prompt_versions(domain) WHERE is_active = TRUE;

-- 4) 시즌 캘린더 (자동 토픽 시드)
CREATE TABLE IF NOT EXISTS blog_seasonal_calendar (
  id              UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  year_month      TEXT         NOT NULL,   -- 'YYYY-MM'
  topic           TEXT         NOT NULL,
  keywords        TEXT[]       DEFAULT '{}'::text[],
  destination     TEXT,                    -- nullable (모든 목적지 공통이면 null)
  season_tag      TEXT,                    -- '봄' | '성수기' | '설연휴' 등
  generated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  used            BOOLEAN      NOT NULL DEFAULT FALSE,
  used_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_bsc_year_month ON blog_seasonal_calendar(year_month);
CREATE INDEX IF NOT EXISTS idx_bsc_used ON blog_seasonal_calendar(used) WHERE used = FALSE;

-- 4-B) 조회수 원자적 증가 RPC (tracker 에서 호출)
CREATE OR REPLACE FUNCTION increment_content_view_count(p_creative_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE content_creatives
  SET view_count = COALESCE(view_count, 0) + 1
  WHERE id = p_creative_id;
END;
$$ LANGUAGE plpgsql;

-- 5) updated_at 트리거
CREATE OR REPLACE FUNCTION update_btq_ts()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_btq_updated ON blog_topic_queue;
CREATE TRIGGER trg_btq_updated BEFORE UPDATE ON blog_topic_queue
  FOR EACH ROW EXECUTE FUNCTION update_btq_ts();

-- 6) RLS
ALTER TABLE blog_topic_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompt_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE blog_seasonal_calendar ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all_btq" ON blog_topic_queue FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_pv"  ON prompt_versions  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_bsc" ON blog_seasonal_calendar FOR ALL USING (true) WITH CHECK (true);

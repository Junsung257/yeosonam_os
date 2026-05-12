-- Content Factory Jobs
-- 카드뉴스 1개 생성 시 전 채널(Satori 렌더, Cover Critic, 블로그, 인스타, 메타광고)
-- 파이프라인 실행 상태를 추적하는 테이블.
-- steps JSONB 구조로 채널 추가 시 컬럼 마이그레이션 없이 키만 추가 가능.

CREATE TABLE IF NOT EXISTS content_factory_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_news_id    UUID NOT NULL REFERENCES card_news(id) ON DELETE CASCADE,
  product_id      UUID REFERENCES travel_packages(id) ON DELETE SET NULL,
  tenant_id       UUID REFERENCES tenants(id) ON DELETE SET NULL,

  -- 전체 상태
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','running','partial','done','failed')),

  -- 채널별 스텝 상태 (JSONB — 채널 추가 시 키만 추가)
  steps           JSONB NOT NULL DEFAULT '{
    "satori_render":   {"status":"pending","updated_at":null,"error":null},
    "cover_critic":    {"status":"pending","updated_at":null,"error":null},
    "blog_generate":   {"status":"pending","updated_at":null,"error":null},
    "ig_publish":      {"status":"pending","updated_at":null,"error":null},
    "meta_ads":        {"status":"pending","updated_at":null,"error":null}
  }',

  total_steps     INT NOT NULL DEFAULT 5,
  completed_steps INT NOT NULL DEFAULT 0,
  failed_steps    INT NOT NULL DEFAULT 0,

  -- AI 비용 추적
  cost_usd        NUMERIC(10,6),

  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 카드뉴스 1개당 active job 1개
  UNIQUE (card_news_id)
);

CREATE INDEX IF NOT EXISTS idx_cfj_card_news_id
  ON content_factory_jobs(card_news_id);

CREATE INDEX IF NOT EXISTS idx_cfj_tenant_status
  ON content_factory_jobs(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_cfj_product_id
  ON content_factory_jobs(product_id);

-- updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION update_content_factory_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cfj_updated_at ON content_factory_jobs;
CREATE TRIGGER trg_cfj_updated_at
  BEFORE UPDATE ON content_factory_jobs
  FOR EACH ROW EXECUTE FUNCTION update_content_factory_jobs_updated_at();

-- RLS
ALTER TABLE content_factory_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all" ON content_factory_jobs;
CREATE POLICY "service_role_all" ON content_factory_jobs
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

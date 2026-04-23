-- ============================================================
-- Content Distributions 테이블
-- 마이그레이션: 20260423020000
-- 목적:
--   1개 상품으로 생성되는 멀티 플랫폼 마케팅 아웃풋 통합 관리.
--   Instagram 캡션, Threads 포스트, 블로그 본문, Meta 광고, Google Ads RSA 등.
--
-- 관계:
--   product_id → travel_packages.id (필수 for product 모드)
--   card_news_id → card_news.id (카드뉴스 연계 시)
--   blog_post_id → blog_posts.id (블로그 연계 시, 향후)
--
-- payload:
--   플랫폼별 스키마 자유. 예시:
--     instagram_caption: { caption, hashtags[], first_comment }
--     threads_post:      { main, thread[] }
--     meta_ads:          { headlines[], descriptions[] }
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS content_distributions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id        UUID REFERENCES travel_packages(id) ON DELETE CASCADE,
  card_news_id      UUID REFERENCES card_news(id) ON DELETE SET NULL,
  blog_post_id      UUID,   -- 블로그 FK (향후 blog_posts 테이블 연결, 지금은 soft)

  platform          TEXT NOT NULL
    CHECK (platform IN (
      'instagram_caption',
      'instagram_story',
      'threads_post',
      'blog_body',
      'meta_ads',
      'google_ads_rsa',
      'kakao_channel',
      'naver_blog'
    )),

  payload           JSONB NOT NULL DEFAULT '{}'::jsonb,

  status            TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','scheduled','published','archived','failed')),
  scheduled_for     TIMESTAMPTZ,
  published_at      TIMESTAMPTZ,
  external_id       TEXT,      -- 발행 후 플랫폼 ID (IG post_id, Threads post_id 등)
  external_url      TEXT,      -- 발행 결과 URL

  engagement        JSONB DEFAULT '{}'::jsonb,   -- likes/comments/shares/saves 주기적 sync

  generation_agent  TEXT,      -- 'instagram-caption-v1', 'threads-post-v1' 등 버저닝
  generation_config JSONB,     -- brief/input 스냅샷 (재생성·디버깅용)

  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now(),
  created_by        TEXT
);

CREATE INDEX IF NOT EXISTS idx_cd_product   ON content_distributions(product_id);
CREATE INDEX IF NOT EXISTS idx_cd_card_news ON content_distributions(card_news_id);
CREATE INDEX IF NOT EXISTS idx_cd_platform  ON content_distributions(platform);
CREATE INDEX IF NOT EXISTS idx_cd_status    ON content_distributions(status);
CREATE INDEX IF NOT EXISTS idx_cd_scheduled ON content_distributions(scheduled_for)
  WHERE status = 'scheduled';

COMMENT ON TABLE content_distributions IS '1개 상품→멀티 플랫폼 마케팅 아웃풋 통합 (IG/Threads/블로그/Ads)';

-- updated_at 자동 갱신
CREATE OR REPLACE FUNCTION update_content_distributions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cd_updated_at ON content_distributions;
CREATE TRIGGER trg_cd_updated_at
  BEFORE UPDATE ON content_distributions
  FOR EACH ROW EXECUTE FUNCTION update_content_distributions_updated_at();

COMMIT;

NOTIFY pgrst, 'reload schema';

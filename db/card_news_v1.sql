-- ============================================================
-- 카드뉴스 에디터 + Void 처리 DB 마이그레이션
-- Supabase > SQL Editor 에서 실행하세요. (1회)
-- ============================================================

-- ① card_news 테이블
CREATE TABLE IF NOT EXISTS card_news (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id       UUID REFERENCES travel_packages(id) ON DELETE SET NULL,
  campaign_id      UUID REFERENCES ad_campaigns(id) ON DELETE SET NULL,
  title            TEXT NOT NULL,
  status           TEXT DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','CONFIRMED','LAUNCHED','ARCHIVED')),
  slides           JSONB NOT NULL DEFAULT '[]',
  -- slides 구조: [{id, position, headline, body, bg_image_url, pexels_keyword, overlay_style}]
  meta_creative_id TEXT,
  created_by       TEXT,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_card_news_package ON card_news(package_id);
CREATE INDEX IF NOT EXISTS idx_card_news_status  ON card_news(status);

-- ② card_news updated_at 자동 갱신
CREATE OR REPLACE FUNCTION update_card_news_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_card_news_updated_at ON card_news;
CREATE TRIGGER trg_card_news_updated_at
  BEFORE UPDATE ON card_news
  FOR EACH ROW EXECUTE FUNCTION update_card_news_updated_at();

-- ③ bookings 테이블 — 취소/Void 추적 컬럼
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS void_reason TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS voided_at   TIMESTAMPTZ;

-- 확인 쿼리
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'card_news';

SELECT column_name FROM information_schema.columns
WHERE table_name = 'bookings' AND column_name IN ('void_reason','voided_at');

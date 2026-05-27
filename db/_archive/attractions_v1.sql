-- ============================================================
-- attractions v1: 관광지 마스터 DB
-- 목적: 관광지별 1줄 설명을 1번만 AI 생성, 이후 재사용
-- ============================================================

CREATE TABLE IF NOT EXISTS attractions (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT        UNIQUE NOT NULL,           -- "야류 해양 국립공원" (정규화된 이름)
  short_desc  TEXT,                                   -- "기암괴석이 만든 자연의 조각 작품" (AI 생성)
  country     TEXT,                                   -- "대만"
  region      TEXT,                                   -- "기륭"
  category    TEXT        DEFAULT 'sightseeing'       -- sightseeing | temple | market | museum | nature | palace | shopping | entertainment
    CHECK (category IN ('sightseeing','temple','market','museum','nature','palace','shopping','entertainment','park','beach','cultural')),
  emoji       TEXT,                                   -- "🏛️" (렌더링용)
  mention_count INT       DEFAULT 1,                  -- 상품에 등장한 횟수
  is_special  BOOLEAN     DEFAULT false,              -- 특전/특식 여부
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_attractions_name ON attractions(name);
CREATE INDEX IF NOT EXISTS idx_attractions_country ON attractions(country);
CREATE INDEX IF NOT EXISTS idx_attractions_mention ON attractions(mention_count DESC);

-- updated_at 트리거
CREATE OR REPLACE FUNCTION update_attractions_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_attractions_updated_at ON attractions;
CREATE TRIGGER trg_attractions_updated_at
  BEFORE UPDATE ON attractions
  FOR EACH ROW EXECUTE FUNCTION update_attractions_updated_at();

-- RLS
ALTER TABLE attractions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_attractions" ON attractions FOR ALL USING (true) WITH CHECK (true);

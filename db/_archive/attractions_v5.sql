-- ============================================================
-- attractions v5: aliases + photos + unmatched_activities
-- ============================================================

-- aliases: 별칭 매칭용 (오행산↔마블마운틴, 센소지↔아사쿠사관음사)
ALTER TABLE attractions ADD COLUMN IF NOT EXISTS aliases TEXT[] DEFAULT '{}';

-- photos: Pexels에서 가져온 사진 URL 배열 (3~5장, 1회 저장 후 재사용)
ALTER TABLE attractions ADD COLUMN IF NOT EXISTS photos JSONB DEFAULT '[]';
-- photos 구조: [{ "src_medium": "...", "src_large": "...", "photographer": "...", "pexels_id": 123 }]

-- unmatched_activities 테이블: 미매칭 항목 자동 수집
CREATE TABLE IF NOT EXISTS unmatched_activities (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  activity          TEXT        NOT NULL,
  package_id        UUID,
  package_title     TEXT,
  day_number        INT,
  country           TEXT,
  region            TEXT,
  occurrence_count  INT         DEFAULT 1,
  status            TEXT        DEFAULT 'pending'
    CHECK (status IN ('pending', 'ignored', 'added')),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- 같은 activity 중복 방지 (upsert용)
CREATE UNIQUE INDEX IF NOT EXISTS idx_unmatched_activity ON unmatched_activities(activity);
CREATE INDEX IF NOT EXISTS idx_unmatched_status ON unmatched_activities(status);

-- RLS
ALTER TABLE unmatched_activities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_unmatched" ON unmatched_activities
  FOR ALL USING (true) WITH CHECK (true);

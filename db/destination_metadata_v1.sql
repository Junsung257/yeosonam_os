-- destination_metadata v1
-- 여행지별 커스텀 타이틀·히어로 이미지·어드민 승인 게이트

CREATE TABLE IF NOT EXISTS destination_metadata (
  destination        TEXT PRIMARY KEY,
  tagline            TEXT,              -- H1 오버라이드, e.g. "산호바다 위의 낙원"
  hero_tagline       TEXT,             -- 1~2문장 서브 설명
  hero_image_url     TEXT,             -- Supabase Storage public URL (자체 CDN)
  hero_image_pexels_id INT,            -- Pexels 원본 ID (저작권 귀속용)
  hero_photographer  TEXT,             -- Pexels 사진가 이름 (저작권 귀속용)
  photo_approved     BOOLEAN DEFAULT false,  -- true여야 고객 페이지에 노출
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now()
);

-- updated_at 자동 갱신
CREATE OR REPLACE FUNCTION update_destination_metadata_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_destination_metadata_updated_at ON destination_metadata;
CREATE TRIGGER trg_destination_metadata_updated_at
  BEFORE UPDATE ON destination_metadata
  FOR EACH ROW EXECUTE FUNCTION update_destination_metadata_updated_at();

-- attractions 에 photo_approved 컬럼 추가 (nullable, 기존 데이터 무영향)
ALTER TABLE attractions ADD COLUMN IF NOT EXISTS photo_approved BOOLEAN DEFAULT false;

-- RLS: 어드민(service role)만 쓰기, 누구나 읽기
ALTER TABLE destination_metadata ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_read_destination_metadata" ON destination_metadata;
CREATE POLICY "public_read_destination_metadata"
  ON destination_metadata FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "service_role_all_destination_metadata" ON destination_metadata;
CREATE POLICY "service_role_all_destination_metadata"
  ON destination_metadata FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

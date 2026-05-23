-- ============================================================
-- content_creatives — A/B 테스트 승자 적용·콘텐츠 최적화 컬럼 추가
-- 마이그레이션: 20260524013600
-- ============================================================
-- 컬럼 설명:
--   seo_title      — SEO 메타 제목 (A/B headline 승자 적용)
--   cta_text       — 행동 유도 문구 (A/B cta 승자 적용)
--   og_image_url   — OG 이미지 URL (A/B og_image 승자 적용)
-- ============================================================

DO $$
BEGIN
  -- seo_title (A/B headline 승자)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'content_creatives' AND column_name = 'seo_title'
  ) THEN
    ALTER TABLE content_creatives
      ADD COLUMN seo_title TEXT;
    COMMENT ON COLUMN content_creatives.seo_title IS 'SEO 메타 제목 — A/B headline 실험 승자 자동 적용';
  END IF;

  -- cta_text (A/B cta 승자)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'content_creatives' AND column_name = 'cta_text'
  ) THEN
    ALTER TABLE content_creatives
      ADD COLUMN cta_text TEXT;
    COMMENT ON COLUMN content_creatives.cta_text IS '행동 유도 문구 — A/B cta 실험 승자 자동 적용';
  END IF;

  -- og_image_url (A/B og_image 승자)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'content_creatives' AND column_name = 'og_image_url'
  ) THEN
    ALTER TABLE content_creatives
      ADD COLUMN og_image_url TEXT;
    COMMENT ON COLUMN content_creatives.og_image_url IS 'OG(Open Graph) 이미지 URL — A/B og_image 실험 승자 자동 적용';
  END IF;
END$$;

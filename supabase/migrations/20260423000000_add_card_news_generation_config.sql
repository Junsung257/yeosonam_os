-- ============================================================
-- 여소남 OS: card_news.generation_config 컬럼 추가
-- 마이그레이션: 20260423000000
-- 목적:
--   Wizard에서 받은 ContentBrief 스냅샷을 저장.
--   /api/card-news POST (브리프 기반 생성 경로)에서 insert,
--   /api/blog/from-card-news 에서 재활용하여 블로그 본문 생성.
-- 에러: "Could not find the 'generation_config' column of 'card_news' in the schema cache" 해결.
-- ============================================================

BEGIN;

ALTER TABLE card_news
  ADD COLUMN IF NOT EXISTS generation_config JSONB;

COMMENT ON COLUMN card_news.generation_config IS
  'Wizard ContentBrief 스냅샷 ({brief}). Phase 6에서 블로그 생성 시 재사용 (/api/blog/from-card-news).';

COMMIT;

-- PostgREST 스키마 캐시 즉시 리로드
NOTIFY pgrst, 'reload schema';

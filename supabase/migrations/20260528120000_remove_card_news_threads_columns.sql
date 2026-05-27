-- ============================================================
-- card_news 테이블에서 threads_* 컬럼 제거
-- 발행 경로 단일화: card_news 직접 큐 → content_distributions
--
-- 배경:
--   card_news 테이블에 직접 threads_publish_status 등의 컬럼이
--   있어 content_distributions과 발행 경로가 이중으로 존재.
--   content_distributions 으로 단일화하여 유지보수 부담 제거.
--
-- 마이그레이션 순서:
--   1. 기존 card_news.threads_* 데이터 → content_distributions 으로 이전
--   2. posting_hour_kst 컬럼 제거 (publish-threads route 전용이었음)
--   3. threads_* 컬럼 제거
-- ============================================================

BEGIN;

-- ── 1. 기존 threads 데이터를 content_distributions 으로 이전 ──────────
-- 조건: threads_publish_status NOT NULL AND threads_text NOT NULL
-- (status가 있으면서 본문이 있는 것만 실제 발행 대상)
INSERT INTO content_distributions (
  card_news_id,
  platform,
  payload,
  status,
  scheduled_for,
  published_at,
  external_id,
  created_at,
  updated_at
)
SELECT
  cn.id,
  'threads_post',
  jsonb_build_object(
    'main', cn.threads_text,
    'image_urls', cn.threads_media_urls
  ),
  CASE
    WHEN cn.threads_publish_status = 'published' THEN 'published'
    WHEN cn.threads_publish_status IN ('queued', 'publishing') THEN 'scheduled'
    WHEN cn.threads_publish_status = 'failed' THEN 'failed'
    ELSE 'draft'
  END,
  cn.threads_scheduled_for,
  cn.threads_published_at,
  cn.threads_post_id,
  COALESCE(cn.threads_published_at, cn.threads_scheduled_for, now()),
  now()
FROM card_news cn
WHERE cn.threads_publish_status IS NOT NULL
  AND cn.threads_text IS NOT NULL;

-- ── 2. posting_hour_kst 컬럼 제거 ──────────────────────────────────
ALTER TABLE card_news
  DROP COLUMN IF EXISTS posting_hour_kst;

-- ── 3. threads_* 컬럼 일괄 제거 ────────────────────────────────────
ALTER TABLE card_news
  DROP COLUMN IF EXISTS threads_publish_status,
  DROP COLUMN IF EXISTS threads_text,
  DROP COLUMN IF EXISTS threads_media_urls,
  DROP COLUMN IF EXISTS threads_scheduled_for,
  DROP COLUMN IF EXISTS threads_post_id,
  DROP COLUMN IF EXISTS threads_published_at,
  DROP COLUMN IF EXISTS threads_error;

COMMIT;

NOTIFY pgrst, 'reload schema';

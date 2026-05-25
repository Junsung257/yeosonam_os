-- ============================================================
-- auto-publish-loop: dry_run 기본값 false로 변경
-- card_news_publish_guards.auto_publish_dry_run 기본값 false
-- ============================================================

ALTER TABLE card_news_publish_guards
ALTER COLUMN auto_publish_dry_run SET DEFAULT false;

-- 기존 NULL 레코드도 false로 업데이트
UPDATE card_news_publish_guards
SET auto_publish_dry_run = false
WHERE auto_publish_dry_run IS NULL;

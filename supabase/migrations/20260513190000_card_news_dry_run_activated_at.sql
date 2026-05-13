-- ═══════════════════════════════════════════════════════════════════
-- card_news_publish_guards.dry_run_activated_at: dry_run=true 활성 시점 추적
-- 박제일: 2026-05-13
-- 사유: 24시간 dry_run 모니터링 후 자동으로 dry_run=false 전환
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE card_news_publish_guards
  ADD COLUMN IF NOT EXISTS dry_run_activated_at timestamptz;

UPDATE card_news_publish_guards
   SET dry_run_activated_at = COALESCE(dry_run_activated_at, now())
 WHERE auto_publish_enabled = true
   AND auto_publish_dry_run = true
   AND dry_run_activated_at IS NULL;

COMMENT ON COLUMN card_news_publish_guards.dry_run_activated_at IS
  'dry_run=true 활성 시점. 24h 경과 후 cron 이 자동으로 dry_run=false 전환.';

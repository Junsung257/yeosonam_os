-- ============================================================
-- 여소남 OS: 카드뉴스 인스타그램 자동 발행 필드
-- 마이그레이션: 20260414130000
-- 목적:
--   /admin/marketing/card-news/[id] 에디터의 "인스타 발행" 버튼에서
--   Meta Graph API(캐러셀)로 게시. 즉시 발행 + 날짜 예약 모두 지원.
--   크론은 기존 /api/cron/agent-executor 에서 due 항목 처리.
-- ============================================================

BEGIN;

ALTER TABLE card_news
  ADD COLUMN IF NOT EXISTS ig_post_id TEXT,
  ADD COLUMN IF NOT EXISTS ig_published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ig_scheduled_for TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ig_publish_status TEXT,
  ADD COLUMN IF NOT EXISTS ig_caption TEXT,
  ADD COLUMN IF NOT EXISTS ig_error TEXT,
  ADD COLUMN IF NOT EXISTS ig_slide_urls TEXT[];

-- 상태 제약: 최초 DB 주입 시 이미 값이 있을 수 있으므로 DROP → ADD
ALTER TABLE card_news DROP CONSTRAINT IF EXISTS card_news_ig_publish_status_check;
ALTER TABLE card_news
  ADD CONSTRAINT card_news_ig_publish_status_check
  CHECK (ig_publish_status IS NULL OR ig_publish_status IN ('queued','publishing','published','failed'));

-- 크론 쿼리 대상: status='queued' AND scheduled_for <= now()
CREATE INDEX IF NOT EXISTS idx_card_news_ig_queue
  ON card_news (ig_publish_status, ig_scheduled_for)
  WHERE ig_publish_status = 'queued';

COMMENT ON COLUMN card_news.ig_post_id IS 'Instagram 발행 완료 시 Meta가 반환한 미디어 ID';
COMMENT ON COLUMN card_news.ig_published_at IS '실제 발행 완료 시각';
COMMENT ON COLUMN card_news.ig_scheduled_for IS '예약 발행 일시 (NULL=미예약). 크론이 이 시각 이후 처리';
COMMENT ON COLUMN card_news.ig_publish_status IS 'queued|publishing|published|failed';
COMMENT ON COLUMN card_news.ig_caption IS '발행 시점 캡션 스냅샷 (해시태그 포함)';
COMMENT ON COLUMN card_news.ig_error IS '실패 시 Meta API 에러 본문 (재시도 UI 표시용)';
COMMENT ON COLUMN card_news.ig_slide_urls IS '발행 시점 슬라이드 PNG 공개 URL 스냅샷 (2~10장)';

COMMIT;

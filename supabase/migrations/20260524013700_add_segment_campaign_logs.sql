-- ============================================================
-- 세그먼트 캠페인 발송 로그 및 customer_rfm 컬럼 추가
-- 마이그레이션: 20260524013700
-- ============================================================
-- 1. segment_campaign_logs — RFM 세그먼트별 이메일 캠페인 발송 추적
-- 2. customer_rfm.last_campaign_sent_at — 고객별 마지막 캠페인 발송 시각
-- ============================================================

DO $$
BEGIN
  -- 1) segment_campaign_logs 테이블 생성
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'segment_campaign_logs'
  ) THEN
    CREATE TABLE segment_campaign_logs (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      campaign_run_id UUID NOT NULL,
      segment_name TEXT NOT NULL,
      customer_email TEXT NOT NULL,
      resend_message_id TEXT,
      status TEXT DEFAULT 'sent' CHECK (status IN ('sent', 'failed', 'bounced', 'opened', 'clicked')),
      error_message TEXT,
      sent_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE INDEX idx_segment_campaign_logs_run ON segment_campaign_logs(campaign_run_id);
    CREATE INDEX idx_segment_campaign_logs_segment ON segment_campaign_logs(segment_name);
    CREATE INDEX idx_segment_campaign_logs_sent_at ON segment_campaign_logs(sent_at);

    -- RLS: service_role 전용 테이블 — service role key를 사용하는 admin 클라이언트만 접근
    ALTER TABLE segment_campaign_logs ENABLE ROW LEVEL SECURITY;
  END IF;

  -- 2) customer_rfm.last_campaign_sent_at 컬럼 추가
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'customer_rfm' AND column_name = 'last_campaign_sent_at'
  ) THEN
    ALTER TABLE customer_rfm
      ADD COLUMN last_campaign_sent_at TIMESTAMPTZ;
    COMMENT ON COLUMN customer_rfm.last_campaign_sent_at IS '해당 고객에게 RFM 세그먼트 캠페인 이메일을 마지막으로 발송한 시각';
  END IF;
END$$;

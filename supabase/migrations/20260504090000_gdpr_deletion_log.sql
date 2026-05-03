CREATE TABLE IF NOT EXISTS gdpr_deletion_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL,  -- 이미 삭제된 후이므로 FK 없음
  initiated_by TEXT NOT NULL, -- admin user email
  steps_completed JSONB NOT NULL DEFAULT '[]',
  completed_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gdpr_deletion_log_customer ON gdpr_deletion_log(customer_id);
COMMENT ON TABLE gdpr_deletion_log IS 'GDPR 잊힐 권리 요청에 따른 고객 데이터 삭제 감사 로그';

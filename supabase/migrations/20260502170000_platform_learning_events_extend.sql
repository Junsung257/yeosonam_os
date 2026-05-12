-- platform_learning_events 확장: 테넌트 스코프 + (옵션) 마스킹 원문

BEGIN;

ALTER TABLE platform_learning_events
  ADD COLUMN IF NOT EXISTS tenant_id UUID,
  ADD COLUMN IF NOT EXISTS message_redacted TEXT,
  ADD COLUMN IF NOT EXISTS consent_flags JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_platform_learning_tenant_created
  ON platform_learning_events (tenant_id, created_at DESC);

COMMENT ON COLUMN platform_learning_events.tenant_id IS
  '일반 테넌트 UUID (affiliate_id 와 별도 — 향후 여행사 테넌트)';
COMMENT ON COLUMN platform_learning_events.message_redacted IS
  'PLATFORM_LEARNING_STORE_REDACTED_MESSAGE=true 일 때만 적재. PII 휴리스틱 마스킹.';
COMMENT ON COLUMN platform_learning_events.consent_flags IS
  '향후 고객/테넌트 동의 스냅샷 JSON';

COMMIT;

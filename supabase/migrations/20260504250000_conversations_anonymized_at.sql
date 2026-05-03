-- GDPR 잊힐 권리 삭제 시 anonymized_at 기록용 컬럼
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS anonymized_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN conversations.anonymized_at IS 'GDPR 삭제 요청으로 messages 필드가 null화된 시각';

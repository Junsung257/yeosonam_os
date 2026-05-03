-- 제휴/인플루언서 유입 고객 채팅 스코프 (플랫폼 멀티테넌트 Phase 1)
-- affiliate_id = affiliates.id — NULL 이면 여소남 직접 유입

BEGIN;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS affiliate_id UUID REFERENCES affiliates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_affiliate_id ON conversations(affiliate_id);

COMMENT ON COLUMN conversations.affiliate_id IS
  '제휴 채널 스코프 — customer_facts.tenant_id 와 동일 UUID 로 팩트/메모리 격리';

COMMIT;

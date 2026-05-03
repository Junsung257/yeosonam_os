-- 플랫폼 AI 플라이휠 — 대화/자비스 턴별 비식별·구조 신호 적재 (상품 파싱용 ai_training_logs 와 분리)
-- 목적: 평가 세트 구축, 라우팅·여정 품질 분석, 추후 선호학습/DPO 소재 — 원문 PII는 저장하지 않음

BEGIN;

CREATE TABLE IF NOT EXISTS platform_learning_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  /** qa_chat | jarvis_v1 | jarvis_v2_stream */
  source          TEXT NOT NULL,
  session_id      UUID,
  affiliate_id    UUID REFERENCES affiliates(id) ON DELETE SET NULL,
  /** 정규화된 메시지 SHA-256 (동일 질문 버킷용). 원문 미저장 */
  message_sha256  CHAR(64),
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_platform_learning_source_created
  ON platform_learning_events (source, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_learning_session
  ON platform_learning_events (session_id, created_at DESC);

COMMENT ON TABLE platform_learning_events IS
  '여소남 플랫폼 AI 고도화용 이벤트 — RAG/라우터/여정 신호만. PII 원문은 넣지 않는다.';

ALTER TABLE platform_learning_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform_learning_events service role"
  ON platform_learning_events FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

COMMIT;

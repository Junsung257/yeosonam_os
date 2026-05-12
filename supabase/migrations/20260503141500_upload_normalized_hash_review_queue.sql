-- 업로드 파이프: 정규화 텍스트 해시 중복 차단 + 실패 건 DLQ (upload_review_queue)
-- document_hashes 는 원격에 이미 존재한다고 가정 (타입: supabase-database.generated.ts)

BEGIN;

ALTER TABLE document_hashes
  ADD COLUMN IF NOT EXISTS normalized_hash TEXT;

COMMENT ON COLUMN document_hashes.normalized_hash IS
  'NFKC·공백 정규화 후 SHA-256. 동일 카탈로그 띄어쓰기만 다른 재업로드 차단.';

CREATE UNIQUE INDEX IF NOT EXISTS document_hashes_normalized_hash_key
  ON document_hashes (normalized_hash)
  WHERE normalized_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS upload_review_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'resolved', 'discarded')),
  severity TEXT NOT NULL DEFAULT 'high',
  error_reason TEXT,
  source_filename TEXT,
  file_hash TEXT,
  normalized_content_hash TEXT,
  raw_text_chunk TEXT,
  parsed_draft_json JSONB,
  product_title TEXT,
  land_operator_id UUID REFERENCES land_operators(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_upload_review_queue_pending
  ON upload_review_queue (created_at DESC)
  WHERE status = 'pending';

COMMENT ON TABLE upload_review_queue IS
  '업로드 파싱 DLQ — BLOCKED·저장 예외 건 수동 검토·재시도용';

ALTER TABLE upload_review_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "upload_review_queue service role" ON upload_review_queue;
CREATE POLICY "upload_review_queue service role"
  ON upload_review_queue FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

COMMIT;

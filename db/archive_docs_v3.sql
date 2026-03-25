-- ============================================================
-- archive_docs v3: 궁극의 데이터 레이크 스키마
-- 추가: parsed_chunks (RAG), 세분화 DLQ 에러 코드
-- ============================================================

-- 1. parsed_chunks (Semantic Chunking for RAG)
ALTER TABLE archive_docs ADD COLUMN IF NOT EXISTS parsed_chunks JSONB DEFAULT '[]'::jsonb;

-- 2. status CHECK 확장 (세분화 DLQ 에러 코드)
ALTER TABLE archive_docs DROP CONSTRAINT IF EXISTS archive_docs_status_check;
ALTER TABLE archive_docs ADD CONSTRAINT archive_docs_status_check
  CHECK (status IN (
    'processed', 'needs_ocr', 'FAILED_PARSE',
    'ERR_CORRUPT_PDF', 'ERR_NO_TEXT', 'ERR_NO_DATE', 'ERR_UNKNOWN_VENDOR'
  ));

-- 3. sku_code (v2에서 이미 추가됐을 수 있음)
ALTER TABLE archive_docs ADD COLUMN IF NOT EXISTS sku_code TEXT UNIQUE;
CREATE INDEX IF NOT EXISTS idx_archive_docs_sku ON archive_docs(sku_code);

-- 4. parser_version 기본값
ALTER TABLE archive_docs ALTER COLUMN parser_version SET DEFAULT 'v3.5-master-sku';

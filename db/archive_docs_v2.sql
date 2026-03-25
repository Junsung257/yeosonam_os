-- ============================================================
-- archive_docs v2: Big Tech 데이터 레이크 스키마 업그레이드
-- 추가: sku_code (15자리 비즈니스 키), FAILED_PARSE 상태, embedding 대비
-- ============================================================

-- 1. sku_code 컬럼 추가 (100년짜리 식별자)
ALTER TABLE archive_docs ADD COLUMN IF NOT EXISTS sku_code TEXT UNIQUE;
CREATE INDEX IF NOT EXISTS idx_archive_docs_sku ON archive_docs(sku_code);

-- 2. status CHECK 제약조건 업그레이드 (FAILED_PARSE 추가)
ALTER TABLE archive_docs DROP CONSTRAINT IF EXISTS archive_docs_status_check;
ALTER TABLE archive_docs ADD CONSTRAINT archive_docs_status_check
  CHECK (status IN ('processed', 'needs_ocr', 'FAILED_PARSE'));

-- 3. embedding 컬럼 (미래 RAG/벡터 검색 대비)
-- pgvector 확장이 활성화돼 있으면 아래 주석 해제:
-- ALTER TABLE archive_docs ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- 4. parser_version 기본값 업데이트
ALTER TABLE archive_docs ALTER COLUMN parser_version SET DEFAULT 'v3.0-sku-dlq';

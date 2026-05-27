-- ============================================================
-- archive_docs: 빅데이터 아카이브 테이블 (Raw Data Lake)
-- 목적: 원시 PDF 텍스트를 Zero-API로 보존하여 미래 AI/RAG 자산화
-- 원칙: products 테이블과 독립적, JSONB 메타데이터로 무한 확장
-- ============================================================

CREATE TABLE IF NOT EXISTS archive_docs (
  id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  file_hash           TEXT        UNIQUE NOT NULL,              -- SHA-256 (64자 hex), 중복 방지 고유키
  original_file_name  TEXT        NOT NULL,                     -- 원본 파일명
  original_file_path  TEXT        NOT NULL,                     -- 로컬 절대 경로 (추적성 확보)
  raw_content         TEXT,                                     -- 원시 텍스트 전체 보존 (유실 0%)
  metadata            JSONB       DEFAULT '{}'::jsonb,          -- 무한 확장형 메타데이터
  status              TEXT        DEFAULT 'processed'           -- 'processed' | 'needs_ocr'
                      CHECK (status IN ('processed', 'needs_ocr')),
  parser_version      TEXT        DEFAULT 'v1.0-regex-only',    -- 파서 버전 관리
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- 인덱스: 해시 조회 (중복 체크), 상태 필터, JSONB GIN (메타데이터 검색)
CREATE INDEX IF NOT EXISTS idx_archive_docs_file_hash   ON archive_docs(file_hash);
CREATE INDEX IF NOT EXISTS idx_archive_docs_status      ON archive_docs(status);
CREATE INDEX IF NOT EXISTS idx_archive_docs_metadata    ON archive_docs USING gin(metadata);

-- updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION update_archive_docs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_archive_docs_updated_at ON archive_docs;
CREATE TRIGGER trg_archive_docs_updated_at
  BEFORE UPDATE ON archive_docs
  FOR EACH ROW
  EXECUTE FUNCTION update_archive_docs_updated_at();

-- RLS 활성화 (서비스 롤 키 사용 시 우회됨)
ALTER TABLE archive_docs ENABLE ROW LEVEL SECURITY;

-- 서비스 롤 전용 풀 액세스 정책
CREATE POLICY "service_role_full_access" ON archive_docs
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

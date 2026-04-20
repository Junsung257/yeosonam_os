-- ════════════════════════════════════════════════════════════════════════
-- error_patterns — 자가 학습형 에러 패턴 라이브러리
-- ────────────────────────────────────────────────────────────────────────
-- 목적:
--   상품 등록 과정에서 감지된 오류 패턴을 DB에 누적하여,
--   다음 등록 시 RAG(pgvector 유사도 검색)로 조회 → 재발 방지 + 자동 수정.
--
-- 설계 원칙:
--   1. 신규 패턴은 기본 manual_review (사람 승인 전엔 자동수정에 사용 안 함)
--   2. occurrence_count >= 3 된 패턴은 자동수정 승격 후보 (promoted_to_whitelist)
--   3. tenant_id 컬럼으로 멀티테넌시 대비 (현재 NULL = 전역)
--   4. gemini-embedding-001 (1536 dim) 벡터 공간 — products/content 와 동일
--
-- 참고: Voyager skill library (NVIDIA 2023) + Reflexion episodic memory (2023)
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS error_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 식별
  error_code TEXT NOT NULL,                   -- 'ERR-20260418-01' | 'E0-past-date' | 'AF-commission-leak'
  category TEXT NOT NULL,                     -- 'parse'|'render'|'data'|'match'|'validate'|'dedupe'|'process'
  title TEXT NOT NULL,                        -- 한 줄 요약
  description TEXT,                           -- 상세 (원문 vs 결과, 근본원인, 해결책)

  -- 매칭/검색
  trigger_keywords TEXT[] DEFAULT '{}',       -- 원문 스캔 키워드 (빠른 1차 필터)
  embedding VECTOR(1536),                     -- gemini-embedding-001 semantic similarity

  -- 예시/수정
  bad_example JSONB,                          -- { field, value, raw_snippet }
  good_fix JSONB,                             -- { transform, before, after, reason }

  -- 운영
  occurrence_count INT DEFAULT 1,
  resolution_type TEXT DEFAULT 'manual_review',    -- 'auto_fixed'|'manual_review'|'unfixable'|'fixed'
  promoted_to_whitelist BOOLEAN DEFAULT false,     -- auto-fixer가 이 패턴을 자동 적용해도 되는가
  severity TEXT DEFAULT 'warning',                  -- 'error'|'warning'|'info'
  status TEXT DEFAULT 'active',                     -- 'active'|'archived'|'superseded'

  -- 출처/추적
  source TEXT DEFAULT 'auto-fixer',           -- 'registry-md'|'auto-fixer'|'audit-rule'|'human'
  created_by TEXT DEFAULT 'system',
  related_package_id UUID REFERENCES travel_packages(id) ON DELETE SET NULL,
  tenant_id UUID,                             -- NULL = 전역 (멀티테넌시 대비)

  -- 시간
  first_seen TIMESTAMPTZ DEFAULT NOW(),
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 멱등 재실행 방어: 이미 있는 테이블에는 컬럼만 추가하도록
-- (개발 환경에서 여러 번 돌려도 에러 안 나게)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='error_patterns' AND column_name='tenant_id') THEN
    ALTER TABLE error_patterns ADD COLUMN tenant_id UUID;
  END IF;
END $$;

-- ─── 인덱스 ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_error_patterns_code ON error_patterns(error_code);
CREATE INDEX IF NOT EXISTS idx_error_patterns_category ON error_patterns(category);
CREATE INDEX IF NOT EXISTS idx_error_patterns_last_seen ON error_patterns(last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_error_patterns_status ON error_patterns(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_error_patterns_promoted ON error_patterns(promoted_to_whitelist) WHERE promoted_to_whitelist = true;

-- pgvector ivfflat 인덱스 (lists는 행수 < 1K일 때 보수적으로 10)
-- 행수 증가 시 lists = sqrt(rows) 권장
CREATE INDEX IF NOT EXISTS idx_error_patterns_embedding
  ON error_patterns USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 10);

-- ─── RPC: 유사 에러 패턴 검색 ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION match_error_patterns(
  query_embedding VECTOR(1536),
  match_threshold FLOAT DEFAULT 0.75,
  match_count INT DEFAULT 3,
  filter_category TEXT DEFAULT NULL,
  only_whitelisted BOOLEAN DEFAULT false
)
RETURNS TABLE (
  id UUID,
  error_code TEXT,
  title TEXT,
  description TEXT,
  category TEXT,
  resolution_type TEXT,
  promoted_to_whitelist BOOLEAN,
  good_fix JSONB,
  occurrence_count INT,
  similarity FLOAT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    ep.id,
    ep.error_code,
    ep.title,
    ep.description,
    ep.category,
    ep.resolution_type,
    ep.promoted_to_whitelist,
    ep.good_fix,
    ep.occurrence_count,
    1 - (ep.embedding <=> query_embedding) AS similarity
  FROM error_patterns ep
  WHERE ep.embedding IS NOT NULL
    AND ep.status = 'active'
    AND (filter_category IS NULL OR ep.category = filter_category)
    AND (NOT only_whitelisted OR ep.promoted_to_whitelist = true)
    AND 1 - (ep.embedding <=> query_embedding) >= match_threshold
  ORDER BY ep.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- ─── RPC: 패턴 발견 시 upsert (occurrence_count++) ──────────────────────
-- 같은 error_code + category 조합이 있으면 count 증가, 없으면 신규 생성
CREATE OR REPLACE FUNCTION upsert_error_pattern(
  p_error_code TEXT,
  p_category TEXT,
  p_title TEXT,
  p_description TEXT DEFAULT NULL,
  p_trigger_keywords TEXT[] DEFAULT '{}',
  p_bad_example JSONB DEFAULT NULL,
  p_good_fix JSONB DEFAULT NULL,
  p_embedding VECTOR(1536) DEFAULT NULL,
  p_source TEXT DEFAULT 'auto-fixer',
  p_severity TEXT DEFAULT 'warning',
  p_related_package_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_id UUID;
BEGIN
  SELECT id INTO v_id FROM error_patterns
  WHERE error_code = p_error_code AND category = p_category AND status = 'active'
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE error_patterns
    SET occurrence_count = occurrence_count + 1,
        last_seen = NOW(),
        updated_at = NOW(),
        -- 임베딩은 없을 때만 채움 (재계산 낭비 방지)
        embedding = COALESCE(embedding, p_embedding),
        related_package_id = COALESCE(p_related_package_id, related_package_id),
        -- good_fix는 신규 제공되면 업데이트
        good_fix = COALESCE(p_good_fix, good_fix)
    WHERE id = v_id;
    RETURN v_id;
  END IF;

  INSERT INTO error_patterns (
    error_code, category, title, description,
    trigger_keywords, bad_example, good_fix, embedding,
    source, severity, related_package_id
  ) VALUES (
    p_error_code, p_category, p_title, p_description,
    p_trigger_keywords, p_bad_example, p_good_fix, p_embedding,
    p_source, p_severity, p_related_package_id
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ─── RLS ────────────────────────────────────────────────────────────────
ALTER TABLE error_patterns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "error_patterns_read" ON error_patterns;
CREATE POLICY "error_patterns_read" ON error_patterns
  FOR SELECT
  USING (true);  -- 현재 단일 테넌트. 파트너 입점 시 tenant_id 필터로 수정

DROP POLICY IF EXISTS "error_patterns_write_service" ON error_patterns;
CREATE POLICY "error_patterns_write_service" ON error_patterns
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE error_patterns IS
  '자가 학습형 에러 패턴 라이브러리. post_register_audit이 감지한 패턴을 누적하여 다음 등록 시 RAG로 재발 방지에 사용.';

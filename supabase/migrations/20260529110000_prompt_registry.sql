-- 여소남 OS — 프로프트 관리 시스템
-- Phase 1-2: prompt_registry 테이블 + A/B 테스트 variant 라우팅

-- 1. prompt_registry 테이블
CREATE TABLE IF NOT EXISTS prompt_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  version INT NOT NULL,
  prompt_text TEXT NOT NULL,
  labels TEXT[] DEFAULT '{}',        -- e.g. {'production', 'staging', 'variant-a', 'variant-b'}
  metadata JSONB DEFAULT '{}',       -- e.g. {"author": "admin", "description": "...", "model": "deepseek-v4-flash"}
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(name, version)
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_prompt_registry_name ON prompt_registry(name);
CREATE INDEX IF NOT EXISTS idx_prompt_registry_labels ON prompt_registry USING gin(labels);

-- RLS (서비스 롤만 접근)
ALTER TABLE prompt_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY prompt_registry_service_all ON prompt_registry
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 2. variant 라우팅을 위한 랜덤 버킷 함수
CREATE OR REPLACE FUNCTION prompt_variant_bucket(customer_id TEXT, variants TEXT[])
RETURNS TEXT AS $$
DECLARE
  hash_val INT;
  idx INT;
BEGIN
  hash_val := ('x' || substr(md5(customer_id), 1, 8))::bit(32)::int;
  idx := hash_val % array_length(variants, 1);
  IF idx < 0 THEN idx := idx + array_length(variants, 1); END IF;
  RETURN variants[idx + 1];
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 3. llm_prompts 와 prompt_registry 를 통합 조회하는 뷰
CREATE OR REPLACE VIEW prompt_active_view AS
SELECT
  name,
  version,
  prompt_text AS body,
  labels,
  metadata,
  created_at
FROM prompt_registry
WHERE labels @> ARRAY['production']
ORDER BY version DESC;

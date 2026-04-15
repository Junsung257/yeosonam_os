-- ============================================================
-- 여소남 OS: 상품 중복 감지 RPC
-- 마이그레이션: 20260417010000
-- 목적:
--   업로드 시 유사 상품(cosine ≥ 0.95) 즉시 감지 → VA 작업 중복 방지
-- 전제: 20260414121000 이후 (travel_packages.embedding 존재, HNSW 인덱스)
-- ============================================================

BEGIN;

-- match_travel_packages_duplicate: 임베딩 기반 중복/근중복 상품 탐색
-- tenant_id는 옵션 (멀티테넌시 확장 대비, 현재 NULL)
-- status 무관 — draft/active/archived 전부 검색 (같은 상품 재업로드 감지)
CREATE OR REPLACE FUNCTION match_travel_packages_duplicate(
  query_embedding extensions.vector(1536),
  match_threshold NUMERIC DEFAULT 0.95,
  match_count INTEGER DEFAULT 3,
  exclude_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  destination TEXT,
  status TEXT,
  price INTEGER,
  created_at TIMESTAMPTZ,
  similarity NUMERIC
)
LANGUAGE SQL STABLE
AS $$
  SELECT
    p.id,
    p.title,
    p.destination,
    p.status,
    p.price,
    p.created_at,
    (1 - (p.embedding <=> query_embedding))::NUMERIC AS similarity
  FROM travel_packages p
  WHERE p.embedding IS NOT NULL
    AND (exclude_id IS NULL OR p.id <> exclude_id)
    AND (1 - (p.embedding <=> query_embedding)) >= match_threshold
  ORDER BY p.embedding <=> query_embedding
  LIMIT GREATEST(1, LEAST(match_count, 20));
$$;

COMMENT ON FUNCTION match_travel_packages_duplicate IS
  '상품 업로드 시 유사(cosine ≥ threshold) 기존 상품 탐색. 기본 0.95. 중복 경고용.';

COMMIT;

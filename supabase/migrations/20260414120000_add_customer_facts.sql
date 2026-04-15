-- ============================================================
-- 여소남 OS: customer_facts (Mem0 스타일 고객 팩트 메모리)
-- 마이그레이션: 20260414120000
-- 목적: 대화에서 추출한 재사용 가능한 고객 팩트를 저장하여
--       재방문 시 자비스가 자동으로 컨텍스트에 주입할 수 있게 함
-- ============================================================

BEGIN;

-- pgvector 확장 보장 (이미 활성화되어 있으면 무시)
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS customer_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  fact_text TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  confidence NUMERIC(3,2) DEFAULT 0.80,
  embedding extensions.vector(1536),
  source_message_idx INTEGER,
  importance NUMERIC(3,2) DEFAULT 0.50,
  superseded_by UUID REFERENCES customer_facts(id) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT true,
  last_accessed_at TIMESTAMPTZ,
  access_count INTEGER DEFAULT 0,
  extracted_at TIMESTAMPTZ DEFAULT NOW()
);

-- 팩트 조회 인덱스 (멀티테넌시 대비 — tenant_id 선두 복합 인덱스)
CREATE INDEX IF NOT EXISTS idx_customer_facts_tenant_customer
  ON customer_facts(tenant_id, customer_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_customer_facts_tenant_conversation
  ON customer_facts(tenant_id, conversation_id);
CREATE INDEX IF NOT EXISTS idx_customer_facts_category
  ON customer_facts(category);
CREATE INDEX IF NOT EXISTS idx_customer_facts_active_recent
  ON customer_facts(extracted_at DESC) WHERE is_active;

-- 카테고리 체크 (FK 대신 CHECK — 단순성)
ALTER TABLE customer_facts
  DROP CONSTRAINT IF EXISTS chk_customer_facts_category;
ALTER TABLE customer_facts
  ADD CONSTRAINT chk_customer_facts_category CHECK (category IN (
    'mobility', 'dietary', 'budget', 'destination_interest',
    'timing', 'party', 'preference', 'history', 'constraint', 'other'
  ));

COMMENT ON TABLE customer_facts IS
  'Mem0 스타일: 대화에서 추출된 재사용 가능한 고객 팩트. 재방문 시 컨텍스트로 자동 주입.';
COMMENT ON COLUMN customer_facts.category IS
  'mobility|dietary|budget|destination_interest|timing|party|preference|history|constraint|other';
COMMENT ON COLUMN customer_facts.embedding IS
  'OpenAI text-embedding-3-small (1536) — products.embedding과 동일 벡터 공간. 시맨틱 검색은 v2에서.';
COMMENT ON COLUMN customer_facts.superseded_by IS
  '더 최신 팩트로 대체될 때 포인터 (예: 예산 업데이트). NULL이면 유효.';
COMMENT ON COLUMN customer_facts.source_message_idx IS
  'conversations.messages 배열의 어느 인덱스에서 추출됐는지';
COMMENT ON COLUMN customer_facts.tenant_id IS
  '멀티테넌시 대비 — 여행사 파트너별 격리. NULL=본사(여소남). RLS 정책 추후 추가.';
COMMENT ON COLUMN customer_facts.importance IS
  'Generative Agents(Park+2023) 참조. 0=트리비얼, 1=결정적. 예: 휠체어=0.95, 좋아하는 색=0.2. 회수 점수 = recency * importance * relevance.';
COMMENT ON COLUMN customer_facts.last_accessed_at IS
  'MemGPT 핫/콜드 티어용. 최근 회수된 팩트 = 핫. 오래 안 쓰인 것 = 콜드 (컨텍스트 제외).';
COMMENT ON COLUMN customer_facts.access_count IS
  '팩트가 실제 대화에 회수된 횟수. 자주 쓰이는 것이 진짜 중요한 팩트 (feedback loop).';

-- ============================================================
-- RPC: 회수된 팩트의 access_count + last_accessed_at 일괄 bump
-- MemGPT 핫/콜드 승격용. 배치 업데이트로 트랜잭션 비용 절약.
-- ============================================================
CREATE OR REPLACE FUNCTION bump_customer_facts_access(fact_ids UUID[])
RETURNS VOID
LANGUAGE SQL
SECURITY DEFINER
AS $$
  UPDATE customer_facts
  SET access_count = access_count + 1,
      last_accessed_at = NOW()
  WHERE id = ANY(fact_ids);
$$;

COMMENT ON FUNCTION bump_customer_facts_access IS
  '회수된 팩트들의 access_count를 1 증가 + last_accessed_at 업데이트. 자주 쓰이는 팩트 = 진짜 중요.';

COMMIT;

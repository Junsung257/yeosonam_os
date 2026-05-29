-- 여소남 OS — 고객 360 통합 이벤트 로그
-- Phase 1-1: 모든 채널(chat, booking, payment, click, support)의 고객 이벤트를
-- 단일 customer_events 테이블로 통합한다.

-- 1. customer_events 테이블
CREATE TABLE IF NOT EXISTS customer_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES users(id) ON DELETE SET NULL,
  session_id TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'chat', 'booking', 'payment', 'click', 'support', 'view', 'search', 'recommendation'
  )),
  channel TEXT CHECK (channel IN ('web', 'kakao', 'whatsapp', 'email', 'phone', 'api')),
  affiliate_id UUID REFERENCES affiliates(id) ON DELETE SET NULL,
  tenant_id UUID REFERENCES affiliates(id) ON DELETE SET NULL,
  payload JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_customer_events_customer_id ON customer_events(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_events_tenant_id ON customer_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_customer_events_event_type ON customer_events(event_type);
CREATE INDEX IF NOT EXISTS idx_customer_events_created_at ON customer_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_events_customer_type_time
  ON customer_events(customer_id, event_type, created_at DESC);

-- RLS
ALTER TABLE customer_events ENABLE ROW LEVEL SECURITY;

-- tenant_id = 자신의 데이터만 조회 가능
CREATE POLICY customer_events_tenant_select ON customer_events
  FOR SELECT USING (
    tenant_id IS NULL
    OR tenant_id IN (
      SELECT id FROM affiliates WHERE id = auth.uid()::uuid
    )
  );

-- 서비스 롤만 INSERT
CREATE POLICY customer_events_service_insert ON customer_events
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- 🔒 platform_learning_events 에 customer_id 컬럼 추가 (이미 있으면 무시)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'platform_learning_events' AND column_name = 'customer_id'
  ) THEN
    ALTER TABLE platform_learning_events ADD COLUMN customer_id UUID REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- customer_facts 에 booking/payment 연결용 컬럼 추가
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'customer_facts' AND column_name = 'source_event_id'
  ) THEN
    ALTER TABLE customer_facts ADD COLUMN source_event_id UUID;
    ALTER TABLE customer_facts ADD COLUMN source_event_type TEXT;
  END IF;
END $$;

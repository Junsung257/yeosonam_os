-- V2 §B.2.1 — P0 테이블에 tenant_id 컬럼 추가 (nullable 로 시작)
--
-- 전략:
-- 1) 컬럼 추가 (nullable)               ← 이 파일
-- 2) 애플리케이션에서 신규 row 는 tenant_id 채움
-- 3) 데이터 백필 스크립트 실행          ← 운영 단계, 별도 PR
-- 4) NOT NULL 승격 + RLS 활성화         ← Phase 3d
--
-- 기존 tenant_id 있는 테이블 (saas_marketplace_v1.sql, content_hub_v1.sql 등) 은 건드리지 않음.

-- ─── 예약/고객/결제 ─────────────────────────────────────────────────────
ALTER TABLE bookings           ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
ALTER TABLE customers          ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
ALTER TABLE payments           ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
ALTER TABLE bank_transactions  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
ALTER TABLE message_logs       ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
ALTER TABLE settlements        ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

-- ─── 자비스 런타임 ─────────────────────────────────────────────────────
ALTER TABLE jarvis_sessions        ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
ALTER TABLE jarvis_tool_logs       ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
ALTER TABLE jarvis_pending_actions ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
ALTER TABLE agent_actions          ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

-- ─── 인덱스 (tenant_id 필터가 모든 쿼리에 들어가므로 필수) ───────────────
CREATE INDEX IF NOT EXISTS idx_bookings_tenant           ON bookings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_customers_tenant          ON customers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payments_tenant           ON payments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_tenant  ON bank_transactions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_message_logs_tenant       ON message_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_settlements_tenant        ON settlements(tenant_id);
CREATE INDEX IF NOT EXISTS idx_jarvis_sessions_tenant    ON jarvis_sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_jarvis_tool_logs_tenant   ON jarvis_tool_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_jarvis_pending_tenant     ON jarvis_pending_actions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_agent_actions_tenant      ON agent_actions(tenant_id);

COMMENT ON COLUMN bookings.tenant_id IS '테넌트 격리용. NULL = 여소남 본사. 마이그레이션 완료 후 NOT NULL 승격 예정.';

-- ============================================================
-- 여소남 OS: Operations Optimization Enhancement
-- Migration: 20260401150000
--
-- 이미 존재 (20260401110000):
--   block_purchase_plans, automated_settlements, daily_operations_metrics → ALTER만
--
-- 신규 테이블:
--   inventory_alerts (재고 알림 로그)
--
-- ALTER (기존 테이블 보완):
--   block_purchase_plans: package_type, supplier_id FK, breakeven_sales_quantity,
--                         expected_roi, purchase_date, service dates 추가
--   automated_settlements: partner_name, commission_rate, adjustment_amount,
--                          tax_rate, bank_account 추가
--   daily_operations_metrics: daily_profit GENERATED, total_visitors,
--                             total_sessions, conversion_rate GENERATED,
--                             top_selling_package_id, top_destination,
--                             inventory_sold_out_count, inquiry 컬럼들,
--                             marketing_spend, roas 추가
-- ============================================================

BEGIN;

-- ============================================================
-- 1. block_purchase_plans 보완
-- ============================================================
ALTER TABLE block_purchase_plans
  ADD COLUMN IF NOT EXISTS package_type TEXT,
  ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS breakeven_sales_quantity INTEGER,
  ADD COLUMN IF NOT EXISTS expected_roi NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS purchase_date DATE,
  ADD COLUMN IF NOT EXISTS service_start_date DATE,
  ADD COLUMN IF NOT EXISTS service_end_date DATE,
  ADD COLUMN IF NOT EXISTS purchased_at TIMESTAMPTZ;

-- ============================================================
-- 2. automated_settlements 보완
-- ============================================================
ALTER TABLE automated_settlements
  ADD COLUMN IF NOT EXISTS partner_name TEXT,
  ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS adjustment_amount INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS bank_account TEXT;

-- ============================================================
-- 3. daily_operations_metrics 보완
-- ============================================================
ALTER TABLE daily_operations_metrics
  ADD COLUMN IF NOT EXISTS daily_profit INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_visitors INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_sessions INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS top_selling_package_id UUID,
  ADD COLUMN IF NOT EXISTS top_destination TEXT,
  ADD COLUMN IF NOT EXISTS inventory_sold_out_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS new_inquiries INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS resolved_inquiries INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pending_inquiries INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_response_time_hours NUMERIC(6,1),
  ADD COLUMN IF NOT EXISTS marketing_spend INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS roas NUMERIC(8,2);

-- ============================================================
-- 4. inventory_alerts (신규)
-- ============================================================
CREATE TABLE IF NOT EXISTS inventory_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID REFERENCES travel_packages(id) ON DELETE SET NULL,

  -- 알림
  alert_type TEXT NOT NULL CHECK (alert_type IN ('low_stock','sold_out','overstock','expiring_soon')),
  alert_level TEXT NOT NULL CHECK (alert_level IN ('info','warning','critical')),
  message TEXT,

  -- 재고 데이터
  current_available INTEGER,
  threshold INTEGER,
  days_until_departure INTEGER,

  -- 처리
  acknowledged BOOLEAN DEFAULT false,
  action_taken TEXT,
  resolved BOOLEAN DEFAULT false,

  created_at TIMESTAMPTZ DEFAULT now(),
  acknowledged_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_inv_alerts_package ON inventory_alerts(package_id);
CREATE INDEX IF NOT EXISTS idx_inv_alerts_resolved ON inventory_alerts(resolved) WHERE resolved = false;
CREATE INDEX IF NOT EXISTS idx_inv_alerts_level ON inventory_alerts(alert_level);
CREATE INDEX IF NOT EXISTS idx_inv_alerts_created ON inventory_alerts(created_at DESC);

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE inventory_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_access" ON inventory_alerts;
CREATE POLICY "authenticated_access" ON inventory_alerts FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMIT;

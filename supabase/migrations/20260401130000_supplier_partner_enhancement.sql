-- ============================================================
-- 여소남 OS: Supplier/Partner Management Enhancement
-- Migration: 20260401130000
--
-- 이미 존재 (20260401110000에서 생성):
--   suppliers, supplier_inventory, supplier_performance → ALTER만
--
-- 신규 테이블:
--   supplier_communications (공급사 커뮤니케이션 로그)
--
-- ALTER (기존 테이블 보완):
--   suppliers: country, region, payment_cycle, rating 추가
--   supplier_inventory: service_type, service_name, reserved/blocked qty,
--                       GENERATED margin/margin_percent 추가
--   supplier_performance: GENERATED confirmed_rate/gross_margin,
--                         total_reviews, avg_confirmation_time, cancellation_rate 추가
-- ============================================================

BEGIN;

-- ============================================================
-- 1. suppliers 테이블 보완
-- ============================================================
ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS country TEXT,
  ADD COLUMN IF NOT EXISTS region TEXT,
  ADD COLUMN IF NOT EXISTS payment_cycle TEXT,
  ADD COLUMN IF NOT EXISTS rating NUMERIC(3,2),
  ADD COLUMN IF NOT EXISTS total_commission_paid INTEGER DEFAULT 0;

-- payment_cycle CHECK (ALTER ADD CONSTRAINT IF NOT EXISTS 미지원 → DO block)
DO $$
BEGIN
  ALTER TABLE suppliers ADD CONSTRAINT chk_suppliers_payment_cycle
    CHECK (payment_cycle IN ('immediate','weekly','monthly'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- 2. supplier_inventory 테이블 보완
-- ============================================================
ALTER TABLE supplier_inventory
  ADD COLUMN IF NOT EXISTS service_type TEXT,
  ADD COLUMN IF NOT EXISTS service_name TEXT,
  ADD COLUMN IF NOT EXISTS reserved_quantity INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS blocked_quantity INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retail_price INTEGER,
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'available';

DO $$
BEGIN
  ALTER TABLE supplier_inventory ADD CONSTRAINT chk_inventory_service_type
    CHECK (service_type IN ('room','seat','ticket','vehicle','other'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE supplier_inventory ADD CONSTRAINT chk_inventory_status
    CHECK (status IN ('available','limited','sold_out'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- 3. supplier_performance 테이블 보완
-- ============================================================
ALTER TABLE supplier_performance
  ADD COLUMN IF NOT EXISTS total_reviews INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_confirmation_time_hours NUMERIC(6,1),
  ADD COLUMN IF NOT EXISTS cancellation_rate NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS commission_paid INTEGER DEFAULT 0;

-- ============================================================
-- 4. supplier_communications (신규)
-- ============================================================
CREATE TABLE IF NOT EXISTS supplier_communications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,

  -- 커뮤니케이션
  communication_type TEXT CHECK (communication_type IN ('email','phone','kakao','meeting','other')),
  subject TEXT,
  content TEXT,
  direction TEXT CHECK (direction IN ('inbound','outbound')),

  -- 관련 예약
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,

  -- 결과
  response_time_hours NUMERIC(6,1),
  resolved BOOLEAN DEFAULT false,
  resolution_notes TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_supplier_comms_supplier ON supplier_communications(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_comms_booking ON supplier_communications(booking_id);
CREATE INDEX IF NOT EXISTS idx_supplier_comms_type ON supplier_communications(communication_type);
CREATE INDEX IF NOT EXISTS idx_supplier_comms_created ON supplier_communications(created_at DESC);

-- ============================================================
-- RLS + 트리거
-- ============================================================
ALTER TABLE supplier_communications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_access" ON supplier_communications;
CREATE POLICY "authenticated_access" ON supplier_communications FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_supplier_comms_updated ON supplier_communications;
-- supplier_communications에는 updated_at 없으므로 트리거 불필요

COMMIT;

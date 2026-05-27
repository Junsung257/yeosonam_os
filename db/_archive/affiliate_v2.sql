-- ============================================================
-- 여소남 OS: 어필리에이트 시스템 v2 마이그레이션
-- Phase 1 핵심 수정 — Supabase SQL Editor에서 실행
-- ============================================================

-- ─────────────────────────────────────────────────
-- ① affiliates 테이블 컬럼 추가
-- ─────────────────────────────────────────────────

-- 파트너별 커미션율 (기본 9%)
ALTER TABLE affiliates
  ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(5,4) NOT NULL DEFAULT 0.09;

-- 사업자번호 (payout_type=BUSINESS 시)
ALTER TABLE affiliates
  ADD COLUMN IF NOT EXISTS business_number VARCHAR(20);

-- 활성/비활성 (6개월 무전환 시 자동 비활성)
ALTER TABLE affiliates
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- 마지막 전환일 (휴면 판단용)
ALTER TABLE affiliates
  ADD COLUMN IF NOT EXISTS last_conversion_at TIMESTAMPTZ;

-- ─────────────────────────────────────────────────
-- ② bookings 테이블 — surcharge 분리 + 분쟁 플래그
-- ─────────────────────────────────────────────────

-- 추가 비용 항목별 상세 ({"싱글차지": 150000, "비자비": 50000})
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS surcharge_breakdown JSONB DEFAULT '{}';

-- 분쟁 플래그 (정산 제외 판단용)
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS dispute_flag BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS dispute_note TEXT;

-- ─────────────────────────────────────────────────
-- ③ settlements 테이블 — HOLD 상태 + PDF
-- ─────────────────────────────────────────────────

ALTER TABLE settlements
  ADD COLUMN IF NOT EXISTS hold_reason TEXT;

ALTER TABLE settlements
  ADD COLUMN IF NOT EXISTS held_at TIMESTAMPTZ;

ALTER TABLE settlements
  ADD COLUMN IF NOT EXISTS released_at TIMESTAMPTZ;

ALTER TABLE settlements
  ADD COLUMN IF NOT EXISTS pdf_url TEXT;

-- status 제약 업데이트 (HOLD, CANCELLED 추가)
ALTER TABLE settlements DROP CONSTRAINT IF EXISTS settlements_status_check;
ALTER TABLE settlements ADD CONSTRAINT settlements_status_check
  CHECK (status IN ('PENDING', 'READY', 'HOLD', 'COMPLETED', 'CANCELLED', 'VOID'));

-- ─────────────────────────────────────────────────
-- ④ affiliate_applications 테이블 (신규)
-- ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS affiliate_applications (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             VARCHAR(50) NOT NULL,
  phone            VARCHAR(20) NOT NULL,
  channel_type     VARCHAR(20) NOT NULL,
  channel_url      TEXT NOT NULL,
  follower_count   INTEGER,
  intro            TEXT,
  business_type    VARCHAR(10) NOT NULL DEFAULT 'individual'
    CHECK (business_type IN ('individual', 'business')),
  business_number  VARCHAR(20),
  status           VARCHAR(20) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  reject_reason    TEXT,
  applied_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at      TIMESTAMPTZ,
  reviewed_by      UUID
);

CREATE INDEX IF NOT EXISTS idx_applications_status ON affiliate_applications(status);

-- ─────────────────────────────────────────────────
-- ⑤ 등급 트리거 업데이트 (기획서 기준)
-- 브론즈: 기본 (0%)
-- 실버: 5건+ (0.5%)
-- 골드: 15건+ (1.0%)
-- 플래티넘: 30건+ (1.5%)
-- 다이아: 50건+ (2.0%)
-- ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION auto_grade_affiliate()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.booking_count >= 50 THEN
    NEW.grade := 5; NEW.bonus_rate := 0.020;  -- 다이아 +2.0%
  ELSIF NEW.booking_count >= 30 THEN
    NEW.grade := 4; NEW.bonus_rate := 0.015;  -- 플래티넘 +1.5%
  ELSIF NEW.booking_count >= 15 THEN
    NEW.grade := 3; NEW.bonus_rate := 0.010;  -- 골드 +1.0%
  ELSIF NEW.booking_count >= 5 THEN
    NEW.grade := 2; NEW.bonus_rate := 0.005;  -- 실버 +0.5%
  ELSE
    NEW.grade := 1; NEW.bonus_rate := 0.000;  -- 브론즈 0%
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 트리거는 기존 것이 있으므로 재생성 불필요 (함수만 교체하면 자동 적용)

-- ─────────────────────────────────────────────────
-- ⑥ RLS 정책 (affiliate_applications)
-- ─────────────────────────────────────────────────

ALTER TABLE affiliate_applications ENABLE ROW LEVEL SECURITY;

-- 관리자/서비스 전체 접근
CREATE POLICY allow_all_affiliate_applications ON affiliate_applications
  FOR ALL USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────
-- ⑦ 확인 쿼리
-- ─────────────────────────────────────────────────

SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('affiliates', 'settlements', 'affiliate_applications', 'bookings')
ORDER BY table_name;

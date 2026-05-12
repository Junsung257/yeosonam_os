-- ═══════════════════════════════════════════════════════════════════════════
-- Hot table composite indexes (실측 쿼리 패턴 기반, 실제 스키마 정합)
-- 적용일: 2026-05-10 (v2 — Supabase MCP)
-- 주의: affiliate_touchpoints 테이블은 현재 DB에 미존재 → 해당 인덱스 제외
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. bookings — settlement-auto.ts 정산 파이프라인 (월 1회 모든 affiliate 순회)
CREATE INDEX IF NOT EXISTS idx_bookings_affiliate_departure
  ON public.bookings (affiliate_id, departure_date DESC)
  WHERE status IN ('confirmed', 'completed', 'fully_paid')
    AND (is_deleted IS FALSE OR is_deleted IS NULL);

-- 2. settlements — settlement-auto.ts / settlements/route.ts (period 단건 조회)
CREATE INDEX IF NOT EXISTS idx_settlements_affiliate_period
  ON public.settlements (affiliate_id, settlement_period DESC);

-- 3. settlements — affiliates/leaderboard/route.ts (월별 리더보드)
CREATE INDEX IF NOT EXISTS idx_settlements_period_status
  ON public.settlements (settlement_period, status, final_payout DESC)
  WHERE status IN ('READY', 'COMPLETED');

-- 4. message_logs — 예약 상세 타임라인 뷰
CREATE INDEX IF NOT EXISTS idx_message_logs_booking_created
  ON public.message_logs (booking_id, created_at ASC);

-- ─────────────────────────────────────────────────────────────────────────
-- v_bookings_kpi : 어드민 대시보드 KPI 의 단일 진실 공급원 (SSOT)
--
-- 목적 (작성: 2026-04-28)
-- 1) 월별 확정매출 (출발일 기준, IFRS 15 / ASC 606 표준 매출 인식)
--    https://www.iata.org/contentassets/4a4b100c43794398baf73dcea6b5ad42/iawg-guidance-ifrs-15.pdf
-- 2) 월별 신규예약 (생성일 KST 기준, 취소 가능)
-- 3) Booking Pace / Lead Time / Cancellation Rate 일관 산출
--
-- 모든 어드민 KPI 는 본 뷰만 통해서 산출 (V1/V3 dashboard.ts 산식 불일치 제거).
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_bookings_kpi AS
SELECT
  b.id,
  b.booking_no,
  b.created_at,
  b.departure_date,
  b.cancelled_at,
  b.status,
  b.payment_status,
  b.settlement_mode,
  b.booking_type,
  b.departure_region,
  b.land_operator_id,
  b.affiliate_id,
  b.utm_source,
  b.utm_campaign,
  b.tenant_id,

  -- 라이프사이클 상태 (live / cancelled)
  CASE WHEN b.status = 'cancelled' THEN 'cancelled' ELSE 'live' END AS lifecycle_state,

  -- IFRS 15 / ASC 606: 출발일이 이미 지난 비취소 예약 = 매출 인식 (Recognized)
  (b.status <> 'cancelled' AND b.departure_date IS NOT NULL AND b.departure_date <= CURRENT_DATE) AS is_recognized,

  -- 출발일 기준 월 (recognized revenue 집계용)
  to_char(b.departure_date, 'YYYY-MM') AS departure_month,

  -- 생성일 기준 월 (booking pace, KST 기준)
  to_char((b.created_at AT TIME ZONE 'Asia/Seoul')::date, 'YYYY-MM') AS booking_month,

  -- 금액 (NULL → 0)
  COALESCE(b.total_price, 0) AS gmv,
  COALESCE(b.total_cost, 0) AS cogs,
  COALESCE(b.paid_amount, 0) AS paid_amount,
  COALESCE(b.margin, 0) AS margin,
  COALESCE(b.influencer_commission, 0) AS influencer_commission,
  COALESCE(b.total_price, 0) - COALESCE(b.paid_amount, 0) AS outstanding,

  -- 리드타임: 예약→출발 D-N
  CASE
    WHEN b.departure_date IS NOT NULL AND b.created_at IS NOT NULL
    THEN (b.departure_date - (b.created_at AT TIME ZONE 'Asia/Seoul')::date)
  END AS lead_time_days
FROM public.bookings b
WHERE COALESCE(b.is_deleted, false) = false;

COMMENT ON VIEW public.v_bookings_kpi IS '어드민 대시보드 KPI SSOT. is_recognized = 출발일 ≤ 오늘 & 비취소 (IFRS 15/ASC 606).';

-- ── 월별 확정매출 (출발일 기준) ─────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_monthly_recognized_revenue AS
SELECT
  departure_month AS month,
  COUNT(*) AS recognized_bookings,
  COALESCE(SUM(gmv), 0)::bigint AS gmv,
  COALESCE(SUM(margin), 0)::bigint AS margin,
  COALESCE(SUM(paid_amount), 0)::bigint AS paid,
  COALESCE(SUM(outstanding), 0)::bigint AS outstanding,
  COALESCE(SUM(influencer_commission), 0)::bigint AS commission
FROM public.v_bookings_kpi
WHERE is_recognized = true
GROUP BY departure_month;

COMMENT ON VIEW public.v_monthly_recognized_revenue IS '월별 확정매출 — 출발일이 이미 지난 비취소 예약. 회계 매출 인식 기준.';

-- ── 월별 신규예약 (생성일 기준) ─────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_monthly_new_bookings AS
SELECT
  booking_month AS month,
  COUNT(*) AS total_bookings,
  COUNT(*) FILTER (WHERE lifecycle_state = 'live') AS live_bookings,
  COUNT(*) FILTER (WHERE lifecycle_state = 'cancelled') AS cancelled_bookings,
  COALESCE(SUM(gmv) FILTER (WHERE lifecycle_state = 'live'), 0)::bigint AS gmv_live,
  COALESCE(SUM(gmv), 0)::bigint AS gmv_total,
  AVG(lead_time_days) FILTER (WHERE lifecycle_state = 'live') AS avg_lead_time
FROM public.v_bookings_kpi
GROUP BY booking_month;

COMMENT ON VIEW public.v_monthly_new_bookings IS '월별 신규예약 — 생성일(KST) 기준. 취소 가능. 마케팅/영업 KPI.';

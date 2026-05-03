-- 고객별 예약 건수·매출 집계 뷰 — CRM getCustomers()에서 bookings 전량 로드(N+1) 제거
-- 서비스 롤·PostgREST: 뷰는 bookings RLS를 상속; 어드민 API는 service role로 조회

CREATE OR REPLACE VIEW public.customer_booking_stats AS
SELECT
  lead_customer_id AS customer_id,
  COUNT(*)::bigint AS booking_count,
  COALESCE(SUM(total_price), 0)::numeric AS total_sales
FROM public.bookings
WHERE lead_customer_id IS NOT NULL
  AND (is_deleted IS FALSE OR is_deleted IS NULL)
  AND (status IS DISTINCT FROM 'cancelled')
GROUP BY lead_customer_id;

COMMENT ON VIEW public.customer_booking_stats IS
  'lead_customer_id 기준 예약 건수·total_price 합 — 소프트삭제·취소 제외 (getCustomers 통계용)';

GRANT SELECT ON public.customer_booking_stats TO authenticated;
GRANT SELECT ON public.customer_booking_stats TO service_role;

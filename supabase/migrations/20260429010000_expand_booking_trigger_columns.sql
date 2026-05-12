-- ─────────────────────────────────────────────────────────────────────────
-- bookings 트리거 UPDATE OF 컬럼 확장 (2026-04-29 part 2)
--
-- 문제 (20260429000000 함수 수정 후 검증 시 발견):
--  - trg_payment_status: paid_amount 변경 시에만 발화 → 단가 변경 시 갱신 안 됨
--  - trg_booking_margin: 7개 컬럼만 감지 → child_n/child_e/infant/single_charge/total_price 변경 누락
--  - 함수 본문은 이 모든 컬럼을 사용하므로 트리거 정의도 일치시켜야 함
--
-- 수정: DROP + CREATE 로 컬럼 리스트 확장. 함수는 그대로 유지.
-- ─────────────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_payment_status ON public.bookings;
CREATE TRIGGER trg_payment_status
  BEFORE INSERT OR UPDATE OF
    paid_amount,
    adult_count, adult_price,
    child_count, child_price,
    child_n_count, child_n_price,
    child_e_count, child_e_price,
    infant_count, infant_price,
    single_charge_count, single_charge,
    fuel_surcharge, total_price
  ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.update_payment_status();

DROP TRIGGER IF EXISTS trg_booking_margin ON public.bookings;
CREATE TRIGGER trg_booking_margin
  BEFORE INSERT OR UPDATE OF
    adult_count, adult_price, adult_cost,
    child_count, child_price, child_cost,
    child_n_count, child_n_price, child_n_cost,
    child_e_count, child_e_price, child_e_cost,
    infant_count, infant_price, infant_cost,
    single_charge_count, single_charge,
    fuel_surcharge, cost_snapshot_krw, influencer_commission,
    total_price, total_cost
  ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.calc_booking_margin();

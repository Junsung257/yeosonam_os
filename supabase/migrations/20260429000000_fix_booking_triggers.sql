-- ─────────────────────────────────────────────────────────────────────────
-- bookings 트리거 함수 2종 수정 (2026-04-29)
--
-- 진단 (production 36건 중):
--  - update_payment_status(): _cost 컬럼 사용 → _price 사용해야 함 (94% 모순)
--  - calc_booking_margin(): 가격/원가 산식 비대칭, 보조 컬럼 누락 (14% 모순)
--
-- 본 마이그레이션은 트리거 자체(trg_*)는 건드리지 않고 함수 본문만 교체.
-- 새 INSERT/UPDATE 부터 정상 작동. 기존 데이터 백필은 별도 단계.
-- 롤백: 함수 본문은 git 이전 버전 또는 원본 마이그레이션에서 복원.
-- ─────────────────────────────────────────────────────────────────────────

-- ── Fix #1: update_payment_status() ─────────────────────────────────────
-- 변경:
--  - _cost (원가) → _price (판매가) 컬럼 사용
--  - child_n, child_e, infant, single_charge, fuel_surcharge 모두 합산
--  - total_price 가 직접 입력된 경우 fallback (calc_total=0 무시 버그 해결)

CREATE OR REPLACE FUNCTION public.update_payment_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  calc_total INTEGER;
BEGIN
  -- 우선 단가 합산 (정상 입력 패턴)
  calc_total := COALESCE(NEW.adult_count, 0)   * COALESCE(NEW.adult_price, 0)
              + COALESCE(NEW.child_count, 0)   * COALESCE(NEW.child_price, 0)
              + COALESCE(NEW.child_n_count, 0) * COALESCE(NEW.child_n_price, 0)
              + COALESCE(NEW.child_e_count, 0) * COALESCE(NEW.child_e_price, 0)
              + COALESCE(NEW.infant_count, 0)  * COALESCE(NEW.infant_price, 0)
              + COALESCE(NEW.single_charge_count, 0) * COALESCE(NEW.single_charge, 0)
              + COALESCE(NEW.fuel_surcharge, 0);

  -- 단가가 모두 0이면 total_price (요약 입력 패턴) 사용
  IF calc_total = 0 AND COALESCE(NEW.total_price, 0) > 0 THEN
    calc_total := NEW.total_price;
  END IF;

  -- 양쪽 모두 0이면 payment_status 변경 안 함 (default '미입금' 유지)
  IF calc_total > 0 THEN
    IF COALESCE(NEW.paid_amount, 0) >= calc_total THEN
      NEW.payment_status := '완납';
    ELSIF COALESCE(NEW.paid_amount, 0) > 0 THEN
      NEW.payment_status := '일부입금';
    ELSE
      NEW.payment_status := '미입금';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.update_payment_status() IS
  '입금액 vs 판매가 비교로 payment_status 자동 갱신. 2026-04-29 fix: _cost→_price + 보조 컬럼 합산 + total_price fallback.';

-- ── Fix #2: calc_booking_margin() ────────────────────────────────────────
-- 변경:
--  - revenue: 모든 가격 컬럼 합산 + total_price fallback
--  - cost: cost_snapshot_krw 우선, 없으면 단가 cost 합산, 없으면 total_cost
--  - 비대칭 산식 → 대칭 산식 (revenue/cost 동일 logic 으로 결정)

CREATE OR REPLACE FUNCTION public.calc_booking_margin()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  revenue INTEGER;
  cost    INTEGER;
BEGIN
  -- Revenue (판매가 합산 + fallback)
  revenue := COALESCE(NEW.adult_count, 0)   * COALESCE(NEW.adult_price, 0)
           + COALESCE(NEW.child_count, 0)   * COALESCE(NEW.child_price, 0)
           + COALESCE(NEW.child_n_count, 0) * COALESCE(NEW.child_n_price, 0)
           + COALESCE(NEW.child_e_count, 0) * COALESCE(NEW.child_e_price, 0)
           + COALESCE(NEW.infant_count, 0)  * COALESCE(NEW.infant_price, 0)
           + COALESCE(NEW.single_charge_count, 0) * COALESCE(NEW.single_charge, 0)
           + COALESCE(NEW.fuel_surcharge, 0);
  IF revenue = 0 AND COALESCE(NEW.total_price, 0) > 0 THEN
    revenue := NEW.total_price;
  END IF;

  -- Cost: cost_snapshot_krw (확정값) 우선 → 단가 cost 합산 → total_cost
  IF COALESCE(NEW.cost_snapshot_krw, 0) > 0 THEN
    cost := NEW.cost_snapshot_krw;
  ELSE
    cost := COALESCE(NEW.adult_count, 0)   * COALESCE(NEW.adult_cost, 0)
          + COALESCE(NEW.child_count, 0)   * COALESCE(NEW.child_cost, 0)
          + COALESCE(NEW.child_n_count, 0) * COALESCE(NEW.child_n_cost, 0)
          + COALESCE(NEW.child_e_count, 0) * COALESCE(NEW.child_e_cost, 0)
          + COALESCE(NEW.infant_count, 0)  * COALESCE(NEW.infant_cost, 0);
    IF cost = 0 AND COALESCE(NEW.total_cost, 0) > 0 THEN
      cost := NEW.total_cost;
    END IF;
  END IF;

  NEW.margin := revenue - cost - COALESCE(NEW.influencer_commission, 0);
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.calc_booking_margin() IS
  '예약 마진 자동 계산. 2026-04-29 fix: revenue/cost 모두 가격 컬럼 합산 + total_price/total_cost fallback + cost_snapshot_krw 우선.';

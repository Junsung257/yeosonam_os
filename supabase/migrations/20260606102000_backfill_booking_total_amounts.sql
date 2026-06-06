-- Backfill booking totals for rows that have component prices but zero totals.
-- This keeps affiliate dashboards and admin revenue views usable for records
-- created before createBooking persisted total_price/total_cost.

UPDATE public.bookings
SET
  total_price =
    COALESCE(adult_count, 0) * COALESCE(adult_price, 0)
    + COALESCE(child_count, 0) * COALESCE(child_price, 0)
    + COALESCE(child_n_count, 0) * COALESCE(child_n_price, 0)
    + COALESCE(child_e_count, 0) * COALESCE(child_e_price, 0)
    + COALESCE(infant_count, 0) * COALESCE(infant_price, 0)
    + COALESCE(single_charge_count, 0) * COALESCE(single_charge, 0)
    + COALESCE(fuel_surcharge, 0),
  updated_at = NOW()
WHERE COALESCE(total_price, 0) = 0
  AND (
    COALESCE(adult_count, 0) * COALESCE(adult_price, 0)
    + COALESCE(child_count, 0) * COALESCE(child_price, 0)
    + COALESCE(child_n_count, 0) * COALESCE(child_n_price, 0)
    + COALESCE(child_e_count, 0) * COALESCE(child_e_price, 0)
    + COALESCE(infant_count, 0) * COALESCE(infant_price, 0)
    + COALESCE(single_charge_count, 0) * COALESCE(single_charge, 0)
    + COALESCE(fuel_surcharge, 0)
  ) > 0;

UPDATE public.bookings
SET
  total_cost =
    COALESCE(adult_count, 0) * COALESCE(adult_cost, 0)
    + COALESCE(child_count, 0) * COALESCE(child_cost, 0)
    + COALESCE(child_n_count, 0) * COALESCE(child_n_cost, 0)
    + COALESCE(child_e_count, 0) * COALESCE(child_e_cost, 0)
    + COALESCE(infant_count, 0) * COALESCE(infant_cost, 0),
  updated_at = NOW()
WHERE COALESCE(total_cost, 0) = 0
  AND (
    COALESCE(adult_count, 0) * COALESCE(adult_cost, 0)
    + COALESCE(child_count, 0) * COALESCE(child_cost, 0)
    + COALESCE(child_n_count, 0) * COALESCE(child_n_cost, 0)
    + COALESCE(child_e_count, 0) * COALESCE(child_e_cost, 0)
    + COALESCE(infant_count, 0) * COALESCE(infant_cost, 0)
  ) > 0;

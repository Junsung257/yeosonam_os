-- Affiliate commission policy V2.
-- Adds an explicit calculation lifecycle and immutable policy-set evidence.
-- Existing bookings are not recalculated or backfilled by this migration.

BEGIN;

ALTER TABLE public.os_policies
  ADD COLUMN IF NOT EXISTS policy_version integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'os_policies_policy_version_positive_chk'
      AND conrelid = 'public.os_policies'::regclass
  ) THEN
    ALTER TABLE public.os_policies
      ADD CONSTRAINT os_policies_policy_version_positive_chk
      CHECK (policy_version > 0);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.bump_os_policy_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF ROW(
    NEW.trigger_type, NEW.trigger_config, NEW.action_type, NEW.action_config,
    NEW.target_scope, NEW.starts_at, NEW.ends_at, NEW.is_active
  ) IS DISTINCT FROM ROW(
    OLD.trigger_type, OLD.trigger_config, OLD.action_type, OLD.action_config,
    OLD.target_scope, OLD.starts_at, OLD.ends_at, OLD.is_active
  ) AND NEW.policy_version = OLD.policy_version THEN
    NEW.policy_version := OLD.policy_version + 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS os_policies_bump_policy_version ON public.os_policies;
CREATE TRIGGER os_policies_bump_policy_version
BEFORE UPDATE ON public.os_policies
FOR EACH ROW EXECUTE FUNCTION public.bump_os_policy_version();

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS commission_status text NOT NULL DEFAULT 'NOT_APPLICABLE',
  ADD COLUMN IF NOT EXISTS commission_base_amount_krw bigint,
  ADD COLUMN IF NOT EXISTS commission_policy_set_version text,
  ADD COLUMN IF NOT EXISTS commission_calculation_trace_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bookings_commission_status_chk'
      AND conrelid = 'public.bookings'::regclass
  ) THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_commission_status_chk
      CHECK (commission_status IN (
        'NOT_APPLICABLE', 'CALCULATION_HOLD', 'CALCULATED', 'BLOCKED_SELF_REFERRAL', 'REVERSED'
      ));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bookings_commission_base_nonnegative_chk'
      AND conrelid = 'public.bookings'::regclass
  ) THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_commission_base_nonnegative_chk
      CHECK (commission_base_amount_krw IS NULL OR commission_base_amount_krw >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bookings_commission_v2_calculated_chk'
      AND conrelid = 'public.bookings'::regclass
  ) THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_commission_v2_calculated_chk
      CHECK (
        commission_status <> 'CALCULATED'
        OR (
          commission_base_amount_krw IS NOT NULL
          AND commission_policy_set_version IS NOT NULL
          AND commission_calculation_trace_id IS NOT NULL
          AND applied_total_commission_rate IS NOT NULL
          AND applied_total_commission_rate BETWEEN 0 AND 0.07
          AND influencer_commission IS NOT NULL
          AND influencer_commission >= 0
          AND commission_breakdown IS NOT NULL
        )
      ) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS bookings_commission_hold_idx
  ON public.bookings(created_at DESC)
  WHERE commission_status = 'CALCULATION_HOLD';
CREATE INDEX IF NOT EXISTS bookings_commission_trace_idx
  ON public.bookings(commission_calculation_trace_id)
  WHERE commission_calculation_trace_id IS NOT NULL;

ALTER TABLE public.travel_packages
  DROP CONSTRAINT IF EXISTS travel_packages_aff_commission_range;
ALTER TABLE public.travel_packages
  ADD CONSTRAINT travel_packages_aff_commission_system_range_chk
  CHECK (affiliate_commission_rate BETWEEN 0 AND 0.07) NOT VALID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'affiliates_bonus_rate_system_range_chk'
      AND conrelid = 'public.affiliates'::regclass
  ) THEN
    ALTER TABLE public.affiliates
      ADD CONSTRAINT affiliates_bonus_rate_system_range_chk
      CHECK (bonus_rate IS NULL OR bonus_rate BETWEEN 0 AND 0.07) NOT VALID;
  END IF;
END $$;

COMMENT ON COLUMN public.bookings.commission_status IS
  'Commission calculation lifecycle. Policy/data read failures must remain CALCULATION_HOLD, never silently default.';
COMMENT ON COLUMN public.bookings.commission_policy_set_version IS
  'SHA-256 digest of system cap plus applied policy IDs and versions at booking time.';
COMMENT ON COLUMN public.bookings.commission_calculation_trace_id IS
  'Stable calculation trace joining booking snapshot, commission ledger and settlement evidence.';
COMMENT ON COLUMN public.affiliates.commission_rate IS
  'Legacy display field only. Booking calculations use product base rate + tier bonus + campaign policy + mandatory system cap.';

REVOKE ALL ON FUNCTION public.bump_os_policy_version() FROM PUBLIC, anon, authenticated;

COMMIT;

-- Manual rollback (before V2 bookings exist):
-- BEGIN;
-- DROP INDEX IF EXISTS public.bookings_commission_trace_idx;
-- DROP INDEX IF EXISTS public.bookings_commission_hold_idx;
-- ALTER TABLE public.bookings
--   DROP CONSTRAINT IF EXISTS bookings_commission_v2_calculated_chk,
--   DROP CONSTRAINT IF EXISTS bookings_commission_base_nonnegative_chk,
--   DROP CONSTRAINT IF EXISTS bookings_commission_status_chk,
--   DROP COLUMN IF EXISTS commission_calculation_trace_id,
--   DROP COLUMN IF EXISTS commission_policy_set_version,
--   DROP COLUMN IF EXISTS commission_base_amount_krw,
--   DROP COLUMN IF EXISTS commission_status;
-- ALTER TABLE public.travel_packages DROP CONSTRAINT IF EXISTS travel_packages_aff_commission_system_range_chk;
-- ALTER TABLE public.travel_packages ADD CONSTRAINT travel_packages_aff_commission_range
--   CHECK (affiliate_commission_rate BETWEEN 0 AND 0.30) NOT VALID;
-- ALTER TABLE public.affiliates DROP CONSTRAINT IF EXISTS affiliates_bonus_rate_system_range_chk;
-- DROP TRIGGER IF EXISTS os_policies_bump_policy_version ON public.os_policies;
-- DROP FUNCTION IF EXISTS public.bump_os_policy_version();
-- ALTER TABLE public.os_policies DROP CONSTRAINT IF EXISTS os_policies_policy_version_positive_chk;
-- ALTER TABLE public.os_policies DROP COLUMN IF EXISTS policy_version;
-- COMMIT;

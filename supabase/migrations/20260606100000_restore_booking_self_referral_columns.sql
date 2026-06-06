BEGIN;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS self_referral_flag boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS self_referral_reason text;

CREATE INDEX IF NOT EXISTS idx_bookings_self_referral_flag
  ON public.bookings (self_referral_flag)
  WHERE self_referral_flag = true;

COMMENT ON COLUMN public.bookings.self_referral_flag IS 'True when affiliate booking is identified as self-referral and excluded from commission settlement.';
COMMENT ON COLUMN public.bookings.self_referral_reason IS 'Reason code for self-referral detection, e.g. PHONE_MATCH or EMAIL_MATCH.';

NOTIFY pgrst, 'reload schema';

COMMIT;

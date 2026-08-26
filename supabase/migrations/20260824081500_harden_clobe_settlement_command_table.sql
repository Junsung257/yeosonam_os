-- Security and lookup hardening for the already-applied Clobe settlement
-- command idempotency table. Production verification on 2026-08-24 showed
-- zero rows, so the supporting booking index is safe to create directly.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_clobe_settlement_commands_booking
  ON public.clobe_settlement_command_idempotency(booking_id);

ALTER TABLE public.clobe_settlement_command_idempotency ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.clobe_settlement_command_idempotency FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.clobe_settlement_command_idempotency TO service_role;

DROP POLICY IF EXISTS clobe_settlement_command_idempotency_service_role
  ON public.clobe_settlement_command_idempotency;
CREATE POLICY clobe_settlement_command_idempotency_service_role
  ON public.clobe_settlement_command_idempotency
  FOR ALL
  TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);

COMMIT;

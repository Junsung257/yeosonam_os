-- Follow-up hardening for the already-applied Clobe reconciliation migration.
-- Keep the command journal service-role-only and make both foreign-key lookup
-- paths explicit for operational audits and deletes.

ALTER TABLE public.clobe_existing_booking_deposit_commands ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clobe_existing_booking_deposit_commands_service_role_only
  ON public.clobe_existing_booking_deposit_commands;
CREATE POLICY clobe_existing_booking_deposit_commands_service_role_only
  ON public.clobe_existing_booking_deposit_commands
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON public.clobe_existing_booking_deposit_commands FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.clobe_existing_booking_deposit_commands TO service_role;

CREATE INDEX IF NOT EXISTS idx_clobe_booking_settlement_snapshots_tenant
  ON public.clobe_booking_settlement_snapshots(tenant_id);

CREATE INDEX IF NOT EXISTS idx_clobe_existing_booking_commands_transaction
  ON public.clobe_existing_booking_deposit_commands(bank_transaction_id);

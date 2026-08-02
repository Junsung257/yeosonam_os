-- A one-time authoritative rebuild reverses the pre-existing booking totals
-- before Clobe bank rows are allocated again from a clean baseline.

ALTER TABLE public.ledger_entries
  DROP CONSTRAINT IF EXISTS ledger_entries_source_check;

ALTER TABLE public.ledger_entries
  ADD CONSTRAINT ledger_entries_source_check
  CHECK (
    source = ANY (ARRAY[
      'slack_ingest',
      'payment_match_confirm',
      'land_settlement_create',
      'land_settlement_reverse',
      'admin_manual_edit',
      'booking_create_softmatch',
      'bank_tx_manual_match',
      'sms_payment',
      'cron_resync',
      'seed_phase2a',
      'bank_tx_legacy_reassignment',
      'bank_tx_clobe_rebuild'
    ])
  );

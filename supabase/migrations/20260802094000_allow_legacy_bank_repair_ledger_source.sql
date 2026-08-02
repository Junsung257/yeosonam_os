-- The legacy allocation repair RPC records explicit ledger transfers when a
-- historical memo was attached to a different booking.

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
      'bank_tx_legacy_reassignment'
    ])
  );

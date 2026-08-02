-- The legacy allocation repair RPC writes an explicit audit event. Keep the
-- event type allow-list aligned with the settlement repair workflow.

ALTER TABLE public.ops_events
  DROP CONSTRAINT IF EXISTS ops_events_event_type_check;

ALTER TABLE public.ops_events
  ADD CONSTRAINT ops_events_event_type_check
  CHECK (
    event_type = ANY (ARRAY[
      'booking_created',
      'booking_updated',
      'booking_cancelled',
      'payment_matched',
      'payment_unmatched',
      'payment_imported',
      'payment_excluded',
      'customer_updated',
      'customer_note',
      'mileage_adjusted',
      'ledger_drift',
      'settlement_created',
      'settlement_reversed',
      'bank_transaction_repaired'
    ]
  );

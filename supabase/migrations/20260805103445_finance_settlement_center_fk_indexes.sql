CREATE INDEX IF NOT EXISTS idx_bank_transaction_classifications_rule
  ON public.bank_transaction_classifications(rule_id)
  WHERE rule_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_settlement_period_exceptions_period
  ON public.settlement_period_exceptions(settlement_period_id)
  WHERE settlement_period_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_settlement_period_exceptions_booking
  ON public.settlement_period_exceptions(booking_id)
  WHERE booking_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_settlement_period_exceptions_bank_transaction
  ON public.settlement_period_exceptions(bank_transaction_id)
  WHERE bank_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_settlement_periods_closed_by
  ON public.settlement_periods(closed_by)
  WHERE closed_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_settlement_periods_reopened_by
  ON public.settlement_periods(reopened_by)
  WHERE reopened_by IS NOT NULL;

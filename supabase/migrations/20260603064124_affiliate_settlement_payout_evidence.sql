-- Affiliate settlement payout evidence.
-- COMPLETED settlements must be traceable to an actual payout and receipt.

ALTER TABLE public.settlements
  ADD COLUMN IF NOT EXISTS payout_reference text,
  ADD COLUMN IF NOT EXISTS paid_by text,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS withholding_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS receipt_url text;

COMMENT ON COLUMN public.settlements.payout_reference IS
'External payout reference, bank transaction id, or internal payment evidence id required before COMPLETED.';

COMMENT ON COLUMN public.settlements.paid_by IS
'Admin/service actor that marked the affiliate settlement payout as completed.';

COMMENT ON COLUMN public.settlements.paid_at IS
'Actual affiliate settlement payout timestamp.';

COMMENT ON COLUMN public.settlements.withholding_amount IS
'Withholding/tax amount recorded at payout completion.';

COMMENT ON COLUMN public.settlements.receipt_url IS
'Receipt or payout evidence URL required before COMPLETED.';

CREATE INDEX IF NOT EXISTS idx_settlements_paid_at
  ON public.settlements(paid_at DESC)
  WHERE paid_at IS NOT NULL;

ALTER TABLE public.settlements
  DROP CONSTRAINT IF EXISTS settlements_completed_payout_evidence_chk;

ALTER TABLE public.settlements
  ADD CONSTRAINT settlements_completed_payout_evidence_chk
  CHECK (
    status <> 'COMPLETED'
    OR (
      length(trim(coalesce(payout_reference, ''))) > 0
      AND length(trim(coalesce(paid_by, ''))) > 0
      AND paid_at IS NOT NULL
      AND withholding_amount >= 0
      AND final_total >= 0
      AND final_payout >= 0
      AND withholding_amount <= final_total
      AND abs((coalesce(final_payout, 0) + withholding_amount) - coalesce(final_total, 0)) <= 1
      AND length(trim(coalesce(receipt_url, ''))) > 0
      AND receipt_url ~* '^https?://'
    )
  ) NOT VALID;

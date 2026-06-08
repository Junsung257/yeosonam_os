ALTER TABLE public.product_registration_improvement_events
  ADD COLUMN IF NOT EXISTS attempt_phase text NOT NULL DEFAULT 'normal_registration';

ALTER TABLE public.product_registration_improvement_events
  DROP CONSTRAINT IF EXISTS product_registration_improvement_events_attempt_phase_check;

ALTER TABLE public.product_registration_improvement_events
  ADD CONSTRAINT product_registration_improvement_events_attempt_phase_check
  CHECK (
    attempt_phase IN (
      'normal_registration',
      'deterministic_source_recompare',
      'render_payload_audit_repair',
      'final_reregistration_deliverability_audit'
    )
  );

CREATE INDEX IF NOT EXISTS idx_product_registration_improvement_events_attempt_phase
  ON public.product_registration_improvement_events (attempt_phase, created_at DESC);

COMMENT ON COLUMN public.product_registration_improvement_events.attempt_phase IS
  'Micro auto QA phase: attempt 0 normal registration, then up to three deterministic/render/final repair attempts.';

-- Affiliate settlement ledger V2.
-- No legacy settlement or production amount is migrated by this DDL.
-- Operators must validate and explicitly backfill eligible historical rows.

BEGIN;

CREATE TABLE IF NOT EXISTS public.policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_type text NOT NULL,
  version integer NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  config jsonb NOT NULL,
  effective_from timestamptz NOT NULL,
  effective_to timestamptz NULL,
  created_by text NOT NULL,
  approved_by text NULL,
  approved_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT policy_versions_type_chk CHECK (policy_type IN ('AFFILIATE_SETTLEMENT', 'AFFILIATE_ATTRIBUTION')),
  CONSTRAINT policy_versions_version_chk CHECK (version > 0),
  CONSTRAINT policy_versions_status_chk CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED')),
  CONSTRAINT policy_versions_period_chk CHECK (effective_to IS NULL OR effective_from < effective_to),
  CONSTRAINT policy_versions_approval_chk CHECK (
    status <> 'ACTIVE' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL AND approved_by <> created_by)
  ),
  UNIQUE (policy_type, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS policy_versions_one_active_uq
  ON public.policy_versions(policy_type) WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS public.commission_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE RESTRICT,
  booking_id uuid NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  attribution_decision_id uuid NULL REFERENCES public.attribution_decisions(id) ON DELETE SET NULL,
  entry_type text NOT NULL,
  amount_krw bigint NOT NULL,
  commission_base_krw bigint NULL,
  commission_rate numeric(9,6) NULL,
  policy_set_version text NULL,
  calculation_trace_id uuid NULL,
  source_entry_id uuid NULL REFERENCES public.commission_ledger_entries(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  eligible_at timestamptz NOT NULL,
  hold_reason text NULL,
  entry_snapshot jsonb NOT NULL,
  created_by text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commission_ledger_entry_type_chk CHECK (
    entry_type IN ('EARNED', 'BONUS', 'ADJUSTMENT', 'REVERSAL', 'MIGRATION')
  ),
  CONSTRAINT commission_ledger_amount_chk CHECK (
    (entry_type IN ('EARNED', 'BONUS', 'MIGRATION') AND amount_krw > 0)
    OR (entry_type = 'ADJUSTMENT' AND amount_krw <> 0)
    OR (entry_type = 'REVERSAL' AND amount_krw < 0)
  ),
  CONSTRAINT commission_ledger_base_chk CHECK (commission_base_krw IS NULL OR commission_base_krw >= 0),
  CONSTRAINT commission_ledger_rate_chk CHECK (commission_rate IS NULL OR commission_rate BETWEEN 0 AND 0.07),
  CONSTRAINT commission_ledger_reversal_chk CHECK (
    (entry_type = 'REVERSAL' AND amount_krw < 0 AND source_entry_id IS NOT NULL)
    OR (entry_type <> 'REVERSAL' AND source_entry_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS commission_ledger_entries_idempotency_uq
  ON public.commission_ledger_entries(idempotency_key);
CREATE INDEX IF NOT EXISTS commission_ledger_entries_unsettled_idx
  ON public.commission_ledger_entries(affiliate_id, eligible_at, occurred_at);
CREATE INDEX IF NOT EXISTS commission_ledger_entries_booking_idx
  ON public.commission_ledger_entries(booking_id, occurred_at) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS commission_ledger_entries_source_idx
  ON public.commission_ledger_entries(source_entry_id) WHERE source_entry_id IS NOT NULL;

COMMENT ON TABLE public.commission_ledger_entries IS
  'Append-only affiliate commission evidence. Corrections are new reversal or adjustment entries; source rows are never edited.';

CREATE TABLE IF NOT EXISTS public.settlement_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE RESTRICT,
  settlement_period text NOT NULL,
  period_start_utc timestamptz NOT NULL,
  period_end_utc timestamptz NOT NULL,
  status text NOT NULL,
  hold_reason_code text NULL,
  qualified_booking_count integer NOT NULL DEFAULT 0,
  gross_commission_krw bigint NOT NULL DEFAULT 0,
  adjustment_krw bigint NOT NULL DEFAULT 0,
  tax_type text NOT NULL,
  tax_rate numeric(9,6) NOT NULL DEFAULT 0,
  withholding_krw bigint NOT NULL DEFAULT 0,
  net_payout_krw bigint NOT NULL DEFAULT 0,
  policy_version_id uuid NOT NULL REFERENCES public.policy_versions(id) ON DELETE RESTRICT,
  calculation_trace_id uuid NOT NULL DEFAULT gen_random_uuid(),
  calculation_snapshot jsonb NOT NULL,
  created_by text NOT NULL,
  ready_at timestamptz NULL,
  completed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT settlement_runs_period_label_chk CHECK (settlement_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT settlement_runs_period_chk CHECK (period_start_utc < period_end_utc),
  CONSTRAINT settlement_runs_status_chk CHECK (
    status IN ('HOLD', 'READY', 'PAYOUT_PENDING', 'COMPLETED')
  ),
  CONSTRAINT settlement_runs_amount_chk CHECK (
    gross_commission_krw >= 0
    AND withholding_krw >= 0
    AND net_payout_krw >= 0
    AND tax_rate BETWEEN 0 AND 1
    AND (
      status = 'HOLD'
      OR abs((gross_commission_krw + adjustment_krw) - withholding_krw - net_payout_krw) <= 1
    )
  ),
  CONSTRAINT settlement_runs_hold_chk CHECK (
    (status = 'HOLD' AND hold_reason_code IS NOT NULL)
    OR (status <> 'HOLD')
  ),
  UNIQUE (affiliate_id, settlement_period)
);

CREATE INDEX IF NOT EXISTS settlement_runs_affiliate_idx
  ON public.settlement_runs(affiliate_id, period_start_utc DESC);
CREATE INDEX IF NOT EXISTS settlement_runs_status_idx
  ON public.settlement_runs(status, period_start_utc DESC);

CREATE TABLE IF NOT EXISTS public.settlement_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_run_id uuid NOT NULL REFERENCES public.settlement_runs(id) ON DELETE RESTRICT,
  ledger_entry_id uuid NOT NULL REFERENCES public.commission_ledger_entries(id) ON DELETE RESTRICT,
  booking_id uuid NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  booking_no text NULL,
  product_id uuid NULL REFERENCES public.travel_packages(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  departure_date date NULL,
  return_date date NULL,
  customer_masked text NULL,
  traveler_count integer NOT NULL DEFAULT 0,
  commission_base_krw bigint NULL,
  commission_rate numeric(9,6) NULL,
  policy_set_version text NULL,
  line_type text NOT NULL,
  line_amount_krw bigint NOT NULL,
  calculation_trace_id uuid NULL,
  line_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT settlement_lines_type_chk CHECK (
    line_type IN ('EARNED', 'BONUS', 'ADJUSTMENT', 'REVERSAL', 'MIGRATION')
  ),
  CONSTRAINT settlement_lines_amount_chk CHECK (line_amount_krw <> 0),
  CONSTRAINT settlement_lines_travelers_chk CHECK (traveler_count >= 0),
  UNIQUE (ledger_entry_id)
);

CREATE INDEX IF NOT EXISTS settlement_lines_run_idx ON public.settlement_lines(settlement_run_id, created_at);

CREATE TABLE IF NOT EXISTS public.payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_run_id uuid NOT NULL UNIQUE REFERENCES public.settlement_runs(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'REQUESTED',
  amount_krw bigint NOT NULL,
  payout_reference text NULL,
  receipt_url text NULL,
  bank_transaction_reference text NULL,
  requested_by text NOT NULL,
  approved_by text NULL,
  executed_by text NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz NULL,
  completed_at timestamptz NULL,
  failure_reason text NULL,
  evidence_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payouts_status_chk CHECK (status IN ('REQUESTED', 'APPROVED', 'COMPLETED', 'FAILED')),
  CONSTRAINT payouts_amount_chk CHECK (amount_krw > 0),
  CONSTRAINT payouts_separation_chk CHECK (approved_by IS NULL OR approved_by <> requested_by),
  CONSTRAINT payouts_completed_evidence_chk CHECK (
    status <> 'COMPLETED'
    OR (
      approved_by IS NOT NULL AND executed_by IS NOT NULL
      AND completed_at IS NOT NULL
      AND length(btrim(COALESCE(payout_reference, ''))) > 0
      AND receipt_url ~ '^https://'
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS payouts_reference_uq
  ON public.payouts(payout_reference) WHERE payout_reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.settlement_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_settlement_run_id uuid NOT NULL REFERENCES public.settlement_runs(id) ON DELETE RESTRICT,
  reversal_ledger_entry_id uuid NOT NULL REFERENCES public.commission_ledger_entries(id) ON DELETE RESTRICT,
  revision_type text NOT NULL,
  amount_krw bigint NOT NULL,
  reason text NOT NULL,
  requested_by text NOT NULL,
  approved_by text NOT NULL,
  status text NOT NULL DEFAULT 'APPROVED',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT settlement_revisions_type_chk CHECK (revision_type IN ('FULL_REVERSAL', 'PARTIAL_REVERSAL')),
  CONSTRAINT settlement_revisions_amount_chk CHECK (amount_krw < 0),
  CONSTRAINT settlement_revisions_actor_chk CHECK (requested_by <> approved_by),
  CONSTRAINT settlement_revisions_status_chk CHECK (status IN ('APPROVED', 'RECOVERED', 'WRITTEN_OFF')),
  UNIQUE (reversal_ledger_entry_id)
);

CREATE TABLE IF NOT EXISTS public.affiliate_disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE RESTRICT,
  booking_id uuid NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  settlement_run_id uuid NULL REFERENCES public.settlement_runs(id) ON DELETE RESTRICT,
  settlement_line_id uuid NULL REFERENCES public.settlement_lines(id) ON DELETE RESTRICT,
  dispute_type text NOT NULL,
  status text NOT NULL DEFAULT 'OPEN',
  idempotency_key text NOT NULL,
  reason text NOT NULL,
  evidence_urls text[] NOT NULL DEFAULT '{}'::text[],
  opened_by text NOT NULL,
  assigned_to text NULL,
  resolution text NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz NULL,
  resolved_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT affiliate_disputes_target_chk CHECK (num_nonnulls(booking_id, settlement_run_id, settlement_line_id) >= 1),
  CONSTRAINT affiliate_disputes_type_chk CHECK (dispute_type IN ('ATTRIBUTION', 'COMMISSION', 'SETTLEMENT', 'PAYOUT')),
  CONSTRAINT affiliate_disputes_status_chk CHECK (
    status IN ('OPEN', 'IN_REVIEW', 'NEEDS_INFO', 'RESOLVED', 'REJECTED', 'WITHDRAWN')
  )
);

CREATE INDEX IF NOT EXISTS affiliate_disputes_owner_idx
  ON public.affiliate_disputes(affiliate_id, opened_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS affiliate_disputes_idempotency_uq
  ON public.affiliate_disputes(affiliate_id, idempotency_key);
CREATE INDEX IF NOT EXISTS affiliate_disputes_queue_idx
  ON public.affiliate_disputes(status, due_at) WHERE status IN ('OPEN', 'IN_REVIEW', 'NEEDS_INFO');

CREATE TABLE IF NOT EXISTS public.settlement_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_run_id uuid NOT NULL REFERENCES public.settlement_runs(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  actor text NOT NULL,
  before_status text NULL,
  after_status text NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS settlement_events_run_idx
  ON public.settlement_events(settlement_run_id, created_at);

CREATE TABLE IF NOT EXISTS public.settlement_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  command_type text NOT NULL,
  idempotency_key text NOT NULL,
  actor text NOT NULL,
  settlement_run_id uuid NULL REFERENCES public.settlement_runs(id) ON DELETE RESTRICT,
  payout_id uuid NULL REFERENCES public.payouts(id) ON DELETE RESTRICT,
  request_hash text NOT NULL,
  result_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT settlement_commands_hash_chk CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  UNIQUE (command_type, idempotency_key)
);

CREATE OR REPLACE FUNCTION public.prevent_append_only_mutation_v2()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS commission_ledger_entries_append_only_v2 ON public.commission_ledger_entries;
CREATE TRIGGER commission_ledger_entries_append_only_v2
BEFORE UPDATE OR DELETE ON public.commission_ledger_entries
FOR EACH ROW EXECUTE FUNCTION public.prevent_append_only_mutation_v2();

DROP TRIGGER IF EXISTS settlement_lines_append_only_v2 ON public.settlement_lines;
CREATE TRIGGER settlement_lines_append_only_v2
BEFORE UPDATE OR DELETE ON public.settlement_lines
FOR EACH ROW EXECUTE FUNCTION public.prevent_append_only_mutation_v2();

DROP TRIGGER IF EXISTS settlement_revisions_append_only_v2 ON public.settlement_revisions;
CREATE TRIGGER settlement_revisions_append_only_v2
BEFORE UPDATE OR DELETE ON public.settlement_revisions
FOR EACH ROW EXECUTE FUNCTION public.prevent_append_only_mutation_v2();

DROP TRIGGER IF EXISTS settlement_events_append_only_v2 ON public.settlement_events;
CREATE TRIGGER settlement_events_append_only_v2
BEFORE UPDATE OR DELETE ON public.settlement_events
FOR EACH ROW EXECUTE FUNCTION public.prevent_append_only_mutation_v2();

CREATE OR REPLACE FUNCTION public.protect_settlement_run_v2()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'SETTLEMENT_RUN_DELETE_FORBIDDEN'; END IF;
  IF (OLD.affiliate_id, OLD.settlement_period, OLD.period_start_utc, OLD.period_end_utc,
      OLD.qualified_booking_count, OLD.gross_commission_krw, OLD.adjustment_krw,
      OLD.tax_type, OLD.tax_rate, OLD.withholding_krw, OLD.net_payout_krw,
      OLD.policy_version_id, OLD.calculation_trace_id, OLD.calculation_snapshot, OLD.created_by)
     IS DISTINCT FROM
     (NEW.affiliate_id, NEW.settlement_period, NEW.period_start_utc, NEW.period_end_utc,
      NEW.qualified_booking_count, NEW.gross_commission_krw, NEW.adjustment_krw,
      NEW.tax_type, NEW.tax_rate, NEW.withholding_krw, NEW.net_payout_krw,
      NEW.policy_version_id, NEW.calculation_trace_id, NEW.calculation_snapshot, NEW.created_by) THEN
    RAISE EXCEPTION 'SETTLEMENT_RUN_FINANCIALS_IMMUTABLE';
  END IF;
  IF OLD.status = 'COMPLETED' THEN RAISE EXCEPTION 'COMPLETED_SETTLEMENT_IMMUTABLE'; END IF;
  IF NOT (
    OLD.status = NEW.status
    OR (OLD.status = 'READY' AND NEW.status IN ('HOLD', 'PAYOUT_PENDING'))
    OR (OLD.status = 'HOLD' AND NEW.status = 'READY' AND OLD.hold_reason_code <> 'THRESHOLD_NOT_MET')
    OR (OLD.status = 'PAYOUT_PENDING' AND NEW.status = 'COMPLETED')
  ) THEN
    RAISE EXCEPTION 'INVALID_SETTLEMENT_RUN_TRANSITION';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS settlement_runs_protect_v2 ON public.settlement_runs;
CREATE TRIGGER settlement_runs_protect_v2
BEFORE UPDATE OR DELETE ON public.settlement_runs
FOR EACH ROW EXECUTE FUNCTION public.protect_settlement_run_v2();

CREATE OR REPLACE FUNCTION public.protect_payout_v2()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'PAYOUT_DELETE_FORBIDDEN'; END IF;
  IF OLD.status = 'COMPLETED' THEN RAISE EXCEPTION 'COMPLETED_PAYOUT_IMMUTABLE'; END IF;
  IF OLD.settlement_run_id <> NEW.settlement_run_id OR OLD.amount_krw <> NEW.amount_krw OR OLD.requested_by <> NEW.requested_by THEN
    RAISE EXCEPTION 'PAYOUT_CORE_IMMUTABLE';
  END IF;
  IF NOT (
    OLD.status = NEW.status
    OR (OLD.status = 'REQUESTED' AND NEW.status IN ('APPROVED', 'FAILED'))
    OR (OLD.status = 'APPROVED' AND NEW.status IN ('COMPLETED', 'FAILED'))
  ) THEN
    RAISE EXCEPTION 'INVALID_PAYOUT_TRANSITION';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payouts_protect_v2 ON public.payouts;
CREATE TRIGGER payouts_protect_v2
BEFORE UPDATE OR DELETE ON public.payouts
FOR EACH ROW EXECUTE FUNCTION public.protect_payout_v2();

CREATE OR REPLACE FUNCTION public.create_commission_reversal_v2(
  p_source_entry_id uuid,
  p_amount_krw bigint,
  p_reason text,
  p_requested_by text,
  p_approved_by text,
  p_idempotency_key text
)
RETURNS public.commission_ledger_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source public.commission_ledger_entries%ROWTYPE;
  v_existing public.commission_ledger_entries%ROWTYPE;
  v_entry public.commission_ledger_entries%ROWTYPE;
  v_already_reversed bigint;
  v_completed_run_id uuid;
BEGIN
  IF p_amount_krw <= 0 OR btrim(COALESCE(p_reason, '')) = '' THEN RAISE EXCEPTION 'INVALID_REVERSAL'; END IF;
  IF p_requested_by = p_approved_by THEN RAISE EXCEPTION 'REVERSAL_SEPARATION_REQUIRED'; END IF;
  SELECT * INTO v_existing FROM public.commission_ledger_entries WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN RETURN v_existing; END IF;

  SELECT * INTO v_source FROM public.commission_ledger_entries
  WHERE id = p_source_entry_id AND entry_type <> 'REVERSAL' FOR SHARE;
  IF NOT FOUND OR v_source.amount_krw <= 0 THEN RAISE EXCEPTION 'REVERSAL_SOURCE_NOT_FOUND'; END IF;
  SELECT COALESCE(abs(sum(amount_krw)), 0) INTO v_already_reversed
  FROM public.commission_ledger_entries
  WHERE source_entry_id = p_source_entry_id AND entry_type = 'REVERSAL';
  IF v_already_reversed + p_amount_krw > v_source.amount_krw THEN RAISE EXCEPTION 'REVERSAL_EXCEEDS_SOURCE'; END IF;

  INSERT INTO public.commission_ledger_entries (
    affiliate_id, booking_id, attribution_decision_id, entry_type, amount_krw,
    commission_base_krw, commission_rate, policy_set_version, calculation_trace_id,
    source_entry_id, idempotency_key, eligible_at, entry_snapshot, created_by
  ) VALUES (
    v_source.affiliate_id, v_source.booking_id, v_source.attribution_decision_id,
    'REVERSAL', -p_amount_krw, v_source.commission_base_krw, v_source.commission_rate,
    v_source.policy_set_version, gen_random_uuid(), v_source.id, p_idempotency_key,
    now(), jsonb_build_object('reason', p_reason, 'source_entry_id', v_source.id,
      'requested_by', p_requested_by, 'approved_by', p_approved_by), p_requested_by
  ) RETURNING * INTO v_entry;

  SELECT sr.id INTO v_completed_run_id
  FROM public.settlement_lines sl
  JOIN public.settlement_runs sr ON sr.id = sl.settlement_run_id
  WHERE sl.ledger_entry_id = v_source.id AND sr.status = 'COMPLETED'
  LIMIT 1;
  IF v_completed_run_id IS NOT NULL THEN
    INSERT INTO public.settlement_revisions (
      original_settlement_run_id, reversal_ledger_entry_id, revision_type,
      amount_krw, reason, requested_by, approved_by
    ) VALUES (
      v_completed_run_id, v_entry.id,
      CASE WHEN p_amount_krw = v_source.amount_krw THEN 'FULL_REVERSAL' ELSE 'PARTIAL_REVERSAL' END,
      -p_amount_krw, p_reason, p_requested_by, p_approved_by
    );
  END IF;
  RETURN v_entry;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_affiliate_settlement_run_v2(
  p_affiliate_id uuid,
  p_period text,
  p_actor text,
  p_idempotency_key text,
  p_request_hash text
)
RETURNS public.settlement_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_command public.settlement_commands%ROWTYPE;
  v_existing_run public.settlement_runs%ROWTYPE;
  v_run public.settlement_runs%ROWTYPE;
  v_policy public.policy_versions%ROWTYPE;
  v_affiliate public.affiliates%ROWTYPE;
  v_year integer;
  v_month integer;
  v_start timestamptz;
  v_end timestamptz;
  v_gross bigint;
  v_adjustment bigint;
  v_total bigint;
  v_booking_count integer;
  v_min_amount bigint;
  v_min_bookings integer;
  v_personal_tax_rate numeric;
  v_tax_rate numeric;
  v_withholding bigint;
  v_net bigint;
  v_qualified boolean;
  v_status text;
  v_hold_reason text;
BEGIN
  IF p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' OR btrim(COALESCE(p_actor, '')) = '' THEN
    RAISE EXCEPTION 'INVALID_SETTLEMENT_COMMAND';
  END IF;
  SELECT * INTO v_existing_command FROM public.settlement_commands
  WHERE command_type = 'CREATE_RUN' AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing_command.request_hash <> p_request_hash THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED'; END IF;
    SELECT * INTO v_existing_run FROM public.settlement_runs WHERE id = v_existing_command.settlement_run_id;
    RETURN v_existing_run;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_affiliate_id::text || ':' || p_period, 0));
  SELECT * INTO v_existing_run FROM public.settlement_runs
  WHERE affiliate_id = p_affiliate_id AND settlement_period = p_period;
  IF FOUND THEN
    INSERT INTO public.settlement_commands (
      command_type, idempotency_key, actor, settlement_run_id, request_hash, result_snapshot
    ) VALUES ('CREATE_RUN', p_idempotency_key, p_actor, v_existing_run.id, p_request_hash, to_jsonb(v_existing_run));
    RETURN v_existing_run;
  END IF;

  v_year := split_part(p_period, '-', 1)::integer;
  v_month := split_part(p_period, '-', 2)::integer;
  v_start := make_timestamptz(v_year, v_month, 1, 0, 0, 0, 'Asia/Seoul');
  v_end := v_start + interval '1 month';

  SELECT * INTO v_policy FROM public.policy_versions
  WHERE policy_type = 'AFFILIATE_SETTLEMENT' AND status = 'ACTIVE'
    AND effective_from < v_end AND (effective_to IS NULL OR effective_to >= v_start)
  ORDER BY version DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'SETTLEMENT_POLICY_MISSING'; END IF;
  IF v_policy.config->>'amount_scope' <> 'CUMULATIVE_UNSETTLED'
     OR v_policy.config->>'booking_scope' <> 'CUMULATIVE_UNSETTLED'
     OR v_policy.config->>'eligibility_basis' <> 'RETURN_COMPLETED' THEN
    RAISE EXCEPTION 'SETTLEMENT_POLICY_UNSUPPORTED';
  END IF;
  BEGIN
    v_min_amount := (v_policy.config->>'min_payout_amount_krw')::bigint;
    v_min_bookings := (v_policy.config->>'min_booking_count')::integer;
    v_personal_tax_rate := (v_policy.config->>'personal_withholding_rate')::numeric;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'SETTLEMENT_POLICY_MALFORMED';
  END;
  IF v_min_amount < 0 OR v_min_bookings < 0 OR v_personal_tax_rate NOT BETWEEN 0 AND 1 THEN
    RAISE EXCEPTION 'SETTLEMENT_POLICY_MALFORMED';
  END IF;

  SELECT * INTO v_affiliate FROM public.affiliates WHERE id = p_affiliate_id;
  IF NOT FOUND OR v_affiliate.is_active IS DISTINCT FROM true
     OR COALESCE(v_affiliate.partner_status, 'active') IN ('suspended', 'terminated') THEN
    RAISE EXCEPTION 'AFFILIATE_NOT_ELIGIBLE';
  END IF;

  SELECT
    COALESCE(sum(CASE WHEN e.entry_type IN ('EARNED', 'BONUS', 'MIGRATION') THEN e.amount_krw ELSE 0 END), 0),
    COALESCE(sum(CASE WHEN e.entry_type IN ('ADJUSTMENT', 'REVERSAL') THEN e.amount_krw ELSE 0 END), 0),
    COALESCE(sum(e.amount_krw), 0),
    count(DISTINCT e.booking_id) FILTER (WHERE e.amount_krw > 0 AND e.booking_id IS NOT NULL)
  INTO v_gross, v_adjustment, v_total, v_booking_count
  FROM public.commission_ledger_entries e
  WHERE e.affiliate_id = p_affiliate_id
    AND e.eligible_at < v_end
    AND e.hold_reason IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.settlement_lines sl WHERE sl.ledger_entry_id = e.id
    );

  v_qualified := v_total >= v_min_amount AND v_booking_count >= v_min_bookings;
  v_tax_rate := CASE WHEN v_affiliate.payout_type = 'PERSONAL' THEN v_personal_tax_rate ELSE 0 END;
  v_withholding := CASE WHEN v_qualified THEN round(v_total * v_tax_rate)::bigint ELSE 0 END;
  v_net := CASE WHEN v_qualified THEN v_total - v_withholding ELSE 0 END;
  v_status := CASE WHEN v_qualified THEN 'READY' ELSE 'HOLD' END;
  v_hold_reason := CASE WHEN v_qualified THEN NULL ELSE 'THRESHOLD_NOT_MET' END;

  INSERT INTO public.settlement_runs (
    affiliate_id, settlement_period, period_start_utc, period_end_utc, status,
    hold_reason_code, qualified_booking_count, gross_commission_krw, adjustment_krw,
    tax_type, tax_rate, withholding_krw, net_payout_krw, policy_version_id,
    calculation_snapshot, created_by, ready_at
  ) VALUES (
    p_affiliate_id, p_period, v_start, v_end, v_status, v_hold_reason,
    v_booking_count, v_gross, v_adjustment,
    CASE WHEN v_affiliate.payout_type = 'PERSONAL' THEN 'PERSONAL_WITHHOLDING' ELSE 'CORPORATE_INVOICE' END,
    v_tax_rate, v_withholding, v_net, v_policy.id,
    jsonb_build_object(
      'timezone', 'Asia/Seoul', 'amount_scope', 'CUMULATIVE_UNSETTLED',
      'booking_scope', 'CUMULATIVE_UNSETTLED', 'eligibility_basis', 'RETURN_COMPLETED',
      'min_payout_amount_krw', v_min_amount, 'min_booking_count', v_min_bookings,
      'unsettled_total_krw', v_total, 'qualified', v_qualified,
      'policy_version', v_policy.version, 'calculated_at', now()
    ), p_actor, CASE WHEN v_qualified THEN now() ELSE NULL END
  ) RETURNING * INTO v_run;

  IF v_qualified THEN
    INSERT INTO public.settlement_lines (
      settlement_run_id, ledger_entry_id, booking_id, booking_no, product_id,
      product_name, departure_date, return_date, customer_masked, traveler_count,
      commission_base_krw, commission_rate, policy_set_version, line_type,
      line_amount_krw, calculation_trace_id, line_snapshot
    )
    SELECT
      v_run.id, e.id, e.booking_id, b.booking_no, b.package_id,
      COALESCE(NULLIF(b.package_title, ''), COALESCE(e.entry_snapshot->>'product_name', '조정')),
      b.departure_date, b.return_date,
      CASE WHEN c.name IS NULL OR btrim(c.name) = '' THEN NULL
        ELSE left(btrim(c.name), 1) || repeat('*', greatest(char_length(btrim(c.name)) - 1, 1)) END,
      COALESCE(b.adult_count, 0) + COALESCE(b.child_count, 0) + COALESCE(b.infant_count, 0),
      e.commission_base_krw, e.commission_rate, e.policy_set_version, e.entry_type,
      e.amount_krw, e.calculation_trace_id,
      jsonb_build_object(
        'ledger_entry', e.entry_snapshot, 'booking_id', e.booking_id,
        'booking_no', b.booking_no, 'product_name', b.package_title,
        'departure_date', b.departure_date, 'return_date', b.return_date,
        'customer_masked', CASE WHEN c.name IS NULL OR btrim(c.name) = '' THEN NULL
          ELSE left(btrim(c.name), 1) || repeat('*', greatest(char_length(btrim(c.name)) - 1, 1)) END,
        'traveler_count', COALESCE(b.adult_count, 0) + COALESCE(b.child_count, 0) + COALESCE(b.infant_count, 0),
        'commission_base_krw', e.commission_base_krw,
        'commission_rate', e.commission_rate,
        'policy_set_version', e.policy_set_version,
        'line_amount_krw', e.amount_krw
      )
    FROM public.commission_ledger_entries e
    LEFT JOIN public.bookings b ON b.id = e.booking_id
    LEFT JOIN public.customers c ON c.id = b.lead_customer_id
    WHERE e.affiliate_id = p_affiliate_id
      AND e.eligible_at < v_end
      AND e.hold_reason IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.settlement_lines sl WHERE sl.ledger_entry_id = e.id)
    ORDER BY e.occurred_at, e.id;
  END IF;

  INSERT INTO public.settlement_commands (
    command_type, idempotency_key, actor, settlement_run_id, request_hash, result_snapshot
  ) VALUES ('CREATE_RUN', p_idempotency_key, p_actor, v_run.id, p_request_hash, to_jsonb(v_run));
  INSERT INTO public.settlement_events (
    settlement_run_id, event_type, actor, before_status, after_status, payload
  ) VALUES (
    v_run.id, 'RUN_CREATED', p_actor, NULL, v_run.status,
    jsonb_build_object('policy_version_id', v_policy.id, 'line_count', CASE WHEN v_qualified THEN v_booking_count ELSE 0 END)
  );
  RETURN v_run;
END;
$$;

CREATE OR REPLACE FUNCTION public.request_affiliate_payout_v2(
  p_run_id uuid,
  p_actor text,
  p_idempotency_key text,
  p_request_hash text
)
RETURNS public.payouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_run public.settlement_runs%ROWTYPE; v_payout public.payouts%ROWTYPE; v_cmd public.settlement_commands%ROWTYPE;
BEGIN
  SELECT * INTO v_cmd FROM public.settlement_commands WHERE command_type = 'REQUEST_PAYOUT' AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_cmd.request_hash <> p_request_hash THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED'; END IF;
    SELECT * INTO v_payout FROM public.payouts WHERE id = v_cmd.payout_id; RETURN v_payout;
  END IF;
  SELECT * INTO v_run FROM public.settlement_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND OR v_run.status <> 'READY' OR v_run.net_payout_krw <= 0 THEN RAISE EXCEPTION 'RUN_NOT_READY_FOR_PAYOUT'; END IF;
  INSERT INTO public.payouts (settlement_run_id, amount_krw, requested_by)
  VALUES (p_run_id, v_run.net_payout_krw, p_actor) RETURNING * INTO v_payout;
  UPDATE public.settlement_runs SET status = 'PAYOUT_PENDING' WHERE id = p_run_id;
  INSERT INTO public.settlement_commands (command_type, idempotency_key, actor, settlement_run_id, payout_id, request_hash, result_snapshot)
  VALUES ('REQUEST_PAYOUT', p_idempotency_key, p_actor, p_run_id, v_payout.id, p_request_hash, to_jsonb(v_payout));
  INSERT INTO public.settlement_events (settlement_run_id, event_type, actor, before_status, after_status, payload)
  VALUES (p_run_id, 'PAYOUT_REQUESTED', p_actor, 'READY', 'PAYOUT_PENDING', jsonb_build_object('payout_id', v_payout.id));
  RETURN v_payout;
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_affiliate_settlement_run_v2(
  p_run_id uuid,
  p_status text,
  p_hold_reason_code text,
  p_actor text,
  p_idempotency_key text,
  p_request_hash text
)
RETURNS public.settlement_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_run public.settlement_runs%ROWTYPE; v_cmd public.settlement_commands%ROWTYPE; v_before text;
BEGIN
  SELECT * INTO v_cmd FROM public.settlement_commands WHERE command_type = 'TRANSITION_RUN' AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_cmd.request_hash <> p_request_hash THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED'; END IF;
    SELECT * INTO v_run FROM public.settlement_runs WHERE id = v_cmd.settlement_run_id; RETURN v_run;
  END IF;
  IF p_status NOT IN ('HOLD', 'READY') THEN RAISE EXCEPTION 'SETTLEMENT_STATUS_NOT_ALLOWED'; END IF;
  SELECT * INTO v_run FROM public.settlement_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SETTLEMENT_RUN_NOT_FOUND'; END IF;
  v_before := v_run.status;
  IF p_status = 'HOLD' AND btrim(COALESCE(p_hold_reason_code, '')) = '' THEN
    RAISE EXCEPTION 'HOLD_REASON_REQUIRED';
  END IF;
  UPDATE public.settlement_runs
  SET status = p_status,
      hold_reason_code = CASE WHEN p_status = 'HOLD' THEN p_hold_reason_code ELSE NULL END,
      ready_at = CASE WHEN p_status = 'READY' THEN COALESCE(ready_at, now()) ELSE ready_at END
  WHERE id = p_run_id RETURNING * INTO v_run;
  INSERT INTO public.settlement_commands (command_type, idempotency_key, actor, settlement_run_id, request_hash, result_snapshot)
  VALUES ('TRANSITION_RUN', p_idempotency_key, p_actor, p_run_id, p_request_hash, to_jsonb(v_run));
  INSERT INTO public.settlement_events (settlement_run_id, event_type, actor, before_status, after_status, payload)
  VALUES (p_run_id, 'RUN_STATUS_CHANGED', p_actor, v_before, p_status,
    jsonb_build_object('hold_reason_code', p_hold_reason_code));
  RETURN v_run;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_affiliate_payout_v2(
  p_payout_id uuid,
  p_actor text,
  p_idempotency_key text,
  p_request_hash text
)
RETURNS public.payouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_payout public.payouts%ROWTYPE; v_cmd public.settlement_commands%ROWTYPE;
BEGIN
  SELECT * INTO v_cmd FROM public.settlement_commands WHERE command_type = 'APPROVE_PAYOUT' AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_cmd.request_hash <> p_request_hash THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED'; END IF;
    SELECT * INTO v_payout FROM public.payouts WHERE id = v_cmd.payout_id; RETURN v_payout;
  END IF;
  SELECT * INTO v_payout FROM public.payouts WHERE id = p_payout_id FOR UPDATE;
  IF NOT FOUND OR v_payout.status <> 'REQUESTED' THEN RAISE EXCEPTION 'PAYOUT_NOT_REQUESTED'; END IF;
  IF v_payout.requested_by = p_actor THEN RAISE EXCEPTION 'PAYOUT_SEPARATION_REQUIRED'; END IF;
  UPDATE public.payouts SET status = 'APPROVED', approved_by = p_actor, approved_at = now()
  WHERE id = p_payout_id RETURNING * INTO v_payout;
  INSERT INTO public.settlement_commands (command_type, idempotency_key, actor, settlement_run_id, payout_id, request_hash, result_snapshot)
  VALUES ('APPROVE_PAYOUT', p_idempotency_key, p_actor, v_payout.settlement_run_id, v_payout.id, p_request_hash, to_jsonb(v_payout));
  INSERT INTO public.settlement_events (settlement_run_id, event_type, actor, payload)
  VALUES (v_payout.settlement_run_id, 'PAYOUT_APPROVED', p_actor, jsonb_build_object('payout_id', v_payout.id));
  RETURN v_payout;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_affiliate_payout_v2(
  p_payout_id uuid,
  p_actor text,
  p_payout_reference text,
  p_receipt_url text,
  p_bank_transaction_reference text,
  p_completed_at timestamptz,
  p_idempotency_key text,
  p_request_hash text
)
RETURNS public.payouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_payout public.payouts%ROWTYPE; v_run public.settlement_runs%ROWTYPE; v_cmd public.settlement_commands%ROWTYPE;
BEGIN
  SELECT * INTO v_cmd FROM public.settlement_commands WHERE command_type = 'COMPLETE_PAYOUT' AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_cmd.request_hash <> p_request_hash THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED'; END IF;
    SELECT * INTO v_payout FROM public.payouts WHERE id = v_cmd.payout_id; RETURN v_payout;
  END IF;
  IF btrim(COALESCE(p_payout_reference, '')) = '' OR p_receipt_url !~ '^https://' OR p_completed_at IS NULL THEN
    RAISE EXCEPTION 'PAYOUT_EVIDENCE_REQUIRED';
  END IF;
  SELECT * INTO v_payout FROM public.payouts WHERE id = p_payout_id FOR UPDATE;
  IF NOT FOUND OR v_payout.status <> 'APPROVED' OR v_payout.approved_by IS NULL THEN RAISE EXCEPTION 'PAYOUT_NOT_APPROVED'; END IF;
  SELECT * INTO v_run FROM public.settlement_runs WHERE id = v_payout.settlement_run_id FOR UPDATE;
  IF v_run.status <> 'PAYOUT_PENDING' OR v_run.net_payout_krw <> v_payout.amount_krw THEN RAISE EXCEPTION 'PAYOUT_RUN_MISMATCH'; END IF;
  UPDATE public.payouts SET status = 'COMPLETED', payout_reference = p_payout_reference,
    receipt_url = p_receipt_url, bank_transaction_reference = NULLIF(btrim(p_bank_transaction_reference), ''),
    executed_by = p_actor, completed_at = p_completed_at,
    evidence_snapshot = jsonb_build_object('reference', p_payout_reference, 'receipt_url', p_receipt_url,
      'bank_transaction_reference', p_bank_transaction_reference, 'completed_at', p_completed_at, 'recorded_at', now())
  WHERE id = p_payout_id RETURNING * INTO v_payout;
  UPDATE public.settlement_runs SET status = 'COMPLETED', completed_at = p_completed_at WHERE id = v_run.id;
  INSERT INTO public.settlement_commands (command_type, idempotency_key, actor, settlement_run_id, payout_id, request_hash, result_snapshot)
  VALUES ('COMPLETE_PAYOUT', p_idempotency_key, p_actor, v_run.id, v_payout.id, p_request_hash, to_jsonb(v_payout));
  INSERT INTO public.settlement_events (settlement_run_id, event_type, actor, before_status, after_status, payload)
  VALUES (v_run.id, 'PAYOUT_COMPLETED', p_actor, 'PAYOUT_PENDING', 'COMPLETED', to_jsonb(v_payout));
  RETURN v_payout;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_booking_commission_ledger_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_earned public.commission_ledger_entries%ROWTYPE; v_net bigint;
BEGIN
  IF NEW.affiliate_id IS NOT NULL AND NEW.commission_status = 'CALCULATED'
     AND COALESCE(NEW.influencer_commission, 0) > 0 THEN
    INSERT INTO public.commission_ledger_entries (
      affiliate_id, booking_id, attribution_decision_id, entry_type, amount_krw,
      commission_base_krw, commission_rate, policy_set_version, calculation_trace_id,
      idempotency_key, eligible_at, hold_reason, entry_snapshot, created_by, occurred_at
    ) VALUES (
      NEW.affiliate_id, NEW.id, NEW.attribution_decision_id, 'EARNED', NEW.influencer_commission::bigint,
      NEW.commission_base_amount_krw, NEW.applied_total_commission_rate,
      NEW.commission_policy_set_version, NEW.commission_calculation_trace_id,
      'booking:' || NEW.id::text || ':commission:v2',
      CASE WHEN NEW.return_date IS NOT NULL
        THEN ((NEW.return_date + 1)::timestamp AT TIME ZONE 'Asia/Seoul')
        ELSE now() END,
      CASE WHEN NEW.return_date IS NULL THEN 'RETURN_DATE_MISSING' ELSE NULL END,
      jsonb_build_object(
        'booking_id', NEW.id, 'booking_no', NEW.booking_no, 'product_id', NEW.package_id,
        'product_name', NEW.package_title, 'departure_date', NEW.departure_date,
        'return_date', NEW.return_date, 'commission_base_krw', NEW.commission_base_amount_krw,
        'commission_rate', NEW.applied_total_commission_rate,
        'commission_amount_krw', NEW.influencer_commission,
        'commission_breakdown', NEW.commission_breakdown,
        'policy_set_version', NEW.commission_policy_set_version,
        'calculation_trace_id', NEW.commission_calculation_trace_id,
        'attribution_decision_id', NEW.attribution_decision_id
      ), 'booking_commission_trigger', COALESCE(NEW.created_at, now())
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.status IS DISTINCT FROM NEW.status
     AND lower(COALESCE(NEW.status, '')) IN ('cancelled', 'canceled', 'refunded', 'void', 'voided') THEN
    SELECT * INTO v_earned FROM public.commission_ledger_entries
    WHERE booking_id = NEW.id AND entry_type = 'EARNED' ORDER BY occurred_at LIMIT 1;
    IF FOUND THEN
      SELECT v_earned.amount_krw + COALESCE(sum(amount_krw), 0) INTO v_net
      FROM public.commission_ledger_entries
      WHERE source_entry_id = v_earned.id AND entry_type = 'REVERSAL';
      IF v_net > 0 THEN
        PERFORM public.create_commission_reversal_v2(
          v_earned.id, v_net, 'BOOKING_' || upper(NEW.status),
          'booking_status_trigger', 'system_policy',
          'booking:' || NEW.id::text || ':status:' || lower(NEW.status) || ':reversal:v2'
        );
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bookings_sync_commission_ledger_v2 ON public.bookings;
CREATE TRIGGER bookings_sync_commission_ledger_v2
AFTER INSERT OR UPDATE OF status, commission_status, influencer_commission ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.sync_booking_commission_ledger_v2();

CREATE OR REPLACE FUNCTION public.prevent_legacy_settlement_mutation_v2()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'LEGACY_SETTLEMENTS_READ_ONLY_USE_V2';
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.settlements') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS settlements_legacy_read_only_v2 ON public.settlements';
    EXECUTE 'CREATE TRIGGER settlements_legacy_read_only_v2
      BEFORE INSERT OR UPDATE OR DELETE ON public.settlements
      FOR EACH ROW EXECUTE FUNCTION public.prevent_legacy_settlement_mutation_v2()';
  END IF;
END;
$$;

ALTER TABLE public.policy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlement_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlement_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlement_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlement_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlement_commands ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.policy_versions, public.commission_ledger_entries,
  public.settlement_runs, public.settlement_lines, public.payouts,
  public.settlement_revisions, public.affiliate_disputes, public.settlement_events,
  public.settlement_commands FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.policy_versions, public.commission_ledger_entries,
  public.settlement_runs, public.settlement_lines, public.payouts,
  public.settlement_revisions, public.affiliate_disputes, public.settlement_events,
  public.settlement_commands TO service_role;

DO $$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'policy_versions', 'commission_ledger_entries', 'settlement_runs', 'settlement_lines',
    'payouts', 'settlement_revisions', 'affiliate_disputes', 'settlement_events', 'settlement_commands'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_service_role_all ON public.%I', v_table, v_table);
    EXECUTE format(
      'CREATE POLICY %I_service_role_all ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      v_table, v_table
    );
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_commission_reversal_v2(uuid, bigint, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_affiliate_settlement_run_v2(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.request_affiliate_payout_v2(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.transition_affiliate_settlement_run_v2(uuid, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.approve_affiliate_payout_v2(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.complete_affiliate_payout_v2(uuid, text, text, text, text, timestamptz, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_commission_reversal_v2(uuid, bigint, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_affiliate_settlement_run_v2(uuid, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.request_affiliate_payout_v2(uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.transition_affiliate_settlement_run_v2(uuid, text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.approve_affiliate_payout_v2(uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_affiliate_payout_v2(uuid, text, text, text, text, timestamptz, text, text) TO service_role;

COMMENT ON TABLE public.settlement_runs IS
  'Immutable period calculation header. READY freezes ledger lines; COMPLETED can only be corrected by revisions and new reversal ledger entries.';
COMMENT ON TABLE public.settlement_lines IS
  'Frozen line evidence used by statements and PDFs. It never re-queries mutable booking amounts.';
COMMENT ON TABLE public.payouts IS
  'Maker-checker payout record with immutable evidence after completion.';

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Reversible rollback (only before V2 records are used; legacy data is untouched):
-- BEGIN;
-- DROP TRIGGER IF EXISTS settlements_legacy_read_only_v2 ON public.settlements;
-- DROP TRIGGER IF EXISTS bookings_sync_commission_ledger_v2 ON public.bookings;
-- DROP TABLE IF EXISTS public.settlement_commands, public.settlement_events,
--   public.affiliate_disputes, public.settlement_revisions, public.payouts,
--   public.settlement_lines, public.settlement_runs, public.commission_ledger_entries,
--   public.policy_versions;
-- COMMIT;

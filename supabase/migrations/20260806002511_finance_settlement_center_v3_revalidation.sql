-- Yeosonam finance center v3
-- Preserve every legacy snapshot while making Clobe 4128 allocations splittable,
-- explicitly reviewed, and safe against stale-screen writes.

BEGIN;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS finance_excluded boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS finance_exclusion_reason text,
  ADD COLUMN IF NOT EXISTS finance_excluded_at timestamptz,
  ADD COLUMN IF NOT EXISTS finance_excluded_by text;

CREATE INDEX IF NOT EXISTS idx_bookings_finance_included_departure
  ON public.bookings(departure_date, booking_no)
  WHERE COALESCE(finance_excluded, false) = false
    AND COALESCE(is_deleted, false) = false;

ALTER TABLE public.settlement_periods
  DROP CONSTRAINT IF EXISTS settlement_periods_status_check;
ALTER TABLE public.settlement_periods
  ADD CONSTRAINT settlement_periods_status_check
  CHECK (status IN ('open', 'conditional', 'closed', 'reopened', 'superseded', 'needs_revalidation'));

ALTER TABLE public.settlement_period_exceptions
  DROP CONSTRAINT IF EXISTS settlement_period_exceptions_exception_type_check;
ALTER TABLE public.settlement_period_exceptions
  ADD CONSTRAINT settlement_period_exceptions_exception_type_check
  CHECK (exception_type IN (
    'negative_margin',
    'no_bank_evidence',
    'allocation_drift',
    'zero_margin',
    'review_required',
    'deferred_review',
    'post_close_change',
    'unclassified_company_transaction',
    'missing_receipt'
  ));

-- Replace the incorrect one-transaction/one-booking guard with a conserved
-- breakdown ledger. Existing columns remain for compatibility.
DROP TRIGGER IF EXISTS trg_clobe_4128_allocation_integrity ON public.bank_transaction_allocations;
DROP FUNCTION IF EXISTS public.enforce_clobe_4128_allocation_integrity();
DROP FUNCTION IF EXISTS public.assert_clobe_4128_allocation_integrity(uuid);
DROP INDEX IF EXISTS public.uq_bank_tx_alloc_active_booking;

ALTER TABLE public.bank_transaction_allocations
  ALTER COLUMN booking_id DROP NOT NULL,
  ALTER COLUMN ledger_account DROP NOT NULL,
  ALTER COLUMN ledger_delta DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS target_type text NOT NULL DEFAULT 'booking',
  ADD COLUMN IF NOT EXISTS reconciliation_key text,
  ADD COLUMN IF NOT EXISTS target_label text,
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS confirmed_by text,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

ALTER TABLE public.bank_transaction_allocations
  DROP CONSTRAINT IF EXISTS bank_transaction_allocations_allocation_type_check,
  DROP CONSTRAINT IF EXISTS bank_transaction_allocations_ledger_account_check;

ALTER TABLE public.bank_transaction_allocations
  ADD CONSTRAINT bank_transaction_allocations_allocation_type_check
    CHECK (allocation_type IN ('deposit', 'refund', 'payout', 'non_booking', 'unassigned')),
  ADD CONSTRAINT bank_transaction_allocations_ledger_account_check
    CHECK (ledger_account IS NULL OR ledger_account IN ('paid_amount', 'total_paid_out')),
  ADD CONSTRAINT bank_transaction_allocations_target_type_check
    CHECK (target_type IN (
      'booking', 'customer_refund', 'bank_fee', 'company_expense', 'company_travel',
      'tax', 'capital', 'transfer', 'owner_draw', 'other_income', 'unassigned'
    )),
  ADD CONSTRAINT bank_transaction_allocations_metadata_object_check
    CHECK (jsonb_typeof(metadata) = 'object'),
  ADD CONSTRAINT bank_transaction_allocations_target_ledger_check
    CHECK (
      (target_type = 'booking' AND booking_id IS NOT NULL AND ledger_account IS NOT NULL AND ledger_delta IS NOT NULL)
      OR
      (target_type = 'customer_refund' AND (
        (booking_id IS NULL AND ledger_account IS NULL AND ledger_delta IS NULL)
        OR
        (booking_id IS NOT NULL AND ledger_account = 'paid_amount' AND ledger_delta < 0)
      ))
      OR
      (target_type NOT IN ('booking', 'customer_refund') AND ledger_account IS NULL AND ledger_delta IS NULL)
    );

UPDATE public.bank_transaction_allocations
SET target_type = CASE WHEN allocation_type = 'refund' THEN 'customer_refund' ELSE 'booking' END,
    confirmed_by = COALESCE(confirmed_by, created_by),
    confirmed_at = COALESCE(confirmed_at, created_at)
WHERE target_type = 'booking'
  AND (confirmed_at IS NULL OR allocation_type = 'refund');

CREATE INDEX IF NOT EXISTS idx_bank_tx_alloc_active_target
  ON public.bank_transaction_allocations(bank_transaction_id, target_type, booking_id)
  WHERE status = 'active' AND reversed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_bank_tx_alloc_reconciliation
  ON public.bank_transaction_allocations(reconciliation_key)
  WHERE reconciliation_key IS NOT NULL AND status = 'active' AND reversed_at IS NULL;

CREATE OR REPLACE FUNCTION public.assert_bank_transaction_allocation_conservation(
  p_bank_transaction_id uuid,
  p_require_exact boolean DEFAULT false
) RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_amount bigint;
  v_allocated bigint;
BEGIN
  SELECT amount::bigint INTO v_amount
  FROM public.bank_transactions
  WHERE id = p_bank_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank transaction not found';
  END IF;

  SELECT COALESCE(SUM(allocated_amount), 0)::bigint INTO v_allocated
  FROM public.bank_transaction_allocations
  WHERE bank_transaction_id = p_bank_transaction_id
    AND status = 'active'
    AND reversed_at IS NULL;

  IF v_allocated > v_amount THEN
    RAISE EXCEPTION 'active allocation total (%) exceeds source amount (%)', v_allocated, v_amount;
  END IF;
  IF p_require_exact AND v_allocated <> v_amount THEN
    RAISE EXCEPTION 'confirmed allocation total (%) must equal source amount (%)', v_allocated, v_amount;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_bank_transaction_allocation_conservation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP <> 'DELETE' THEN
    PERFORM public.assert_bank_transaction_allocation_conservation(NEW.bank_transaction_id, false);
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE')
     AND (TG_OP = 'DELETE' OR OLD.bank_transaction_id IS DISTINCT FROM NEW.bank_transaction_id) THEN
    PERFORM public.assert_bank_transaction_allocation_conservation(OLD.bank_transaction_id, false);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_bank_transaction_allocation_conservation
  AFTER INSERT OR UPDATE OF bank_transaction_id, allocated_amount, status, reversed_at
  OR DELETE ON public.bank_transaction_allocations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_bank_transaction_allocation_conservation();

CREATE TABLE IF NOT EXISTS public.bank_transaction_breakdown_requests (
  idempotency_key text PRIMARY KEY CHECK (btrim(idempotency_key) <> ''),
  bank_transaction_id uuid NOT NULL REFERENCES public.bank_transactions(id) ON DELETE RESTRICT,
  expected_fingerprint text NOT NULL,
  payload_hash text NOT NULL,
  result jsonb,
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.booking_settlement_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  departure_month date,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'confirmed', 'customer_cancelled', 'invalid_booking',
    'reclassified', 'deferred', 'superseded'
  )),
  is_current boolean NOT NULL DEFAULT true,
  review_fingerprint text NOT NULL,
  deposits bigint NOT NULL DEFAULT 0,
  withdrawals bigint NOT NULL DEFAULT 0,
  customer_refunds bigint NOT NULL DEFAULT 0,
  bank_fees bigint NOT NULL DEFAULT 0,
  cash_margin bigint NOT NULL DEFAULT 0,
  transaction_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(transaction_ids) = 'array'),
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(snapshot) = 'object'),
  assigned_to text,
  decision_reason text,
  due_date date,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_by_label text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_settlement_reviews_current
  ON public.booking_settlement_reviews(booking_id)
  WHERE is_current;
CREATE INDEX IF NOT EXISTS idx_booking_settlement_reviews_queue
  ON public.booking_settlement_reviews(status, departure_month, updated_at DESC)
  WHERE is_current;

CREATE TABLE IF NOT EXISTS public.booking_settlement_review_requests (
  idempotency_key text PRIMARY KEY CHECK (btrim(idempotency_key) <> ''),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  expected_fingerprint text NOT NULL,
  payload_hash text NOT NULL,
  result jsonb,
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.finance_migration_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_key text NOT NULL UNIQUE,
  snapshot_type text NOT NULL,
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) IN ('object', 'array')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.prevent_finance_migration_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'finance migration snapshots are immutable';
END;
$$;

CREATE TRIGGER trg_finance_migration_snapshots_immutable
  BEFORE UPDATE OR DELETE ON public.finance_migration_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.prevent_finance_migration_snapshot_mutation();

CREATE OR REPLACE FUNCTION public.finance_booking_review_fingerprint(p_booking_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT md5(concat_ws('|',
    b.id::text,
    COALESCE(b.departure_date::text, ''),
    COALESCE(b.status, ''),
    COALESCE(b.is_deleted, false)::text,
    COALESCE(b.finance_excluded, false)::text,
    COALESCE((
      SELECT string_agg(concat_ws(':',
        a.id::text,
        a.bank_transaction_id::text,
        a.target_type,
        COALESCE(a.booking_id::text, ''),
        a.allocated_amount::text,
        COALESCE(a.ledger_delta::text, ''),
        COALESCE(a.reconciliation_key, ''),
        COALESCE(t.transaction_type, ''),
        COALESCE(t.amount::text, ''),
        COALESCE(t.memo, ''),
        COALESCE(t.updated_at::text, '')
      ), '|' ORDER BY t.received_at, t.id, a.id)
      FROM public.bank_transaction_allocations a
      JOIN public.bank_transactions t ON t.id = a.bank_transaction_id
      WHERE a.booking_id = b.id
        AND a.status = 'active'
        AND a.reversed_at IS NULL
        AND t.status = 'active'
    ), '')
  ))
  FROM public.bookings b
  WHERE b.id = p_booking_id;
$$;

CREATE OR REPLACE FUNCTION public.finance_bank_breakdown_fingerprint(p_bank_transaction_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT md5(concat_ws('|',
    t.id::text,
    t.amount::text,
    COALESCE(t.transaction_type, ''),
    COALESCE(t.memo, ''),
    COALESCE(t.received_at::text, ''),
    COALESCE(t.updated_at::text, ''),
    COALESCE((
      SELECT string_agg(concat_ws(':',
        a.id::text, a.target_type, COALESCE(a.booking_id::text, ''),
        a.allocated_amount::text, COALESCE(a.reconciliation_key, ''),
        COALESCE(a.reason, '')
      ), '|' ORDER BY a.created_at, a.id)
      FROM public.bank_transaction_allocations a
      WHERE a.bank_transaction_id = t.id
        AND a.status = 'active'
        AND a.reversed_at IS NULL
    ), '')
  ))
  FROM public.bank_transactions t
  WHERE t.id = p_bank_transaction_id;
$$;

CREATE OR REPLACE FUNCTION public.finance_invalidate_booking_review(
  p_booking_id uuid,
  p_reason text DEFAULT 'source_changed'
) RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_current public.booking_settlement_reviews%ROWTYPE;
  v_fingerprint text;
  v_departure_month date;
BEGIN
  SELECT finance_booking_review_fingerprint(p_booking_id), date_trunc('month', departure_date)::date
  INTO v_fingerprint, v_departure_month
  FROM public.bookings
  WHERE id = p_booking_id;

  IF NOT FOUND OR v_fingerprint IS NULL THEN RETURN; END IF;

  SELECT * INTO v_current
  FROM public.booking_settlement_reviews
  WHERE booking_id = p_booking_id AND is_current
  FOR UPDATE;

  IF FOUND AND v_current.status = 'pending' THEN
    UPDATE public.booking_settlement_reviews
    SET departure_month = v_departure_month,
        review_fingerprint = v_fingerprint,
        updated_at = now(),
        snapshot = snapshot || jsonb_build_object('last_invalidation_reason', p_reason, 'last_invalidated_at', now()),
        decision_reason = 'Clobe 거래·메모 또는 배분 변경으로 재검토 필요'
    WHERE id = v_current.id;
  ELSE
    IF FOUND THEN
      UPDATE public.booking_settlement_reviews
      SET is_current = false,
          status = 'superseded',
          updated_at = now(),
          snapshot = snapshot || jsonb_build_object('superseded_reason', p_reason, 'superseded_at', now())
      WHERE id = v_current.id;
    END IF;

    INSERT INTO public.booking_settlement_reviews (
      booking_id, departure_month, status, review_fingerprint, snapshot, decision_reason
    ) VALUES (
      p_booking_id, v_departure_month, 'pending', v_fingerprint,
      jsonb_build_object('origin', 'automatic_invalidation', 'reason', p_reason),
      'Clobe 거래·메모 또는 배분 변경으로 재검토 필요'
    );
  END IF;

  INSERT INTO public.settlement_period_exceptions (
    settlement_period_id, departure_month, booking_id, exception_type,
    status, reason, source_fingerprint, current_fingerprint, payload
  )
  SELECT
    p.id, p.departure_month, p_booking_id, 'post_close_change',
    'open', '월 마감 후 Clobe 거래·메모 또는 배분이 변경됨',
    item.transaction_fingerprint, v_fingerprint,
    jsonb_build_object('origin', 'finance_v3_invalidation', 'change_reason', p_reason)
  FROM public.settlement_periods p
  JOIN public.settlement_period_items item
    ON item.settlement_period_id = p.id AND item.booking_id = p_booking_id
  WHERE p.is_current AND p.status IN ('closed', 'conditional')
  ON CONFLICT DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.invalidate_booking_review_from_allocation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP <> 'DELETE' AND NEW.booking_id IS NOT NULL THEN
    PERFORM public.finance_invalidate_booking_review(NEW.booking_id, 'allocation_changed');
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.booking_id IS NOT NULL
     AND (TG_OP = 'DELETE' OR OLD.booking_id IS DISTINCT FROM NEW.booking_id) THEN
    PERFORM public.finance_invalidate_booking_review(OLD.booking_id, 'allocation_changed');
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_invalidate_booking_review_from_allocation
  AFTER INSERT OR UPDATE OF booking_id, target_type, allocated_amount, status, reversed_at,
    reconciliation_key, reason OR DELETE
  ON public.bank_transaction_allocations
  FOR EACH ROW EXECUTE FUNCTION public.invalidate_booking_review_from_allocation();

CREATE OR REPLACE FUNCTION public.invalidate_booking_review_from_transaction()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_booking_id uuid;
BEGIN
  IF OLD.memo IS NOT DISTINCT FROM NEW.memo
     AND OLD.amount IS NOT DISTINCT FROM NEW.amount
     AND OLD.transaction_type IS NOT DISTINCT FROM NEW.transaction_type
     AND OLD.received_at IS NOT DISTINCT FROM NEW.received_at
     AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  FOR v_booking_id IN
    SELECT DISTINCT booking_id
    FROM public.bank_transaction_allocations
    WHERE bank_transaction_id = NEW.id
      AND booking_id IS NOT NULL
      AND status = 'active'
      AND reversed_at IS NULL
  LOOP
    PERFORM public.finance_invalidate_booking_review(v_booking_id, 'clobe_transaction_changed');
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_invalidate_booking_review_from_transaction
  AFTER UPDATE OF memo, amount, transaction_type, received_at, status
  ON public.bank_transactions
  FOR EACH ROW EXECUTE FUNCTION public.invalidate_booking_review_from_transaction();

CREATE OR REPLACE FUNCTION public.invalidate_booking_review_from_booking()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR OLD.departure_date IS DISTINCT FROM NEW.departure_date
     OR OLD.status IS DISTINCT FROM NEW.status
     OR OLD.is_deleted IS DISTINCT FROM NEW.is_deleted
     OR OLD.finance_excluded IS DISTINCT FROM NEW.finance_excluded THEN
    PERFORM public.finance_invalidate_booking_review(NEW.id, 'booking_state_changed');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_invalidate_booking_review_from_booking
  AFTER INSERT OR UPDATE OF departure_date, status, is_deleted, finance_excluded
  ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.invalidate_booking_review_from_booking();

-- Company travel is distinct from ordinary company expense and owner draw.
ALTER TABLE public.bank_transaction_classifications
  DROP CONSTRAINT IF EXISTS bank_transaction_classifications_os_classification_check,
  DROP CONSTRAINT IF EXISTS bank_transaction_classifications_resolved_classification_check;
ALTER TABLE public.bank_transaction_classifications
  ADD CONSTRAINT bank_transaction_classifications_os_classification_check
    CHECK (os_classification IS NULL OR os_classification IN (
      'company_expense', 'company_travel', 'tax', 'capital', 'transfer',
      'refund', 'owner_draw', 'other_income', 'review'
    )),
  ADD CONSTRAINT bank_transaction_classifications_resolved_classification_check
    CHECK (resolved_classification IN (
      'company_expense', 'company_travel', 'tax', 'capital', 'transfer',
      'refund', 'owner_draw', 'other_income', 'review'
    ));

ALTER TABLE public.bank_classification_rules
  DROP CONSTRAINT IF EXISTS bank_classification_rules_target_classification_check;
ALTER TABLE public.bank_classification_rules
  ADD CONSTRAINT bank_classification_rules_target_classification_check
    CHECK (target_classification IN (
      'company_expense', 'company_travel', 'tax', 'capital', 'transfer',
      'refund', 'owner_draw', 'other_income', 'review'
    ));

ALTER TABLE public.ledger_entries
  DROP CONSTRAINT IF EXISTS ledger_entries_source_check;
ALTER TABLE public.ledger_entries
  ADD CONSTRAINT ledger_entries_source_check
    CHECK (source IN (
      'slack_ingest', 'payment_match_confirm', 'land_settlement_create',
      'land_settlement_reverse', 'admin_manual_edit', 'booking_create_softmatch',
      'bank_tx_manual_match', 'sms_payment', 'cron_resync', 'seed_phase2a',
      'bank_tx_legacy_reassignment', 'bank_tx_clobe_rebuild',
      'finance_breakdown', 'finance_breakdown_reverse'
    ));

CREATE OR REPLACE FUNCTION public.save_bank_transaction_breakdown(
  p_transaction_id uuid,
  p_lines jsonb,
  p_expected_fingerprint text,
  p_idempotency_key text,
  p_actor uuid,
  p_actor_label text,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_tx public.bank_transactions%ROWTYPE;
  v_request public.bank_transaction_breakdown_requests%ROWTYPE;
  v_current_fingerprint text;
  v_payload_hash text;
  v_total bigint := 0;
  v_line jsonb;
  v_old public.bank_transaction_allocations%ROWTYPE;
  v_target_type text;
  v_booking_id uuid;
  v_amount bigint;
  v_ledger_account text;
  v_ledger_delta bigint;
  v_allocation_type text;
  v_index integer := 0;
  v_booking_ids uuid[] := ARRAY[]::uuid[];
  v_representative uuid;
  v_non_booking_count integer;
  v_result jsonb;
BEGIN
  IF NULLIF(btrim(COALESCE(p_idempotency_key, '')), '') IS NULL THEN
    RAISE EXCEPTION 'idempotency key is required';
  END IF;
  IF NULLIF(btrim(COALESCE(p_expected_fingerprint, '')), '') IS NULL THEN
    RAISE EXCEPTION 'expected fingerprint is required';
  END IF;
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'breakdown reason is required';
  END IF;
  IF jsonb_typeof(COALESCE(p_lines, 'null'::jsonb)) <> 'array'
     OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'breakdown lines are required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('finance-breakdown:' || p_transaction_id::text, 0));
  SELECT * INTO v_tx FROM public.bank_transactions WHERE id = p_transaction_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'bank transaction not found'; END IF;
  IF v_tx.external_provider <> 'clobe' OR v_tx.source <> 'clobe_mcp'
     OR v_tx.account_number <> '100038454128' OR v_tx.status <> 'active' THEN
    RAISE EXCEPTION 'only active Clobe 4128 transactions can be edited';
  END IF;

  v_current_fingerprint := public.finance_bank_breakdown_fingerprint(p_transaction_id);
  v_payload_hash := md5(p_lines::text || '|' || p_reason);
  SELECT * INTO v_request
  FROM public.bank_transaction_breakdown_requests
  WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_request.bank_transaction_id <> p_transaction_id OR v_request.payload_hash <> v_payload_hash THEN
      RAISE EXCEPTION 'idempotency key conflict';
    END IF;
    IF v_request.completed_at IS NULL THEN RAISE EXCEPTION 'breakdown request is incomplete'; END IF;
    RETURN v_request.result;
  END IF;
  IF v_current_fingerprint <> p_expected_fingerprint THEN
    RAISE EXCEPTION 'stale breakdown fingerprint';
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_target_type := v_line->>'targetType';
    v_amount := COALESCE((v_line->>'amount')::bigint, 0);
    v_booking_id := NULLIF(v_line->>'bookingId', '')::uuid;
    IF v_target_type NOT IN (
      'booking', 'customer_refund', 'bank_fee', 'company_expense', 'company_travel',
      'tax', 'capital', 'transfer', 'owner_draw', 'other_income', 'unassigned'
    ) OR v_amount <= 0 THEN
      RAISE EXCEPTION 'invalid breakdown line';
    END IF;
    IF v_target_type = 'booking' AND v_booking_id IS NULL THEN
      RAISE EXCEPTION 'booking target requires bookingId';
    END IF;
    IF v_target_type = 'customer_refund' AND v_tx.transaction_type <> '출금' THEN
      RAISE EXCEPTION 'customer refund must be a withdrawal';
    END IF;
    IF v_target_type IN ('bank_fee', 'company_expense', 'company_travel', 'tax', 'owner_draw')
       AND v_tx.transaction_type <> '출금' THEN
      RAISE EXCEPTION 'expense target must be a withdrawal';
    END IF;
    IF v_target_type IN ('capital', 'other_income') AND v_tx.transaction_type <> '입금' THEN
      RAISE EXCEPTION 'income target must be a deposit';
    END IF;
    IF v_booking_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.bookings WHERE id = v_booking_id AND COALESCE(is_deleted, false) = false
    ) THEN
      RAISE EXCEPTION 'booking target not found';
    END IF;
    v_total := v_total + v_amount;
  END LOOP;
  IF v_total <> v_tx.amount THEN
    RAISE EXCEPTION 'breakdown total (%) must equal source amount (%)', v_total, v_tx.amount;
  END IF;

  INSERT INTO public.bank_transaction_breakdown_requests (
    idempotency_key, bank_transaction_id, expected_fingerprint, payload_hash, actor
  ) VALUES (p_idempotency_key, p_transaction_id, p_expected_fingerprint, v_payload_hash, p_actor_label);

  FOR v_old IN
    SELECT * FROM public.bank_transaction_allocations
    WHERE bank_transaction_id = p_transaction_id
      AND status = 'active' AND reversed_at IS NULL
    FOR UPDATE
  LOOP
    IF v_old.booking_id IS NOT NULL AND v_old.ledger_delta IS NOT NULL AND v_old.ledger_delta <> 0 THEN
      PERFORM public.update_booking_ledger(
        v_old.booking_id,
        CASE WHEN v_old.ledger_account = 'paid_amount' THEN (-v_old.ledger_delta)::integer ELSE 0 END,
        CASE WHEN v_old.ledger_account = 'total_paid_out' THEN (-v_old.ledger_delta)::integer ELSE 0 END,
        'finance_breakdown_reverse',
        p_transaction_id::text,
        'finance-breakdown:' || p_idempotency_key || ':reverse:' || v_old.id::text,
        p_reason,
        p_actor_label
      );
    END IF;
    IF v_old.booking_id IS NOT NULL AND NOT (v_old.booking_id = ANY(v_booking_ids)) THEN
      v_booking_ids := array_append(v_booking_ids, v_old.booking_id);
    END IF;
  END LOOP;

  UPDATE public.bank_transaction_allocations
  SET status = 'reversed', reversed_at = now()
  WHERE bank_transaction_id = p_transaction_id
    AND status = 'active' AND reversed_at IS NULL;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_index := v_index + 1;
    v_target_type := v_line->>'targetType';
    v_booking_id := NULLIF(v_line->>'bookingId', '')::uuid;
    v_amount := (v_line->>'amount')::bigint;
    v_ledger_account := NULL;
    v_ledger_delta := NULL;
    v_allocation_type := 'non_booking';

    IF v_target_type = 'booking' THEN
      IF v_tx.transaction_type = '입금' THEN
        v_ledger_account := 'paid_amount'; v_ledger_delta := v_amount; v_allocation_type := 'deposit';
      ELSE
        v_ledger_account := 'total_paid_out'; v_ledger_delta := v_amount; v_allocation_type := 'payout';
      END IF;
    ELSIF v_target_type = 'customer_refund' AND v_booking_id IS NOT NULL THEN
      v_ledger_account := 'paid_amount'; v_ledger_delta := -v_amount; v_allocation_type := 'refund';
    ELSIF v_target_type = 'unassigned' THEN
      v_allocation_type := 'unassigned';
    END IF;

    INSERT INTO public.bank_transaction_allocations (
      bank_transaction_id, booking_id, ledger_account, allocated_amount, ledger_delta,
      allocation_type, target_type, reconciliation_key, target_label, reason, metadata,
      status, idempotency_key, notes, created_by, confirmed_by, confirmed_at
    ) VALUES (
      p_transaction_id, v_booking_id, v_ledger_account, v_amount, v_ledger_delta,
      v_allocation_type, v_target_type, NULLIF(v_line->>'reconciliationKey', ''),
      NULLIF(v_line->>'targetLabel', ''), p_reason,
      COALESCE(v_line->'metadata', '{}'::jsonb), 'active',
      'finance-breakdown:' || p_idempotency_key || ':line:' || v_index::text,
      p_reason, p_actor_label, p_actor_label, now()
    );

    IF v_booking_id IS NOT NULL AND NOT (v_booking_id = ANY(v_booking_ids)) THEN
      v_booking_ids := array_append(v_booking_ids, v_booking_id);
    END IF;
    IF v_booking_id IS NOT NULL AND v_ledger_delta IS NOT NULL AND v_ledger_delta <> 0 THEN
      PERFORM public.update_booking_ledger(
        v_booking_id,
        CASE WHEN v_ledger_account = 'paid_amount' THEN v_ledger_delta::integer ELSE 0 END,
        CASE WHEN v_ledger_account = 'total_paid_out' THEN v_ledger_delta::integer ELSE 0 END,
        'finance_breakdown',
        p_transaction_id::text,
        'finance-breakdown:' || p_idempotency_key || ':apply:' || v_index::text,
        p_reason,
        p_actor_label
      );
    END IF;
  END LOOP;

  PERFORM public.assert_bank_transaction_allocation_conservation(p_transaction_id, true);

  SELECT
    CASE
      WHEN COUNT(DISTINCT booking_id) = 1
        THEN (array_agg(DISTINCT booking_id) FILTER (WHERE booking_id IS NOT NULL))[1]
      ELSE NULL
    END,
    COUNT(*) FILTER (WHERE target_type <> 'booking')
  INTO v_representative, v_non_booking_count
  FROM public.bank_transaction_allocations
  WHERE bank_transaction_id = p_transaction_id
    AND status = 'active' AND reversed_at IS NULL;
  IF v_non_booking_count > 0 THEN v_representative := NULL; END IF;

  UPDATE public.bank_transactions
  SET booking_id = v_representative,
      match_status = CASE WHEN EXISTS (
        SELECT 1 FROM public.bank_transaction_allocations
        WHERE bank_transaction_id = p_transaction_id AND status = 'active'
          AND reversed_at IS NULL AND target_type = 'unassigned'
      ) THEN 'review' ELSE 'manual' END,
      match_confidence = 1,
      matched_by = p_actor_label,
      matched_at = now(),
      updated_at = now()
  WHERE id = p_transaction_id;

  v_result := jsonb_build_object(
    'ok', true,
    'transactionId', p_transaction_id,
    'allocatedTotal', v_total,
    'lineCount', jsonb_array_length(p_lines),
    'fingerprint', public.finance_bank_breakdown_fingerprint(p_transaction_id)
  );
  UPDATE public.bank_transaction_breakdown_requests
  SET result = v_result, completed_at = now()
  WHERE idempotency_key = p_idempotency_key;

  INSERT INTO public.audit_logs (
    user_id, action, target_type, target_id, description, before_value, after_value
  ) VALUES (
    p_actor, 'FINANCE_TRANSACTION_BREAKDOWN_SAVED', 'bank_transactions', p_transaction_id::text,
    p_reason,
    jsonb_build_object('fingerprint', p_expected_fingerprint),
    jsonb_build_object('lines', p_lines, 'result', v_result, 'actor', p_actor_label)
  );
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_booking_settlement_review(
  p_booking_id uuid,
  p_decision text,
  p_expected_fingerprint text,
  p_idempotency_key text,
  p_actor uuid,
  p_actor_label text,
  p_reason text DEFAULT NULL,
  p_assigned_to text DEFAULT NULL,
  p_due_date date DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_request public.booking_settlement_review_requests%ROWTYPE;
  v_current_fingerprint text;
  v_payload_hash text;
  v_deposits bigint := 0;
  v_withdrawals bigint := 0;
  v_refunds bigint := 0;
  v_fees bigint := 0;
  v_transaction_ids jsonb := '[]'::jsonb;
  v_review_id uuid;
  v_result jsonb;
BEGIN
  IF p_decision NOT IN ('confirmed', 'customer_cancelled', 'invalid_booking', 'reclassified', 'deferred') THEN
    RAISE EXCEPTION 'unsupported settlement decision';
  END IF;
  IF NULLIF(btrim(COALESCE(p_idempotency_key, '')), '') IS NULL
     OR NULLIF(btrim(COALESCE(p_expected_fingerprint, '')), '') IS NULL THEN
    RAISE EXCEPTION 'fingerprint and idempotency key are required';
  END IF;
  IF p_decision IN ('customer_cancelled', 'invalid_booking', 'reclassified', 'deferred')
     AND NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'decision reason is required';
  END IF;
  IF p_decision = 'deferred' AND (
    NULLIF(btrim(COALESCE(p_assigned_to, '')), '') IS NULL OR p_due_date IS NULL
  ) THEN
    RAISE EXCEPTION 'deferred review requires assignee and due date';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('finance-review:' || p_booking_id::text, 0));
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'booking not found'; END IF;

  v_current_fingerprint := public.finance_booking_review_fingerprint(p_booking_id);
  v_payload_hash := md5(concat_ws('|', p_decision, p_reason, p_assigned_to, p_due_date::text));
  SELECT * INTO v_request
  FROM public.booking_settlement_review_requests
  WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_request.booking_id <> p_booking_id OR v_request.payload_hash <> v_payload_hash THEN
      RAISE EXCEPTION 'idempotency key conflict';
    END IF;
    IF v_request.completed_at IS NULL THEN RAISE EXCEPTION 'review request is incomplete'; END IF;
    RETURN v_request.result;
  END IF;
  IF v_current_fingerprint <> p_expected_fingerprint THEN
    RAISE EXCEPTION 'stale booking review fingerprint';
  END IF;

  INSERT INTO public.booking_settlement_review_requests (
    idempotency_key, booking_id, expected_fingerprint, payload_hash, actor
  ) VALUES (p_idempotency_key, p_booking_id, p_expected_fingerprint, v_payload_hash, p_actor_label);

  -- Apply the booking state first. Its invalidation trigger supersedes the old
  -- review, then the decision below becomes the current post-change snapshot.
  IF p_decision = 'customer_cancelled' THEN
    UPDATE public.bookings SET status = 'cancelled', finance_excluded = true,
      finance_exclusion_reason = p_reason, finance_excluded_at = now(),
      finance_excluded_by = p_actor_label, updated_at = now()
    WHERE id = p_booking_id;
  ELSIF p_decision IN ('invalid_booking', 'reclassified') THEN
    UPDATE public.bookings SET is_deleted = true, finance_excluded = true,
      finance_exclusion_reason = p_reason, finance_excluded_at = now(),
      finance_excluded_by = p_actor_label, updated_at = now()
    WHERE id = p_booking_id;
  END IF;
  v_current_fingerprint := public.finance_booking_review_fingerprint(p_booking_id);

  SELECT
    COALESCE(SUM(a.allocated_amount) FILTER (
      WHERE a.target_type = 'booking' AND t.transaction_type = '입금'
    ), 0)::bigint,
    COALESCE(SUM(a.allocated_amount) FILTER (
      WHERE a.target_type = 'booking' AND t.transaction_type = '출금'
    ), 0)::bigint,
    COALESCE(SUM(a.allocated_amount) FILTER (WHERE a.target_type = 'customer_refund'), 0)::bigint,
    COALESCE(SUM(a.allocated_amount) FILTER (WHERE a.target_type = 'bank_fee'), 0)::bigint,
    COALESCE(jsonb_agg(DISTINCT t.id) FILTER (WHERE t.id IS NOT NULL), '[]'::jsonb)
  INTO v_deposits, v_withdrawals, v_refunds, v_fees, v_transaction_ids
  FROM public.bank_transaction_allocations a
  JOIN public.bank_transactions t ON t.id = a.bank_transaction_id AND t.status = 'active'
  WHERE a.booking_id = p_booking_id
    AND a.status = 'active' AND a.reversed_at IS NULL;

  IF p_decision = 'confirmed' AND jsonb_array_length(v_transaction_ids) = 0 THEN
    RAISE EXCEPTION 'confirmed settlement requires bank evidence';
  END IF;
  IF p_decision = 'confirmed' AND (v_deposits - v_withdrawals - v_refunds) < 0 THEN
    RAISE EXCEPTION 'negative cash margin cannot be confirmed';
  END IF;

  UPDATE public.booking_settlement_reviews
  SET is_current = false, status = 'superseded', updated_at = now(),
      snapshot = snapshot || jsonb_build_object('superseded_at', now())
  WHERE booking_id = p_booking_id AND is_current;

  INSERT INTO public.booking_settlement_reviews (
    booking_id, departure_month, status, review_fingerprint,
    deposits, withdrawals, customer_refunds, bank_fees, cash_margin,
    transaction_ids, snapshot, assigned_to, decision_reason, due_date,
    reviewed_by, reviewed_by_label, reviewed_at
  ) VALUES (
    p_booking_id, date_trunc('month', v_booking.departure_date)::date, p_decision,
    v_current_fingerprint, v_deposits, v_withdrawals, v_refunds, v_fees,
    v_deposits - v_withdrawals - v_refunds, v_transaction_ids,
    jsonb_build_object(
      'booking_status', v_booking.status,
      'departure_date', v_booking.departure_date,
      'finance_excluded', v_booking.finance_excluded,
      'fingerprint_version', 3
    ), NULLIF(btrim(COALESCE(p_assigned_to, '')), ''),
    NULLIF(btrim(COALESCE(p_reason, '')), ''), p_due_date,
    p_actor, p_actor_label, now()
  ) RETURNING id INTO v_review_id;

  v_result := jsonb_build_object(
    'ok', true, 'reviewId', v_review_id, 'bookingId', p_booking_id,
    'decision', p_decision, 'deposits', v_deposits, 'withdrawals', v_withdrawals,
    'customerRefunds', v_refunds, 'bankFees', v_fees,
    'cashMargin', v_deposits - v_withdrawals - v_refunds,
    'fingerprint', v_current_fingerprint
  );
  UPDATE public.booking_settlement_review_requests
  SET result = v_result, completed_at = now()
  WHERE idempotency_key = p_idempotency_key;

  INSERT INTO public.audit_logs (
    user_id, action, target_type, target_id, description, before_value, after_value
  ) VALUES (
    p_actor, 'FINANCE_BOOKING_REVIEW_DECIDED', 'booking', p_booking_id::text,
    COALESCE(p_reason, '예약 정산 검토'),
    jsonb_build_object('fingerprint', p_expected_fingerprint),
    v_result || jsonb_build_object('actor', p_actor_label)
  );
  RETURN v_result;
END;
$$;

ALTER TABLE public.bank_transaction_breakdown_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_settlement_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_settlement_review_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_migration_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY bank_transaction_breakdown_requests_service_role_only
  ON public.bank_transaction_breakdown_requests FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY booking_settlement_reviews_service_role_only
  ON public.booking_settlement_reviews FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY booking_settlement_review_requests_service_role_only
  ON public.booking_settlement_review_requests FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY finance_migration_snapshots_service_role_only
  ON public.finance_migration_snapshots FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON public.bank_transaction_breakdown_requests FROM anon, authenticated;
REVOKE ALL ON public.booking_settlement_reviews FROM anon, authenticated;
REVOKE ALL ON public.booking_settlement_review_requests FROM anon, authenticated;
REVOKE ALL ON public.finance_migration_snapshots FROM anon, authenticated;
GRANT ALL ON public.bank_transaction_breakdown_requests TO service_role;
GRANT ALL ON public.booking_settlement_reviews TO service_role;
GRANT ALL ON public.booking_settlement_review_requests TO service_role;
GRANT SELECT, INSERT ON public.finance_migration_snapshots TO service_role;

REVOKE ALL ON FUNCTION public.assert_bank_transaction_allocation_conservation(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finance_booking_review_fingerprint(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finance_bank_breakdown_fingerprint(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finance_invalidate_booking_review(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_bank_transaction_breakdown(uuid, jsonb, text, text, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_booking_settlement_review(uuid, text, text, text, uuid, text, text, text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_bank_transaction_allocation_conservation(uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.finance_booking_review_fingerprint(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.finance_bank_breakdown_fingerprint(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.finance_invalidate_booking_review(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_bank_transaction_breakdown(uuid, jsonb, text, text, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_booking_settlement_review(uuid, text, text, text, uuid, text, text, text, date) TO service_role;

-- Immutable before-images for the revalidation and test-data quarantine.
INSERT INTO public.finance_migration_snapshots (snapshot_key, snapshot_type, snapshot)
SELECT
  'finance-v3:legacy-periods:2026-08-06',
  'legacy_settlement_periods',
  COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.departure_month, p.revision), '[]'::jsonb)
FROM public.settlement_periods p
WHERE p.closed_by_label = 'legacy_booking_confirmation'
ON CONFLICT (snapshot_key) DO NOTHING;

INSERT INTO public.finance_migration_snapshots (snapshot_key, snapshot_type, snapshot)
SELECT
  'finance-v3:test-bookings:2026-08-06',
  'production_test_booking_quarantine',
  COALESCE(jsonb_agg(to_jsonb(b) ORDER BY b.booking_no), '[]'::jsonb)
FROM public.bookings b
WHERE b.booking_no IN ('BK-0080','BK-0081','BK-0082','BK-0083','BK-0084','BK-0085','BK-0086','BK-0087','BK-0088','BK-0089','BK-0090')
ON CONFLICT (snapshot_key) DO NOTHING;

-- Legacy confirmations become reviewable estimates. Their immutable period
-- items remain untouched for audit and historical comparison.
UPDATE public.settlement_periods
SET status = 'needs_revalidation', updated_at = now()
WHERE closed_by_label = 'legacy_booking_confirmation'
  AND is_current
  AND status IN ('closed', 'conditional');

INSERT INTO public.booking_settlement_reviews (
  booking_id, departure_month, status, review_fingerprint,
  deposits, withdrawals, cash_margin, transaction_ids, snapshot, decision_reason
)
SELECT DISTINCT ON (item.booking_id)
  item.booking_id,
  date_trunc('month', item.departure_date)::date,
  'pending',
  COALESCE(public.finance_booking_review_fingerprint(item.booking_id), item.transaction_fingerprint),
  item.deposits,
  item.withdrawals,
  item.deposits - item.withdrawals,
  item.transaction_ids,
  jsonb_build_object(
    'origin', 'legacy_booking_confirmation_revalidation',
    'legacy_period_id', item.settlement_period_id,
    'legacy_cash_margin', item.cash_margin,
    'fingerprint_version', 3
  ),
  '과거 자동확정 건을 실제 Clobe 거래 기준으로 재검토'
FROM public.settlement_period_items item
JOIN public.settlement_periods period ON period.id = item.settlement_period_id
WHERE period.closed_by_label = 'legacy_booking_confirmation'
ORDER BY item.booking_id, period.revision DESC
ON CONFLICT (booking_id) WHERE is_current DO NOTHING;

-- Every real booking has a current decision row, including reservations that
-- were never part of the legacy 48 snapshots.
INSERT INTO public.booking_settlement_reviews (
  booking_id, departure_month, status, review_fingerprint, snapshot, decision_reason
)
SELECT
  b.id,
  date_trunc('month', b.departure_date)::date,
  'pending',
  public.finance_booking_review_fingerprint(b.id),
  jsonb_build_object('origin', 'finance_v3_initial_review_queue', 'fingerprint_version', 3),
  '예약별 Clobe 거래를 확인한 뒤 정산 결정 필요'
FROM public.bookings b
WHERE COALESCE(b.is_deleted, false) = false
  AND COALESCE(b.finance_excluded, false) = false
  AND b.departure_date IS NOT NULL
ON CONFLICT (booking_id) WHERE is_current DO NOTHING;

UPDATE public.bookings b
SET settlement_confirmed_at = NULL,
    settlement_confirmed_by = NULL,
    settlement_mode = NULL,
    updated_at = now()
WHERE EXISTS (
  SELECT 1
  FROM public.settlement_period_items item
  JOIN public.settlement_periods period ON period.id = item.settlement_period_id
  WHERE item.booking_id = b.id
    AND period.closed_by_label = 'legacy_booking_confirmation'
);

UPDATE public.bookings
SET is_deleted = true,
    finance_excluded = true,
    finance_exclusion_reason = '운영·E2E 테스트 예약 격리',
    finance_excluded_at = now(),
    finance_excluded_by = 'finance_v3_migration',
    updated_at = now()
WHERE booking_no IN ('BK-0080','BK-0081','BK-0082','BK-0083','BK-0084','BK-0085','BK-0086','BK-0087','BK-0088','BK-0089','BK-0090');

UPDATE public.booking_settlement_reviews review
SET status = 'invalid_booking',
    decision_reason = '운영·E2E 테스트 예약 격리',
    reviewed_by_label = 'finance_v3_migration',
    reviewed_at = now(),
    updated_at = now(),
    snapshot = snapshot || jsonb_build_object('quarantined_test_booking', true)
FROM public.bookings booking
WHERE review.booking_id = booking.id
  AND review.is_current
  AND booking.booking_no IN ('BK-0080','BK-0081','BK-0082','BK-0083','BK-0084','BK-0085','BK-0086','BK-0087','BK-0088','BK-0089','BK-0090');

-- Confirmed owner decision: BK-0018 is an invalid/wrong-date placeholder.
UPDATE public.bookings
SET is_deleted = true,
    finance_excluded = true,
    finance_exclusion_reason = '잘못 입력된 출발일의 오예약',
    finance_excluded_at = now(),
    finance_excluded_by = 'finance_v3_migration',
    updated_at = now()
WHERE booking_no = 'BK-0018';

UPDATE public.booking_settlement_reviews review
SET status = 'invalid_booking',
    decision_reason = '잘못 입력된 출발일의 오예약',
    reviewed_by_label = 'finance_v3_migration',
    reviewed_at = now(),
    updated_at = now()
FROM public.bookings booking
WHERE review.booking_id = booking.id AND review.is_current AND booking.booking_no = 'BK-0018';

COMMENT ON COLUMN public.bookings.finance_excluded IS '정산·세금·증빙·보호금·매출 계산에서 제외되는 복원 가능한 격리 표식.';
COMMENT ON TABLE public.booking_settlement_reviews IS '사장님 건별 확인 결정과 당시 거래·메모·배분 지문의 불변 이력.';
COMMENT ON FUNCTION public.save_bank_transaction_breakdown(uuid, jsonb, text, text, uuid, text, text) IS
  'Clobe 거래를 여러 예약·환불·수수료·회사 용도로 원자 분할하고 원본 금액 보존을 강제한다.';

COMMIT;

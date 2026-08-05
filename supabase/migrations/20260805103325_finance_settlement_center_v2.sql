-- Yeosonam finance center v2
-- Clobe 4128 is the bank SSOT. Period items are immutable close snapshots.

BEGIN;

CREATE TABLE IF NOT EXISTS public.settlement_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  departure_month date NOT NULL CHECK (departure_month = date_trunc('month', departure_month)::date),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'conditional', 'closed', 'reopened', 'superseded')),
  is_current boolean NOT NULL DEFAULT true,
  sync_cutoff_at timestamptz,
  source_transaction_count integer NOT NULL DEFAULT 0 CHECK (source_transaction_count >= 0),
  source_fingerprint text NOT NULL DEFAULT '',
  review_fingerprint text NOT NULL DEFAULT '',
  confirmed_booking_count integer NOT NULL DEFAULT 0 CHECK (confirmed_booking_count >= 0),
  confirmed_deposits bigint NOT NULL DEFAULT 0,
  confirmed_withdrawals bigint NOT NULL DEFAULT 0,
  confirmed_cash_margin bigint NOT NULL DEFAULT 0,
  exception_count integer NOT NULL DEFAULT 0 CHECK (exception_count >= 0),
  bank_balance bigint,
  os_balance bigint,
  balance_difference bigint,
  closed_at timestamptz,
  closed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  closed_by_label text,
  reopened_at timestamptz,
  reopened_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reopened_by_label text,
  reopen_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (departure_month, revision)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_settlement_periods_current_month
  ON public.settlement_periods(departure_month)
  WHERE is_current;
CREATE INDEX IF NOT EXISTS idx_settlement_periods_status_month
  ON public.settlement_periods(status, departure_month DESC);

CREATE TABLE IF NOT EXISTS public.settlement_period_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_period_id uuid NOT NULL REFERENCES public.settlement_periods(id) ON DELETE RESTRICT,
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  booking_no text NOT NULL,
  customer_name text,
  package_title text,
  departure_date date NOT NULL,
  deposits bigint NOT NULL DEFAULT 0,
  withdrawals bigint NOT NULL DEFAULT 0,
  cash_margin bigint NOT NULL DEFAULT 0,
  allocation_count integer NOT NULL DEFAULT 0 CHECK (allocation_count >= 0),
  transaction_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(transaction_ids) = 'array'),
  transaction_fingerprint text NOT NULL,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (settlement_period_id, booking_id)
);

CREATE INDEX IF NOT EXISTS idx_settlement_period_items_booking
  ON public.settlement_period_items(booking_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_settlement_period_items_period
  ON public.settlement_period_items(settlement_period_id, departure_date, booking_no);

CREATE TABLE IF NOT EXISTS public.settlement_period_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_period_id uuid REFERENCES public.settlement_periods(id) ON DELETE RESTRICT,
  departure_month date NOT NULL CHECK (departure_month = date_trunc('month', departure_month)::date),
  booking_id uuid REFERENCES public.bookings(id) ON DELETE RESTRICT,
  bank_transaction_id uuid REFERENCES public.bank_transactions(id) ON DELETE RESTRICT,
  exception_type text NOT NULL CHECK (exception_type IN (
    'negative_margin',
    'no_bank_evidence',
    'allocation_drift',
    'zero_margin',
    'post_close_change',
    'unclassified_company_transaction',
    'missing_receipt'
  )),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'waived')),
  assigned_to text,
  reason text,
  due_date date,
  source_fingerprint text,
  current_fingerprint text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  resolved_at timestamptz,
  resolved_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_open_settlement_period_exception
  ON public.settlement_period_exceptions(
    departure_month,
    exception_type,
    COALESCE(booking_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(bank_transaction_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_settlement_period_exceptions_queue
  ON public.settlement_period_exceptions(status, due_date, departure_month DESC);

CREATE TABLE IF NOT EXISTS public.bank_transaction_classifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_transaction_id uuid NOT NULL UNIQUE REFERENCES public.bank_transactions(id) ON DELETE RESTRICT,
  clobe_original_classification text,
  os_classification text CHECK (os_classification IN (
    'company_expense', 'tax', 'capital', 'transfer', 'refund', 'owner_draw', 'other_income', 'review'
  )),
  resolved_classification text NOT NULL CHECK (resolved_classification IN (
    'company_expense', 'tax', 'capital', 'transfer', 'refund', 'owner_draw', 'other_income', 'review'
  )),
  resolution_source text NOT NULL CHECK (resolution_source IN ('manual', 'os_rule', 'clobe', 'review')),
  rule_id uuid,
  is_profit_and_loss boolean NOT NULL DEFAULT true,
  receipt_status text NOT NULL DEFAULT 'not_required'
    CHECK (receipt_status IN ('not_required', 'missing', 'attached', 'verified')),
  confirmed_at timestamptz,
  confirmed_by text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bank_transaction_classifications_queue
  ON public.bank_transaction_classifications(resolved_classification, resolution_source, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.bank_classification_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  priority integer NOT NULL DEFAULT 100,
  counterparty_pattern text,
  memo_pattern text,
  direction text CHECK (direction IN ('deposit', 'withdrawal')),
  target_classification text NOT NULL CHECK (target_classification IN (
    'company_expense', 'tax', 'capital', 'transfer', 'refund', 'owner_draw', 'other_income', 'review'
  )),
  is_profit_and_loss boolean NOT NULL DEFAULT true,
  apply_to_existing boolean NOT NULL DEFAULT false,
  effective_from timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (counterparty_pattern IS NOT NULL OR memo_pattern IS NOT NULL)
);

ALTER TABLE public.bank_transaction_classifications
  DROP CONSTRAINT IF EXISTS bank_transaction_classifications_rule_id_fkey;
ALTER TABLE public.bank_transaction_classifications
  ADD CONSTRAINT bank_transaction_classifications_rule_id_fkey
  FOREIGN KEY (rule_id) REFERENCES public.bank_classification_rules(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bank_classification_rules_active_priority
  ON public.bank_classification_rules(is_active, priority, created_at);

CREATE TABLE IF NOT EXISTS public.finance_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'clobe' CHECK (provider = 'clobe'),
  account_number text NOT NULL,
  range_from date,
  range_to date,
  source_count integer NOT NULL DEFAULT 0,
  recognized_count integer NOT NULL DEFAULT 0,
  inserted_count integer NOT NULL DEFAULT 0,
  matched_count integer NOT NULL DEFAULT 0,
  duplicate_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  status text NOT NULL CHECK (status IN ('success', 'partial', 'failed')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_finance_sync_runs_latest
  ON public.finance_sync_runs(account_number, completed_at DESC);

CREATE OR REPLACE FUNCTION public.finance_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_settlement_period_item_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'settlement period items are immutable; create a new period revision';
END;
$$;

DROP TRIGGER IF EXISTS trg_settlement_periods_touch ON public.settlement_periods;
CREATE TRIGGER trg_settlement_periods_touch
  BEFORE UPDATE ON public.settlement_periods
  FOR EACH ROW EXECUTE FUNCTION public.finance_touch_updated_at();
DROP TRIGGER IF EXISTS trg_settlement_period_exceptions_touch ON public.settlement_period_exceptions;
CREATE TRIGGER trg_settlement_period_exceptions_touch
  BEFORE UPDATE ON public.settlement_period_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.finance_touch_updated_at();
DROP TRIGGER IF EXISTS trg_bank_transaction_classifications_touch ON public.bank_transaction_classifications;
CREATE TRIGGER trg_bank_transaction_classifications_touch
  BEFORE UPDATE ON public.bank_transaction_classifications
  FOR EACH ROW EXECUTE FUNCTION public.finance_touch_updated_at();
DROP TRIGGER IF EXISTS trg_bank_classification_rules_touch ON public.bank_classification_rules;
CREATE TRIGGER trg_bank_classification_rules_touch
  BEFORE UPDATE ON public.bank_classification_rules
  FOR EACH ROW EXECUTE FUNCTION public.finance_touch_updated_at();
DROP TRIGGER IF EXISTS trg_settlement_period_items_immutable ON public.settlement_period_items;
CREATE TRIGGER trg_settlement_period_items_immutable
  BEFORE UPDATE OR DELETE ON public.settlement_period_items
  FOR EACH ROW EXECUTE FUNCTION public.prevent_settlement_period_item_mutation();

ALTER TABLE public.settlement_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlement_period_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlement_period_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_transaction_classifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_classification_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_sync_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS settlement_periods_service_role_only ON public.settlement_periods;
CREATE POLICY settlement_periods_service_role_only ON public.settlement_periods
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS settlement_period_items_service_role_only ON public.settlement_period_items;
CREATE POLICY settlement_period_items_service_role_only ON public.settlement_period_items
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS settlement_period_exceptions_service_role_only ON public.settlement_period_exceptions;
CREATE POLICY settlement_period_exceptions_service_role_only ON public.settlement_period_exceptions
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS bank_transaction_classifications_service_role_only ON public.bank_transaction_classifications;
CREATE POLICY bank_transaction_classifications_service_role_only ON public.bank_transaction_classifications
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS bank_classification_rules_service_role_only ON public.bank_classification_rules;
CREATE POLICY bank_classification_rules_service_role_only ON public.bank_classification_rules
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS finance_sync_runs_service_role_only ON public.finance_sync_runs;
CREATE POLICY finance_sync_runs_service_role_only ON public.finance_sync_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON public.settlement_periods FROM anon, authenticated;
REVOKE ALL ON public.settlement_period_items FROM anon, authenticated;
REVOKE ALL ON public.settlement_period_exceptions FROM anon, authenticated;
REVOKE ALL ON public.bank_transaction_classifications FROM anon, authenticated;
REVOKE ALL ON public.bank_classification_rules FROM anon, authenticated;
REVOKE ALL ON public.finance_sync_runs FROM anon, authenticated;
GRANT ALL ON public.settlement_periods TO service_role;
GRANT ALL ON public.settlement_period_items TO service_role;
GRANT ALL ON public.settlement_period_exceptions TO service_role;
GRANT ALL ON public.bank_transaction_classifications TO service_role;
GRANT ALL ON public.bank_classification_rules TO service_role;
GRANT ALL ON public.finance_sync_runs TO service_role;

-- Preserve all pre-v2 booking confirmations as month snapshots.
INSERT INTO public.settlement_periods (
  departure_month,
  revision,
  status,
  is_current,
  sync_cutoff_at,
  confirmed_booking_count,
  closed_at,
  closed_by_label
)
SELECT
  date_trunc('month', b.departure_date)::date,
  1,
  'closed',
  true,
  MAX(b.settlement_confirmed_at),
  COUNT(*)::integer,
  MAX(b.settlement_confirmed_at),
  'legacy_booking_confirmation'
FROM public.bookings b
WHERE b.settlement_confirmed_at IS NOT NULL
  AND b.departure_date IS NOT NULL
  AND COALESCE(b.is_deleted, false) = false
  AND COALESCE(b.status, '') <> 'cancelled'
GROUP BY date_trunc('month', b.departure_date)::date
ON CONFLICT (departure_month, revision) DO NOTHING;

WITH booking_cash AS (
  SELECT
    b.id AS booking_id,
    b.booking_no,
    c.name AS customer_name,
    b.package_title,
    b.departure_date::date AS departure_date,
    COALESCE(SUM(a.allocated_amount) FILTER (WHERE t.transaction_type = '입금'), 0)::bigint AS deposits,
    COALESCE(SUM(a.allocated_amount) FILTER (WHERE t.transaction_type = '출금'), 0)::bigint AS withdrawals,
    COUNT(a.id)::integer AS allocation_count,
    COALESCE(
      jsonb_agg(t.id ORDER BY t.received_at, t.id) FILTER (WHERE t.id IS NOT NULL),
      '[]'::jsonb
    ) AS transaction_ids,
    md5(COALESCE(string_agg(
      t.id::text || ':' || a.allocated_amount::text || ':' || t.transaction_type,
      '|' ORDER BY t.received_at, t.id
    ), '')) AS transaction_fingerprint
  FROM public.bookings b
  LEFT JOIN public.customers c ON c.id = b.lead_customer_id
  LEFT JOIN public.bank_transaction_allocations a
    ON a.booking_id = b.id AND a.status = 'active' AND a.reversed_at IS NULL
  LEFT JOIN public.bank_transactions t
    ON t.id = a.bank_transaction_id
   AND t.status = 'active'
   AND t.external_provider = 'clobe'
   AND t.source = 'clobe_mcp'
   AND t.account_number = '100038454128'
   AND t.settlement_scope = 'travel'
  WHERE b.settlement_confirmed_at IS NOT NULL
    AND b.departure_date IS NOT NULL
    AND COALESCE(b.is_deleted, false) = false
    AND COALESCE(b.status, '') <> 'cancelled'
  GROUP BY b.id, b.booking_no, c.name, b.package_title, b.departure_date
)
INSERT INTO public.settlement_period_items (
  settlement_period_id,
  booking_id,
  booking_no,
  customer_name,
  package_title,
  departure_date,
  deposits,
  withdrawals,
  cash_margin,
  allocation_count,
  transaction_ids,
  transaction_fingerprint,
  snapshot
)
SELECT
  p.id,
  cash.booking_id,
  COALESCE(cash.booking_no, cash.booking_id::text),
  cash.customer_name,
  cash.package_title,
  cash.departure_date,
  cash.deposits,
  cash.withdrawals,
  cash.deposits - cash.withdrawals,
  cash.allocation_count,
  cash.transaction_ids,
  cash.transaction_fingerprint,
  jsonb_build_object('migrated_from', 'bookings.settlement_confirmed_at', 'fingerprint_version', 1)
FROM booking_cash cash
JOIN public.settlement_periods p
  ON p.departure_month = date_trunc('month', cash.departure_date)::date
 AND p.revision = 1
ON CONFLICT (settlement_period_id, booking_id) DO NOTHING;

UPDATE public.settlement_periods p
SET
  confirmed_booking_count = totals.booking_count,
  confirmed_deposits = totals.deposits,
  confirmed_withdrawals = totals.withdrawals,
  confirmed_cash_margin = totals.cash_margin,
  source_transaction_count = totals.source_transaction_count,
  source_fingerprint = totals.source_fingerprint
FROM (
  SELECT
    settlement_period_id,
    COUNT(*)::integer AS booking_count,
    SUM(deposits)::bigint AS deposits,
    SUM(withdrawals)::bigint AS withdrawals,
    SUM(cash_margin)::bigint AS cash_margin,
    SUM(allocation_count)::integer AS source_transaction_count,
    md5(string_agg(booking_id::text || ':' || transaction_fingerprint, '|' ORDER BY booking_id)) AS source_fingerprint
  FROM public.settlement_period_items
  GROUP BY settlement_period_id
) totals
WHERE p.id = totals.settlement_period_id;

-- Seed provider classifications without overriding future OS/manual decisions.
INSERT INTO public.bank_transaction_classifications (
  bank_transaction_id,
  clobe_original_classification,
  resolved_classification,
  resolution_source,
  is_profit_and_loss
)
SELECT
  t.id,
  t.provider_category,
  CASE
    WHEN COALESCE(t.provider_is_unclassified, true) THEN 'review'
    WHEN t.provider_category ~* '(세금|국세|지방세|부가세)' THEN 'tax'
    WHEN t.provider_category ~* '(자본|증자|대여금|차입금)' THEN 'capital'
    WHEN t.provider_category ~* '(이체|계좌이동)' THEN 'transfer'
    WHEN t.provider_category ~* '(대표자|인출)' THEN 'owner_draw'
    WHEN t.transaction_type = '입금' THEN 'other_income'
    ELSE 'company_expense'
  END,
  CASE WHEN COALESCE(t.provider_is_unclassified, true) THEN 'review' ELSE 'clobe' END,
  CASE
    WHEN t.provider_category ~* '(자본|증자|대여금|차입금|이체|계좌이동|대표자|인출)' THEN false
    ELSE true
  END
FROM public.bank_transactions t
WHERE t.external_provider = 'clobe'
  AND t.source = 'clobe_mcp'
  AND t.status = 'active'
  AND t.account_number = '100038454128'
  AND t.settlement_scope = 'non_travel'
ON CONFLICT (bank_transaction_id) DO NOTHING;

COMMENT ON TABLE public.settlement_periods IS '출발 월별 정산 마감 버전. 재개방 후 재마감 시 새 revision을 만든다.';
COMMENT ON TABLE public.settlement_period_items IS '예약별 입금·출금·현금마진과 거래 지문의 불변 월마감 스냅샷.';
COMMENT ON TABLE public.settlement_period_exceptions IS '조건부 마감 및 마감 후 변경의 담당자·사유·기한 큐.';
COMMENT ON TABLE public.bank_transaction_classifications IS 'Clobe 원본 분류와 OS 최종 분류를 분리한 회사거래 분류 원장.';
COMMENT ON TABLE public.bank_classification_rules IS '신규 거래에 적용하는 OS 자동 분류 규칙. apply_to_existing=false가 기본이다.';

CREATE OR REPLACE FUNCTION public.close_finance_settlement_period(
  p_departure_month date,
  p_status text,
  p_sync_cutoff_at timestamptz,
  p_source_fingerprint text,
  p_review_fingerprint text,
  p_source_transaction_count integer,
  p_items jsonb,
  p_exceptions jsonb,
  p_actor uuid,
  p_actor_label text,
  p_bank_balance bigint,
  p_os_balance bigint
) RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_current public.settlement_periods%ROWTYPE;
  v_period_id uuid;
  v_revision integer;
  v_now timestamptz := now();
  v_item jsonb;
  v_exception jsonb;
  v_booking_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF p_departure_month IS NULL OR p_departure_month <> date_trunc('month', p_departure_month)::date THEN
    RAISE EXCEPTION 'departure month must be the first day of a month';
  END IF;
  IF p_status NOT IN ('closed', 'conditional') THEN
    RAISE EXCEPTION 'close status must be closed or conditional';
  END IF;
  IF jsonb_typeof(COALESCE(p_items, '[]'::jsonb)) <> 'array'
     OR jsonb_typeof(COALESCE(p_exceptions, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'items and exceptions must be arrays';
  END IF;
  IF p_status = 'closed' AND jsonb_array_length(COALESCE(p_exceptions, '[]'::jsonb)) > 0 THEN
    RAISE EXCEPTION 'normal close cannot contain unresolved exceptions';
  END IF;
  IF p_status = 'conditional' AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(p_exceptions, '[]'::jsonb)) AS exception_row(value)
    WHERE NULLIF(trim(value->>'assigned_to'), '') IS NULL
       OR NULLIF(trim(value->>'reason'), '') IS NULL
       OR NULLIF(value->>'due_date', '') IS NULL
  ) THEN
    RAISE EXCEPTION 'conditional close exceptions require assignee, reason, and due date';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('finance-close:' || p_departure_month::text));

  SELECT * INTO v_current
  FROM public.settlement_periods
  WHERE departure_month = p_departure_month AND is_current
  FOR UPDATE;

  IF FOUND
     AND v_current.status IN ('closed', 'conditional')
     AND v_current.source_fingerprint = COALESCE(p_source_fingerprint, '')
     AND v_current.review_fingerprint = COALESCE(p_review_fingerprint, '') THEN
    RETURN v_current.id;
  END IF;

  IF FOUND AND v_current.status IN ('closed', 'conditional') THEN
    RAISE EXCEPTION 'settlement period is locked; reopen it before closing a new revision';
  END IF;

  SELECT COALESCE(MAX(revision), 0) + 1 INTO v_revision
  FROM public.settlement_periods
  WHERE departure_month = p_departure_month;

  IF FOUND THEN
    UPDATE public.settlement_periods
    SET is_current = false, status = 'superseded'
    WHERE id = v_current.id;
  END IF;

  INSERT INTO public.settlement_periods (
    departure_month,
    revision,
    status,
    is_current,
    sync_cutoff_at,
    source_transaction_count,
    source_fingerprint,
    review_fingerprint,
    confirmed_booking_count,
    confirmed_deposits,
    confirmed_withdrawals,
    confirmed_cash_margin,
    exception_count,
    bank_balance,
    os_balance,
    balance_difference,
    closed_at,
    closed_by,
    closed_by_label
  ) VALUES (
    p_departure_month,
    v_revision,
    p_status,
    true,
    p_sync_cutoff_at,
    GREATEST(COALESCE(p_source_transaction_count, 0), 0),
    COALESCE(p_source_fingerprint, ''),
    COALESCE(p_review_fingerprint, ''),
    jsonb_array_length(COALESCE(p_items, '[]'::jsonb)),
    COALESCE((SELECT SUM((value->>'deposits')::bigint) FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) AS item(value)), 0),
    COALESCE((SELECT SUM((value->>'withdrawals')::bigint) FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) AS item(value)), 0),
    COALESCE((SELECT SUM((value->>'cash_margin')::bigint) FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) AS item(value)), 0),
    jsonb_array_length(COALESCE(p_exceptions, '[]'::jsonb)),
    p_bank_balance,
    p_os_balance,
    CASE WHEN p_bank_balance IS NULL OR p_os_balance IS NULL THEN NULL ELSE p_bank_balance - p_os_balance END,
    v_now,
    p_actor,
    p_actor_label
  ) RETURNING id INTO v_period_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb))
  LOOP
    INSERT INTO public.settlement_period_items (
      settlement_period_id,
      booking_id,
      booking_no,
      customer_name,
      package_title,
      departure_date,
      deposits,
      withdrawals,
      cash_margin,
      allocation_count,
      transaction_ids,
      transaction_fingerprint,
      snapshot
    ) VALUES (
      v_period_id,
      (v_item->>'booking_id')::uuid,
      v_item->>'booking_no',
      NULLIF(v_item->>'customer_name', ''),
      NULLIF(v_item->>'package_title', ''),
      (v_item->>'departure_date')::date,
      COALESCE((v_item->>'deposits')::bigint, 0),
      COALESCE((v_item->>'withdrawals')::bigint, 0),
      COALESCE((v_item->>'cash_margin')::bigint, 0),
      COALESCE((v_item->>'allocation_count')::integer, 0),
      COALESCE(v_item->'transaction_ids', '[]'::jsonb),
      COALESCE(v_item->>'transaction_fingerprint', ''),
      COALESCE(v_item->'snapshot', '{}'::jsonb)
    );
    v_booking_ids := array_append(v_booking_ids, (v_item->>'booking_id')::uuid);
  END LOOP;

  FOR v_exception IN SELECT value FROM jsonb_array_elements(COALESCE(p_exceptions, '[]'::jsonb))
  LOOP
    INSERT INTO public.settlement_period_exceptions (
      settlement_period_id,
      departure_month,
      booking_id,
      bank_transaction_id,
      exception_type,
      assigned_to,
      reason,
      due_date,
      source_fingerprint,
      current_fingerprint,
      payload
    ) VALUES (
      v_period_id,
      p_departure_month,
      NULLIF(v_exception->>'booking_id', '')::uuid,
      NULLIF(v_exception->>'bank_transaction_id', '')::uuid,
      v_exception->>'exception_type',
      NULLIF(v_exception->>'assigned_to', ''),
      NULLIF(v_exception->>'reason', ''),
      NULLIF(v_exception->>'due_date', '')::date,
      NULLIF(v_exception->>'source_fingerprint', ''),
      NULLIF(v_exception->>'current_fingerprint', ''),
      COALESCE(v_exception->'payload', '{}'::jsonb)
    );
  END LOOP;

  IF cardinality(v_booking_ids) > 0 THEN
    UPDATE public.bookings
    SET
      settlement_confirmed_at = COALESCE(settlement_confirmed_at, v_now),
      settlement_confirmed_by = COALESCE(settlement_confirmed_by, 'finance_period:' || p_actor_label),
      settlement_mode = 'cash',
      status = CASE WHEN status = 'cancelled' THEN status ELSE 'completed' END,
      payment_status = CASE WHEN status = 'cancelled' THEN payment_status ELSE '완납' END,
      updated_at = v_now
    WHERE id = ANY(v_booking_ids);
  END IF;

  INSERT INTO public.audit_logs (
    user_id,
    action,
    target_type,
    target_id,
    description,
    after_value
  ) VALUES (
    p_actor,
    'FINANCE_PERIOD_CLOSED',
    'settlement_period',
    v_period_id::text,
    p_departure_month::text || ' departure month close revision ' || v_revision,
    jsonb_build_object(
      'status', p_status,
      'revision', v_revision,
      'booking_count', cardinality(v_booking_ids),
      'exception_count', jsonb_array_length(COALESCE(p_exceptions, '[]'::jsonb)),
      'actor', p_actor_label
    )
  );

  RETURN v_period_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reopen_finance_settlement_period(
  p_departure_month date,
  p_reason text,
  p_actor uuid,
  p_actor_label text
) RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_period_id uuid;
BEGIN
  IF NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'reopen reason is required';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('finance-close:' || p_departure_month::text));
  UPDATE public.settlement_periods
  SET
    status = 'reopened',
    reopened_at = now(),
    reopened_by = p_actor,
    reopened_by_label = p_actor_label,
    reopen_reason = trim(p_reason)
  WHERE departure_month = p_departure_month
    AND is_current
    AND status IN ('closed', 'conditional')
  RETURNING id INTO v_period_id;

  IF v_period_id IS NULL THEN
    RAISE EXCEPTION 'locked settlement period not found';
  END IF;

  INSERT INTO public.audit_logs (
    user_id,
    action,
    target_type,
    target_id,
    description,
    after_value
  ) VALUES (
    p_actor,
    'FINANCE_PERIOD_REOPENED',
    'settlement_period',
    v_period_id::text,
    p_departure_month::text || ' settlement period reopened',
    jsonb_build_object('reason', trim(p_reason), 'actor', p_actor_label)
  );
  RETURN v_period_id;
END;
$$;

REVOKE ALL ON FUNCTION public.close_finance_settlement_period(date, text, timestamptz, text, text, integer, jsonb, jsonb, uuid, text, bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.close_finance_settlement_period(date, text, timestamptz, text, text, integer, jsonb, jsonb, uuid, text, bigint, bigint) TO service_role;
REVOKE ALL ON FUNCTION public.reopen_finance_settlement_period(date, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reopen_finance_settlement_period(date, text, uuid, text) TO service_role;

COMMIT;

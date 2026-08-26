BEGIN;

-- Provider transaction IDs are scoped by tenant/account. The former global
-- index was safe for the current single account but blocked correct isolation
-- as additional tenant accounts are connected.
DROP INDEX IF EXISTS public.uq_bank_transactions_external_provider_tx;
CREATE UNIQUE INDEX uq_bank_transactions_external_provider_tx
  ON public.bank_transactions (
    COALESCE(tenant_id::TEXT, 'platform'),
    external_provider,
    COALESCE(NULLIF(pg_catalog.regexp_replace(account_number, '[^0-9]', '', 'g'), ''), 'unknown-account'),
    external_transaction_id
  )
  WHERE external_provider IS NOT NULL
    AND external_transaction_id IS NOT NULL
    AND status IS DISTINCT FROM 'excluded';

-- Keep each Clobe command distinguishable in the append-only ledger. These
-- values are used by the memo-reconciliation and operator-approved outflow
-- commands below, so the constraint must be widened before either RPC runs.
ALTER TABLE public.ledger_entries
  DROP CONSTRAINT IF EXISTS ledger_entries_source_check;
ALTER TABLE public.ledger_entries
  ADD CONSTRAINT ledger_entries_source_check
  CHECK (source IN (
    'slack_ingest', 'payment_match_confirm', 'land_settlement_create',
    'land_settlement_reverse', 'admin_manual_edit', 'booking_create_softmatch',
    'bank_tx_manual_match', 'sms_payment', 'cron_resync', 'seed_phase2a',
    'bank_tx_legacy_reassignment', 'bank_tx_clobe_rebuild',
    'finance_breakdown', 'finance_breakdown_reverse',
    'clobe_provider_memo_reconciliation', 'clobe_outflow_allocation'
  ));

-- One durable run record is created before any remote Clobe read. A tenant +
-- account lease prevents two manual syncs from processing the same rows at the
-- same time. Existing completed history remains valid.
ALTER TABLE public.finance_sync_runs
  DROP CONSTRAINT IF EXISTS finance_sync_runs_status_check;
ALTER TABLE public.finance_sync_runs
  ADD CONSTRAINT finance_sync_runs_status_check
  CHECK (status IN ('running', 'success', 'partial', 'failed'));
ALTER TABLE public.finance_sync_runs
  ALTER COLUMN completed_at DROP NOT NULL,
  ALTER COLUMN completed_at DROP DEFAULT;
ALTER TABLE public.finance_sync_runs
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS trigger_source TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS lease_token UUID,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS checkpoint_cursor TEXT,
  ADD COLUMN IF NOT EXISTS page_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_finance_sync_runs_lease
  ON public.finance_sync_runs(tenant_id, provider, account_number, lease_expires_at DESC)
  WHERE status = 'running' AND completed_at IS NULL;

CREATE OR REPLACE FUNCTION public.begin_clobe_sync_run(
  p_tenant_id UUID,
  p_account_number TEXT,
  p_range_from DATE,
  p_range_to DATE,
  p_trigger_source TEXT DEFAULT 'manual',
  p_lease_seconds INTEGER DEFAULT 360
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_account TEXT := regexp_replace(COALESCE(p_account_number, ''), '[^0-9]', '', 'g');
  v_run_id UUID := gen_random_uuid();
  v_token UUID := gen_random_uuid();
BEGIN
  IF v_account = '' THEN
    RAISE EXCEPTION 'account is required for Clobe sync' USING ERRCODE = 'P0001';
  END IF;
  IF p_range_from IS NULL OR p_range_to IS NULL OR p_range_from > p_range_to THEN
    RAISE EXCEPTION 'valid Clobe sync range is required' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'clobe-sync:' || COALESCE(p_tenant_id::TEXT, 'platform') || ':' || v_account,
      0
    )
  );

  UPDATE public.finance_sync_runs
  SET status = 'failed',
      completed_at = pg_catalog.now(),
      error_count = error_count + 1,
      details = COALESCE(details, '{}'::JSONB)
        || jsonb_build_object('failure', 'lease_expired', 'expired_at', pg_catalog.now())
  WHERE tenant_id IS NOT DISTINCT FROM p_tenant_id
    AND provider = 'clobe'
    AND regexp_replace(account_number, '[^0-9]', '', 'g') = v_account
    AND status = 'running'
    AND completed_at IS NULL
    AND lease_expires_at <= pg_catalog.now();

  IF EXISTS (
    SELECT 1
    FROM public.finance_sync_runs
    WHERE tenant_id IS NOT DISTINCT FROM p_tenant_id
      AND provider = 'clobe'
      AND regexp_replace(account_number, '[^0-9]', '', 'g') = v_account
      AND status = 'running'
      AND completed_at IS NULL
      AND lease_expires_at > pg_catalog.now()
  ) THEN
    RAISE EXCEPTION 'Clobe sync is already running for this account' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.finance_sync_runs (
    id, tenant_id, provider, account_number, range_from, range_to,
    status, trigger_source, lease_token, lease_expires_at, started_at,
    completed_at, details
  ) VALUES (
    v_run_id, p_tenant_id, 'clobe', v_account, p_range_from, p_range_to,
    'running', COALESCE(NULLIF(pg_catalog.btrim(p_trigger_source), ''), 'manual'),
    v_token, pg_catalog.now() + pg_catalog.make_interval(secs => GREATEST(60, LEAST(p_lease_seconds, 1800))),
    pg_catalog.now(), NULL, jsonb_build_object('phase', 'remote_read')
  );

  RETURN jsonb_build_object(
    'run_id', v_run_id,
    'lease_token', v_token,
    'lease_expires_at', pg_catalog.now() + pg_catalog.make_interval(secs => GREATEST(60, LEAST(p_lease_seconds, 1800)))
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.checkpoint_clobe_sync_run(
  p_run_id UUID,
  p_lease_token UUID,
  p_cursor TEXT,
  p_page_count INTEGER,
  p_details JSONB DEFAULT '{}'::JSONB,
  p_lease_seconds INTEGER DEFAULT 360
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.finance_sync_runs%ROWTYPE;
BEGIN
  UPDATE public.finance_sync_runs
  SET checkpoint_cursor = p_cursor,
      page_count = GREATEST(0, COALESCE(p_page_count, 0)),
      lease_expires_at = pg_catalog.now() + pg_catalog.make_interval(secs => GREATEST(60, LEAST(p_lease_seconds, 1800))),
      details = COALESCE(details, '{}'::JSONB) || COALESCE(p_details, '{}'::JSONB)
  WHERE id = p_run_id
    AND lease_token = p_lease_token
    AND status = 'running'
    AND completed_at IS NULL
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'active Clobe sync lease not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object('run_id', v_row.id, 'lease_expires_at', v_row.lease_expires_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_clobe_sync_run(
  p_run_id UUID,
  p_lease_token UUID,
  p_status TEXT,
  p_source_count INTEGER DEFAULT 0,
  p_recognized_count INTEGER DEFAULT 0,
  p_inserted_count INTEGER DEFAULT 0,
  p_matched_count INTEGER DEFAULT 0,
  p_duplicate_count INTEGER DEFAULT 0,
  p_error_count INTEGER DEFAULT 0,
  p_details JSONB DEFAULT '{}'::JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.finance_sync_runs%ROWTYPE;
BEGIN
  IF p_status NOT IN ('success', 'partial', 'failed') THEN
    RAISE EXCEPTION 'invalid Clobe sync completion status' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.finance_sync_runs
  SET status = p_status,
      source_count = GREATEST(0, COALESCE(p_source_count, 0)),
      recognized_count = GREATEST(0, COALESCE(p_recognized_count, 0)),
      inserted_count = GREATEST(0, COALESCE(p_inserted_count, 0)),
      matched_count = GREATEST(0, COALESCE(p_matched_count, 0)),
      duplicate_count = GREATEST(0, COALESCE(p_duplicate_count, 0)),
      error_count = GREATEST(0, COALESCE(p_error_count, 0)),
      details = COALESCE(details, '{}'::JSONB) || COALESCE(p_details, '{}'::JSONB),
      completed_at = pg_catalog.now(),
      lease_expires_at = NULL
  WHERE id = p_run_id
    AND lease_token = p_lease_token
    AND status = 'running'
    AND completed_at IS NULL
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'active Clobe sync lease not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object('run_id', v_row.id, 'status', v_row.status, 'completed_at', v_row.completed_at);
END;
$$;

REVOKE ALL ON FUNCTION public.begin_clobe_sync_run(UUID, TEXT, DATE, DATE, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.checkpoint_clobe_sync_run(UUID, UUID, TEXT, INTEGER, JSONB, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_clobe_sync_run(UUID, UUID, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_clobe_sync_run(UUID, TEXT, DATE, DATE, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.checkpoint_clobe_sync_run(UUID, UUID, TEXT, INTEGER, JSONB, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_clobe_sync_run(UUID, UUID, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, JSONB) TO service_role;

-- Final settlement evidence is append-only. Reopening creates another row; an
-- already confirmed snapshot is never rewritten.
CREATE TABLE IF NOT EXISTS public.clobe_booking_settlement_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  settlement_key TEXT NOT NULL,
  version INTEGER NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('confirmed', 'reopened')),
  transaction_fingerprint TEXT NOT NULL,
  transaction_ids UUID[] NOT NULL,
  inflow_amount BIGINT NOT NULL,
  outflow_amount BIGINT NOT NULL,
  net_profit BIGINT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(evidence) = 'object'),
  reason TEXT,
  actor TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (booking_id, version)
);

ALTER TABLE public.clobe_booking_settlement_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS clobe_booking_settlement_snapshots_service_role_only
  ON public.clobe_booking_settlement_snapshots;
CREATE POLICY clobe_booking_settlement_snapshots_service_role_only
  ON public.clobe_booking_settlement_snapshots
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.clobe_booking_settlement_snapshots FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.clobe_booking_settlement_snapshots TO service_role;

CREATE OR REPLACE FUNCTION public.reject_clobe_settlement_snapshot_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'Clobe settlement snapshots are append-only' USING ERRCODE = 'P0001';
END;
$$;
DROP TRIGGER IF EXISTS trg_reject_clobe_settlement_snapshot_mutation
  ON public.clobe_booking_settlement_snapshots;
CREATE TRIGGER trg_reject_clobe_settlement_snapshot_mutation
  BEFORE UPDATE OR DELETE ON public.clobe_booking_settlement_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.reject_clobe_settlement_snapshot_mutation();

-- Clobe final settlement fields may only be changed by the evidence-gated
-- command below. This blocks legacy monthly/AI/general UPDATE paths while
-- leaving non-Clobe booking workflows unchanged.
CREATE OR REPLACE FUNCTION public.guard_clobe_booking_settlement_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.booking_settlement_keys k
    WHERE k.booking_id = NEW.id
      AND k.status = 'active'
      AND (
        k.source IN ('clobe_memo_created_booking', 'bank_memo_created_booking', 'clobe_memo_approved_booking')
        OR COALESCE(k.metadata ->> 'clobe_generated', 'false') IN ('true', 't', '1')
      )
  ) AND COALESCE(
    pg_catalog.current_setting('yeosonam.clobe_settlement_booking_id', TRUE),
    ''
  ) <> NEW.id::TEXT THEN
    RAISE EXCEPTION 'Clobe settlement fields require finalize_clobe_booking_settlement' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_clobe_booking_settlement_mutation ON public.bookings;
CREATE TRIGGER trg_guard_clobe_booking_settlement_mutation
  BEFORE UPDATE OF settlement_confirmed_at, settlement_confirmed_by, settlement_mode
  ON public.bookings
  FOR EACH ROW
  WHEN (
    OLD.settlement_confirmed_at IS DISTINCT FROM NEW.settlement_confirmed_at
    OR OLD.settlement_confirmed_by IS DISTINCT FROM NEW.settlement_confirmed_by
    OR OLD.settlement_mode IS DISTINCT FROM NEW.settlement_mode
  )
  EXECUTE FUNCTION public.guard_clobe_booking_settlement_mutation();

CREATE OR REPLACE FUNCTION public.finalize_clobe_booking_settlement(
  p_booking_id UUID,
  p_confirm BOOLEAN DEFAULT TRUE,
  p_reason TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL,
  p_actor TEXT DEFAULT 'admin'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_booking RECORD;
  v_key RECORD;
  v_command RECORD;
  v_paid BIGINT;
  v_payout BIGINT;
  v_net BIGINT;
  v_transaction_ids UUID[] := ARRAY[]::UUID[];
  v_provider_transaction_count INTEGER := 0;
  v_snapshot_id UUID;
  v_snapshot_version INTEGER;
  v_fingerprint TEXT;
  v_result JSONB;
  v_command_type TEXT := CASE WHEN p_confirm THEN 'finalize' ELSE 'unfinalize' END;
  v_already_in_state BOOLEAN := FALSE;
BEGIN
  IF NULLIF(pg_catalog.btrim(p_idempotency_key), '') IS NULL THEN
    RAISE EXCEPTION 'Clobe settlement command requires idempotency_key' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_idempotency_key, 0));

  SELECT * INTO v_command
  FROM public.clobe_settlement_command_idempotency
  WHERE idempotency_key = p_idempotency_key
  FOR UPDATE;
  IF FOUND THEN
    IF v_command.booking_id <> p_booking_id OR v_command.command_type <> v_command_type THEN
      RAISE EXCEPTION 'Clobe settlement idempotency key conflict' USING ERRCODE = 'P0001';
    END IF;
    RETURN COALESCE(v_command.result_json, jsonb_build_object('ok', TRUE, 'idempotent_replay', TRUE));
  END IF;

  SELECT id, tenant_id, status, is_deleted, paid_amount, total_paid_out,
         settlement_confirmed_at, settlement_confirmed_by, settlement_mode
    INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_booking.is_deleted, FALSE) THEN
    RAISE EXCEPTION 'booking not found or deleted' USING ERRCODE = 'P0002';
  END IF;

  SELECT id, tenant_id, normalized_key, raw_key
    INTO v_key
  FROM public.booking_settlement_keys
  WHERE booking_id = p_booking_id
    AND status = 'active'
    AND (
      source IN ('clobe_memo_created_booking', 'bank_memo_created_booking', 'clobe_memo_approved_booking')
      OR COALESCE(metadata ->> 'clobe_generated', 'false') IN ('true', 't', '1')
    )
  ORDER BY updated_at DESC
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Clobe settlement key is required' USING ERRCODE = 'P0001';
  END IF;

  SELECT
    COALESCE(SUM(CASE WHEN account = 'paid_amount' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN account = 'total_paid_out' THEN amount ELSE 0 END), 0)
    INTO v_paid, v_payout
  FROM public.ledger_entries
  WHERE booking_id = p_booking_id;

  IF v_paid <> COALESCE(v_booking.paid_amount, 0)
     OR v_payout <> COALESCE(v_booking.total_paid_out, 0) THEN
    RAISE EXCEPTION 'ledger drift blocks Clobe settlement: booking paid=% ledger paid=% booking payout=% ledger payout=%',
      COALESCE(v_booking.paid_amount, 0), v_paid,
      COALESCE(v_booking.total_paid_out, 0), v_payout USING ERRCODE = 'P0001';
  END IF;

  -- Include both transactions whose latest provider key points at this booking
  -- and transactions explicitly allocated to it (the latter supports one bank
  -- withdrawal split across two bookings).
  WITH candidate_transactions AS (
    SELECT DISTINCT t.id
    FROM public.bank_transactions t
    WHERE t.status <> 'excluded'
      AND t.tenant_id IS NOT DISTINCT FROM v_booking.tenant_id
      AND (t.source IN ('clobe_mcp', 'clobe_api') OR t.external_provider = 'clobe')
      AND (
        COALESCE(
          NULLIF(pg_catalog.btrim(t.source_metadata -> 'clobe_mcp' ->> 'settlement_key'), ''),
          NULLIF(pg_catalog.btrim(t.source_metadata -> 'clobe_api' ->> 'settlement_key'), '')
        ) = v_key.normalized_key
        OR EXISTS (
          SELECT 1 FROM public.bank_transaction_allocations a
          WHERE a.bank_transaction_id = t.id
            AND a.booking_id = p_booking_id
            AND a.status = 'active'
            AND a.reversed_at IS NULL
        )
      )
  )
  SELECT COALESCE(pg_catalog.array_agg(id ORDER BY id), ARRAY[]::UUID[])
    INTO v_transaction_ids
  FROM candidate_transactions;

  SELECT COUNT(*) INTO v_provider_transaction_count
  FROM public.bank_transactions t
  WHERE t.id = ANY(v_transaction_ids)
    AND COALESCE(
      NULLIF(pg_catalog.btrim(t.source_metadata -> 'clobe_mcp' ->> 'settlement_key'), ''),
      NULLIF(pg_catalog.btrim(t.source_metadata -> 'clobe_api' ->> 'settlement_key'), '')
    ) = v_key.normalized_key;

  IF p_confirm AND v_provider_transaction_count = 0 THEN
    RAISE EXCEPTION 'no active Clobe provider transactions exist for settlement key %', v_key.normalized_key USING ERRCODE = 'P0001';
  END IF;

  IF p_confirm AND EXISTS (
    SELECT 1
    FROM public.bank_transactions t
    WHERE t.id = ANY(v_transaction_ids)
      AND COALESCE((
        SELECT SUM(a.allocated_amount)
        FROM public.bank_transaction_allocations a
        WHERE a.bank_transaction_id = t.id
          AND a.status = 'active'
          AND a.reversed_at IS NULL
      ), 0) <> ABS(t.amount)
  ) THEN
    RAISE EXCEPTION 'every Clobe transaction must be fully allocated before final settlement' USING ERRCODE = 'P0001';
  END IF;

  IF p_confirm AND EXISTS (
    SELECT 1
    FROM public.bank_transaction_allocations a
    WHERE a.bank_transaction_id = ANY(v_transaction_ids)
      AND a.status = 'active'
      AND a.reversed_at IS NULL
      AND (
        a.target_type NOT IN ('booking', 'customer_refund')
        OR a.booking_id IS NULL
        OR a.ledger_account IS NULL
        OR a.ledger_delta IS NULL
      )
  ) THEN
    RAISE EXCEPTION 'unresolved non-booking allocation blocks Clobe final settlement' USING ERRCODE = 'P0001';
  END IF;

  IF p_confirm AND EXISTS (
    SELECT 1
    FROM public.bank_transaction_allocations a
    WHERE a.bank_transaction_id = ANY(v_transaction_ids)
      AND a.status = 'active'
      AND a.reversed_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.ledger_entries l
        WHERE l.booking_id = a.booking_id
          AND l.account = a.ledger_account
          AND l.amount = a.ledger_delta
          AND (
            l.idempotency_key = a.idempotency_key
            OR l.idempotency_key LIKE a.idempotency_key || ':%'
            OR (
              a.idempotency_key LIKE '%:line:%'
              AND l.idempotency_key LIKE pg_catalog.replace(a.idempotency_key, ':line:', ':apply:') || ':%'
            )
          )
      )
  ) THEN
    RAISE EXCEPTION 'allocation ledger evidence blocks Clobe final settlement' USING ERRCODE = 'P0001';
  END IF;

  IF p_confirm AND EXISTS (
    SELECT 1
    FROM public.bank_transactions t
    WHERE t.id = ANY(v_transaction_ids)
      AND COALESCE(
        NULLIF(pg_catalog.btrim(t.source_metadata -> 'clobe_mcp' ->> 'settlement_key'), ''),
        NULLIF(pg_catalog.btrim(t.source_metadata -> 'clobe_api' ->> 'settlement_key'), '')
      ) = v_key.normalized_key
      AND NOT EXISTS (
        SELECT 1
        FROM public.bank_transaction_allocations a
        WHERE a.bank_transaction_id = t.id
          AND a.booking_id = p_booking_id
          AND a.status = 'active'
          AND a.reversed_at IS NULL
      )
  ) THEN
    RAISE EXCEPTION 'provider-key transaction is not allocated to this booking' USING ERRCODE = 'P0001';
  END IF;

  IF p_confirm AND EXISTS (
    SELECT 1
    FROM public.bank_transaction_allocations a
    JOIN public.bank_transactions t ON t.id = a.bank_transaction_id
    WHERE a.booking_id = p_booking_id
      AND a.status = 'active'
      AND a.reversed_at IS NULL
      AND t.status <> 'excluded'
      AND t.tenant_id IS NOT DISTINCT FROM v_booking.tenant_id
      AND (t.source IN ('clobe_mcp', 'clobe_api') OR t.external_provider = 'clobe')
      AND (
        t.match_status IN ('review', 'error', 'unmatched')
        OR (
          COALESCE(
            NULLIF(pg_catalog.btrim(t.source_metadata -> 'clobe_mcp' ->> 'settlement_key'), ''),
            NULLIF(pg_catalog.btrim(t.source_metadata -> 'clobe_api' ->> 'settlement_key'), '')
          ) IS DISTINCT FROM v_key.normalized_key
          AND NOT (
            t.transaction_type = '출금'
            AND t.match_status = 'manual'
            AND EXISTS (
              SELECT 1
              FROM public.clobe_outflow_allocation_commands c
              WHERE c.bank_transaction_id = t.id
                AND c.completed_at IS NOT NULL
                AND c.result_json IS NOT NULL
                AND c.request_json ->> 'action' = 'match'
                AND pg_catalog.jsonb_typeof(c.request_json -> 'allocations') = 'array'
                AND (
                  SELECT COUNT(*)
                  FROM public.bank_transaction_allocations current_a
                  WHERE current_a.bank_transaction_id = t.id
                    AND current_a.status = 'active'
                    AND current_a.reversed_at IS NULL
                ) = pg_catalog.jsonb_array_length(c.request_json -> 'allocations')
                AND NOT EXISTS (
                  SELECT 1
                  FROM public.bank_transaction_allocations current_a
                  WHERE current_a.bank_transaction_id = t.id
                    AND current_a.status = 'active'
                    AND current_a.reversed_at IS NULL
                    AND current_a.idempotency_key NOT LIKE c.idempotency_key || ':%'
                )
                AND NOT EXISTS (
                  SELECT 1
                  FROM pg_catalog.jsonb_array_elements(c.request_json -> 'allocations') requested
                  WHERE NOT EXISTS (
                    SELECT 1
                    FROM public.bank_transaction_allocations current_a
                    WHERE current_a.bank_transaction_id = t.id
                      AND current_a.status = 'active'
                      AND current_a.reversed_at IS NULL
                      AND current_a.idempotency_key LIKE c.idempotency_key || ':%'
                      AND current_a.booking_id = (requested ->> 'bookingId')::UUID
                      AND current_a.allocated_amount = (requested ->> 'amount')::BIGINT
                      AND current_a.allocation_type = requested ->> 'allocationType'
                  )
                )
            )
          )
        )
      )
  ) THEN
    RAISE EXCEPTION 'Clobe allocation has unresolved memo-key or review state' USING ERRCODE = 'P0001';
  END IF;

  IF p_confirm AND EXISTS (
    SELECT 1
    FROM public.ops_events e
    WHERE e.status = 'open'
      AND e.event_type = 'payment_imported'
      AND e.metadata ? 'previous_settlement_key'
      AND e.metadata ? 'new_settlement_key'
      AND (
        e.booking_id = p_booking_id
        OR EXISTS (
          SELECT 1
          FROM public.bank_transaction_allocations a
          WHERE a.bank_transaction_id = e.bank_transaction_id
            AND a.booking_id = p_booking_id
            AND a.status = 'active'
            AND a.reversed_at IS NULL
        )
      )
  ) THEN
    RAISE EXCEPTION 'open Clobe memo-change review blocks final settlement' USING ERRCODE = 'P0001';
  END IF;

  IF p_confirm AND EXISTS (
    SELECT 1
    FROM public.bank_transactions t
    WHERE t.id = ANY(v_transaction_ids)
      AND COALESCE(
        NULLIF(pg_catalog.btrim(t.source_metadata -> 'clobe_mcp' ->> 'settlement_key'), ''),
        NULLIF(pg_catalog.btrim(t.source_metadata -> 'clobe_api' ->> 'settlement_key'), '')
      ) = v_key.normalized_key
      AND NULLIF(pg_catalog.btrim(t.memo), '') IS DISTINCT FROM v_key.raw_key
      AND NULLIF(pg_catalog.btrim(t.memo), '') IS DISTINCT FROM v_key.normalized_key
  ) THEN
    RAISE EXCEPTION 'latest Clobe memo has not been applied to every transaction' USING ERRCODE = 'P0001';
  END IF;

  SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(
    t.id::TEXT || ':' || t.transaction_type || ':' || t.amount::TEXT || ':'
      || COALESCE(pg_catalog.to_char(t.updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.USOF'), ''),
    '|' ORDER BY t.id
  ), ''))
  INTO v_fingerprint
  FROM public.bank_transactions t
  WHERE t.id = ANY(v_transaction_ids);

  v_net := v_paid - v_payout;
  v_already_in_state := CASE
    WHEN p_confirm THEN v_booking.settlement_confirmed_at IS NOT NULL
    ELSE v_booking.settlement_confirmed_at IS NULL
  END;

  IF p_confirm AND NOT v_already_in_state THEN
    IF v_booking.status = 'cancelled' THEN
      RAISE EXCEPTION 'cancelled booking cannot be finalized by Clobe cash settlement' USING ERRCODE = 'P0001';
    END IF;
    SELECT COALESCE(MAX(version), 0) + 1 INTO v_snapshot_version
    FROM public.clobe_booking_settlement_snapshots WHERE booking_id = p_booking_id;

    INSERT INTO public.clobe_booking_settlement_snapshots (
      booking_id, tenant_id, settlement_key, version, event_type,
      transaction_fingerprint, transaction_ids, inflow_amount, outflow_amount,
      net_profit, evidence, reason, actor
    ) VALUES (
      p_booking_id, v_booking.tenant_id, v_key.normalized_key, v_snapshot_version, 'confirmed',
      v_fingerprint, v_transaction_ids, v_paid, v_payout, v_net,
      jsonb_build_object(
        'provider_transaction_count', v_provider_transaction_count,
        'transaction_count', pg_catalog.cardinality(v_transaction_ids),
        'booking_projection', jsonb_build_object('paid_amount', v_booking.paid_amount, 'total_paid_out', v_booking.total_paid_out)
      ),
      p_reason, COALESCE(NULLIF(pg_catalog.btrim(p_actor), ''), 'admin')
    ) RETURNING id INTO v_snapshot_id;

    PERFORM pg_catalog.set_config('yeosonam.clobe_settlement_booking_id', p_booking_id::TEXT, TRUE);
    UPDATE public.bookings
    SET settlement_confirmed_at = pg_catalog.now(),
        settlement_confirmed_by = COALESCE(NULLIF(pg_catalog.btrim(p_actor), ''), 'admin'),
        settlement_mode = 'cash',
        updated_at = pg_catalog.now()
    WHERE id = p_booking_id;
    PERFORM pg_catalog.set_config('yeosonam.clobe_settlement_booking_id', '', TRUE);
  ELSIF NOT p_confirm AND NOT v_already_in_state THEN
    IF NULLIF(pg_catalog.btrim(p_reason), '') IS NULL THEN
      RAISE EXCEPTION 'unfinalize reason is required' USING ERRCODE = 'P0001';
    END IF;
    SELECT COALESCE(MAX(version), 0) + 1 INTO v_snapshot_version
    FROM public.clobe_booking_settlement_snapshots WHERE booking_id = p_booking_id;

    INSERT INTO public.clobe_booking_settlement_snapshots (
      booking_id, tenant_id, settlement_key, version, event_type,
      transaction_fingerprint, transaction_ids, inflow_amount, outflow_amount,
      net_profit, evidence, reason, actor
    ) VALUES (
      p_booking_id, v_booking.tenant_id, v_key.normalized_key, v_snapshot_version, 'reopened',
      v_fingerprint, v_transaction_ids, v_paid, v_payout, v_net,
      jsonb_build_object('previous_confirmed_at', v_booking.settlement_confirmed_at),
      p_reason, COALESCE(NULLIF(pg_catalog.btrim(p_actor), ''), 'admin')
    ) RETURNING id INTO v_snapshot_id;

    PERFORM pg_catalog.set_config('yeosonam.clobe_settlement_booking_id', p_booking_id::TEXT, TRUE);
    UPDATE public.bookings
    SET settlement_confirmed_at = NULL,
        settlement_confirmed_by = NULL,
        settlement_mode = NULL,
        updated_at = pg_catalog.now()
    WHERE id = p_booking_id;
    PERFORM pg_catalog.set_config('yeosonam.clobe_settlement_booking_id', '', TRUE);
  ELSE
    SELECT id, version INTO v_snapshot_id, v_snapshot_version
    FROM public.clobe_booking_settlement_snapshots
    WHERE booking_id = p_booking_id
    ORDER BY version DESC LIMIT 1;
  END IF;

  v_result := jsonb_build_object(
    'ok', TRUE,
    'booking_id', p_booking_id,
    'command', v_command_type,
    'settlement_key', v_key.normalized_key,
    'paid_amount', v_paid,
    'total_paid_out', v_payout,
    'net_profit', v_net,
    'transaction_count', pg_catalog.cardinality(v_transaction_ids),
    'transaction_fingerprint', v_fingerprint,
    'snapshot_id', v_snapshot_id,
    'snapshot_version', v_snapshot_version,
    'settlement_mode', CASE WHEN p_confirm THEN 'cash' ELSE NULL END,
    'already_in_state', v_already_in_state,
    'actor', COALESCE(NULLIF(pg_catalog.btrim(p_actor), ''), 'admin')
  );

  INSERT INTO public.clobe_settlement_command_idempotency (
    idempotency_key, booking_id, command_type, request_json, result_json, completed_at
  ) VALUES (
    p_idempotency_key, p_booking_id, v_command_type,
    jsonb_build_object('confirm', p_confirm, 'reason', p_reason, 'actor', p_actor),
    v_result, pg_catalog.now()
  );

  INSERT INTO public.audit_logs (
    action, target_type, target_id, before_value, after_value, description, user_id
  ) VALUES (
    CASE WHEN p_confirm THEN 'clobe_settlement_finalized' ELSE 'clobe_settlement_unfinalized' END,
    'bookings', p_booking_id::TEXT,
    jsonb_build_object(
      'settlement_confirmed_at', v_booking.settlement_confirmed_at,
      'settlement_confirmed_by', v_booking.settlement_confirmed_by,
      'settlement_mode', v_booking.settlement_mode,
      'status', v_booking.status
    ),
    v_result,
    COALESCE(NULLIF(pg_catalog.btrim(p_reason), ''), 'Clobe 입금-출금 기준 정산 확정'),
    p_actor
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_clobe_booking_settlement(UUID, BOOLEAN, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_clobe_booking_settlement(UUID, BOOLEAN, TEXT, TEXT, TEXT)
  TO service_role;

COMMENT ON FUNCTION public.finalize_clobe_booking_settlement(UUID, BOOLEAN, TEXT, TEXT, TEXT)
  IS 'Clobe cash close with provider-memo coverage, exact allocation conservation, ledger drift blocking, idempotency and immutable evidence snapshot.';

CREATE OR REPLACE FUNCTION public.apply_clobe_memo_booking_correction(
  p_booking_id UUID,
  p_transaction_id UUID,
  p_previous_key TEXT,
  p_next_key TEXT,
  p_raw_key TEXT,
  p_departure_date DATE,
  p_customer_id UUID,
  p_customer_name TEXT,
  p_land_operator_id UUID,
  p_land_operator_name TEXT,
  p_package_title TEXT,
  p_actor TEXT DEFAULT 'clobe_sync'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_booking RECORD;
  v_transaction RECORD;
  v_current_key RECORD;
  v_target_key RECORD;
  v_target_booking RECORD;
  v_now TIMESTAMPTZ := pg_catalog.now();
  v_merged_booking_id UUID;
BEGIN
  IF NULLIF(pg_catalog.btrim(p_previous_key), '') IS NULL
     OR NULLIF(pg_catalog.btrim(p_next_key), '') IS NULL
     OR p_previous_key = p_next_key THEN
    RAISE EXCEPTION 'valid distinct Clobe memo keys are required' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('clobe-memo:' || p_booking_id::TEXT, 0)
  );

  SELECT id, tenant_id, source, external_provider, status, source_metadata
    INTO v_transaction
  FROM public.bank_transactions
  WHERE id = p_transaction_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_transaction.status = 'excluded'
     OR NOT (
       v_transaction.source IN ('clobe_mcp', 'clobe_api')
       OR v_transaction.external_provider = 'clobe'
     ) THEN
    RAISE EXCEPTION 'active Clobe transaction is required' USING ERRCODE = 'P0002';
  END IF;

  SELECT id, tenant_id, is_deleted, settlement_confirmed_at, package_title
    INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_booking.is_deleted, FALSE) THEN
    RAISE EXCEPTION 'booking not found or deleted' USING ERRCODE = 'P0002';
  END IF;
  IF v_booking.settlement_confirmed_at IS NOT NULL THEN
    RAISE EXCEPTION 'finalized Clobe settlement memo cannot be changed automatically' USING ERRCODE = 'P0001';
  END IF;
  IF v_transaction.tenant_id IS DISTINCT FROM v_booking.tenant_id THEN
    RAISE EXCEPTION 'cross-tenant Clobe memo correction is forbidden' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(
    NULLIF(pg_catalog.btrim(v_transaction.source_metadata -> 'clobe_mcp' ->> 'settlement_key'), ''),
    NULLIF(pg_catalog.btrim(v_transaction.source_metadata -> 'clobe_api' ->> 'settlement_key'), '')
  ) IS DISTINCT FROM p_next_key THEN
    RAISE EXCEPTION 'latest provider memo key does not match requested correction' USING ERRCODE = 'P0001';
  END IF;

  SELECT id, tenant_id, source, metadata, raw_key
    INTO v_current_key
  FROM public.booking_settlement_keys
  WHERE booking_id = p_booking_id
    AND normalized_key = p_previous_key
    AND status = 'active'
  FOR UPDATE;
  IF NOT FOUND OR NOT (
    v_current_key.source IN ('clobe_memo_created_booking', 'bank_memo_created_booking', 'clobe_memo_approved_booking')
    OR COALESCE(v_current_key.metadata ->> 'clobe_generated', 'false') IN ('true', 't', '1')
    OR COALESCE(v_current_key.metadata ->> 'placeholder', 'false') IN ('true', 't', '1')
  ) THEN
    RAISE EXCEPTION 'active Clobe-generated settlement key is required' USING ERRCODE = 'P0001';
  END IF;

  -- The provider observation is authoritative. A stale OS memo using the old
  -- key does not block correction after Clobe already changed it; another
  -- provider observation that still says the old key does.
  IF EXISTS (
    SELECT 1
    FROM public.bank_transactions t
    WHERE t.id <> p_transaction_id
      AND t.status <> 'excluded'
      AND t.tenant_id IS NOT DISTINCT FROM v_booking.tenant_id
      AND (t.source IN ('clobe_mcp', 'clobe_api') OR t.external_provider = 'clobe')
      AND COALESCE(
        NULLIF(pg_catalog.btrim(t.source_metadata -> 'clobe_mcp' ->> 'settlement_key'), ''),
        NULLIF(pg_catalog.btrim(t.source_metadata -> 'clobe_api' ->> 'settlement_key'), '')
      ) = p_previous_key
  ) THEN
    RAISE EXCEPTION 'another active Clobe provider transaction still uses the previous memo key' USING ERRCODE = 'P0001';
  END IF;

  SELECT id, booking_id, source, metadata
    INTO v_target_key
  FROM public.booking_settlement_keys
  WHERE normalized_key = p_next_key
    AND status = 'active'
    AND tenant_id IS NOT DISTINCT FROM v_current_key.tenant_id
  FOR UPDATE;

  IF FOUND AND v_target_key.booking_id <> p_booking_id THEN
    SELECT id, tenant_id, is_deleted, settlement_confirmed_at,
           paid_amount, total_paid_out, total_price, total_cost,
           quick_created, package_title, metadata
      INTO v_target_booking
    FROM public.bookings
    WHERE id = v_target_key.booking_id
    FOR UPDATE;

    IF NOT FOUND
       OR COALESCE(v_target_booking.is_deleted, FALSE)
       OR v_target_booking.tenant_id IS DISTINCT FROM v_booking.tenant_id
       OR v_target_booking.settlement_confirmed_at IS NOT NULL
       OR COALESCE(v_target_booking.paid_amount, 0) <> 0
       OR COALESCE(v_target_booking.total_paid_out, 0) <> 0
       OR COALESCE(v_target_booking.total_price, 0) <> 0
       OR COALESCE(v_target_booking.total_cost, 0) <> 0
       OR NOT (
         v_target_key.source IN ('clobe_memo_created_booking', 'bank_memo_created_booking', 'clobe_memo_approved_booking')
         OR COALESCE(v_target_key.metadata ->> 'clobe_generated', 'false') IN ('true', 't', '1')
         OR COALESCE(v_target_key.metadata ->> 'placeholder', 'false') IN ('true', 't', '1')
       )
       OR EXISTS (
         SELECT 1 FROM public.ledger_entries l WHERE l.booking_id = v_target_key.booking_id
       )
       OR EXISTS (
         SELECT 1 FROM public.bank_transaction_allocations a
         WHERE a.booking_id = v_target_key.booking_id
           AND a.status = 'active'
           AND a.reversed_at IS NULL
       ) THEN
      RAISE EXCEPTION 'corrected memo key belongs to a non-empty booking; manual review is required' USING ERRCODE = 'P0001';
    END IF;

    v_merged_booking_id := v_target_key.booking_id;

    UPDATE public.booking_settlement_keys
    SET status = 'retired',
        metadata = COALESCE(v_target_key.metadata, '{}'::JSONB)
          || jsonb_build_object('merged_into_booking_id', p_booking_id, 'merged_at', v_now),
        updated_at = v_now
    WHERE id = v_target_key.id;

    UPDATE public.bookings
    SET is_deleted = TRUE,
        finance_excluded = TRUE,
        finance_exclusion_reason = 'empty Clobe placeholder merged after provider memo correction',
        finance_excluded_at = v_now,
        finance_excluded_by = COALESCE(NULLIF(pg_catalog.btrim(p_actor), ''), 'clobe_sync'),
        metadata = COALESCE(metadata, '{}'::JSONB)
          || jsonb_build_object('merged_into_booking_id', p_booking_id, 'merged_at', v_now, 'merge_source', 'clobe_memo_correction'),
        updated_at = v_now
    WHERE id = v_merged_booking_id;

    UPDATE public.bank_transactions
    SET booking_id = CASE WHEN booking_id = v_merged_booking_id THEN p_booking_id ELSE booking_id END,
        source_metadata = pg_catalog.jsonb_set(
          pg_catalog.jsonb_set(
            COALESCE(source_metadata, '{}'::JSONB),
            '{clobe_mcp,suggested_booking_id}', pg_catalog.to_jsonb(p_booking_id::TEXT), TRUE
          ),
          '{clobe_api,suggested_booking_id}', pg_catalog.to_jsonb(p_booking_id::TEXT), TRUE
        ),
        updated_at = v_now
    WHERE status <> 'excluded'
      AND (
        booking_id = v_merged_booking_id
        OR source_metadata -> 'clobe_mcp' ->> 'suggested_booking_id' = v_merged_booking_id::TEXT
        OR source_metadata -> 'clobe_api' ->> 'suggested_booking_id' = v_merged_booking_id::TEXT
      );
  END IF;

  UPDATE public.bookings
  SET departure_date = p_departure_date,
      lead_customer_id = p_customer_id,
      land_operator = p_land_operator_name,
      land_operator_id = p_land_operator_id,
      package_title = COALESCE(NULLIF(pg_catalog.btrim(p_package_title), ''), package_title),
      updated_at = v_now
  WHERE id = p_booking_id;

  UPDATE public.booking_settlement_keys
  SET normalized_key = p_next_key,
      raw_key = p_raw_key,
      departure_date = p_departure_date,
      customer_name_snapshot = p_customer_name,
      land_operator_id = p_land_operator_id,
      land_operator_name_snapshot = p_land_operator_name,
      source = 'clobe_memo_created_booking',
      metadata = COALESCE(v_current_key.metadata, '{}'::JSONB)
        || jsonb_build_object(
          'clobe_generated', TRUE,
          'corrected_from', p_previous_key,
          'merged_empty_booking_id', v_merged_booking_id
        ),
      updated_at = v_now
  WHERE id = v_current_key.id;

  INSERT INTO public.audit_logs (
    action, target_type, target_id, before_value, after_value, description, user_id
  ) VALUES (
    'clobe_memo_booking_corrected', 'bookings', p_booking_id::TEXT,
    jsonb_build_object('settlement_key', p_previous_key),
    jsonb_build_object(
      'settlement_key', p_next_key,
      'transaction_id', p_transaction_id,
      'merged_empty_booking_id', v_merged_booking_id
    ),
    'Clobe memo source-of-truth correction before final settlement',
    COALESCE(NULLIF(pg_catalog.btrim(p_actor), ''), 'clobe_sync')
  );

  RETURN jsonb_build_object(
    'ok', TRUE,
    'booking_id', p_booking_id,
    'transaction_id', p_transaction_id,
    'previous_key', p_previous_key,
    'next_key', p_next_key,
    'merged_empty_booking_id', v_merged_booking_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_clobe_memo_booking_correction(
  UUID, UUID, TEXT, TEXT, TEXT, DATE, UUID, TEXT, UUID, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_clobe_memo_booking_correction(
  UUID, UUID, TEXT, TEXT, TEXT, DATE, UUID, TEXT, UUID, TEXT, TEXT, TEXT
) TO service_role;

COMMENT ON FUNCTION public.apply_clobe_memo_booking_correction(
  UUID, UUID, TEXT, TEXT, TEXT, DATE, UUID, TEXT, UUID, TEXT, TEXT, TEXT
) IS 'Applies the latest provider memo before finalization and merges only a provably empty duplicate Clobe placeholder.';

-- Replace the production-drifted body (where the Korean deposit literal was
-- corrupted) and narrow execution to service_role.
CREATE OR REPLACE FUNCTION public.repair_legacy_bank_transaction_allocation(
  p_transaction_id UUID,
  p_target_booking_id UUID,
  p_matched_by TEXT DEFAULT 'clobe_sync',
  p_notes TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tx RECORD;
  v_existing RECORD;
  v_source RECORD;
  v_target RECORD;
  v_source_booking_id UUID;
  v_amount BIGINT;
  v_transfer BIGINT := 0;
  v_ledger_delta BIGINT := 0;
  v_ledger_account TEXT;
  v_allocation_type TEXT;
  v_allocation_key TEXT;
  v_notes TEXT;
BEGIN
  SELECT id, tenant_id, amount, transaction_type, is_refund, match_status,
         booking_id, counterparty_name, status
    INTO v_tx
  FROM public.bank_transactions
  WHERE id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank transaction not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_tx.status = 'excluded' OR COALESCE(v_tx.match_status, '') = 'excluded' THEN
    RAISE EXCEPTION 'excluded bank transaction cannot be repaired' USING ERRCODE = 'P0001';
  END IF;

  SELECT bank_transaction_id, booking_id, allocated_amount, ledger_delta
    INTO v_existing
  FROM public.bank_transaction_allocations
  WHERE bank_transaction_id = p_transaction_id
    AND status = 'active'
    AND reversed_at IS NULL
  ORDER BY created_at
  LIMIT 1;

  IF FOUND THEN
    IF v_existing.booking_id = p_target_booking_id THEN
      RETURN jsonb_build_object(
        'ok', TRUE, 'already_repaired', TRUE,
        'transaction_id', p_transaction_id,
        'booking_id', p_target_booking_id,
        'allocated_amount', v_existing.allocated_amount,
        'ledger_delta', v_existing.ledger_delta
      );
    END IF;
    RAISE EXCEPTION 'bank transaction already has allocation for another booking' USING ERRCODE = 'P0001';
  END IF;

  SELECT id, tenant_id, paid_amount, total_paid_out
    INTO v_target
  FROM public.bookings
  WHERE id = p_target_booking_id
    AND COALESCE(is_deleted, FALSE) = FALSE
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'target booking not found or deleted: %', p_target_booking_id USING ERRCODE = 'P0002';
  END IF;
  IF v_tx.tenant_id IS DISTINCT FROM v_target.tenant_id THEN
    RAISE EXCEPTION 'cross-tenant legacy repair is forbidden' USING ERRCODE = 'P0001';
  END IF;

  v_source_booking_id := v_tx.booking_id;
  IF v_source_booking_id IS NOT NULL AND v_source_booking_id <> p_target_booking_id THEN
    IF v_source_booking_id::TEXT < p_target_booking_id::TEXT THEN
      SELECT id, tenant_id, paid_amount, total_paid_out INTO v_source
      FROM public.bookings WHERE id = v_source_booking_id FOR UPDATE;
      SELECT id, tenant_id, paid_amount, total_paid_out INTO v_target
      FROM public.bookings WHERE id = p_target_booking_id FOR UPDATE;
    ELSE
      SELECT id, tenant_id, paid_amount, total_paid_out INTO v_target
      FROM public.bookings WHERE id = p_target_booking_id FOR UPDATE;
      SELECT id, tenant_id, paid_amount, total_paid_out INTO v_source
      FROM public.bookings WHERE id = v_source_booking_id FOR UPDATE;
    END IF;
    IF v_source.id IS NULL THEN
      RAISE EXCEPTION 'source booking not found: %', v_source_booking_id USING ERRCODE = 'P0002';
    END IF;
    IF v_source.tenant_id IS DISTINCT FROM v_target.tenant_id THEN
      RAISE EXCEPTION 'cross-tenant legacy repair is forbidden' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  v_amount := GREATEST(0, COALESCE(v_tx.amount, 0));
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'positive transaction amount is required' USING ERRCODE = 'P0001';
  END IF;

  IF v_tx.transaction_type = '입금' AND COALESCE(v_tx.is_refund, FALSE) = FALSE THEN
    v_ledger_account := 'paid_amount';
    v_allocation_type := 'deposit';
    v_transfer := CASE
      WHEN v_source_booking_id IS NULL THEN v_amount
      WHEN v_source_booking_id = p_target_booking_id THEN 0
      ELSE LEAST(v_amount, GREATEST(0, COALESCE(v_source.paid_amount, 0)))
    END;
    v_ledger_delta := v_transfer;
  ELSIF COALESCE(v_tx.is_refund, FALSE) = TRUE THEN
    v_ledger_account := 'paid_amount';
    v_allocation_type := 'refund';
    v_transfer := CASE
      WHEN v_source_booking_id IS NULL THEN v_amount
      WHEN v_source_booking_id = p_target_booking_id THEN 0
      ELSE LEAST(v_amount, GREATEST(0, COALESCE(v_source.paid_amount, 0)))
    END;
    v_ledger_delta := -v_transfer;
  ELSE
    v_ledger_account := 'total_paid_out';
    v_allocation_type := 'payout';
    v_transfer := CASE
      WHEN v_source_booking_id IS NULL THEN v_amount
      WHEN v_source_booking_id = p_target_booking_id THEN 0
      ELSE LEAST(v_amount, GREATEST(0, COALESCE(v_source.total_paid_out, 0)))
    END;
    v_ledger_delta := v_transfer;
  END IF;

  v_notes := COALESCE(p_notes, 'legacy bank transaction allocation repair');

  IF v_source_booking_id IS NOT NULL AND v_source_booking_id <> p_target_booking_id AND v_transfer > 0 THEN
    PERFORM public.update_booking_ledger(
      p_booking_id := v_source_booking_id,
      p_paid_delta := CASE
        WHEN v_allocation_type = 'deposit' THEN -v_transfer::INTEGER
        WHEN v_allocation_type = 'refund' THEN v_transfer::INTEGER
        ELSE 0
      END,
      p_payout_delta := CASE WHEN v_allocation_type = 'payout' THEN -v_transfer::INTEGER ELSE 0 END,
      p_source := 'bank_tx_legacy_reassignment',
      p_source_ref_id := p_transaction_id::TEXT,
      p_idempotency_key := 'legacy-bank-repair:source:' || p_transaction_id::TEXT || ':' || p_target_booking_id::TEXT,
      p_memo := v_notes,
      p_created_by := p_matched_by
    );
  END IF;

  IF v_source_booking_id IS NULL OR v_source_booking_id <> p_target_booking_id THEN
    PERFORM public.update_booking_ledger(
      p_booking_id := p_target_booking_id,
      p_paid_delta := CASE
        WHEN v_allocation_type = 'deposit' THEN v_transfer::INTEGER
        WHEN v_allocation_type = 'refund' THEN -v_transfer::INTEGER
        ELSE 0
      END,
      p_payout_delta := CASE WHEN v_allocation_type = 'payout' THEN v_transfer::INTEGER ELSE 0 END,
      p_source := 'bank_tx_legacy_reassignment',
      p_source_ref_id := p_transaction_id::TEXT,
      p_idempotency_key := 'legacy-bank-repair:target:' || p_transaction_id::TEXT || ':' || p_target_booking_id::TEXT,
      p_memo := v_notes,
      p_created_by := p_matched_by
    );
  END IF;

  v_allocation_key := 'bktxalloc:legacy:' || p_transaction_id::TEXT || ':' || p_target_booking_id::TEXT;
  INSERT INTO public.bank_transaction_allocations (
    bank_transaction_id, booking_id, ledger_account, allocated_amount,
    ledger_delta, allocation_type, idempotency_key, notes, created_by,
    target_type, metadata
  ) VALUES (
    p_transaction_id, p_target_booking_id, v_ledger_account, v_amount,
    v_ledger_delta, v_allocation_type, v_allocation_key, v_notes, p_matched_by,
    'booking', jsonb_build_object('repair_version', 2, 'transaction_type', v_tx.transaction_type)
  );

  UPDATE public.bank_transactions
  SET booking_id = p_target_booking_id,
      match_status = 'manual', match_confidence = 1,
      matched_by = p_matched_by, matched_at = pg_catalog.now(), updated_at = pg_catalog.now()
  WHERE id = p_transaction_id;

  INSERT INTO public.ops_events (
    event_type, severity, title, description, booking_id,
    bank_transaction_id, target_type, target_id, status, metadata, created_by
  ) VALUES (
    'bank_transaction_repaired', 'info', 'Legacy bank transaction evidence repaired',
    pg_catalog.format('%s %s repaired from legacy match', COALESCE(v_tx.counterparty_name, 'transaction'), v_amount),
    p_target_booking_id, p_transaction_id, 'bank_transactions', p_transaction_id::TEXT,
    'resolved', jsonb_build_object(
      'legacy_booking_id', v_source_booking_id,
      'target_booking_id', p_target_booking_id,
      'allocation_type', v_allocation_type,
      'allocated_amount', v_amount,
      'ledger_delta', v_ledger_delta,
      'actor', p_matched_by
    ), p_matched_by
  );

  INSERT INTO public.audit_logs (
    action, target_type, target_id, before_value, after_value, description, user_id
  ) VALUES (
    'bank_transaction_legacy_repaired', 'bank_transactions', p_transaction_id::TEXT,
    jsonb_build_object('booking_id', v_source_booking_id, 'match_status', v_tx.match_status),
    jsonb_build_object(
      'booking_id', p_target_booking_id,
      'allocated_amount', v_amount,
      'ledger_delta', v_ledger_delta,
      'allocation_key', v_allocation_key,
      'actor', p_matched_by
    ), v_notes, NULL
  );

  RETURN jsonb_build_object(
    'ok', TRUE, 'already_repaired', FALSE,
    'transaction_id', p_transaction_id,
    'previous_booking_id', v_source_booking_id,
    'booking_id', p_target_booking_id,
    'allocated_amount', v_amount,
    'ledger_delta', v_ledger_delta,
    'allocation_type', v_allocation_type
  );
END;
$$;

REVOKE ALL ON FUNCTION public.repair_legacy_bank_transaction_allocation(UUID, UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.repair_legacy_bank_transaction_allocation(UUID, UUID, TEXT, TEXT)
  TO service_role;

COMMENT ON FUNCTION public.repair_legacy_bank_transaction_allocation(UUID, UUID, TEXT, TEXT)
  IS 'Restores one legacy allocation with correct Korean deposit classification, tenant isolation and ledger-backed reassignment.';

CREATE OR REPLACE FUNCTION public.reclassify_clobe_nonbooking_inflow_to_booking(
  p_transaction_id UUID,
  p_booking_id UUID,
  p_reason TEXT,
  p_actor TEXT DEFAULT 'admin'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tx RECORD;
  v_booking RECORD;
  v_key RECORD;
  v_amount BIGINT;
  v_idempotency_key TEXT;
BEGIN
  IF NULLIF(pg_catalog.btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'reclassification reason is required' USING ERRCODE = 'P0001';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('clobe-reclassify:' || p_transaction_id::TEXT, 0)
  );

  SELECT id, tenant_id, source, external_provider, transaction_type, is_refund,
         amount, status, source_metadata
    INTO v_tx
  FROM public.bank_transactions
  WHERE id = p_transaction_id
  FOR UPDATE;
  IF NOT FOUND OR v_tx.status = 'excluded'
     OR NOT (v_tx.source IN ('clobe_mcp', 'clobe_api') OR v_tx.external_provider = 'clobe')
     OR v_tx.transaction_type <> '입금'
     OR COALESCE(v_tx.is_refund, FALSE) THEN
    RAISE EXCEPTION 'active Clobe non-refund inflow is required' USING ERRCODE = 'P0001';
  END IF;

  SELECT id, tenant_id, is_deleted, settlement_confirmed_at
    INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_booking.is_deleted, FALSE) OR v_booking.settlement_confirmed_at IS NOT NULL THEN
    RAISE EXCEPTION 'active unfinalized target booking is required' USING ERRCODE = 'P0001';
  END IF;
  IF v_booking.tenant_id IS DISTINCT FROM v_tx.tenant_id THEN
    RAISE EXCEPTION 'cross-tenant Clobe reclassification is forbidden' USING ERRCODE = 'P0001';
  END IF;

  SELECT normalized_key INTO v_key
  FROM public.booking_settlement_keys
  WHERE booking_id = p_booking_id AND status = 'active'
  ORDER BY updated_at DESC LIMIT 1;
  IF NOT FOUND OR v_key.normalized_key IS DISTINCT FROM COALESCE(
    NULLIF(pg_catalog.btrim(v_tx.source_metadata -> 'clobe_mcp' ->> 'settlement_key'), ''),
    NULLIF(pg_catalog.btrim(v_tx.source_metadata -> 'clobe_api' ->> 'settlement_key'), '')
  ) THEN
    RAISE EXCEPTION 'provider memo key does not match target booking' USING ERRCODE = 'P0001';
  END IF;

  v_amount := ABS(v_tx.amount);
  IF COALESCE((
    SELECT SUM(a.allocated_amount)
    FROM public.bank_transaction_allocations a
    WHERE a.bank_transaction_id = p_transaction_id
      AND a.status = 'active' AND a.reversed_at IS NULL
  ), 0) <> v_amount OR EXISTS (
    SELECT 1 FROM public.bank_transaction_allocations a
    WHERE a.bank_transaction_id = p_transaction_id
      AND a.status = 'active' AND a.reversed_at IS NULL
      AND (a.booking_id IS NOT NULL OR a.target_type NOT IN ('transfer', 'other_income', 'unassigned'))
  ) THEN
    RAISE EXCEPTION 'transaction must have one exact non-booking classification before reclassification' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.bank_transaction_allocations
  SET status = 'reversed', reversed_at = pg_catalog.now(),
      reason = p_reason,
      metadata = COALESCE(metadata, '{}'::JSONB)
        || jsonb_build_object('reclassified_to_booking_id', p_booking_id, 'reclassified_by', p_actor)
  WHERE bank_transaction_id = p_transaction_id
    AND status = 'active' AND reversed_at IS NULL;

  v_idempotency_key := 'clobe-nonbooking-to-booking:' || p_transaction_id::TEXT || ':' || p_booking_id::TEXT;
  INSERT INTO public.bank_transaction_allocations (
    bank_transaction_id, booking_id, ledger_account, allocated_amount,
    ledger_delta, allocation_type, status, idempotency_key, notes,
    created_by, target_type, reason, metadata, confirmed_by, confirmed_at
  ) VALUES (
    p_transaction_id, p_booking_id, 'paid_amount', v_amount,
    v_amount, 'deposit', 'active', v_idempotency_key, p_reason,
    p_actor, 'booking', p_reason,
    jsonb_build_object('source', 'provider_memo_reclassification'),
    p_actor, pg_catalog.now()
  ) ON CONFLICT (idempotency_key) DO NOTHING;

  PERFORM public.update_booking_ledger(
    p_booking_id := p_booking_id,
    p_paid_delta := v_amount::INTEGER,
    p_payout_delta := 0,
    p_source := 'clobe_nonbooking_reclassification',
    p_source_ref_id := p_transaction_id::TEXT,
    p_idempotency_key := v_idempotency_key,
    p_memo := p_reason,
    p_created_by := p_actor
  );

  UPDATE public.bank_transactions
  SET booking_id = p_booking_id, match_status = 'manual', match_confidence = 1,
      matched_by = p_actor, matched_at = pg_catalog.now(),
      settlement_scope = 'travel', provider_is_unclassified = FALSE,
      updated_at = pg_catalog.now()
  WHERE id = p_transaction_id;

  INSERT INTO public.audit_logs (
    action, target_type, target_id, before_value, after_value, description, user_id
  ) VALUES (
    'clobe_nonbooking_inflow_reclassified', 'bank_transactions', p_transaction_id::TEXT,
    jsonb_build_object('classification', 'non_booking'),
    jsonb_build_object('booking_id', p_booking_id, 'amount', v_amount, 'allocation_idempotency_key', v_idempotency_key),
    p_reason, p_actor
  );

  RETURN jsonb_build_object('ok', TRUE, 'transaction_id', p_transaction_id, 'booking_id', p_booking_id, 'amount', v_amount);
END;
$$;

REVOKE ALL ON FUNCTION public.reclassify_clobe_nonbooking_inflow_to_booking(UUID, UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reclassify_clobe_nonbooking_inflow_to_booking(UUID, UUID, TEXT, TEXT)
  TO service_role;

-- A provider memo can legitimately become canonical after a transaction was
-- conserved as company/non-travel. Keep the original classification as
-- reversed evidence, then auto-apply only inflows. Outflows return to review
-- because one withdrawal may be split across payout/refund bookings.
CREATE OR REPLACE FUNCTION public.reconcile_clobe_provider_memo_allocation(
  p_transaction_id UUID,
  p_booking_id UUID,
  p_reason TEXT,
  p_actor TEXT DEFAULT 'clobe_sync'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tx RECORD;
  v_booking RECORD;
  v_active_key TEXT;
  v_provider_key TEXT;
  v_provider_memo TEXT;
  v_amount BIGINT;
  v_active_total BIGINT;
  v_active_count INTEGER;
  v_source_fingerprint TEXT;
  v_idempotency_key TEXT;
  v_status TEXT;
BEGIN
  IF NULLIF(pg_catalog.btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'reconciliation reason is required' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('clobe-provider-memo-reconcile:' || p_transaction_id::TEXT, 0)
  );

  SELECT id, tenant_id, source, external_provider, transaction_type, is_refund,
         amount, status, source_metadata, booking_id, match_status
    INTO v_tx
  FROM public.bank_transactions
  WHERE id = p_transaction_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank transaction not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_tx.status = 'excluded'
     OR NOT (v_tx.source IN ('clobe_mcp', 'clobe_api') OR v_tx.external_provider = 'clobe') THEN
    RAISE EXCEPTION 'active Clobe transaction is required' USING ERRCODE = 'P0001';
  END IF;

  SELECT id, tenant_id, is_deleted, settlement_confirmed_at
    INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_booking.is_deleted, FALSE) OR v_booking.settlement_confirmed_at IS NOT NULL THEN
    RAISE EXCEPTION 'active unfinalized target booking is required' USING ERRCODE = 'P0001';
  END IF;
  IF v_booking.tenant_id IS DISTINCT FROM v_tx.tenant_id THEN
    RAISE EXCEPTION 'cross-tenant Clobe reconciliation is forbidden' USING ERRCODE = 'P0001';
  END IF;

  SELECT normalized_key
    INTO v_active_key
  FROM public.booking_settlement_keys
  WHERE booking_id = p_booking_id AND status = 'active'
  ORDER BY updated_at DESC
  LIMIT 1;
  v_provider_key := COALESCE(
    NULLIF(pg_catalog.btrim(v_tx.source_metadata -> 'clobe_mcp' ->> 'settlement_key'), ''),
    NULLIF(pg_catalog.btrim(v_tx.source_metadata -> 'clobe_api' ->> 'settlement_key'), '')
  );
  v_provider_memo := COALESCE(
    NULLIF(pg_catalog.btrim(v_tx.source_metadata -> 'clobe_mcp' ->> 'memo'), ''),
    NULLIF(pg_catalog.btrim(v_tx.source_metadata -> 'clobe_api' ->> 'memo'), '')
  );
  IF v_active_key IS NULL
     OR v_active_key IS DISTINCT FROM v_provider_key
     OR v_provider_key !~ '^[0-9]{6}_[^_]+_.+$' THEN
    RAISE EXCEPTION 'provider memo key does not match target booking' USING ERRCODE = 'P0001';
  END IF;

  v_amount := ABS(COALESCE(v_tx.amount, 0));
  SELECT COALESCE(SUM(a.allocated_amount), 0)::BIGINT,
         COUNT(*)::INTEGER,
         pg_catalog.md5(COALESCE(pg_catalog.string_agg(a.id::TEXT, '|' ORDER BY a.id), ''))
    INTO v_active_total, v_active_count, v_source_fingerprint
  FROM public.bank_transaction_allocations a
  WHERE a.bank_transaction_id = p_transaction_id
    AND a.status = 'active'
    AND a.reversed_at IS NULL;

  IF v_amount <= 0 OR v_amount > 2147483647 OR v_active_count <= 0 OR v_active_total <> v_amount THEN
    RAISE EXCEPTION 'transaction requires exact active classification conservation' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.bank_transaction_allocations a
    WHERE a.bank_transaction_id = p_transaction_id
      AND a.status = 'active'
      AND a.reversed_at IS NULL
      AND (
        a.booking_id IS NOT NULL
        OR a.ledger_account IS NOT NULL
        OR a.ledger_delta IS NOT NULL
        OR a.target_type IN ('booking', 'customer_refund')
      )
  ) THEN
    RAISE EXCEPTION 'booking or ledger allocation requires manual review' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.bank_transaction_allocations
  SET status = 'reversed',
      reversed_at = pg_catalog.now(),
      reason = p_reason,
      metadata = COALESCE(metadata, '{}'::JSONB) || jsonb_build_object(
        'provider_memo_reconciled_to_booking_id', p_booking_id,
        'provider_memo_reconciled_by', p_actor,
        'provider_memo_reconciled_at', pg_catalog.now()
      )
  WHERE bank_transaction_id = p_transaction_id
    AND status = 'active'
    AND reversed_at IS NULL;

  IF v_tx.transaction_type = '입금' AND COALESCE(v_tx.is_refund, FALSE) = FALSE THEN
    v_idempotency_key := 'clobe-provider-memo:' || p_transaction_id::TEXT || ':'
      || p_booking_id::TEXT || ':' || v_source_fingerprint;
    INSERT INTO public.bank_transaction_allocations (
      bank_transaction_id, booking_id, ledger_account, allocated_amount,
      ledger_delta, allocation_type, status, idempotency_key, notes,
      created_by, target_type, reason, metadata, confirmed_by, confirmed_at
    ) VALUES (
      p_transaction_id, p_booking_id, 'paid_amount', v_amount,
      v_amount, 'deposit', 'active', v_idempotency_key, p_reason,
      p_actor, 'booking', p_reason,
      jsonb_build_object('source', 'clobe_provider_memo_reconciliation'),
      p_actor, pg_catalog.now()
    );

    PERFORM public.update_booking_ledger(
      p_booking_id := p_booking_id,
      p_paid_delta := v_amount::INTEGER,
      p_payout_delta := 0,
      p_source := 'clobe_provider_memo_reconciliation',
      p_source_ref_id := p_transaction_id::TEXT,
      p_idempotency_key := v_idempotency_key,
      p_memo := p_reason,
      p_created_by := p_actor
    );
    v_status := 'reclassified_booking';

    UPDATE public.bank_transactions
    SET memo = COALESCE(v_provider_memo, memo),
        booking_id = p_booking_id,
        match_status = 'auto',
        match_confidence = 1,
        matched_by = p_actor,
        matched_at = pg_catalog.now(),
        settlement_scope = 'travel',
        provider_is_unclassified = FALSE,
        updated_at = pg_catalog.now()
    WHERE id = p_transaction_id;
  ELSE
    v_status := 'released_for_review';
    v_idempotency_key := 'clobe-provider-memo-review:' || p_transaction_id::TEXT || ':'
      || p_booking_id::TEXT || ':' || v_source_fingerprint;
    INSERT INTO public.bank_transaction_allocations (
      bank_transaction_id, booking_id, ledger_account, allocated_amount,
      ledger_delta, allocation_type, status, idempotency_key, notes,
      created_by, target_type, reason, metadata, confirmed_by, confirmed_at
    ) VALUES (
      p_transaction_id, NULL, NULL, v_amount,
      NULL, 'unassigned', 'active', v_idempotency_key, p_reason,
      p_actor, 'unassigned', p_reason,
      jsonb_build_object(
        'source', 'clobe_provider_memo_reconciliation',
        'suggested_booking_id', p_booking_id,
        'requires_outflow_approval', TRUE
      ),
      NULL, NULL
    );

    UPDATE public.bank_transactions
    SET memo = COALESCE(v_provider_memo, memo),
        booking_id = NULL,
        match_status = 'review',
        match_confidence = 0,
        matched_by = p_actor,
        matched_at = NULL,
        settlement_scope = 'travel',
        provider_is_unclassified = FALSE,
        updated_at = pg_catalog.now()
    WHERE id = p_transaction_id;
  END IF;

  INSERT INTO public.ops_events (
    event_type, severity, title, description, booking_id,
    bank_transaction_id, target_type, target_id, status, metadata, created_by
  ) VALUES (
    'payment_imported',
    CASE WHEN v_status = 'released_for_review' THEN 'warning' ELSE 'info' END,
    CASE WHEN v_status = 'released_for_review'
      THEN 'Clobe 출금 메모 반영 · 배정 확인 필요'
      ELSE 'Clobe 입금 메모로 예약 배정 복구'
    END,
    pg_catalog.format('Provider memo reconciled %s transaction %s', v_tx.transaction_type, v_amount),
    p_booking_id, p_transaction_id, 'bank_transactions', p_transaction_id::TEXT,
    CASE WHEN v_status = 'released_for_review' THEN 'open' ELSE 'resolved' END,
    jsonb_build_object(
      'status', v_status,
      'booking_id', p_booking_id,
      'provider_key', v_provider_key,
      'amount', v_amount,
      'actor', p_actor
    ), p_actor
  );

  INSERT INTO public.audit_logs (
    action, target_type, target_id, before_value, after_value, description, user_id
  ) VALUES (
    'clobe_provider_memo_allocation_reconciled', 'bank_transactions', p_transaction_id::TEXT,
    jsonb_build_object('classification', 'non_booking', 'allocation_count', v_active_count),
    jsonb_build_object('status', v_status, 'booking_id', p_booking_id, 'amount', v_amount),
    p_reason, NULL
  );

  RETURN jsonb_build_object(
    'ok', TRUE,
    'status', v_status,
    'transaction_id', p_transaction_id,
    'booking_id', p_booking_id,
    'amount', v_amount
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_clobe_provider_memo_allocation(UUID, UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_clobe_provider_memo_allocation(UUID, UUID, TEXT, TEXT)
  TO service_role;

COMMENT ON FUNCTION public.reconcile_clobe_provider_memo_allocation(UUID, UUID, TEXT, TEXT)
  IS 'Append-only correction when the latest canonical Clobe memo supersedes an exact non-booking classification; inflows auto-allocate, outflows return to review.';

-- Keep the legacy repair entry point compatible while delegating all future
-- work to the generation-safe command above.
CREATE OR REPLACE FUNCTION public.reclassify_clobe_nonbooking_inflow_to_booking(
  p_transaction_id UUID,
  p_booking_id UUID,
  p_reason TEXT,
  p_actor TEXT DEFAULT 'admin'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result JSONB;
BEGIN
  v_result := public.reconcile_clobe_provider_memo_allocation(
    p_transaction_id,
    p_booking_id,
    p_reason,
    p_actor
  );
  IF v_result ->> 'status' <> 'reclassified_booking' THEN
    RAISE EXCEPTION 'Clobe non-booking inflow reclassification did not create a booking allocation' USING ERRCODE = 'P0001';
  END IF;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.reclassify_clobe_nonbooking_inflow_to_booking(UUID, UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reclassify_clobe_nonbooking_inflow_to_booking(UUID, UUID, TEXT, TEXT)
  TO service_role;

-- Explicit operator approval is the only bridge from a normal OS booking to
-- the Clobe cash-settlement workflow. Key ownership, any non-booking
-- reclassification, deposit allocation, ledger evidence, audit, and provider
-- approval metadata are committed atomically.
CREATE TABLE IF NOT EXISTS public.clobe_existing_booking_deposit_commands (
  idempotency_key TEXT PRIMARY KEY,
  bank_transaction_id UUID NOT NULL REFERENCES public.bank_transactions(id) ON DELETE RESTRICT,
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  settlement_key TEXT NOT NULL,
  request_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  result_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  completed_at TIMESTAMPTZ
);

ALTER TABLE public.clobe_existing_booking_deposit_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.clobe_existing_booking_deposit_commands FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.clobe_existing_booking_deposit_commands TO service_role;

CREATE OR REPLACE FUNCTION public.confirm_clobe_deposit_to_existing_booking(
  p_transaction_id UUID,
  p_booking_id UUID,
  p_expected_settlement_key TEXT,
  p_raw_key TEXT,
  p_departure_date DATE,
  p_customer_name TEXT,
  p_land_operator_name TEXT,
  p_idempotency_key TEXT,
  p_actor TEXT DEFAULT 'admin'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tx RECORD;
  v_booking RECORD;
  v_command RECORD;
  v_key RECORD;
  v_key_exists BOOLEAN := FALSE;
  v_provider_key TEXT;
  v_provider_memo TEXT;
  v_suggested_booking_id UUID;
  v_source_key TEXT;
  v_active_count INTEGER := 0;
  v_active_total BIGINT := 0;
  v_booking_deposit_valid BOOLEAN := FALSE;
  v_nonbooking_valid BOOLEAN := FALSE;
  v_match_result JSONB;
  v_result JSONB;
BEGIN
  IF NULLIF(pg_catalog.btrim(p_idempotency_key), '') IS NULL
     OR NULLIF(pg_catalog.btrim(p_expected_settlement_key), '') IS NULL
     OR p_expected_settlement_key !~ '^[0-9]{6}_[^_]+_.+$'
     OR p_departure_date IS NULL
     OR pg_catalog.to_char(p_departure_date, 'YYMMDD') <> pg_catalog.split_part(p_expected_settlement_key, '_', 1)
     OR NULLIF(pg_catalog.btrim(p_customer_name), '') IS NULL
     OR NULLIF(pg_catalog.btrim(p_land_operator_name), '') IS NULL THEN
    RAISE EXCEPTION 'valid Clobe approval identity is required' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('clobe-existing-booking-deposit:' || p_transaction_id::TEXT, 0)
  );

  SELECT * INTO v_command
  FROM public.clobe_existing_booking_deposit_commands
  WHERE idempotency_key = p_idempotency_key
  FOR UPDATE;
  IF FOUND THEN
    IF v_command.bank_transaction_id <> p_transaction_id
       OR v_command.booking_id <> p_booking_id
       OR v_command.settlement_key <> p_expected_settlement_key THEN
      RAISE EXCEPTION 'Clobe existing-booking approval idempotency conflict' USING ERRCODE = 'P0001';
    END IF;
    RETURN COALESCE(v_command.result_json, jsonb_build_object('ok', TRUE, 'idempotent_replay', TRUE));
  END IF;

  SELECT id, tenant_id, source, external_provider, transaction_type, is_refund,
         amount, status, booking_id, match_status, source_metadata
    INTO v_tx
  FROM public.bank_transactions
  WHERE id = p_transaction_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank transaction not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_tx.status = 'excluded'
     OR NOT (v_tx.source IN ('clobe_mcp', 'clobe_api') OR v_tx.external_provider = 'clobe')
     OR v_tx.transaction_type <> '입금'
     OR COALESCE(v_tx.is_refund, FALSE)
     OR v_tx.amount <= 0 THEN
    RAISE EXCEPTION 'active Clobe deposit is required' USING ERRCODE = 'P0001';
  END IF;

  v_source_key := CASE WHEN v_tx.source = 'clobe_api' THEN 'clobe_api' ELSE 'clobe_mcp' END;
  v_provider_key := COALESCE(
    NULLIF(pg_catalog.btrim(v_tx.source_metadata -> v_source_key ->> 'settlement_key'), ''),
    NULLIF(pg_catalog.btrim(v_tx.source_metadata -> 'clobe_mcp' ->> 'settlement_key'), ''),
    NULLIF(pg_catalog.btrim(v_tx.source_metadata -> 'clobe_api' ->> 'settlement_key'), '')
  );
  v_provider_memo := COALESCE(
    NULLIF(pg_catalog.btrim(v_tx.source_metadata -> v_source_key ->> 'memo'), ''),
    NULLIF(pg_catalog.btrim(v_tx.source_metadata -> 'clobe_mcp' ->> 'memo'), ''),
    NULLIF(pg_catalog.btrim(v_tx.source_metadata -> 'clobe_api' ->> 'memo'), '')
  );
  v_suggested_booking_id := COALESCE(
    NULLIF(v_tx.source_metadata -> v_source_key ->> 'suggested_booking_id', '')::UUID,
    NULLIF(v_tx.source_metadata -> 'clobe_mcp' ->> 'suggested_booking_id', '')::UUID,
    NULLIF(v_tx.source_metadata -> 'clobe_api' ->> 'suggested_booking_id', '')::UUID
  );
  IF v_provider_key IS DISTINCT FROM p_expected_settlement_key
     OR v_provider_memo IS DISTINCT FROM p_raw_key
     OR v_suggested_booking_id IS DISTINCT FROM p_booking_id THEN
    RAISE EXCEPTION 'latest Clobe suggestion changed; refresh review before approval' USING ERRCODE = 'P0001';
  END IF;

  SELECT id, tenant_id, is_deleted, settlement_confirmed_at, departure_date
    INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_booking.is_deleted, FALSE) THEN
    RAISE EXCEPTION 'booking not found or deleted' USING ERRCODE = 'P0002';
  END IF;
  IF v_booking.tenant_id IS DISTINCT FROM v_tx.tenant_id THEN
    RAISE EXCEPTION 'cross-tenant Clobe approval is forbidden' USING ERRCODE = 'P0001';
  END IF;
  IF v_booking.settlement_confirmed_at IS NOT NULL THEN
    RAISE EXCEPTION 'finalized booking cannot receive a Clobe deposit' USING ERRCODE = 'P0001';
  END IF;
  IF v_booking.departure_date IS DISTINCT FROM p_departure_date THEN
    RAISE EXCEPTION 'booking departure date changed; refresh review before approval' USING ERRCODE = 'P0001';
  END IF;

  SELECT id, booking_id, source, metadata
    INTO v_key
  FROM public.booking_settlement_keys
  WHERE tenant_id IS NOT DISTINCT FROM v_tx.tenant_id
    AND normalized_key = p_expected_settlement_key
    AND status = 'active'
  FOR UPDATE;
  v_key_exists := FOUND;
  IF v_key_exists AND v_key.booking_id <> p_booking_id THEN
    RAISE EXCEPTION 'Clobe settlement key already belongs to another booking' USING ERRCODE = 'P0001';
  END IF;
  IF NOT v_key_exists AND EXISTS (
    SELECT 1
    FROM public.booking_settlement_keys k
    WHERE k.booking_id = p_booking_id
      AND k.status = 'active'
      AND k.normalized_key <> p_expected_settlement_key
  ) THEN
    RAISE EXCEPTION 'booking already owns a different active settlement key' USING ERRCODE = 'P0001';
  END IF;

  IF v_key_exists THEN
    UPDATE public.booking_settlement_keys
    SET raw_key = p_raw_key,
        departure_date = p_departure_date,
        customer_name_snapshot = p_customer_name,
        land_operator_name_snapshot = p_land_operator_name,
        source = 'clobe_memo_approved_booking',
        metadata = COALESCE(metadata, '{}'::JSONB) || jsonb_build_object(
          'clobe_approved_existing_booking', TRUE,
          'clobe_generated', FALSE,
          'approved_transaction_id', p_transaction_id,
          'approved_by', COALESCE(NULLIF(pg_catalog.btrim(p_actor), ''), 'admin'),
          'approved_at', pg_catalog.now()
        ),
        updated_at = pg_catalog.now()
    WHERE id = v_key.id;
  ELSE
    INSERT INTO public.booking_settlement_keys (
      tenant_id, normalized_key, raw_key, booking_id, departure_date,
      customer_name_snapshot, land_operator_name_snapshot, source, metadata
    ) VALUES (
      v_tx.tenant_id, p_expected_settlement_key, p_raw_key, p_booking_id, p_departure_date,
      p_customer_name, p_land_operator_name, 'clobe_memo_approved_booking',
      jsonb_build_object(
        'clobe_approved_existing_booking', TRUE,
        'clobe_generated', FALSE,
        'approved_transaction_id', p_transaction_id,
        'approved_by', COALESCE(NULLIF(pg_catalog.btrim(p_actor), ''), 'admin'),
        'approved_at', pg_catalog.now()
      )
    );
  END IF;

  SELECT COUNT(*)::INTEGER,
         COALESCE(SUM(a.allocated_amount), 0)::BIGINT,
         COALESCE(bool_and(
           a.booking_id = p_booking_id
           AND a.target_type = 'booking'
           AND a.allocation_type = 'deposit'
           AND a.ledger_account = 'paid_amount'
           AND a.ledger_delta = a.allocated_amount
         ), FALSE),
         COALESCE(bool_and(
           a.booking_id IS NULL
           AND a.target_type NOT IN ('booking', 'customer_refund')
           AND a.ledger_account IS NULL
           AND a.ledger_delta IS NULL
         ), FALSE)
    INTO v_active_count, v_active_total, v_booking_deposit_valid, v_nonbooking_valid
  FROM public.bank_transaction_allocations a
  WHERE a.bank_transaction_id = p_transaction_id
    AND a.status = 'active'
    AND a.reversed_at IS NULL;

  IF v_active_count = 0 THEN
    IF v_tx.booking_id IS NOT NULL OR COALESCE(v_tx.match_status, 'unmatched') NOT IN ('unmatched', 'review', 'error') THEN
      RAISE EXCEPTION 'Clobe deposit already has unmatched financial state' USING ERRCODE = 'P0001';
    END IF;
    v_match_result := public.match_bank_transaction_allocations(
      p_transaction_id,
      jsonb_build_array(jsonb_build_object('bookingId', p_booking_id, 'amount', v_tx.amount)),
      1,
      COALESCE(NULLIF(pg_catalog.btrim(p_actor), ''), 'admin'),
      'operator approved existing booking suggested by Clobe memo'
    );
  ELSIF v_active_total = v_tx.amount AND v_nonbooking_valid THEN
    v_match_result := public.reconcile_clobe_provider_memo_allocation(
      p_transaction_id,
      p_booking_id,
      'operator approved existing booking after Clobe memo reclassification',
      COALESCE(NULLIF(pg_catalog.btrim(p_actor), ''), 'admin')
    );
  ELSIF v_active_total = v_tx.amount
        AND v_booking_deposit_valid
        AND v_tx.booking_id = p_booking_id
        AND v_tx.match_status IN ('auto', 'manual') THEN
    IF EXISTS (
      SELECT 1
      FROM public.bank_transaction_allocations a
      WHERE a.bank_transaction_id = p_transaction_id
        AND a.status = 'active'
        AND a.reversed_at IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.ledger_entries l
          WHERE l.booking_id = a.booking_id
            AND l.account = a.ledger_account
            AND l.amount = a.ledger_delta
            AND (
              l.idempotency_key = a.idempotency_key
              OR l.idempotency_key LIKE a.idempotency_key || ':%'
            )
        )
    ) THEN
      RAISE EXCEPTION 'existing Clobe deposit allocation lacks ledger evidence' USING ERRCODE = 'P0001';
    END IF;
    v_match_result := jsonb_build_object('ok', TRUE, 'already_allocated', TRUE);
  ELSE
    RAISE EXCEPTION 'existing Clobe allocation state is not safe for approval' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.bank_transactions
  SET memo = p_raw_key,
      source_metadata = pg_catalog.jsonb_set(
        COALESCE(source_metadata, '{}'::JSONB),
        ARRAY[v_source_key],
        COALESCE(source_metadata -> v_source_key, '{}'::JSONB) || jsonb_build_object(
          'existing_booking_approved_at', pg_catalog.now(),
          'existing_booking_approved_by', COALESCE(NULLIF(pg_catalog.btrim(p_actor), ''), 'admin'),
          'approved_booking_id', p_booking_id
        ),
        TRUE
      ),
      updated_at = pg_catalog.now()
  WHERE id = p_transaction_id;

  UPDATE public.ops_events
  SET status = 'resolved',
      resolved_at = COALESCE(resolved_at, pg_catalog.now()),
      metadata = COALESCE(metadata, '{}'::JSONB) || jsonb_build_object(
        'resolution', 'existing_booking_approved',
        'booking_id', p_booking_id,
        'settlement_key', p_expected_settlement_key
      )
  WHERE bank_transaction_id = p_transaction_id
    AND status = 'open';

  v_result := jsonb_build_object(
    'ok', TRUE,
    'transaction_id', p_transaction_id,
    'booking_id', p_booking_id,
    'settlement_key', p_expected_settlement_key,
    'amount', v_tx.amount,
    'match_result', v_match_result
  );

  INSERT INTO public.clobe_existing_booking_deposit_commands (
    idempotency_key, bank_transaction_id, booking_id, settlement_key,
    request_json, result_json, completed_at
  ) VALUES (
    p_idempotency_key, p_transaction_id, p_booking_id, p_expected_settlement_key,
    jsonb_build_object('raw_key', p_raw_key, 'actor', p_actor),
    v_result, pg_catalog.now()
  );

  INSERT INTO public.audit_logs (
    action, target_type, target_id, before_value, after_value, description, user_id
  ) VALUES (
    'clobe_existing_booking_deposit_approved', 'bank_transactions', p_transaction_id::TEXT,
    jsonb_build_object('suggested_booking_id', v_suggested_booking_id),
    v_result,
    'Operator approved a normal booking as the Clobe settlement-key owner',
    NULL
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_clobe_deposit_to_existing_booking(
  UUID, UUID, TEXT, TEXT, DATE, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_clobe_deposit_to_existing_booking(
  UUID, UUID, TEXT, TEXT, DATE, TEXT, TEXT, TEXT, TEXT
) TO service_role;

COMMENT ON FUNCTION public.confirm_clobe_deposit_to_existing_booking(
  UUID, UUID, TEXT, TEXT, DATE, TEXT, TEXT, TEXT, TEXT
) IS 'Atomically approves an exact Clobe memo suggestion for an existing booking, binds the settlement key, and records deposit ledger evidence.';

-- Preserve the already deployed implementation under a private versioned
-- name, then place an atomic guard in front of it. A late canonical provider
-- memo leaves one explicit unassigned allocation; operator approval replaces
-- that placeholder and all booking ledger writes in the same transaction.
DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.match_clobe_outflow_allocations_v1(uuid,jsonb,text,text,text)') IS NULL
     AND pg_catalog.to_regprocedure('public.match_clobe_outflow_allocations(uuid,jsonb,text,text,text)') IS NOT NULL THEN
    ALTER FUNCTION public.match_clobe_outflow_allocations(UUID, JSONB, TEXT, TEXT, TEXT)
      RENAME TO match_clobe_outflow_allocations_v1;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.match_clobe_outflow_allocations(
  p_transaction_id UUID,
  p_allocations JSONB,
  p_idempotency_key TEXT,
  p_matched_by TEXT DEFAULT 'admin',
  p_notes TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_active_total BIGINT;
  v_active_count INTEGER;
  v_unassigned_count INTEGER;
  v_source_amount BIGINT;
  v_result JSONB;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('clobe-outflow-transaction:' || p_transaction_id::TEXT, 0)
  );

  SELECT ABS(amount)::BIGINT INTO v_source_amount
  FROM public.bank_transactions
  WHERE id = p_transaction_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank transaction not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(SUM(a.allocated_amount), 0)::BIGINT,
         COUNT(*)::INTEGER,
         COUNT(*) FILTER (
           WHERE a.target_type = 'unassigned'
             AND a.allocation_type = 'unassigned'
             AND a.booking_id IS NULL
             AND a.ledger_account IS NULL
             AND a.ledger_delta IS NULL
         )::INTEGER
    INTO v_active_total, v_active_count, v_unassigned_count
  FROM public.bank_transaction_allocations a
  WHERE a.bank_transaction_id = p_transaction_id
    AND a.status = 'active'
    AND a.reversed_at IS NULL;

  IF v_unassigned_count > 0 THEN
    IF v_unassigned_count <> v_active_count OR v_active_total <> v_source_amount THEN
      RAISE EXCEPTION 'Clobe outflow contains mixed or incomplete active allocations' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.bank_transaction_allocations
    SET status = 'reversed',
        reversed_at = pg_catalog.now(),
        reason = COALESCE(NULLIF(pg_catalog.btrim(p_notes), ''), 'operator approved Clobe outflow allocation'),
        metadata = COALESCE(metadata, '{}'::JSONB) || jsonb_build_object(
          'replaced_by_command', p_idempotency_key,
          'replaced_by', COALESCE(NULLIF(pg_catalog.btrim(p_matched_by), ''), 'admin'),
          'replaced_at', pg_catalog.now()
        )
    WHERE bank_transaction_id = p_transaction_id
      AND status = 'active'
      AND reversed_at IS NULL;
  END IF;

  v_result := public.match_clobe_outflow_allocations_v1(
    p_transaction_id,
    p_allocations,
    p_idempotency_key,
    p_matched_by,
    p_notes
  );
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.match_clobe_outflow_allocations_v1(UUID, JSONB, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_clobe_outflow_allocations_v1(UUID, JSONB, TEXT, TEXT, TEXT)
  TO service_role;
REVOKE ALL ON FUNCTION public.match_clobe_outflow_allocations(UUID, JSONB, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_clobe_outflow_allocations(UUID, JSONB, TEXT, TEXT, TEXT)
  TO service_role;

COMMENT ON FUNCTION public.match_clobe_outflow_allocations(UUID, JSONB, TEXT, TEXT, TEXT)
  IS 'Atomically replaces exact unassigned Clobe review evidence with operator-approved payout/refund allocations.';

COMMIT;

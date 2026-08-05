-- A reopened month must return its bookings to the close preview.

BEGIN;

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
  v_period public.settlement_periods%ROWTYPE;
  v_booking_count integer := 0;
BEGIN
  IF NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'reopen reason is required';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('finance-close:' || p_departure_month::text));

  SELECT * INTO v_period
  FROM public.settlement_periods
  WHERE departure_month = p_departure_month
    AND is_current
    AND status IN ('closed', 'conditional')
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'locked settlement period not found';
  END IF;

  UPDATE public.settlement_periods
  SET
    status = 'reopened',
    reopened_at = now(),
    reopened_by = p_actor,
    reopened_by_label = p_actor_label,
    reopen_reason = trim(p_reason)
  WHERE id = v_period.id;

  UPDATE public.bookings b
  SET
    settlement_confirmed_at = NULL,
    settlement_confirmed_by = NULL,
    settlement_mode = NULL,
    updated_at = now()
  FROM public.settlement_period_items item
  WHERE item.settlement_period_id = v_period.id
    AND item.booking_id = b.id;
  GET DIAGNOSTICS v_booking_count = ROW_COUNT;

  INSERT INTO public.audit_logs (
    user_id,
    action,
    target_type,
    target_id,
    description,
    before_value,
    after_value
  ) VALUES (
    p_actor,
    'FINANCE_PERIOD_REOPENED',
    'settlement_period',
    v_period.id::text,
    p_departure_month::text || ' settlement period reopened',
    jsonb_build_object(
      'status', v_period.status,
      'revision', v_period.revision,
      'confirmed_booking_count', v_period.confirmed_booking_count
    ),
    jsonb_build_object(
      'status', 'reopened',
      'reason', trim(p_reason),
      'actor', p_actor_label,
      'bookings_returned_to_preview', v_booking_count
    )
  );

  RETURN v_period.id;
END;
$$;

REVOKE ALL ON FUNCTION public.reopen_finance_settlement_period(date, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reopen_finance_settlement_period(date, text, uuid, text) TO service_role;

COMMIT;

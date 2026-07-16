-- Repair legacy RPC contracts against the current clean-schema shape.
-- These forward fixes keep historical migrations immutable in production while
-- ensuring a newly-created database can pass strict function validation.

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL,
  target_type text,
  target_id text,
  before_value jsonb,
  after_value jsonb,
  description text,
  user_id text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_logs_service_role_all" ON public.audit_logs;
CREATE POLICY "audit_logs_service_role_all"
  ON public.audit_logs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.update_booking_ledger(
  p_booking_id uuid,
  p_paid_delta integer DEFAULT 0,
  p_payout_delta integer DEFAULT 0
)
RETURNS TABLE (
  paid_amount integer,
  total_paid_out integer,
  payment_status text,
  booking_status text,
  auto_status_changed boolean
)
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM public.update_booking_ledger(
    p_booking_id,
    p_paid_delta,
    p_payout_delta,
    'legacy_rpc',
    NULL::text,
    NULL::text,
    NULL::text,
    NULL::text
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_booking_ledger(
  p_booking_id uuid,
  p_paid_delta integer DEFAULT 0,
  p_payout_delta integer DEFAULT 0,
  p_source text DEFAULT 'slack_ingest',
  p_source_ref_id text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_memo text DEFAULT NULL,
  p_created_by text DEFAULT NULL
)
RETURNS TABLE (
  paid_amount integer,
  total_paid_out integer,
  payment_status text,
  booking_status text,
  auto_status_changed boolean
)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_total_price integer;
  v_total_cost integer;
  v_new_paid integer;
  v_new_payout integer;
  v_new_payment_status text;
  v_cur_status text;
  v_new_status text;
  v_status_changed boolean := false;
  v_fee_tolerance constant integer := 5000;
  v_paid_idem text;
  v_payout_idem text;
BEGIN
  UPDATE public.bookings AS b
  SET
    paid_amount = GREATEST(0, COALESCE(b.paid_amount, 0) + p_paid_delta),
    total_paid_out = GREATEST(0, COALESCE(b.total_paid_out, 0) + p_payout_delta),
    updated_at = now()
  WHERE b.id = p_booking_id
  RETURNING
    COALESCE(b.total_price, 0),
    COALESCE(b.total_cost, 0),
    b.paid_amount,
    b.total_paid_out,
    b.status
  INTO
    v_total_price,
    v_total_cost,
    v_new_paid,
    v_new_payout,
    v_cur_status;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF p_paid_delta <> 0 AND to_regprocedure('public.record_ledger_entry(uuid,text,text,integer,text,text,text,text,text)') IS NOT NULL THEN
    v_paid_idem := CASE WHEN p_idempotency_key IS NOT NULL THEN p_idempotency_key || ':paid' ELSE NULL END;
    PERFORM public.record_ledger_entry(
      p_booking_id := p_booking_id,
      p_account := 'paid_amount',
      p_entry_type := CASE WHEN p_paid_delta > 0 THEN 'deposit' ELSE 'refund' END,
      p_amount := p_paid_delta,
      p_source := p_source,
      p_source_ref_id := p_source_ref_id,
      p_idempotency_key := v_paid_idem,
      p_memo := p_memo,
      p_created_by := p_created_by
    );
  END IF;

  IF p_payout_delta <> 0 AND to_regprocedure('public.record_ledger_entry(uuid,text,text,integer,text,text,text,text,text)') IS NOT NULL THEN
    v_payout_idem := CASE WHEN p_idempotency_key IS NOT NULL THEN p_idempotency_key || ':payout' ELSE NULL END;
    PERFORM public.record_ledger_entry(
      p_booking_id := p_booking_id,
      p_account := 'total_paid_out',
      p_entry_type := CASE WHEN p_payout_delta > 0 THEN 'payout' ELSE 'payout_reverse' END,
      p_amount := p_payout_delta,
      p_source := p_source,
      p_source_ref_id := p_source_ref_id,
      p_idempotency_key := v_payout_idem,
      p_memo := p_memo,
      p_created_by := p_created_by
    );
  END IF;

  IF v_total_cost > 0 AND v_new_payout > v_total_cost + v_fee_tolerance THEN
    v_new_payment_status := '초과지급(경고)';
  ELSIF v_total_price > 0 AND v_new_paid >= v_total_price THEN
    v_new_payment_status := '완납';
  ELSIF v_new_paid > 0 THEN
    v_new_payment_status := '예약금완료';
  ELSE
    v_new_payment_status := '미입금';
  END IF;

  v_new_status := v_cur_status;
  IF v_cur_status <> 'cancelled' AND p_paid_delta > 0 THEN
    IF v_new_paid >= v_total_price AND v_total_price > 0 AND v_cur_status <> 'completed' THEN
      v_new_status := 'completed';
    ELSIF v_new_paid > 0 AND v_cur_status = 'pending' THEN
      v_new_status := 'confirmed';
    END IF;
  END IF;

  UPDATE public.bookings AS b
  SET
    payment_status = v_new_payment_status,
    status = v_new_status,
    updated_at = now()
  WHERE b.id = p_booking_id;

  v_status_changed := v_new_status <> v_cur_status;

  RETURN QUERY
  SELECT v_new_paid, v_new_payout, v_new_payment_status, v_new_status, v_status_changed;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_trending_packages()
RETURNS TABLE(
  package_id uuid,
  package_name text,
  destination text,
  price integer,
  score numeric,
  reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    tp.id,
    tp.title::text,
    tp.destination::text,
    tp.price::integer,
    (COALESCE(tp.view_count, 0)::numeric / 100.0 + COUNT(DISTINCT b.id)::numeric * 2) AS score,
    '최근 인기 상품'::text AS reason
  FROM public.travel_packages tp
  LEFT JOIN public.bookings b ON tp.id = b.package_id
    AND b.created_at > now() - interval '30 days'
    AND b.status IN ('deposit_paid', 'waiting_balance', 'fully_paid', 'confirmed', 'completed')
    AND COALESCE(b.is_deleted, false) = false
  WHERE tp.status IN ('active', 'approved')
  GROUP BY tp.id, tp.title, tp.destination, tp.price, tp.view_count
  ORDER BY score DESC
  LIMIT 20;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_simple_recommendations(p_customer_id uuid DEFAULT NULL)
RETURNS TABLE(
  package_id uuid,
  package_name text,
  destination text,
  price integer,
  score numeric,
  reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_customer_id IS NULL OR to_regclass('public.customer_unified_profile') IS NULL THEN
    RETURN QUERY SELECT * FROM public.get_trending_packages();
    RETURN;
  END IF;

  RETURN QUERY
  WITH similar_customers AS (
    SELECT cup2.customer_id AS id
    FROM public.customer_unified_profile cup1
    JOIN public.customer_unified_profile cup2 ON
      ABS(COALESCE(cup1.rfm_r, 3) - COALESCE(cup2.rfm_r, 3)) <= 1
      AND ABS(COALESCE(cup1.rfm_f, 3) - COALESCE(cup2.rfm_f, 3)) <= 1
      AND cup2.customer_id <> p_customer_id
    WHERE cup1.customer_id = p_customer_id
    LIMIT 100
  ),
  popular_among_similar AS (
    SELECT
      tp.id,
      tp.title::text AS title,
      tp.destination::text AS destination,
      tp.price::integer AS price,
      COUNT(DISTINCT b.id) AS booking_count
    FROM similar_customers sc
    JOIN public.bookings b ON sc.id = b.lead_customer_id
    JOIN public.travel_packages tp ON b.package_id = tp.id
    WHERE b.status IN ('deposit_paid', 'waiting_balance', 'fully_paid', 'confirmed', 'completed')
      AND COALESCE(b.is_deleted, false) = false
      AND tp.status IN ('active', 'approved')
    GROUP BY tp.id, tp.title, tp.destination, tp.price
    ORDER BY booking_count DESC
    LIMIT 10
  )
  SELECT
    p.id,
    p.title,
    p.destination,
    p.price,
    (p.booking_count::numeric / 10.0),
    '유사 고객이 선택한 상품'::text
  FROM popular_among_similar p;

  IF NOT FOUND THEN
    RETURN QUERY SELECT * FROM public.get_trending_packages();
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_personalized_by_destination(
  p_customer_id uuid,
  p_destination text
)
RETURNS TABLE(
  package_id uuid,
  package_name text,
  destination text,
  price integer,
  score numeric,
  reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    tp.id,
    tp.title::text,
    tp.destination::text,
    tp.price::integer,
    (COALESCE(tp.view_count, 0)::numeric / 50.0 + COUNT(DISTINCT b.id)::numeric * 3) AS score,
    format('%s 인기 상품', p_destination)::text AS reason
  FROM public.travel_packages tp
  LEFT JOIN public.bookings b ON tp.id = b.package_id
    AND b.created_at > now() - interval '90 days'
    AND b.status IN ('deposit_paid', 'waiting_balance', 'fully_paid', 'confirmed', 'completed')
    AND COALESCE(b.is_deleted, false) = false
  WHERE tp.destination ILIKE '%' || p_destination || '%'
    AND tp.status IN ('active', 'approved')
  GROUP BY tp.id, tp.title, tp.destination, tp.price, tp.view_count
  ORDER BY score DESC
  LIMIT 10;
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_expired_trend_posts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer := 0;
BEGIN
  IF to_regclass('public.external_trend_posts') IS NOT NULL THEN
    DELETE FROM public.external_trend_posts
    WHERE expires_at < now();
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
  END IF;

  RETURN deleted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_attribution_summary()
RETURNS TABLE(updated integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer := 0;
BEGIN
  DELETE FROM public.attribution_summary;

  INSERT INTO public.attribution_summary (
    channel,
    creative_id,
    campaign_id,
    first_touch_conversions,
    last_touch_conversions,
    total_cost,
    attributed_revenue,
    attributed_profit,
    computed_at
  )
  SELECT
    COALESCE(tp.touchpoint->>'channel', 'unknown') AS channel,
    CASE
      WHEN COALESCE(tp.touchpoint->>'creative_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN (tp.touchpoint->>'creative_id')::uuid
      ELSE NULL
    END AS creative_id,
    NULLIF(tp.touchpoint->>'campaign_id', '') AS campaign_id,
    1 AS first_touch_conversions,
    0 AS last_touch_conversions,
    COALESCE(NULLIF(tp.touchpoint->>'cost', '')::numeric, 0) AS total_cost,
    COALESCE(b.total_price, 0)::numeric AS attributed_revenue,
    GREATEST(COALESCE(b.total_price, 0) - COALESCE(b.total_cost, 0), 0)::numeric AS attributed_profit,
    now()
  FROM public.attribution_chains ac
  LEFT JOIN public.bookings b ON b.id = ac.booking_id
  CROSS JOIN LATERAL (
    SELECT ac.touchpoints->0 AS touchpoint
  ) tp
  WHERE ac.created_at >= now() - interval '30 days'
    AND jsonb_typeof(ac.touchpoints) = 'array'
    AND jsonb_array_length(ac.touchpoints) > 0;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN QUERY SELECT v_updated;
END;
$$;

CREATE OR REPLACE FUNCTION public.recompute_rfm_scores()
RETURNS TABLE(computed integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_computed integer := 0;
BEGIN
  DELETE FROM public.customer_rfm;

  INSERT INTO public.customer_rfm (
    customer_id,
    customer_email,
    recency_days,
    frequency,
    monetary_total,
    r_score,
    f_score,
    m_score,
    rfm_combined,
    last_booking_at,
    first_booking_at,
    computed_at
  )
  WITH agg AS (
    SELECT
      b.lead_customer_id,
      MAX(b.created_at) AS last_booking_at,
      MIN(b.created_at) AS first_booking_at,
      COUNT(*)::integer AS frequency,
      COALESCE(SUM(b.total_price), 0)::numeric AS monetary_total
    FROM public.bookings b
    WHERE b.lead_customer_id IS NOT NULL
      AND COALESCE(b.is_deleted, false) = false
      AND b.status IS DISTINCT FROM 'cancelled'
      AND b.status IS DISTINCT FROM 'voided'
    GROUP BY b.lead_customer_id
  ),
  scored AS (
    SELECT
      a.*,
      GREATEST(0, EXTRACT(DAY FROM (now() - a.last_booking_at))::integer) AS recency_days,
      CASE
        WHEN a.last_booking_at >= now() - interval '30 days' THEN 5
        WHEN a.last_booking_at >= now() - interval '90 days' THEN 4
        WHEN a.last_booking_at >= now() - interval '180 days' THEN 3
        WHEN a.last_booking_at >= now() - interval '365 days' THEN 2
        ELSE 1
      END AS r_score,
      LEAST(5, GREATEST(1, a.frequency)) AS f_score,
      CASE
        WHEN a.monetary_total >= 5000000 THEN 5
        WHEN a.monetary_total >= 3000000 THEN 4
        WHEN a.monetary_total >= 1000000 THEN 3
        WHEN a.monetary_total > 0 THEN 2
        ELSE 1
      END AS m_score
    FROM agg a
  )
  SELECT
    s.lead_customer_id::text,
    c.email,
    s.recency_days,
    s.frequency,
    s.monetary_total,
    s.r_score,
    s.f_score,
    s.m_score,
    concat(s.r_score, s.f_score, s.m_score),
    s.last_booking_at,
    s.first_booking_at,
    now()
  FROM scored s
  LEFT JOIN public.customers c ON c.id = s.lead_customer_id;

  GET DIAGNOSTICS v_computed = ROW_COUNT;
  RETURN QUERY SELECT v_computed;
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_heal_content_gaps(p_max_per_run integer DEFAULT 3)
RETURNS TABLE(
  scanned_packages integer,
  gaps_found integer,
  already_covered integer,
  queued integer,
  skipped_duplicate integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scanned integer := 0;
  v_gaps_found integer := 0;
  v_already_covered integer := 0;
  v_queued integer := 0;
  v_skipped integer := 0;
  v_pkg record;
  v_has_content boolean;
  v_in_queue boolean;
  v_in_card_news boolean;
  v_booking_count integer;
  v_topic text;
BEGIN
  FOR v_pkg IN
    SELECT
      tp.id,
      tp.title::text AS title,
      tp.destination::text AS destination,
      COALESCE(tp.product_summary, tp.notes, '') AS description
    FROM public.travel_packages tp
    WHERE tp.status IN ('active', 'approved')
    ORDER BY tp.created_at DESC
    LIMIT 200
  LOOP
    SELECT EXISTS(
      SELECT 1
      FROM public.content_creatives cc
      WHERE cc.product_id = v_pkg.id AND cc.status = 'published'
    ) INTO v_has_content;

    SELECT COUNT(*)
    INTO v_booking_count
    FROM public.bookings b
    WHERE b.package_id = v_pkg.id;

    v_scanned := v_scanned + 1;

    IF v_has_content OR v_booking_count = 0 THEN
      IF v_has_content THEN
        v_already_covered := v_already_covered + 1;
      END IF;
      CONTINUE;
    END IF;

    v_gaps_found := v_gaps_found + 1;

    SELECT EXISTS(
      SELECT 1
      FROM public.blog_topic_queue btq
      WHERE btq.product_id = v_pkg.id AND btq.status IN ('pending', 'processing')
    ) INTO v_in_queue;

    SELECT EXISTS(
      SELECT 1
      FROM public.card_news cn
      WHERE cn.product_id = v_pkg.id AND (cn.status IS NULL OR cn.status <> 'draft')
    ) INTO v_in_card_news;

    IF v_in_queue OR v_in_card_news THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_topic := trim(COALESCE(v_pkg.destination, '') || ' ' || COALESCE(v_pkg.title, '') || ' 여행 가이드');

    INSERT INTO public.blog_topic_queue (
      topic,
      source,
      priority,
      destination,
      product_id,
      status,
      created_at
    )
    VALUES (
      v_topic,
      'auto_heal',
      50,
      v_pkg.destination,
      v_pkg.id,
      'pending',
      now()
    );

    v_queued := v_queued + 1;
    IF v_queued >= p_max_per_run THEN
      EXIT;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_scanned, v_gaps_found, v_already_covered, v_queued, v_skipped;
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_finalize_ab_experiments()
RETURNS TABLE(finalized integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_finalized integer := 0;
  v_exp record;
  v_control_conv integer;
  v_control_imp integer;
  v_test_conv integer;
  v_test_imp integer;
  v_winner_variant_id uuid;
BEGIN
  FOR v_exp IN
    SELECT e.id, e.min_sample_size
    FROM public.ab_experiments e
    WHERE e.status = 'running'
  LOOP
    SELECT
      COALESCE(COUNT(*) FILTER (WHERE a.converted = true), 0),
      COALESCE(COUNT(*), 0)
    INTO v_control_conv, v_control_imp
    FROM public.ab_assignments a
    JOIN public.ab_variants v ON v.id = a.variant_id
    WHERE a.experiment_id = v_exp.id AND v.is_control = true;

    SELECT
      COALESCE(COUNT(*) FILTER (WHERE a.converted = true), 0),
      COALESCE(COUNT(*), 0)
    INTO v_test_conv, v_test_imp
    FROM public.ab_assignments a
    JOIN public.ab_variants v ON v.id = a.variant_id
    WHERE a.experiment_id = v_exp.id AND v.is_control = false;

    IF v_control_imp < v_exp.min_sample_size OR v_test_imp < v_exp.min_sample_size THEN
      CONTINUE;
    END IF;

    IF v_test_imp > 0
      AND v_control_imp > 0
      AND (v_test_conv::numeric / NULLIF(v_test_imp, 0)) > (v_control_conv::numeric / NULLIF(v_control_imp, 0))
    THEN
      SELECT v.id
      INTO v_winner_variant_id
      FROM public.ab_variants v
      WHERE v.experiment_id = v_exp.id AND v.is_control = false
      ORDER BY (
        SELECT COUNT(*)
        FROM public.ab_assignments a
        WHERE a.variant_id = v.id AND a.converted = true
      ) DESC
      LIMIT 1;

      UPDATE public.ab_experiments
      SET
        status = 'completed',
        winner_variant_id = v_winner_variant_id,
        completed_at = now()
      WHERE id = v_exp.id;

      v_finalized := v_finalized + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_finalized;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_predictive_insights()
RETURNS TABLE(insights_generated integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_generated integer := 0;
  v_kw record;
  v_change_percent numeric;
  v_direction text;
BEGIN
  FOR v_kw IN
    WITH ranked AS (
      SELECT
        kts.keyword,
        kts.destination,
        kts.search_volume,
        kts.trend_score,
        kts.date,
        ROW_NUMBER() OVER (PARTITION BY kts.keyword ORDER BY kts.date DESC) AS rn,
        ROW_NUMBER() OVER (PARTITION BY kts.keyword ORDER BY kts.date ASC) AS rn_first
      FROM public.keyword_trend_snapshots kts
      WHERE kts.date >= (current_date - interval '60 days')
    ),
    current_rows AS (
      SELECT * FROM ranked WHERE rn = 1
    ),
    previous_rows AS (
      SELECT * FROM ranked WHERE rn_first = 1
    )
    SELECT
      c.keyword,
      c.destination,
      c.search_volume AS current_volume,
      COALESCE(p.search_volume, 0) AS prev_volume,
      COALESCE(c.trend_score, 0) AS trend_score
    FROM current_rows c
    LEFT JOIN previous_rows p ON p.keyword = c.keyword
    WHERE c.keyword IS NOT NULL
      AND c.search_volume > 10
    ORDER BY (c.search_volume - COALESCE(p.search_volume, 0)) DESC
    LIMIT 50
  LOOP
    IF v_kw.prev_volume > 0 THEN
      v_change_percent := ROUND(((v_kw.current_volume - v_kw.prev_volume)::numeric / v_kw.prev_volume) * 100, 2);
    ELSE
      v_change_percent := 100;
    END IF;

    v_direction := CASE
      WHEN v_change_percent > 10 THEN 'up'
      WHEN v_change_percent < -10 THEN 'down'
      ELSE 'flat'
    END;

    INSERT INTO public.trend_keyword_archive (
      observed_at,
      source,
      keyword,
      related_destination,
      trend_score,
      search_volume,
      raw
    )
    VALUES (
      now(),
      'keyword_trend_snapshots',
      v_kw.keyword,
      v_kw.destination,
      v_kw.trend_score,
      v_kw.current_volume,
      jsonb_build_object('previous_volume', v_kw.prev_volume, 'change_percent', v_change_percent)
    );

    IF NOT EXISTS (
      SELECT 1
      FROM public.predictive_insights pi
      WHERE pi.keyword = v_kw.keyword
        AND pi.created_at > now() - interval '24 hours'
    ) THEN
      INSERT INTO public.predictive_insights (
        insight_type,
        title,
        description,
        keyword,
        destination,
        trend_direction,
        change_percent,
        recommendation,
        suggested_action,
        estimated_impact,
        priority,
        status,
        created_at,
        expires_at
      )
      VALUES (
        'keyword_trend',
        v_kw.keyword || ' 검색 흐름',
        v_kw.keyword || ' 검색량 변화가 감지되었습니다.',
        v_kw.keyword,
        v_kw.destination,
        v_direction,
        v_change_percent,
        CASE WHEN v_direction = 'up' THEN '관련 콘텐츠 점검' ELSE '추세 모니터링' END,
        CASE WHEN v_direction = 'up' THEN '콘텐츠 발행 후보로 검토' ELSE '추가 데이터 누적 후 판단' END,
        CASE WHEN abs(v_change_percent) >= 30 THEN 'high' ELSE 'medium' END,
        CASE WHEN abs(v_change_percent) >= 30 THEN 80 ELSE 50 END,
        'pending',
        now(),
        now() + interval '14 days'
      );

      v_generated := v_generated + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_generated;
END;
$$;

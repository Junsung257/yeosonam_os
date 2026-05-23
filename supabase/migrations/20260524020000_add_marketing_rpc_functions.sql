-- ============================================================
-- ??? OS: ??? RPC ?? ? ??/?? ??? SQL ???
-- ??????: 20260524020000
--
-- ??:
--   1. refresh_attribution_summary() ? attribution_touch_events / chains ? summary ??
--   2. recompute_rfm_scores() ? bookings ? customer_rfm UPSERT
--   3. auto_heal_content_gaps() ? ??? ? ?? ? blog_topic_queue ??
--   4. auto_finalize_ab_experiments() ? ??? A/B ?? ?? ??
--   5. generate_predictive_insights() ? keyword_trend_snapshots ? predictive_insights INSERT
-- ============================================================

BEGIN;

-- ============================================================
-- 0. blog_topic_queue source CHECK ? 'auto_heal' ??
-- ============================================================
ALTER TABLE blog_topic_queue DROP CONSTRAINT IF EXISTS blog_topic_queue_source_check;
ALTER TABLE blog_topic_queue ADD CONSTRAINT blog_topic_queue_source_check
  CHECK (source IN ('seasonal','coverage_gap','user_seed','product','trend','pillar','auto_heal'));

-- ============================================================
-- 1. refresh_attribution_summary()
-- ============================================================
-- attribution_chains.touchpoints JSONB? ??? 5? ??? ????
-- attribution_summary? UPSERT??. 30? ?? ??? ??.
-- ============================================================
CREATE OR REPLACE FUNCTION refresh_attribution_summary()
RETURNS TABLE(updated INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated INT := 0;
  v_chain RECORD;
  v_tp JSONB;
  v_touchpoints JSONB;
  v_n INT;
  v_revenue NUMERIC(12,2);
  v_profit NUMERIC(12,2);
  v_weight NUMERIC(10,6);
  v_channel TEXT;
  v_creative_id TEXT;
  v_campaign_id TEXT;
  v_cost NUMERIC(12,2);
  v_idx INT;
  v_hours NUMERIC;
  v_weights NUMERIC(10,6)[];
  v_sum NUMERIC(10,6);
  v_model TEXT;
  v_contrib NUMERIC(10,6);
BEGIN
  -- attribution_summary ??? (??? ??? ??)
  DELETE FROM attribution_summary;

  FOR v_chain IN
    SELECT
      ac.id AS chain_id,
      ac.booking_id,
      ac.touchpoints,
      ac.touch_count,
      ac.first_touch_creative_id,
      ac.last_touch_creative_id,
      COALESCE(b.total_price, 0) AS revenue,
      COALESCE(b.total_profit, 0) AS profit
    FROM attribution_chains ac
    LEFT JOIN bookings b ON b.id = ac.booking_id
    WHERE ac.created_at >= NOW() - INTERVAL '30 days'
      AND ac.touch_count > 0
  LOOP
    v_touchpoints := v_chain.touchpoints;
    v_n := jsonb_array_length(v_touchpoints);
    v_revenue := v_chain.revenue;
    v_profit := v_chain.profit;

    IF v_n = 0 THEN
      CONTINUE;
    END IF;

    -- first_touch
    v_tp := v_touchpoints->0;
    INSERT INTO attribution_summary
      (channel, creative_id, campaign_id, first_touch_conversions, last_touch_conversions,
       linear_conversions, time_decay_conversions, position_based_conversions,
       total_cost, attributed_revenue, attributed_profit, computed_at)
    VALUES
      (v_tp->>'channel',
       (v_tp->>'creative_id')::UUID,
       v_tp->>'campaign_id',
       1, 0, 0, 0, 0,
       COALESCE((v_tp->>'cost')::NUMERIC, 0),
       v_revenue, v_profit, NOW())
    ON CONFLICT DO NOTHING;

    -- last_touch
    v_tp := v_touchpoints->(v_n - 1);
    INSERT INTO attribution_summary
      (channel, creative_id, campaign_id, first_touch_conversions, last_touch_conversions,
       linear_conversions, time_decay_conversions, position_based_conversions,
       total_cost, attributed_revenue, attributed_profit, computed_at)
    VALUES
      (v_tp->>'channel',
       (v_tp->>'creative_id')::UUID,
       v_tp->>'campaign_id',
       0, 1, 0, 0, 0,
       COALESCE((v_tp->>'cost')::NUMERIC, 0),
       v_revenue, v_profit, NOW())
    ON CONFLICT DO NOTHING;

    -- linear (1/n each)
    FOR v_idx IN 0..v_n-1 LOOP
      v_tp := v_touchpoints->v_idx;
      v_weight := 1.0 / v_n;
      INSERT INTO attribution_summary
        (channel, creative_id, campaign_id, first_touch_conversions, last_touch_conversions,
         linear_conversions, time_decay_conversions, position_based_conversions,
         total_cost, attributed_revenue, attributed_profit, computed_at)
      VALUES
        (v_tp->>'channel',
         (v_tp->>'creative_id')::UUID,
         v_tp->>'campaign_id',
         0, 0, v_weight, 0, 0,
         COALESCE((v_tp->>'cost')::NUMERIC, 0),
         v_revenue * v_weight, v_profit * v_weight, NOW())
      ON CONFLICT DO NOTHING;
    END LOOP;

    -- time_decay (exp(-0.1 * hours_ago))
    v_sum := 0;
    FOR v_idx IN 0..v_n-1 LOOP
      v_tp := v_touchpoints->v_idx;
      v_hours := COALESCE((v_tp->>'time_to_conversion_hours')::NUMERIC, 0);
      v_weights[v_idx] := exp(-0.1 * GREATEST(v_hours, 0));
      v_sum := v_sum + v_weights[v_idx];
    END LOOP;
    IF v_sum > 0 THEN
      FOR v_idx IN 0..v_n-1 LOOP
        v_tp := v_touchpoints->v_idx;
        v_weight := v_weights[v_idx] / v_sum;
        INSERT INTO attribution_summary
          (channel, creative_id, campaign_id, first_touch_conversions, last_touch_conversions,
           linear_conversions, time_decay_conversions, position_based_conversions,
           total_cost, attributed_revenue, attributed_profit, computed_at)
        VALUES
          (v_tp->>'channel',
           (v_tp->>'creative_id')::UUID,
           v_tp->>'campaign_id',
           0, 0, 0, v_weight, 0,
           COALESCE((v_tp->>'cost')::NUMERIC, 0),
           v_revenue * v_weight, v_profit * v_weight, NOW())
        ON CONFLICT DO NOTHING;
      END LOOP;
    END IF;

    -- position_based (first 40% + last 40% + middle 20%)
    IF v_n = 1 THEN
      v_tp := v_touchpoints->0;
      INSERT INTO attribution_summary
        (channel, creative_id, campaign_id, first_touch_conversions, last_touch_conversions,
         linear_conversions, time_decay_conversions, position_based_conversions,
         total_cost, attributed_revenue, attributed_profit, computed_at)
      VALUES
        (v_tp->>'channel',
         (v_tp->>'creative_id')::UUID,
         v_tp->>'campaign_id',
         0, 0, 0, 0, 1,
         COALESCE((v_tp->>'cost')::NUMERIC, 0),
         v_revenue, v_profit, NOW())
      ON CONFLICT DO NOTHING;
    ELSIF v_n = 2 THEN
      FOR v_idx IN 0..1 LOOP
        v_tp := v_touchpoints->v_idx;
        INSERT INTO attribution_summary
          (channel, creative_id, campaign_id, first_touch_conversions, last_touch_conversions,
           linear_conversions, time_decay_conversions, position_based_conversions,
           total_cost, attributed_revenue, attributed_profit, computed_at)
        VALUES
          (v_tp->>'channel',
           (v_tp->>'creative_id')::UUID,
           v_tp->>'campaign_id',
           0, 0, 0, 0, 0.5,
           COALESCE((v_tp->>'cost')::NUMERIC, 0),
           v_revenue * 0.5, v_profit * 0.5, NOW())
        ON CONFLICT DO NOTHING;
      END LOOP;
    ELSE
      v_tp := v_touchpoints->0;
      INSERT INTO attribution_summary
        (channel, creative_id, campaign_id, first_touch_conversions, last_touch_conversions,
         linear_conversions, time_decay_conversions, position_based_conversions,
         total_cost, attributed_revenue, attributed_profit, computed_at)
      VALUES
        (v_tp->>'channel',
         (v_tp->>'creative_id')::UUID,
         v_tp->>'campaign_id',
         0, 0, 0, 0, 0.4,
         COALESCE((v_tp->>'cost')::NUMERIC, 0),
         v_revenue * 0.4, v_profit * 0.4, NOW())
      ON CONFLICT DO NOTHING;

      v_tp := v_touchpoints->(v_n - 1);
      INSERT INTO attribution_summary
        (channel, creative_id, campaign_id, first_touch_conversions, last_touch_conversions,
         linear_conversions, time_decay_conversions, position_based_conversions,
         total_cost, attributed_revenue, attributed_profit, computed_at)
      VALUES
        (v_tp->>'channel',
         (v_tp->>'creative_id')::UUID,
         v_tp->>'campaign_id',
         0, 0, 0, 0, 0.4,
         COALESCE((v_tp->>'cost')::NUMERIC, 0),
         v_revenue * 0.4, v_profit * 0.4, NOW())
      ON CONFLICT DO NOTHING;

      FOR v_idx IN 1..v_n-2 LOOP
        v_tp := v_touchpoints->v_idx;
        v_weight := 0.2 / (v_n - 2);
        INSERT INTO attribution_summary
          (channel, creative_id, campaign_id, first_touch_conversions, last_touch_conversions,
           linear_conversions, time_decay_conversions, position_based_conversions,
           total_cost, attributed_revenue, attributed_profit, computed_at)
        VALUES
          (v_tp->>'channel',
           (v_tp->>'creative_id')::UUID,
           v_tp->>'campaign_id',
           0, 0, 0, 0, v_weight,
           COALESCE((v_tp->>'cost')::NUMERIC, 0),
           v_revenue * v_weight, v_profit * v_weight, NOW())
        ON CONFLICT DO NOTHING;
      END LOOP;
    END IF;
  END LOOP;

  -- ?? ?? (channel + creative_id + campaign_id ?? SUM)
  WITH merged AS (
    SELECT
      channel,
      creative_id,
      campaign_id,
      SUM(first_touch_conversions) AS ft,
      SUM(last_touch_conversions) AS lt,
      SUM(linear_conversions) AS lin,
      SUM(time_decay_conversions) AS td,
      SUM(position_based_conversions) AS pb,
      SUM(total_cost) AS cost,
      SUM(attributed_revenue) AS rev,
      SUM(attributed_profit) AS profit
    FROM attribution_summary
    GROUP BY channel, creative_id, campaign_id
  )
  UPDATE attribution_summary s
  SET
    first_touch_conversions = m.ft,
    last_touch_conversions = m.lt,
    linear_conversions = ROUND(m.lin::NUMERIC, 4),
    time_decay_conversions = ROUND(m.td::NUMERIC, 4),
    position_based_conversions = ROUND(m.pb::NUMERIC, 4),
    total_cost = ROUND(m.cost::NUMERIC, 2),
    attributed_revenue = ROUND(m.rev::NUMERIC, 2),
    attributed_profit = ROUND(m.profit::NUMERIC, 2),
    computed_at = NOW()
  FROM merged m
  WHERE s.channel = m.channel
    AND (s.creative_id = m.creative_id OR (s.creative_id IS NULL AND m.creative_id IS NULL))
    AND (s.campaign_id = m.campaign_id OR (s.campaign_id IS NULL AND m.campaign_id IS NULL));

  -- ?? ?? ? ? ?? ??? ??? ??
  DELETE FROM attribution_summary a
  USING (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY channel, COALESCE(creative_id::TEXT, ''), COALESCE(campaign_id, '')
      ORDER BY computed_at DESC
    ) AS rn
    FROM attribution_summary
  ) dups
  WHERE a.id = dups.id AND dups.rn > 1;

  SELECT COUNT(*) INTO v_updated FROM attribution_summary;
  RETURN QUERY SELECT v_updated;
END;
$$;

-- ============================================================
-- 2. recompute_rfm_scores()
-- ============================================================
-- bookings ????? ??? RFM(Recency, Frequency, Monetary)
-- ??? ??? customer_rfm? UPSERT??.
-- Quintile ???? 1~5?? ????.
-- ============================================================
CREATE OR REPLACE FUNCTION recompute_rfm_scores()
RETURNS TABLE(computed INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cust RECORD;
  v_recency_20 NUMERIC;
  v_recency_40 NUMERIC;
  v_recency_60 NUMERIC;
  v_recency_80 NUMERIC;
  v_freq_20 NUMERIC;
  v_freq_40 NUMERIC;
  v_freq_60 NUMERIC;
  v_freq_80 NUMERIC;
  v_monetary_20 NUMERIC;
  v_monetary_40 NUMERIC;
  v_monetary_60 NUMERIC;
  v_monetary_80 NUMERIC;
  v_r_score INT;
  v_f_score INT;
  v_m_score INT;
  v_computed INT := 0;
BEGIN
  DELETE FROM customer_rfm;

  CREATE TEMP TABLE _rfm_agg ON COMMIT DROP AS
  SELECT
    b.lead_customer_id AS customer_id,
    MAX(b.booking_date) AS last_booking_at,
    COUNT(*) AS frequency,
    COALESCE(SUM(b.total_price), 0) AS monetary_total
  FROM bookings b
  WHERE b.lead_customer_id IS NOT NULL
    AND (b.is_deleted IS NULL OR b.is_deleted = false)
    AND (b.status IS DISTINCT FROM 'cancelled')
    AND (b.status IS DISTINCT FROM 'voided')
  GROUP BY b.lead_customer_id;

  ALTER TABLE _rfm_agg ADD COLUMN recency_days INT DEFAULT 999;
  UPDATE _rfm_agg
  SET recency_days = GREATEST(0, EXTRACT(DAY FROM (NOW() - last_booking_at))::INT)
  WHERE last_booking_at IS NOT NULL;

  ALTER TABLE _rfm_agg ADD COLUMN customer_email TEXT;
  UPDATE _rfm_agg a
  SET customer_email = c.email
  FROM customers c
  WHERE a.customer_id = c.id AND c.email IS NOT NULL;

  -- PERCENTILE_CONT? ?? ?? ? ??
  SELECT PERCENTILE_CONT(0.2) WITHIN GROUP (ORDER BY -recency_days) INTO v_recency_20 FROM _rfm_agg;
  SELECT PERCENTILE_CONT(0.4) WITHIN GROUP (ORDER BY -recency_days) INTO v_recency_40 FROM _rfm_agg;
  SELECT PERCENTILE_CONT(0.6) WITHIN GROUP (ORDER BY -recency_days) INTO v_recency_60 FROM _rfm_agg;
  SELECT PERCENTILE_CONT(0.8) WITHIN GROUP (ORDER BY -recency_days) INTO v_recency_80 FROM _rfm_agg;

  SELECT PERCENTILE_CONT(0.2) WITHIN GROUP (ORDER BY frequency) INTO v_freq_20 FROM _rfm_agg;
  SELECT PERCENTILE_CONT(0.4) WITHIN GROUP (ORDER BY frequency) INTO v_freq_40 FROM _rfm_agg;
  SELECT PERCENTILE_CONT(0.6) WITHIN GROUP (ORDER BY frequency) INTO v_freq_60 FROM _rfm_agg;
  SELECT PERCENTILE_CONT(0.8) WITHIN GROUP (ORDER BY frequency) INTO v_freq_80 FROM _rfm_agg;

  SELECT PERCENTILE_CONT(0.2) WITHIN GROUP (ORDER BY monetary_total) INTO v_monetary_20 FROM _rfm_agg;
  SELECT PERCENTILE_CONT(0.4) WITHIN GROUP (ORDER BY monetary_total) INTO v_monetary_40 FROM _rfm_agg;
  SELECT PERCENTILE_CONT(0.6) WITHIN GROUP (ORDER BY monetary_total) INTO v_monetary_60 FROM _rfm_agg;
  SELECT PERCENTILE_CONT(0.8) WITHIN GROUP (ORDER BY monetary_total) INTO v_monetary_80 FROM _rfm_agg;

  FOR v_cust IN SELECT * FROM _rfm_agg WHERE customer_id IS NOT NULL LOOP
    IF v_cust.recency_days IS NULL OR v_cust.recency_days >= 365 THEN
      v_r_score := 1;
    ELSE
      v_r_score := CASE
        WHEN (-v_cust.recency_days) >= v_recency_80 THEN 5
        WHEN (-v_cust.recency_days) >= v_recency_60 THEN 4
        WHEN (-v_cust.recency_days) >= v_recency_40 THEN 3
        WHEN (-v_cust.recency_days) >= v_recency_20 THEN 2
        ELSE 1
      END;
    END IF;

    v_f_score := CASE
      WHEN v_cust.frequency >= v_freq_80 THEN 5
      WHEN v_cust.frequency >= v_freq_60 THEN 4
      WHEN v_cust.frequency >= v_freq_40 THEN 3
      WHEN v_cust.frequency >= v_freq_20 THEN 2
      ELSE 1
    END;

    v_m_score := CASE
      WHEN v_cust.monetary_total >= v_monetary_80 THEN 5
      WHEN v_cust.monetary_total >= v_monetary_60 THEN 4
      WHEN v_cust.monetary_total >= v_monetary_40 THEN 3
      WHEN v_cust.monetary_total >= v_monetary_20 THEN 2
      ELSE 1
    END;

    INSERT INTO customer_rfm
      (customer_id, customer_email, recency_score, frequency_score, monetary_score,
       rfm_score, segment_name, last_booking_at, first_booking_at,
       frequency, monetary_total, recency_days, computed_at)
    VALUES
      (v_cust.customer_id, v_cust.customer_email,
       v_r_score, v_f_score, v_m_score,
       v_r_score + v_f_score + v_m_score,
       CASE
         WHEN v_r_score >= 4 AND v_f_score >= 4 AND v_m_score >= 4 THEN 'champions'
         WHEN v_r_score >= 4 AND v_f_score >= 1 AND v_m_score >= 1 THEN 'recent_customers'
         WHEN v_r_score >= 2 AND v_f_score >= 4 AND v_m_score >= 4 THEN 'loyal'
         WHEN v_r_score >= 2 AND v_f_score >= 2 AND v_m_score >= 2 THEN 'regular'
         WHEN v_r_score >= 4 AND v_f_score = 1 AND v_m_score = 1 THEN 'new'
         WHEN v_r_score <= 2 AND v_f_score >= 3 AND v_m_score >= 3 THEN 'at_risk'
         WHEN v_r_score <= 2 AND v_f_score <= 2 AND v_m_score <= 2 THEN 'dormant'
         WHEN v_r_score = 1 AND v_f_score = 1 AND v_m_score = 1 THEN 'lost'
         ELSE 'needs_attention'
       END,
       v_cust.last_booking_at, v_cust.last_booking_at,
       v_cust.frequency, v_cust.monetary_total, v_cust.recency_days, NOW())
    ON CONFLICT (customer_id) DO UPDATE SET
      recency_score = EXCLUDED.recency_score,
      frequency_score = EXCLUDED.frequency_score,
      monetary_score = EXCLUDED.monetary_score,
      rfm_score = EXCLUDED.rfm_score,
      segment_name = EXCLUDED.segment_name,
      last_booking_at = EXCLUDED.last_booking_at,
      frequency = EXCLUDED.frequency,
      monetary_total = EXCLUDED.monetary_total,
      recency_days = EXCLUDED.recency_days,
      computed_at = NOW();

    v_computed := v_computed + 1;
  END LOOP;

  DROP TABLE IF EXISTS _rfm_agg;
  RETURN QUERY SELECT v_computed;
END;
$$;
-- ============================================================
-- 3. auto_heal_content_gaps(p_max_per_run INT DEFAULT 3)
-- ============================================================
-- 예약이 있지만 발행 콘텐츠가 없는 활성 상품을 스캔하여
-- blog_topic_queue에 자동으로 토픽을 등록한다.
-- ============================================================
CREATE OR REPLACE FUNCTION auto_heal_content_gaps(
  p_max_per_run INT DEFAULT 3
)
RETURNS TABLE(
  scanned_packages INT,
  gaps_found INT,
  already_covered INT,
  queued INT,
  skipped_duplicate INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS \$\$
DECLARE
  v_scanned INT := 0;
  v_gaps_found INT := 0;
  v_already_covered INT := 0;
  v_queued INT := 0;
  v_skipped INT := 0;
  v_pkg RECORD;
  v_has_content BOOLEAN;
  v_in_queue BOOLEAN;
  v_in_card_news BOOLEAN;
  v_booking_count INT;
  v_topic TEXT;
BEGIN
  FOR v_pkg IN
    SELECT tp.id, tp.title, tp.destination, tp.description
    FROM travel_packages tp
    WHERE tp.status IN ('active', 'approved')
    ORDER BY tp.created_at DESC
    LIMIT 200
  LOOP
    SELECT EXISTS(
      SELECT 1 FROM content_creatives cc
      WHERE cc.product_id = v_pkg.id AND cc.status = 'published'
    ) INTO v_has_content;

    SELECT COUNT(*) INTO v_booking_count
    FROM bookings b
    WHERE b.package_id = v_pkg.id;

    v_scanned := v_scanned + 1;

    IF v_has_content OR v_booking_count = 0 THEN
      IF v_has_content THEN v_already_covered := v_already_covered + 1; END IF;
      CONTINUE;
    END IF;

    v_gaps_found := v_gaps_found + 1;

    SELECT EXISTS(
      SELECT 1 FROM blog_topic_queue btq
      WHERE btq.product_id = v_pkg.id AND btq.status IN ('pending', 'processing')
    ) INTO v_in_queue;

    SELECT EXISTS(
      SELECT 1 FROM card_news cn
      WHERE cn.product_id = v_pkg.id AND (cn.status IS NULL OR cn.status != 'draft')
    ) INTO v_in_card_news;

    IF v_in_queue OR v_in_card_news THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_topic := COALESCE(v_pkg.destination, '') || ' ' || COALESCE(v_pkg.title, '') || ' 여행 후기 및 추천';

    INSERT INTO blog_topic_queue
      (topic, source, priority, destination, product_id, status, created_at)
    VALUES
      (v_topic, 'auto_heal', 50, v_pkg.destination, v_pkg.id, 'pending', NOW());

    v_queued := v_queued + 1;
    IF v_queued >= p_max_per_run THEN EXIT; END IF;
  END LOOP;

  RETURN QUERY SELECT v_scanned, v_gaps_found, v_already_covered, v_queued, v_skipped;
END;
\$\$;

-- ============================================================
-- 4. auto_finalize_ab_experiments()
-- ============================================================
-- 실행 중인 A/B 실험 중 최소 표본(min_sample_size)을 충족하고
-- Chi-squared 검정 결과 유의미한 차이가 있는 실험을
-- 자동으로 완료(completed) 처리하고 승자를 기록한다.
-- ============================================================
CREATE OR REPLACE FUNCTION auto_finalize_ab_experiments()
RETURNS TABLE(finalized INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS \$\$
DECLARE
  v_finalized INT := 0;
  v_exp RECORD;
  v_control_conv INT;
  v_control_imp INT;
  v_test_conv INT;
  v_test_imp INT;
  v_control_nonconv INT;
  v_test_nonconv INT;
  v_total INT;
  v_expected_control_conv NUMERIC;
  v_expected_control_nonconv NUMERIC;
  v_expected_test_conv NUMERIC;
  v_expected_test_nonconv NUMERIC;
  v_chi2 NUMERIC;
  v_p_value NUMERIC;
  v_winner_variant_id UUID;
BEGIN
  FOR v_exp IN
    SELECT e.id, e.min_sample_size, e.name
    FROM ab_experiments e
    WHERE e.status = 'running'
  LOOP
    SELECT
      COALESCE(COUNT(*) FILTER (WHERE a.converted = true), 0),
      COALESCE(COUNT(*), 0)
    INTO v_control_conv, v_control_imp
    FROM ab_assignments a
    JOIN ab_variants v ON v.id = a.variant_id
    WHERE a.experiment_id = v_exp.id AND v.is_control = true;

    SELECT
      COALESCE(COUNT(*) FILTER (WHERE a.converted = true), 0),
      COALESCE(COUNT(*), 0)
    INTO v_test_conv, v_test_imp
    FROM ab_assignments a
    JOIN ab_variants v ON v.id = a.variant_id
    WHERE a.experiment_id = v_exp.id AND v.is_control = false;

    IF v_control_imp < v_exp.min_sample_size OR v_test_imp < v_exp.min_sample_size THEN
      CONTINUE;
    END IF;

    IF v_control_imp = 0 OR v_test_imp = 0 THEN
      CONTINUE;
    END IF;

    v_control_nonconv := v_control_imp - v_control_conv;
    v_test_nonconv := v_test_imp - v_test_conv;
    v_total := v_control_imp + v_test_imp;

    IF v_total <= 0 THEN CONTINUE; END IF;

    v_expected_control_conv := (v_control_imp * (v_control_conv + v_test_conv)::NUMERIC) / v_total;
    v_expected_control_nonconv := (v_control_imp * (v_control_nonconv + v_test_nonconv)::NUMERIC) / v_total;
    v_expected_test_conv := (v_test_imp * (v_control_conv + v_test_conv)::NUMERIC) / v_total;
    v_expected_test_nonconv := (v_test_imp * (v_control_nonconv + v_test_nonconv)::NUMERIC) / v_total;

    v_chi2 := 0;
    IF v_expected_control_conv > 0 THEN
      v_chi2 := v_chi2 + ((v_control_conv - v_expected_control_conv)^2) / v_expected_control_conv;
    END IF;
    IF v_expected_control_nonconv > 0 THEN
      v_chi2 := v_chi2 + ((v_control_nonconv - v_expected_control_nonconv)^2) / v_expected_control_nonconv;
    END IF;
    IF v_expected_test_conv > 0 THEN
      v_chi2 := v_chi2 + ((v_test_conv - v_expected_test_conv)^2) / v_expected_test_conv;
    END IF;
    IF v_expected_test_nonconv > 0 THEN
      v_chi2 := v_chi2 + ((v_test_nonconv - v_expected_test_nonconv)^2) / v_expected_test_nonconv;
    END IF;

    v_p_value := CASE WHEN v_chi2 <= 0 THEN 1
      ELSE LEAST(1, exp(-0.5 * v_chi2) * (1 + v_chi2 * 0.5))
    END;

    -- p-value < 0.05 이고 test variant가 control보다 전환율이 높으면 승자 선언
    IF v_p_value < 0.05 AND (v_test_conv::NUMERIC / NULLIF(v_test_imp, 0)) > (v_control_conv::NUMERIC / NULLIF(v_control_imp, 0)) THEN
      SELECT v.id INTO v_winner_variant_id
      FROM ab_variants v
      WHERE v.experiment_id = v_exp.id AND v.is_control = false
      ORDER BY (SELECT COUNT(*) FROM ab_assignments a WHERE a.variant_id = v.id AND a.converted = true) DESC
      LIMIT 1;

      UPDATE ab_experiments
      SET status = 'completed',
          winner_variant_id = v_winner_variant_id,
          completed_at = NOW(),
          updated_at = NOW()
      WHERE id = v_exp.id;

      v_finalized := v_finalized + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_finalized;
END;
\$\$;

-- ============================================================
-- 5. generate_predictive_insights()
-- ============================================================
-- keyword_trend_snapshots에서 유의미한 트렌드를 분석하여
-- predictive_insights 테이블에 인사이트 레코드를 생성한다.
-- 3단계: (a) 키워드 기회 식별 (b) 트렌드 감지/예측 (c) 인사이트 INSERT
-- ============================================================
CREATE OR REPLACE FUNCTION generate_predictive_insights()
RETURNS TABLE(insights_generated INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS \$\$
DECLARE
  v_insights_generated INT := 0;
  v_kw RECORD;
  v_prev_volume NUMERIC;
  v_current_volume NUMERIC;
  v_trend_score NUMERIC;
  v_forecast_next NUMERIC;
  v_has_content BOOLEAN;
  v_action_type TEXT;
  v_confidence_score NUMERIC;
  v_reasoning TEXT;
  v_suggestion TEXT;
BEGIN
  FOR v_kw IN
    WITH ranked AS (
      SELECT
        kts.keyword,
        kts.search_volume,
        kts.recorded_at,
        ROW_NUMBER() OVER (PARTITION BY kts.keyword ORDER BY kts.recorded_at DESC) AS rn,
        ROW_NUMBER() OVER (PARTITION BY kts.keyword ORDER BY kts.recorded_at ASC) AS rn_first
      FROM keyword_trend_snapshots kts
      WHERE kts.recorded_at >= NOW() - INTERVAL '60 days'
    ),
    current AS (
      SELECT * FROM ranked WHERE rn = 1
    ),
    previous AS (
      SELECT * FROM ranked WHERE rn_first = 1
    )
    SELECT
      c.keyword,
      c.search_volume AS current_volume,
      COALESCE(p.search_volume, 0) AS prev_volume
    FROM current c
    LEFT JOIN previous p ON p.keyword = c.keyword AND p.rn_first = 1
    WHERE c.keyword IS NOT NULL
      AND c.search_volume > 10
    ORDER BY (c.search_volume - COALESCE(p.search_volume, 0)) DESC
    LIMIT 50
  LOOP
    v_current_volume := v_kw.current_volume;
    v_prev_volume := v_kw.prev_volume;

    -- 트렌드 점수 계산 (상승률)
    IF v_prev_volume > 0 THEN
      v_trend_score := (v_current_volume - v_prev_volume) / v_prev_volume;
    ELSE
      v_trend_score := 1.0;
    END IF;

    -- 간단한 선형 예측: 다음 기간 = 현재 + (현재 - 이전)
    v_forecast_next := v_current_volume + GREATEST(0, v_current_volume - v_prev_volume);

    -- 콘텐츠 존재 여부 확인
    SELECT EXISTS(
      SELECT 1 FROM content_creatives cc
      WHERE (cc.title ILIKE '%' || v_kw.keyword || '%' OR cc.description ILIKE '%' || v_kw.keyword || '%')
        AND cc.status = 'published'
    ) INTO v_has_content;

    -- 액션 타입 결정
    IF v_trend_score > 0.5 AND NOT v_has_content THEN
      v_action_type := 'create_content';
    ELSIF v_trend_score > 0.3 AND v_forecast_next > 100 THEN
      v_action_type := 'optimize_content';
    ELSIF v_trend_score < -0.3 THEN
      v_action_type := 'monitor_decline';
    ELSE
      v_action_type := 'review';
    END IF;

    -- 신뢰도 점수 (0.0 ~ 1.0)
    v_confidence_score := LEAST(1.0, ABS(v_trend_score) * 0.7 + (v_current_volume / 1000.0) * 0.3);

    -- 추론 텍스트
    v_reasoning := v_kw.keyword || ' 키워드 검색량이 ' ||
      CASE
        WHEN v_trend_score > 0 THEN ROUND(v_trend_score * 100)::TEXT || '% 증가'
        WHEN v_trend_score < 0 THEN ROUND(ABS(v_trend_score) * 100)::TEXT || '% 감소'
        ELSE '변동 없음'
      END ||
      ' (현재: ' || ROUND(v_current_volume)::TEXT || ', 이전: ' || ROUND(v_prev_volume)::TEXT || ').';

    -- 제안 텍스트
    v_suggestion := CASE v_action_type
      WHEN 'create_content' THEN v_kw.keyword || ' 관련 콘텐츠를 신규 제작하세요. 검색량이 급증 중입니다.'
      WHEN 'optimize_content' THEN v_kw.keyword || ' 관련 기존 콘텐츠를 최적화하세요. 지속적인 관심이 예상됩니다.'
      WHEN 'monitor_decline' THEN v_kw.keyword || ' 관련 콘텐츠의 성과를 모니터링하세요. 관심도가 하락 중입니다.'
      ELSE v_kw.keyword || ' 관련 콘텐츠 전략을 검토하세요.'
    END;

    -- trend_keyword_archive에도 기록
    INSERT INTO trend_keyword_archive (keyword, search_volume, trend_score, recorded_at)
    VALUES (v_kw.keyword, ROUND(v_current_volume)::INT, ROUND(v_trend_score::NUMERIC, 4), NOW())
    ON CONFLICT (keyword, recorded_at) DO NOTHING;

    -- 중복 인사이트 방지
    IF NOT EXISTS (
      SELECT 1 FROM predictive_insights
      WHERE keyword = v_kw.keyword
        AND created_at > NOW() - INTERVAL '24 hours'
    ) THEN
      INSERT INTO predictive_insights
        (keyword, trend_score, forecast_next, action_type, confidence_score,
         reasoning, suggestion, current_volume, prev_volume, created_at)
      VALUES
        (v_kw.keyword, ROUND(v_trend_score::NUMERIC, 4),
         ROUND(v_forecast_next::NUMERIC, 0)::INT,
         v_action_type, ROUND(v_confidence_score::NUMERIC, 2),
         v_reasoning, v_suggestion,
         ROUND(v_current_volume)::INT, ROUND(v_prev_volume)::INT, NOW());

      v_insights_generated := v_insights_generated + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_insights_generated;
END;
\$\$;

-- ============================================================
-- 종료
-- ============================================================
COMMIT;

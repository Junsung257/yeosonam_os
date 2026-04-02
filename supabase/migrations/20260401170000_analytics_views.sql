-- ============================================================
-- 여소남 OS: Analytics Views & Dashboards
-- Migration: 20260401170000
--
-- 교체 (20260401110000에서 생성됨):
--   high_value_customers, at_risk_customers, product_performance_dashboard
--
-- 신규 뷰:
--   influencer_performance (인플루언서 성과)
--   campaign_roi_dashboard (캠페인 ROI)
--   conversion_funnel (전환 퍼널)
--   supplier_rankings (공급사 순위)
--
-- 수정사항 (사용자 SQL 대비):
--   - bookings.customer_id → lead_customer_id
--   - status = 'confirmed' → 실제 상태머신 값
--   - tp.name → tp.title
--   - cup.customer_lifetime_value → ltv_estimate
--   - cup.propensity_to_book/churn → propensity_scores JSONB
--   - supplier_inventory.margin_percent 미존재 → 인라인 계산
--   - supplier_performance.gross_revenue → total_revenue
--   - marketing_campaigns.channel → channels (TEXT[])
--   - conversion_funnel: 비효율 JOIN → 효율적 CTE
-- ============================================================

BEGIN;

-- 기존 뷰 DROP (컬럼 변경 시 CREATE OR REPLACE 불가)
DROP VIEW IF EXISTS high_value_customers CASCADE;
DROP VIEW IF EXISTS at_risk_customers CASCADE;
DROP VIEW IF EXISTS product_performance_dashboard CASCADE;

-- ============================================================
-- 1. VIP 고객 뷰 (재생성)
-- ============================================================
CREATE VIEW high_value_customers AS
SELECT
  c.id,
  c.name,
  c.email,
  c.phone,
  c.source,
  cup.ltv_estimate,
  cup.rfm_r, cup.rfm_f, cup.rfm_m,
  cup.rfm_segment,
  cup.lifecycle_stage,
  cup.propensity_scores->>'book' AS propensity_to_book,
  cup.engagement_score,
  cup.next_best_action,
  COUNT(DISTINCT b.id) AS total_bookings,
  COALESCE(SUM(b.total_price), 0) AS total_spent,
  COALESCE(AVG(ptr.overall_rating), 0) AS avg_rating,
  MAX(b.created_at) AS last_booking_date,
  EXTRACT(DAY FROM NOW() - MAX(b.created_at))::INTEGER AS days_since_last_booking
FROM customers c
JOIN customer_unified_profile cup ON c.id = cup.customer_id
LEFT JOIN bookings b ON c.id = b.lead_customer_id
  AND b.status IN ('deposit_paid','waiting_balance','fully_paid','confirmed','completed')
  AND b.is_deleted = false
LEFT JOIN post_trip_reviews ptr ON b.id = ptr.booking_id AND ptr.status = 'approved'
WHERE cup.ltv_estimate > 5000000 OR cup.rfm_segment IN ('Champions','Loyal')
GROUP BY c.id, c.name, c.email, c.phone, c.source,
         cup.ltv_estimate, cup.rfm_r, cup.rfm_f, cup.rfm_m,
         cup.rfm_segment, cup.lifecycle_stage,
         cup.propensity_scores, cup.engagement_score, cup.next_best_action;

-- ============================================================
-- 2. 이탈 위험 고객 뷰 (재생성)
-- ============================================================
CREATE VIEW at_risk_customers AS
SELECT
  c.id,
  c.name,
  c.email,
  c.phone,
  cup.rfm_r, cup.rfm_f, cup.rfm_m,
  cup.rfm_segment,
  cup.churn_risk_level,
  cup.propensity_scores->>'churn' AS churn_propensity,
  cup.days_since_last_booking,
  cup.total_revenue,
  COUNT(DISTINCT b.id) AS past_bookings,
  COALESCE(AVG(ptr.overall_rating), 0) AS avg_rating
FROM customers c
JOIN customer_unified_profile cup ON c.id = cup.customer_id
LEFT JOIN bookings b ON c.id = b.lead_customer_id AND b.is_deleted = false
LEFT JOIN post_trip_reviews ptr ON b.id = ptr.booking_id
WHERE cup.rfm_segment IN ('At Risk','Cant Lose Them','Hibernating','Lost')
   OR cup.churn_risk_level IN ('high','churned')
   OR cup.days_since_last_booking > 365
GROUP BY c.id, c.name, c.email, c.phone,
         cup.rfm_r, cup.rfm_f, cup.rfm_m, cup.rfm_segment,
         cup.churn_risk_level, cup.propensity_scores,
         cup.days_since_last_booking, cup.total_revenue
HAVING COUNT(DISTINCT b.id) >= 1;

-- ============================================================
-- 3. 상품 성과 대시보드 (재생성)
-- ============================================================
CREATE VIEW product_performance_dashboard AS
SELECT
  tp.id,
  tp.title,
  tp.destination,
  tp.nights,
  tp.duration,
  tp.price,
  tp.status,
  tp.view_count,
  tp.inquiry_count,
  COUNT(DISTINCT b.id) AS total_bookings,
  COALESCE(SUM(b.total_price), 0) AS total_revenue,
  COALESCE(AVG(ptr.overall_rating), 0) AS avg_rating,
  COUNT(DISTINCT ptr.id) AS review_count,
  CASE WHEN tp.view_count > 0
    THEN ROUND((COUNT(DISTINCT b.id)::NUMERIC / tp.view_count) * 100, 2)
    ELSE 0
  END AS conversion_rate,
  CASE WHEN tp.view_count > 0
    THEN ROUND((tp.inquiry_count::NUMERIC / tp.view_count) * 100, 2)
    ELSE 0
  END AS inquiry_rate,
  CASE WHEN COUNT(DISTINCT ptr.id) > 0
    THEN ROUND(COUNT(DISTINCT CASE WHEN ptr.would_recommend THEN ptr.id END)::NUMERIC / COUNT(DISTINCT ptr.id) * 100, 1)
    ELSE 0
  END AS recommendation_rate
FROM travel_packages tp
LEFT JOIN bookings b ON tp.id = b.package_id
  AND b.status IN ('deposit_paid','waiting_balance','fully_paid','confirmed','completed')
  AND b.is_deleted = false
LEFT JOIN post_trip_reviews ptr ON tp.id = ptr.package_id AND ptr.status = 'approved'
GROUP BY tp.id, tp.title, tp.destination, tp.nights, tp.duration,
         tp.price, tp.status, tp.view_count, tp.inquiry_count;

-- ============================================================
-- 4. 인플루언서 성과 (신규)
-- ============================================================
CREATE OR REPLACE VIEW influencer_performance AS
SELECT
  a.id,
  a.name,
  a.referral_code,
  a.commission_rate,
  a.grade,
  a.is_active,
  COUNT(DISTINCT c.id) AS total_referrals,
  COUNT(DISTINCT b.id) AS total_bookings,
  COALESCE(SUM(b.total_price), 0) AS total_revenue,
  COALESCE(SUM(b.influencer_commission), 0) AS total_commission,
  CASE WHEN COUNT(DISTINCT c.id) > 0
    THEN ROUND(COUNT(DISTINCT b.id)::NUMERIC / COUNT(DISTINCT c.id) * 100, 1)
    ELSE 0
  END AS conversion_rate,
  MAX(b.created_at) AS last_booking_date
FROM affiliates a
LEFT JOIN customers c ON c.referrer_id = a.id
LEFT JOIN bookings b ON b.affiliate_id = a.id
  AND b.status IN ('deposit_paid','waiting_balance','fully_paid','confirmed','completed')
  AND b.is_deleted = false
GROUP BY a.id, a.name, a.referral_code, a.commission_rate, a.grade, a.is_active
ORDER BY total_revenue DESC NULLS LAST;

-- ============================================================
-- 5. 캠페인 ROI 대시보드 (신규)
-- ============================================================
CREATE OR REPLACE VIEW campaign_roi_dashboard AS
SELECT
  mc.id,
  mc.name,
  mc.type,
  mc.channels,
  mc.status,
  mc.budget,
  mc.spent,
  mc.remaining,
  mc.impressions,
  mc.clicks,
  mc.conversions,
  mc.revenue,
  mc.ctr,
  mc.cpc,
  mc.cpa,
  mc.roas,
  CASE WHEN mc.budget > 0
    THEN ROUND(((mc.revenue - mc.spent)::NUMERIC / mc.budget) * 100, 1)
    ELSE 0
  END AS roi_percent,
  mc.start_date,
  mc.end_date
FROM marketing_campaigns mc
WHERE mc.status IN ('active','completed')
ORDER BY mc.roas DESC NULLS LAST;

-- ============================================================
-- 6. 전환 퍼널 (신규) — 효율적 CTE 방식
-- ============================================================
CREATE OR REPLACE VIEW conversion_funnel AS
WITH recent AS (
  SELECT session_id, action_type, customer_id
  FROM user_actions
  WHERE created_at >= NOW() - INTERVAL '30 days'
),
funnel AS (
  SELECT
    COUNT(DISTINCT session_id) AS total_sessions,
    COUNT(DISTINCT session_id) FILTER (WHERE action_type = 'search') AS searched,
    COUNT(DISTINCT session_id) FILTER (WHERE action_type = 'product_click') AS clicked,
    COUNT(DISTINCT session_id) FILTER (WHERE action_type = 'chat_start') AS chatted,
    COUNT(DISTINCT session_id) FILTER (WHERE action_type = 'inquiry') AS inquired
  FROM recent
),
booked AS (
  SELECT COUNT(DISTINCT b.id) AS converted
  FROM bookings b
  WHERE b.created_at >= NOW() - INTERVAL '30 days'
    AND b.status IN ('deposit_paid','waiting_balance','fully_paid','confirmed','completed')
    AND b.is_deleted = false
)
SELECT
  f.total_sessions,
  f.searched,
  f.clicked,
  f.chatted,
  f.inquired,
  bo.converted,
  CASE WHEN f.total_sessions > 0
    THEN ROUND(bo.converted::NUMERIC / f.total_sessions * 100, 2)
    ELSE 0
  END AS overall_conversion_rate,
  CASE WHEN f.searched > 0
    THEN ROUND(f.clicked::NUMERIC / f.searched * 100, 2)
    ELSE 0
  END AS search_to_click_rate,
  CASE WHEN f.clicked > 0
    THEN ROUND(bo.converted::NUMERIC / f.clicked * 100, 2)
    ELSE 0
  END AS click_to_booking_rate
FROM funnel f, booked bo;

-- ============================================================
-- 7. 공급사 순위 (신규)
-- ============================================================
CREATE OR REPLACE VIEW supplier_rankings AS
SELECT
  s.id,
  s.name,
  s.type,
  s.reliability_score,
  s.quality_score,
  s.rating,
  s.status,
  COUNT(DISTINCT si.id) AS active_inventory_count,
  CASE WHEN COUNT(si.id) > 0 AND SUM(si.cost_price) > 0
    THEN ROUND(((SUM(si.retail_price) - SUM(si.cost_price))::NUMERIC / SUM(si.cost_price)) * 100, 1)
    ELSE 0
  END AS avg_margin_percent,
  COALESCE(SUM(sp.total_revenue), 0) AS total_revenue,
  COALESCE(AVG(sp.average_rating), 0) AS avg_rating,
  COALESCE(AVG(sp.confirmed_rate), 0) AS avg_confirmed_rate
FROM suppliers s
LEFT JOIN supplier_inventory si ON s.id = si.supplier_id AND si.is_available = true
LEFT JOIN supplier_performance sp ON s.id = sp.supplier_id
WHERE s.status = 'active'
GROUP BY s.id, s.name, s.type, s.reliability_score, s.quality_score, s.rating, s.status
ORDER BY total_revenue DESC NULLS LAST;

COMMIT;

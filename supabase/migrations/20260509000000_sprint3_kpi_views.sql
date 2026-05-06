-- Sprint 3-C: KPI 통합 뷰
-- card_news × engagement_snapshots × attribution_events → 콘텐츠 KPI 원스톱 뷰

CREATE OR REPLACE VIEW v_content_kpi AS
SELECT
  cn.tenant_id,
  cn.id,
  cn.title,
  cn.variant_angle,
  cn.is_winner,
  cn.ig_post_id,
  cn.ig_published_at,
  cn.status,
  COALESCE(pes.avg_performance_score, 0) AS performance_score,
  COALESCE(att.view_count, 0)            AS views_from_content,
  COALESCE(att.inquiry_count, 0)         AS inquiries_from_content,
  COALESCE(att.booking_count, 0)         AS bookings_from_content
FROM card_news cn
LEFT JOIN (
  SELECT
    card_news_id,
    AVG(performance_score) AS avg_performance_score
  FROM post_engagement_snapshots
  GROUP BY card_news_id
) pes ON pes.card_news_id = cn.id
LEFT JOIN (
  SELECT
    content_id,
    COUNT(*) FILTER (WHERE event_type = 'view')    AS view_count,
    COUNT(*) FILTER (WHERE event_type = 'inquiry') AS inquiry_count,
    COUNT(*) FILTER (WHERE event_type = 'booking') AS booking_count
  FROM content_attribution_events
  GROUP BY content_id
) att ON att.content_id = cn.id;

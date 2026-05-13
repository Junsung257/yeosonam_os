-- P13-5 + P13-6: booking task 통계 VIEW + prompt regression fixture
-- 박제일: 2026-05-13

CREATE TABLE IF NOT EXISTS prompt_regression_fixtures (
  id              bigserial PRIMARY KEY,
  fixture_name    text UNIQUE NOT NULL,
  prompt_version  text NOT NULL,
  raw_text_snippet text NOT NULL,
  expected_fields jsonb NOT NULL,
  category        text DEFAULT 'general' CHECK (category IN ('general','price','itinerary','hotel','airline','notices','edge_case')),
  is_active       boolean DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS prompt_regression_runs (
  id              bigserial PRIMARY KEY,
  fixture_id      bigint REFERENCES prompt_regression_fixtures(id) ON DELETE CASCADE,
  prompt_version  text NOT NULL,
  passed          boolean NOT NULL,
  diff_fields     jsonb,
  llm_cost_usd    numeric(8,5),
  elapsed_ms      int,
  notes           text,
  ran_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_regression_runs_ran_at ON prompt_regression_runs(ran_at DESC);
CREATE INDEX IF NOT EXISTS idx_regression_runs_failed ON prompt_regression_runs(ran_at DESC) WHERE passed = false;

CREATE OR REPLACE VIEW booking_task_resolution_stats AS
SELECT
  task_type,
  COUNT(*)                                              AS total_tasks,
  COUNT(*) FILTER (WHERE status = 'auto_resolved')      AS auto_resolved_count,
  COUNT(*) FILTER (WHERE status = 'resolved')           AS manual_resolved_count,
  COUNT(*) FILTER (WHERE status = 'open')               AS open_count,
  ROUND(
    COUNT(*) FILTER (WHERE status = 'auto_resolved')::numeric /
    NULLIF(COUNT(*) FILTER (WHERE status IN ('auto_resolved','resolved')), 0) * 100,
    1
  )                                                      AS auto_resolve_rate_pct,
  AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 3600)
    FILTER (WHERE status = 'auto_resolved')              AS avg_auto_resolve_hours,
  MAX(updated_at)                                        AS last_update
FROM booking_tasks
WHERE created_at >= now() - interval '30 days'
GROUP BY task_type
ORDER BY total_tasks DESC;

-- Agent Office KPI lineage (read-only aggregate contract)
--
-- This migration does not add an execution or command ledger. It exposes one
-- bounded, versioned aggregate over the existing Agent Office source tables so
-- the dashboard never treats a limited detail page as a period KPI.

CREATE OR REPLACE FUNCTION public.get_agent_office_kpi_v1(
  p_window_start TIMESTAMPTZ,
  p_window_end TIMESTAMPTZ
)
RETURNS TABLE (
  metric_key TEXT,
  value NUMERIC,
  source_updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
SET statement_timeout = '5000ms'
AS $$
DECLARE
  v_source_updated_at TIMESTAMPTZ;
BEGIN
  IF p_window_start IS NULL OR p_window_end IS NULL
     OR p_window_start >= p_window_end
     OR p_window_end - p_window_start > INTERVAL '366 days' THEN
    RAISE EXCEPTION 'invalid Agent Office KPI window'
      USING ERRCODE = '22023';
  END IF;

  -- A single freshness value lets the UI explain whether the aggregate is
  -- current without exposing free-form task messages or payloads.
  SELECT MAX(source_value)
    INTO v_source_updated_at
  FROM (
    SELECT MAX(updated_at) AS source_value FROM public.agent_tasks
    UNION ALL
    SELECT MAX(COALESCE(updated_at, requested_at)) FROM public.agent_approvals
    UNION ALL
    SELECT MAX(created_at) FROM public.agent_incidents
    UNION ALL
    SELECT MAX(COALESCE(ended_at, started_at)) FROM public.agent_trace_spans
  ) AS sources;

  RETURN QUERY
  SELECT metrics.metric_key, metrics.value, v_source_updated_at
  FROM (
    VALUES
      (
        'agent.tasks.completed'::TEXT,
        (
          SELECT COUNT(*)::NUMERIC
          FROM public.agent_tasks
          WHERE status = 'done'
            AND COALESCE(completed_at, updated_at) >= p_window_start
            AND COALESCE(completed_at, updated_at) < p_window_end
        )
      ),
      (
        'agent.tasks.failed'::TEXT,
        (
          SELECT COUNT(*)::NUMERIC
          FROM public.agent_tasks
          WHERE status = 'failed'
            AND COALESCE(completed_at, updated_at) >= p_window_start
            AND COALESCE(completed_at, updated_at) < p_window_end
        )
      ),
      (
        'agent.tasks.active'::TEXT,
        (
          SELECT COUNT(*)::NUMERIC
          FROM public.agent_tasks
          WHERE status IN ('queued', 'running', 'frozen', 'resumed')
        )
      ),
      (
        'agent.approvals.pending'::TEXT,
        (
          SELECT COUNT(*)::NUMERIC
          FROM public.agent_approvals
          WHERE status = 'pending'
        )
      ),
      (
        'agent.approvals.overdue'::TEXT,
        (
          SELECT COUNT(*)::NUMERIC
          FROM public.agent_approvals
          WHERE status = 'pending'
            AND (
              expires_at <= p_window_end
              OR (
                expires_at IS NULL
                AND COALESCE(requested_at, created_at) <= p_window_end - INTERVAL '7 days'
              )
            )
        )
      ),
      (
        'agent.incidents.critical'::TEXT,
        (
          SELECT COUNT(*)::NUMERIC
          FROM public.agent_incidents
          WHERE severity = 'critical'
            AND created_at >= p_window_start
            AND created_at < p_window_end
        )
      ),
      (
        'agent.trace.p95_duration_ms'::TEXT,
        (
          SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)::NUMERIC
          FROM public.agent_trace_spans
          WHERE duration_ms IS NOT NULL
            AND duration_ms >= 0
            AND ended_at IS NOT NULL
            AND started_at >= p_window_start
            AND started_at < p_window_end
        )
      ),
      (
        'agent.workrooms.multi_agent'::TEXT,
        (
          SELECT COUNT(*)::NUMERIC
          FROM (
            SELECT correlation_id
            FROM public.agent_tasks
            WHERE updated_at >= p_window_start
              AND updated_at < p_window_end
            GROUP BY correlation_id
            HAVING COUNT(*) > 1
               AND COUNT(DISTINCT COALESCE(specialist_id, agent_type)) > 1
          ) AS workrooms
        )
      )
  ) AS metrics(metric_key, value);
END;
$$;

COMMENT ON FUNCTION public.get_agent_office_kpi_v1(TIMESTAMPTZ, TIMESTAMPTZ)
  IS 'Agent Office KPI v1. Existing ledgers only; read-only, versioned, and never an execution/approval authority.';

REVOKE ALL ON FUNCTION public.get_agent_office_kpi_v1(TIMESTAMPTZ, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_agent_office_kpi_v1(TIMESTAMPTZ, TIMESTAMPTZ)
  TO service_role;

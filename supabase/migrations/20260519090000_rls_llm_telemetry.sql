-- ============================================================================
-- RLS for LLM telemetry tables (critique_results, response_feedback)
-- ============================================================================
-- Supabase advisor flagged these as ERROR/sensitive_columns_exposed:
--   - public.critique_results — session_id exposed via API without RLS
--   - public.response_feedback — session_id exposed via API without RLS
--
-- Both tables contain LLM observability data: session correlation IDs, redacted
-- replies, hashes of user questions. Anonymous read access leaks conversation
-- linkage and rating telemetry.
--
-- Strategy: enable RLS; only service_role bypasses (server-side writes/reads).
-- No public-facing access is needed — these tables are write-only from API
-- routes and read-only from admin dashboards (which use service_role).
-- ============================================================================

-- ─── critique_results ───────────────────────────────────────────────────────
ALTER TABLE public.critique_results ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS by default in Supabase, but adding an explicit
-- policy documents intent and protects against role escalation surprises.
DROP POLICY IF EXISTS critique_results_service_role_all ON public.critique_results;
CREATE POLICY critique_results_service_role_all
  ON public.critique_results
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.critique_results IS
'LLM critique outputs (Supervisor stage gating decisions). Service-role-only. PII: session_id, conversation_id correlate to user sessions.';

-- ─── response_feedback ──────────────────────────────────────────────────────
ALTER TABLE public.response_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS response_feedback_service_role_all ON public.response_feedback;
CREATE POLICY response_feedback_service_role_all
  ON public.response_feedback
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.response_feedback IS
'User/LLM ratings on LLM replies (1-5 stars + comments). Service-role-only. PII: session_id, rater_id may correlate to users.';

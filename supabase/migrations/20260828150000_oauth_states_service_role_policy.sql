BEGIN;

-- Keep oauth callback state inaccessible to browser roles while making the
-- server-only boundary explicit for RLS-aware tooling and future grants.
ALTER TABLE public.oauth_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.oauth_states FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.oauth_states TO service_role;

DROP POLICY IF EXISTS oauth_states_service_role_all ON public.oauth_states;
CREATE POLICY oauth_states_service_role_all
  ON public.oauth_states
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMIT;

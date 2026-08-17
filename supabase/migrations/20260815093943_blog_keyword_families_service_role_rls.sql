-- Restrict the server-owned keyword-family registry to the service role.
-- The preceding create migration used role-agnostic policies and is retained
-- unchanged as migration history. This migration is intentionally idempotent.

BEGIN;

ALTER TABLE public.blog_keyword_families ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blog_keyword_family_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_blog_keyword_families"
  ON public.blog_keyword_families;
DROP POLICY IF EXISTS "allow_all_blog_keyword_family_members"
  ON public.blog_keyword_family_members;
DROP POLICY IF EXISTS "service_role_blog_keyword_families"
  ON public.blog_keyword_families;
DROP POLICY IF EXISTS "service_role_blog_keyword_family_members"
  ON public.blog_keyword_family_members;

REVOKE ALL ON TABLE public.blog_keyword_families
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.blog_keyword_family_members
  FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.blog_keyword_families TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.blog_keyword_family_members TO service_role;

CREATE POLICY "service_role_blog_keyword_families"
  ON public.blog_keyword_families
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "service_role_blog_keyword_family_members"
  ON public.blog_keyword_family_members
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

COMMIT;

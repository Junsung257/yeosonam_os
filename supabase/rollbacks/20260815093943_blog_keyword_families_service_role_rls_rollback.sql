-- Emergency rollback only. This restores the historical broad policy and
-- therefore must not be used as the normal application rollback path.

BEGIN;

DROP POLICY IF EXISTS "service_role_blog_keyword_families"
  ON public.blog_keyword_families;
DROP POLICY IF EXISTS "service_role_blog_keyword_family_members"
  ON public.blog_keyword_family_members;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.blog_keyword_families TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.blog_keyword_family_members TO anon, authenticated;

CREATE POLICY "allow_all_blog_keyword_families"
  ON public.blog_keyword_families
  FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "allow_all_blog_keyword_family_members"
  ON public.blog_keyword_family_members
  FOR ALL
  USING (true)
  WITH CHECK (true);

COMMIT;

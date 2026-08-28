-- Forward-only hardening for environments where media_assets_v1 was already
-- applied before the explicit service-role policy and self-FK index were added.
-- Fresh databases create the same objects in media_assets_v1, so this is a no-op.

ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.media_assets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.media_assets TO service_role;

DROP POLICY IF EXISTS media_assets_service_role_all ON public.media_assets;
CREATE POLICY media_assets_service_role_all
  ON public.media_assets
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS media_assets_superseded_by_idx
  ON public.media_assets (superseded_by)
  WHERE superseded_by IS NOT NULL;

-- Editorial and price sources do not receive official authority, but their
-- domains must still be reviewed before automatic evidence can use them.

CREATE TABLE public.blog_information_reputable_source_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hostname text NOT NULL UNIQUE,
  source_types text[] NOT NULL,
  intents text[] NOT NULL,
  allow_subdomains boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  reviewed_by text NOT NULL,
  reviewed_at timestamptz NOT NULL,
  review_note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT blog_information_reputable_source_registry_hostname CHECK (
    hostname = lower(hostname)
    AND hostname = rtrim(hostname, '.')
    AND hostname ~ '^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$'
    AND hostname !~ '\.\.'
  ),
  CONSTRAINT blog_information_reputable_source_registry_types CHECK (
    cardinality(source_types) > 0
  ),
  CONSTRAINT blog_information_reputable_source_registry_intents CHECK (
    cardinality(intents) > 0
  )
);

INSERT INTO public.blog_information_reputable_source_registry (
  hostname,
  source_types,
  intents,
  allow_subdomains,
  status,
  reviewed_by,
  reviewed_at,
  review_note
)
VALUES
  ('skyscanner.co.kr', ARRAY['reputable_price_source'], ARRAY['hotel_areas', 'family_budget'], true, 'active', 'codex_reputable_source_audit', '2026-07-24T00:00:00Z', 'Metasearch price pages; values remain freshness-gated.'),
  ('koreanair.com', ARRAY['reputable_price_source'], ARRAY['family_budget'], true, 'active', 'codex_reputable_source_audit', '2026-07-24T00:00:00Z', 'Airline first-party fare pages.'),
  ('hotelscombined.co.kr', ARRAY['reputable_price_source'], ARRAY['hotel_areas', 'family_budget'], true, 'active', 'codex_reputable_source_audit', '2026-07-24T00:00:00Z', 'Hotel metasearch price pages; values remain freshness-gated.'),
  ('hotels.com', ARRAY['reputable_price_source'], ARRAY['hotel_areas', 'family_budget'], true, 'active', 'codex_reputable_source_audit', '2026-07-24T00:00:00Z', 'Hotel booking and destination price pages.'),
  ('booking.com', ARRAY['reputable_price_source'], ARRAY['hotel_areas'], true, 'active', 'codex_reputable_source_audit', '2026-07-24T00:00:00Z', 'Hotel booking price pages.'),
  ('agoda.com', ARRAY['reputable_price_source'], ARRAY['hotel_areas'], true, 'active', 'codex_reputable_source_audit', '2026-07-24T00:00:00Z', 'Hotel booking price pages.')
ON CONFLICT (hostname) DO UPDATE
SET
  source_types = EXCLUDED.source_types,
  intents = EXCLUDED.intents,
  allow_subdomains = EXCLUDED.allow_subdomains,
  status = EXCLUDED.status,
  reviewed_by = EXCLUDED.reviewed_by,
  reviewed_at = EXCLUDED.reviewed_at,
  review_note = EXCLUDED.review_note,
  updated_at = now();

ALTER TABLE public.blog_information_reputable_source_registry ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.blog_information_reputable_source_registry FROM public, anon, authenticated;
GRANT SELECT ON TABLE public.blog_information_reputable_source_registry TO service_role;

CREATE POLICY blog_information_reputable_source_registry_service_select
  ON public.blog_information_reputable_source_registry
  FOR SELECT TO service_role
  USING (true);

COMMENT ON TABLE public.blog_information_reputable_source_registry IS
  'Reviewed non-official web domains eligible for automatic editorial or price evidence.';

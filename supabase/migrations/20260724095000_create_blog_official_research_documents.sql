-- Domain trust and document relevance are separate decisions. This table makes
-- every directly fetched page reviewable and scopes it to explicit intents.

CREATE TABLE public.blog_information_official_research_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  official_source_registry_id uuid NOT NULL
    REFERENCES public.blog_information_official_source_registry(id) ON DELETE CASCADE,
  source_url text NOT NULL,
  intents text[] NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  reviewed_by text NOT NULL,
  reviewed_at timestamptz NOT NULL,
  review_note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT blog_information_official_research_documents_https CHECK (
    source_url ~ '^https://'
  ),
  CONSTRAINT blog_information_official_research_documents_intents CHECK (
    cardinality(intents) > 0
  ),
  UNIQUE (official_source_registry_id, source_url)
);

WITH reviewed_documents(hostname, source_type, source_url, intents, review_note) AS (
  VALUES
    ('guamairport.com', 'airport', 'https://www.guamairport.com/passenger/ground-transportation', ARRAY['airport_transport'], 'Airport ground transportation overview.'),
    ('guamairport.com', 'airport', 'https://www.guamairport.com/passenger/ground-transportation/taxis', ARRAY['airport_transport'], 'Airport-authorized taxi directory.'),
    ('grta.guam.gov', 'transport_operator', 'https://grta.guam.gov/list_lines', ARRAY['airport_transport', 'itinerary'], 'GRTA route list; may reject automated access and is reported as a fetch failure.'),
    ('worldweather.wmo.int', 'meteorological_agency', 'https://worldweather.wmo.int/kr/city.html?cityId=1954', ARRAY['monthly_weather'], 'WWIS Guam city context page.'),
    ('worldweather.wmo.int', 'meteorological_agency', 'https://worldweather.wmo.int/kr/json/1954_kr.xml', ARRAY['monthly_weather'], 'WWIS machine-readable Guam forecast and climate normals.'),
    ('kakaomobility.com', 'transport_operator', 'https://www.kakaomobility.com/service-kakaot/guam-taxi', ARRAY['airport_transport'], 'Kakao T Guam taxi service terms.'),
    ('visitguam.com', 'official_tourism', 'https://www.visitguam.com/about-guam/entry-and-exit-formalities/', ARRAY['entry_requirements'], 'Guam Visitors Bureau entry formalities.'),
    ('visitguam.com', 'official_tourism', 'https://www.visitguam.com/planning/traveler-essentials/language-and-currency/', ARRAY['currency_payment'], 'Guam Visitors Bureau language and currency page.'),
    ('cbp.gov', 'immigration', 'https://www.cbp.gov/travel/international-visitors/esta', ARRAY['entry_requirements'], 'CBP ESTA requirements.'),
    ('cbp.gov', 'immigration', 'https://www.help.cbp.gov/s/article/Article-1441?language=en_US', ARRAY['entry_requirements'], 'CBP Guam-CNMI ESTA FAQ; JS rendering may prevent extraction.'),
    ('cbp.gov', 'immigration', 'https://www.cbp.gov/sites/default/files/2025-03/guam-cnmi_20241125.pdf', ARRAY['entry_requirements'], 'CBP G-CNMI eTA implementation bulletin.'),
    ('cbp.gov', 'customs', 'https://www.cbp.gov/travel/international-visitors/know-before-you-visit/customs-duty-information', ARRAY['entry_requirements', 'shopping_souvenirs'], 'CBP customs duty information.'),
    ('cqa.guam.gov', 'customs', 'https://cqa.guam.gov/', ARRAY['entry_requirements', 'shopping_souvenirs'], 'Guam Customs and Quarantine Agency.'),
    ('ecfr.gov', 'government', 'https://www.ecfr.gov/api/versioner/v1/full/2026-07-22/title-8.xml?part=212', ARRAY['entry_requirements'], 'Current eCFR 8 CFR Part 212 XML snapshot.')
)
INSERT INTO public.blog_information_official_research_documents (
  official_source_registry_id,
  source_url,
  intents,
  status,
  reviewed_by,
  reviewed_at,
  review_note
)
SELECT
  registry.id,
  document.source_url,
  document.intents,
  'active',
  'codex_official_source_audit',
  '2026-07-24T00:00:00Z',
  document.review_note
FROM reviewed_documents document
JOIN public.blog_information_official_source_registry registry
  ON registry.hostname = document.hostname
 AND registry.source_type = document.source_type
ON CONFLICT (official_source_registry_id, source_url) DO UPDATE
SET
  intents = EXCLUDED.intents,
  status = EXCLUDED.status,
  reviewed_by = EXCLUDED.reviewed_by,
  reviewed_at = EXCLUDED.reviewed_at,
  review_note = EXCLUDED.review_note,
  updated_at = now();

ALTER TABLE public.blog_information_official_research_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.blog_information_official_research_documents FROM public, anon, authenticated;
GRANT SELECT ON TABLE public.blog_information_official_research_documents TO service_role;

CREATE POLICY blog_information_official_research_documents_service_select
  ON public.blog_information_official_research_documents
  FOR SELECT TO service_role
  USING (true);

COMMENT ON TABLE public.blog_information_official_research_documents IS
  'Admin-reviewed direct-research pages with explicit informational intent scope.';

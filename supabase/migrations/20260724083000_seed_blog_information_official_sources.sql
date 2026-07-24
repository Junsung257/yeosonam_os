-- Reviewed first-party sources for the currently active Guam informational queue.
-- Each host was verified against its live organization/agency imprint on 2026-07-24.

BEGIN;

INSERT INTO public.blog_information_official_source_registry (
  hostname,
  source_type,
  authority_level,
  allow_subdomains,
  status,
  reviewed_by,
  reviewed_at,
  review_note
)
VALUES
  (
    'guamairport.com',
    'airport',
    'official_primary',
    true,
    'active',
    'codex_official_source_audit',
    '2026-07-24T00:00:00Z',
    'A.B. Won Pat International Airport Authority passenger and ground-transportation site.'
  ),
  (
    'grta.guam.gov',
    'transport_operator',
    'official_primary',
    false,
    'active',
    'codex_official_source_audit',
    '2026-07-24T00:00:00Z',
    'Guam Regional Transit Authority official route and schedule site.'
  ),
  (
    'weather.gov',
    'meteorological_agency',
    'official_primary',
    true,
    'active',
    'codex_official_source_audit',
    '2026-07-24T00:00:00Z',
    'U.S. National Weather Service and NWS Tiyan Guam official observations and forecasts.'
  ),
  (
    'visitguam.com',
    'official_tourism',
    'official_primary',
    true,
    'active',
    'codex_official_source_audit',
    '2026-07-24T00:00:00Z',
    'Guam Visitors Bureau official destination site.'
  ),
  (
    'welcometoguam.co.kr',
    'official_tourism',
    'official_primary',
    true,
    'active',
    'codex_official_source_audit',
    '2026-07-24T00:00:00Z',
    'Guam Visitors Bureau official Korean-language destination site.'
  ),
  (
    'cbp.gov',
    'immigration',
    'official_primary',
    true,
    'active',
    'codex_official_source_audit',
    '2026-07-24T00:00:00Z',
    'U.S. Customs and Border Protection official Guam-CNMI entry guidance.'
  ),
  (
    'cbp.gov',
    'customs',
    'official_primary',
    true,
    'active',
    'codex_official_source_audit',
    '2026-07-24T00:00:00Z',
    'U.S. Customs and Border Protection official customs guidance.'
  ),
  (
    'cqa.guam.gov',
    'customs',
    'official_primary',
    false,
    'active',
    'codex_official_source_audit',
    '2026-07-24T00:00:00Z',
    'Guam Customs and Quarantine Agency official declaration and import-requirements site.'
  )
ON CONFLICT (hostname, source_type) DO UPDATE
SET
  authority_level = EXCLUDED.authority_level,
  allow_subdomains = EXCLUDED.allow_subdomains,
  status = EXCLUDED.status,
  reviewed_by = EXCLUDED.reviewed_by,
  reviewed_at = EXCLUDED.reviewed_at,
  review_note = EXCLUDED.review_note,
  updated_at = now();

COMMIT;

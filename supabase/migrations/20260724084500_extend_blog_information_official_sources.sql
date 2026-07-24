-- Additional first-party sources discovered by the live category canaries.

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
    'worldweather.wmo.int',
    'meteorological_agency',
    'official_primary',
    false,
    'active',
    'codex_official_source_audit',
    '2026-07-24T00:00:00Z',
    'World Meteorological Organization World Weather Information Service city climate pages.'
  ),
  (
    'kakaomobility.com',
    'transport_operator',
    'official_primary',
    true,
    'active',
    'codex_official_source_audit',
    '2026-07-24T00:00:00Z',
    'Kakao Mobility first-party Kakao T Guam taxi service page.'
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

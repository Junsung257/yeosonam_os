-- Current federal rules provide the nationality, 45-day, return-ticket, and
-- electronic-authorization conditions that generic ESTA guidance omits.

INSERT INTO public.blog_information_official_source_registry (
  hostname,
  source_type,
  authority_level,
  allow_subdomains,
  status,
  reviewed_by,
  reviewed_at,
  review_note,
  research_urls
)
VALUES (
  'ecfr.gov',
  'government',
  'official_secondary',
  true,
  'active',
  'codex_official_source_audit',
  '2026-07-24T00:00:00Z',
  'Electronic Code of Federal Regulations, current 8 CFR 212.1 Guam-CNMI rules.',
  ARRAY['https://www.ecfr.gov/current/title-8/chapter-I/subchapter-B/part-212/section-212.1']
)
ON CONFLICT (hostname, source_type) DO UPDATE
SET
  authority_level = EXCLUDED.authority_level,
  allow_subdomains = EXCLUDED.allow_subdomains,
  status = EXCLUDED.status,
  reviewed_by = EXCLUDED.reviewed_by,
  reviewed_at = EXCLUDED.reviewed_at,
  review_note = EXCLUDED.review_note,
  research_urls = EXCLUDED.research_urls,
  updated_at = now();

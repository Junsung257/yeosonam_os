-- Currency/payment guidance is limited to explicit U.S. government and Guam
-- Visitors Bureau statements rather than inference from a page title.

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
VALUES (
  'usa.gov',
  'government',
  'official_primary',
  true,
  'active',
  'codex_official_source_audit',
  '2026-07-24T00:00:00Z',
  'Official U.S. government currency guidance for the United States and its territories.'
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

WITH reviewed_documents(hostname, source_type, source_url, intents, review_note) AS (
  VALUES
    ('usa.gov', 'government', 'https://www.usa.gov/currency', ARRAY['currency_payment'], 'USD is the official currency of the U.S. and its territories.'),
    ('visitguam.com', 'official_tourism', 'https://www.visitguam.com/smscormoranguam/sms-diving-in-guam/', ARRAY['currency_payment'], 'Guam Visitors Bureau states Guam uses USD and major credit cards are accepted.')
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

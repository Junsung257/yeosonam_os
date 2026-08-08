-- Affiliate portal V2 release validation (read-only).
-- This file never updates partner, publication, domain, or consent rows.

SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (table_name IN ('affiliate_terms_acceptances', 'affiliate_saved_products', 'affiliate_collections', 'affiliate_collection_products')
    OR (table_name = 'affiliates' AND column_name IN ('payout_profile_status', 'tax_profile_status', 'onboarding_progress')))
ORDER BY table_name, ordinal_position;

SELECT count(*) AS invalid_profile_status_rows
FROM public.affiliates
WHERE payout_profile_status NOT IN ('NOT_SUBMITTED', 'PENDING_REVIEW', 'VERIFIED', 'CHANGES_REQUIRED', 'LOCKED')
   OR tax_profile_status NOT IN ('NOT_SUBMITTED', 'PENDING_REVIEW', 'VERIFIED', 'CHANGES_REQUIRED', 'LOCKED');

SELECT affiliate_id, product_id, count(*) AS duplicate_saved_rows
FROM public.affiliate_saved_products
GROUP BY affiliate_id, product_id
HAVING count(*) > 1;

SELECT affiliate_id, idempotency_key, count(*) AS duplicate_channel_commands
FROM public.affiliate_channels
WHERE idempotency_key IS NOT NULL
GROUP BY affiliate_id, idempotency_key
HAVING count(*) > 1;

SELECT affiliate_id, idempotency_key, count(*) AS duplicate_domain_commands
FROM public.affiliate_domains
WHERE idempotency_key IS NOT NULL
GROUP BY affiliate_id, idempotency_key
HAVING count(*) > 1;

SELECT count(*) AS publications_without_owner
FROM public.affiliate_publications p
LEFT JOIN public.affiliates a ON a.id = p.affiliate_id
WHERE a.id IS NULL;

SELECT count(*) AS publications_with_invalid_status
FROM public.affiliate_publications
WHERE status NOT IN ('DRAFT', 'TESTED', 'PUBLISHED', 'PAUSED', 'BROKEN', 'RETIRED');

-- Release gate: browser roles must not have direct access to portal tables.
SELECT table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('affiliate_terms_acceptances', 'affiliate_saved_products', 'affiliate_collections', 'affiliate_collection_products')
  AND grantee IN ('anon', 'authenticated', 'PUBLIC');

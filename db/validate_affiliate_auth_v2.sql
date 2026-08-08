-- Affiliate Auth V2 deployment validation (read-only).
-- Run after applying 20260808135026_affiliate_auth_sessions_v2.sql.
-- This script never rotates credentials or changes production data.

-- 1) Required columns and tables.
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    table_name IN ('affiliate_invitations', 'affiliate_sessions', 'notification_outbox')
    OR (table_name = 'affiliates' AND column_name IN ('token_version', 'credentials_rotated_at'))
  )
ORDER BY table_name, ordinal_position;

-- 2) Release blocker: must reach zero only after each partner received a V2
-- invitation through the credential-rotation admin action.
SELECT
  count(*) FILTER (WHERE portal_pin IS NOT NULL) AS plaintext_pin_rows,
  count(*) FILTER (WHERE pin_hash IS NOT NULL) AS legacy_pin_hash_rows,
  count(*) FILTER (
    WHERE portal_pin IS NOT NULL OR pin_hash IS NOT NULL
  ) AS partners_requiring_rotation
FROM public.affiliates;

-- 3) No live session may outlive partner restriction or token rotation.
SELECT count(*) AS invalid_live_sessions
FROM public.affiliate_sessions s
JOIN public.affiliates a ON a.id = s.affiliate_id
WHERE s.revoked_at IS NULL
  AND s.expires_at > now()
  AND (
    a.is_active = false
    OR a.partner_status IN ('suspended', 'terminated')
    OR a.token_version <> s.token_version
  );

-- 4) At most one usable invitation per partner.
SELECT affiliate_id, count(*) AS live_invitation_count
FROM public.affiliate_invitations
WHERE used_at IS NULL
  AND revoked_at IS NULL
  AND expires_at > now()
GROUP BY affiliate_id
HAVING count(*) > 1;

-- 5) Browser roles must have no direct grants.
SELECT table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('affiliate_invitations', 'affiliate_sessions', 'notification_outbox')
  AND grantee IN ('anon', 'authenticated', 'PUBLIC')
ORDER BY table_name, grantee, privilege_type;

-- Expected release-gate results after credential rotation:
--   plaintext_pin_rows = 0
--   legacy_pin_hash_rows = 0
--   partners_requiring_rotation = 0
--   invalid_live_sessions = 0
--   duplicate live invitation query = 0 rows
--   browser grants query = 0 rows


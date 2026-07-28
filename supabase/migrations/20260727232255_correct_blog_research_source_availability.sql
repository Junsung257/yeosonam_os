-- Production direct-fetch verification on 2026-07-28 found that
-- budgetyourtrip.com returns HTTP 403 to the research worker. Revoke it until
-- a permitted, directly retrievable source path is reviewed.
update public.blog_information_reputable_source_registry
set
  status = 'revoked',
  review_note = 'Revoked 2026-07-28: production reviewed-page fetch returned HTTP 403. Do not use until a permitted direct-fetch path is reviewed.',
  reviewed_by = 'codex_live_source_availability_audit',
  reviewed_at = now(),
  updated_at = now()
where hostname = 'budgetyourtrip.com';

-- Wikivoyage destination pages commonly separate Eat guidance into budget,
-- mid-range, and splurge sections. It remains corroboration-only and cannot
-- satisfy high-risk or sole-source claims.
update public.blog_information_reputable_source_registry
set
  intents = (
    select array_agg(distinct intent order by intent)
    from unnest(
      public.blog_information_reputable_source_registry.intents
      || array['food_budget']
    ) as merged(intent)
  ),
  review_note = 'Collaboratively maintained destination guidance. Food sections may corroborate meal tiers, but every price remains a checked-date estimate and requires a second reviewed domain. Never use as sole high-risk evidence.',
  reviewed_by = 'codex_live_source_availability_audit',
  reviewed_at = now(),
  updated_at = now()
where hostname = 'wikivoyage.org'
  and status = 'active';

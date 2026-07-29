-- The curated menu registry row is stored at the parent hostname because
-- subdomains are allowed. A previous correction targeted the page hostname,
-- so it matched no row and family-budget research could not fetch meal facts.
update public.blog_information_reputable_source_registry
set
  intents = (
    select array_agg(distinct intent order by intent)
    from unnest(
      public.blog_information_reputable_source_registry.intents
      || array['family_budget']
    ) as merged(intent)
  ),
  reviewed_by = 'codex_family_budget_meal_scope_correction',
  reviewed_at = now(),
  review_note = 'First-party checked-date breakfast and beverage menu. Use exact meal or snack samples only; never infer a destination average.',
  updated_at = now()
where hostname = 'menuguam.com'
  and status = 'active'
  and 'https://chinfe.menuguam.com/' = any(research_urls);

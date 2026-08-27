const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;

function required(environment, key) {
  const value = environment[key]?.trim();
  if (!value) throw new Error(`missing_${key}`);
  return value;
}

/**
 * Resolve the only Supabase target that the V4 Preview configurator may use.
 *
 * The generic SUPABASE_* variables are intentionally not accepted here. A
 * Preview deployment must be bound to an explicitly named staging project
 * and its URL must resolve to that same project ref.
 */
export function resolvePreviewSupabaseTarget(environment) {
  const stagingProjectRef = required(environment, 'BLOG_STAGING_SUPABASE_PROJECT_REF').toLowerCase();
  const productionProjectRef = required(
    environment,
    'BLOG_PRODUCTION_SUPABASE_PROJECT_REF',
  ).toLowerCase();
  const stagingUrl = required(environment, 'BLOG_STAGING_SUPABASE_URL');

  if (!PROJECT_REF_PATTERN.test(stagingProjectRef)) {
    throw new Error('invalid_blog_staging_supabase_project_ref');
  }
  if (!PROJECT_REF_PATTERN.test(productionProjectRef)) {
    throw new Error('invalid_blog_production_supabase_project_ref');
  }
  if (stagingProjectRef === productionProjectRef) {
    throw new Error('blog_preview_production_supabase_ref_forbidden');
  }

  let parsed;
  try {
    parsed = new URL(stagingUrl);
  } catch {
    throw new Error('invalid_blog_staging_supabase_url');
  }

  if (
    parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
    || parsed.port
    || (parsed.pathname !== '/' && parsed.pathname !== '')
    || parsed.search
    || parsed.hash
    || parsed.hostname.toLowerCase() !== `${stagingProjectRef}.supabase.co`
  ) {
    throw new Error('blog_preview_staging_supabase_target_mismatch');
  }

  return {
    projectRef: stagingProjectRef,
    productionProjectRef,
    url: `https://${stagingProjectRef}.supabase.co`,
  };
}

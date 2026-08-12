const DEFAULT_PRODUCTION_PROJECT_REF = 'ixaxnvbmhzjvupissmly';
const REQUIRED_CONFIRMATION = 'STAGING_SNAPSHOT_REFRESH_ALLOWED';
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;

type StagingRuntimeEnvironment = Record<string, string | undefined>;

export type BlogStagingRuntimeTarget = {
  projectRef: string;
  url: string;
};

function required(environment: StagingRuntimeEnvironment, key: string): string {
  const value = environment[key]?.trim();
  if (!value) throw new Error(`blog_staging_runtime_${key.toLowerCase()}_missing`);
  return value;
}

export function extractSupabaseProjectRef(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('blog_staging_runtime_supabase_url_invalid');
  }

  if (
    parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
    || parsed.port
    || (parsed.pathname !== '/' && parsed.pathname !== '')
    || parsed.search
    || parsed.hash
  ) {
    throw new Error('blog_staging_runtime_supabase_url_not_direct_project_origin');
  }

  const match = parsed.hostname.toLowerCase().match(/^([a-z0-9]{20})\.supabase\.co$/);
  if (!match?.[1]) throw new Error('blog_staging_runtime_supabase_project_ref_unavailable');
  return match[1];
}

export function assertBlogStagingRuntimeTarget(
  environment: StagingRuntimeEnvironment,
): BlogStagingRuntimeTarget {
  if (environment.BLOG_STAGING_RUNTIME_VERIFY_CONFIRM !== REQUIRED_CONFIRMATION) {
    throw new Error('blog_staging_runtime_confirmation_missing');
  }

  const url = required(environment, 'SUPABASE_URL');
  required(environment, 'SUPABASE_SERVICE_ROLE_KEY');
  required(environment, 'SUPABASE_ANON_KEY');

  const expectedProjectRef = required(environment, 'BLOG_STAGING_SUPABASE_PROJECT_REF').toLowerCase();
  if (!PROJECT_REF_PATTERN.test(expectedProjectRef)) {
    throw new Error('blog_staging_runtime_expected_project_ref_invalid');
  }

  const productionProjectRef = (
    environment.BLOG_PRODUCTION_SUPABASE_PROJECT_REF?.trim().toLowerCase()
    || DEFAULT_PRODUCTION_PROJECT_REF
  );
  if (!PROJECT_REF_PATTERN.test(productionProjectRef)) {
    throw new Error('blog_staging_runtime_production_project_ref_invalid');
  }
  if (expectedProjectRef === productionProjectRef) {
    throw new Error('blog_staging_runtime_production_project_forbidden');
  }

  const actualProjectRef = extractSupabaseProjectRef(url);
  if (actualProjectRef !== expectedProjectRef) {
    throw new Error('blog_staging_runtime_project_ref_mismatch');
  }

  return { projectRef: actualProjectRef, url };
}

export const BLOG_STAGING_RUNTIME_CONFIRMATION = REQUIRED_CONFIRMATION;

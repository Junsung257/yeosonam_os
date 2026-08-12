const REQUIRED_CONFIRMATION = 'STAGING_SNAPSHOT_REFRESH_ALLOWED';
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;
const MANAGEMENT_API_ORIGIN = 'https://api.supabase.com';
const MANAGEMENT_API_TIMEOUT_MS = 10_000;

type StagingRuntimeEnvironment = Record<string, string | undefined>;

export type BlogStagingRuntimeTarget = {
  branchName: string;
  productionProjectRef: string;
  projectRef: string;
  url: string;
};

export type VerifiedBlogStagingBranchMetadata = {
  branchName: string;
  isDefault: false;
  parentProjectRef: string;
  persistent: false;
  projectRef: string;
  status: string | null;
  withData: false;
};

function required(environment: StagingRuntimeEnvironment, key: string): string {
  const value = environment[key]?.trim();
  if (!value) throw new Error(`blog_staging_runtime_${key.toLowerCase()}_missing`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
  required(environment, 'SUPABASE_ACCESS_TOKEN');

  const branchName = required(environment, 'BLOG_STAGING_SUPABASE_BRANCH_NAME');
  if (branchName.length > 120 || /[\u0000-\u001f\u007f]/.test(branchName)) {
    throw new Error('blog_staging_runtime_branch_name_invalid');
  }

  const expectedProjectRef = required(environment, 'BLOG_STAGING_SUPABASE_PROJECT_REF').toLowerCase();
  if (!PROJECT_REF_PATTERN.test(expectedProjectRef)) {
    throw new Error('blog_staging_runtime_expected_project_ref_invalid');
  }

  const productionProjectRef = required(
    environment,
    'BLOG_PRODUCTION_SUPABASE_PROJECT_REF',
  ).toLowerCase();
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

  return {
    branchName,
    productionProjectRef,
    projectRef: actualProjectRef,
    url,
  };
}

export async function verifyBlogStagingBranchMetadata(
  target: BlogStagingRuntimeTarget,
  environment: StagingRuntimeEnvironment,
  fetchImpl: typeof fetch = fetch,
): Promise<VerifiedBlogStagingBranchMetadata> {
  const accessToken = required(environment, 'SUPABASE_ACCESS_TOKEN');
  const endpoint = `${MANAGEMENT_API_ORIGIN}/v1/projects/${target.productionProjectRef}`
    + `/branches/${encodeURIComponent(target.branchName)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MANAGEMENT_API_TIMEOUT_MS);

  let response: Response;
  let rawBody: string;
  try {
    response = await fetchImpl(endpoint, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      method: 'GET',
      signal: controller.signal,
    });
    rawBody = await response.text();
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('blog_staging_runtime_management_api_timeout');
    }
    throw new Error(
      `blog_staging_runtime_management_api_unreachable:${error instanceof Error ? error.name : 'unknown'}`,
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`blog_staging_runtime_management_api_failed:${response.status}`);
  }
  if (rawBody.length > 65_536) {
    throw new Error('blog_staging_runtime_management_api_response_too_large');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new Error('blog_staging_runtime_management_api_response_invalid');
  }
  if (!isRecord(parsed)) {
    throw new Error('blog_staging_runtime_management_api_response_invalid');
  }
  if (parsed.name !== target.branchName) {
    throw new Error('blog_staging_runtime_branch_name_mismatch');
  }
  if (parsed.project_ref !== target.projectRef) {
    throw new Error('blog_staging_runtime_branch_project_ref_mismatch');
  }
  if (parsed.parent_project_ref !== target.productionProjectRef) {
    throw new Error('blog_staging_runtime_branch_parent_ref_mismatch');
  }
  if (parsed.is_default !== false) {
    throw new Error('blog_staging_runtime_default_branch_forbidden');
  }
  if (parsed.persistent !== false) {
    throw new Error('blog_staging_runtime_persistent_branch_forbidden');
  }
  if (parsed.with_data !== false) {
    throw new Error('blog_staging_runtime_data_clone_forbidden');
  }

  return {
    branchName: target.branchName,
    isDefault: false,
    parentProjectRef: target.productionProjectRef,
    persistent: false,
    projectRef: target.projectRef,
    status: typeof parsed.status === 'string' ? parsed.status : null,
    withData: false,
  };
}

export const BLOG_STAGING_RUNTIME_CONFIRMATION = REQUIRED_CONFIRMATION;

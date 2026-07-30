import { type NextRequest } from 'next/server';
import { isAdminRequest } from '@/lib/admin-guard';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { createOAuthState, isOAuthStateConfigured } from '@/lib/oauth-state';
import { getSecret } from '@/lib/secret-registry';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SAFE_CONFIG_SELECT = [
  'id',
  'platform',
  'enabled',
  'account_id',
  'token_expires_at',
  'default_post_type',
  'daily_post_limit',
  'posts_today',
  'last_post_at',
  'created_at',
  'updated_at',
].join(', ');

const PLATFORMS = new Set(['instagram', 'facebook', 'threads', 'twitter', 'naver_cafe']);
const SECRET_UPDATE_FIELDS = new Set([
  'access_token',
  'refresh_token',
  'client_secret',
  'token',
  'encrypted_access_token',
  'encrypted_refresh_token',
]);

function noStoreResponse<T>(body: T, init?: ResponseInit) {
  const response = apiResponse(body, init);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function publicConfig(row: Record<string, unknown>) {
  return {
    id: row.id,
    platform: row.platform,
    enabled: row.enabled,
    account_id: row.account_id,
    token_expires_at: row.token_expires_at,
    default_post_type: row.default_post_type,
    daily_post_limit: row.daily_post_limit,
    daily_limit: row.daily_post_limit,
    posts_today: row.posts_today,
    last_post_at: row.last_post_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function GET(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return noStoreResponse({ error: 'Admin access required' }, { status: 403 });
  }
  if (!isSupabaseAdminConfigured) {
    return noStoreResponse({ error: 'Admin database is not configured' }, { status: 503 });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('social_platform_configs')
      .select(SAFE_CONFIG_SELECT)
      .order('platform', { ascending: true });

    if (error) throw error;
    const configs = (data ?? []).map((row) => publicConfig(row as unknown as Record<string, unknown>));
    return noStoreResponse({ configs });
  } catch (error) {
    console.error('[social-configs] list failed:', sanitizeDbError(error, 'query failed'));
    return noStoreResponse({ error: 'Social configuration lookup failed' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return noStoreResponse({ error: 'Admin access required' }, { status: 403 });
  }

  const body: unknown = await request.json().catch(() => null);
  const platform = isRecord(body) ? body.platform : null;
  if (platform !== 'threads') {
    return noStoreResponse({ error: 'Only Threads OAuth is supported here' }, { status: 400 });
  }

  const appId = getSecret('THREADS_APP_ID') || getSecret('META_APP_ID');
  if (!appId) {
    return noStoreResponse({ error: 'THREADS_APP_ID or META_APP_ID is not configured' }, { status: 503 });
  }
  if (!isOAuthStateConfigured()) {
    return noStoreResponse({ error: 'OAuth state signing is not configured' }, { status: 503 });
  }

  const state = createOAuthState({
    tenantId: '00000000-0000-0000-0000-000000000000',
    provider: 'threads',
  });
  const siteUrl = (
    process.env.NEXT_PUBLIC_SITE_URL || 'https://www.yeosonam.com'
  ).replace(/\/+$/, '');
  const redirectUri = `${siteUrl}/api/auth/meta-callback`;

  const oauthUrl = new URL('https://threads.net/oauth/authorize');
  oauthUrl.searchParams.set('client_id', appId);
  oauthUrl.searchParams.set('redirect_uri', redirectUri);
  oauthUrl.searchParams.set('state', state);
  oauthUrl.searchParams.set('scope', [
    'threads_basic',
    'threads_content_publish',
    'threads_read_replies',
    'threads_manage_replies',
    'threads_manage_mentions',
    'threads_keyword_search',
    'threads_manage_insights',
  ].join(','));
  oauthUrl.searchParams.set('response_type', 'code');

  return noStoreResponse({ oauth_url: oauthUrl.toString(), platform });
}

export async function PATCH(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return noStoreResponse({ error: 'Admin access required' }, { status: 403 });
  }
  if (!isSupabaseAdminConfigured) {
    return noStoreResponse({ error: 'Admin database is not configured' }, { status: 503 });
  }

  const body: unknown = await request.json().catch(() => null);
  if (!isRecord(body) || typeof body.platform !== 'string' || !PLATFORMS.has(body.platform) || !isRecord(body.updates)) {
    return noStoreResponse({ error: 'A valid platform and updates object are required' }, { status: 400 });
  }

  const updateKeys = Object.keys(body.updates);
  if (updateKeys.some((key) => SECRET_UPDATE_FIELDS.has(key))) {
    return noStoreResponse({ error: 'OAuth credentials cannot be changed through this endpoint' }, { status: 400 });
  }

  const dbPatch: Record<string, boolean | number> = {};
  if ('enabled' in body.updates) {
    if (typeof body.updates.enabled !== 'boolean') {
      return noStoreResponse({ error: 'enabled must be a boolean' }, { status: 400 });
    }
    dbPatch.enabled = body.updates.enabled;
  }

  const limitValue = body.updates.daily_limit ?? body.updates.daily_post_limit;
  if (limitValue !== undefined) {
    if (!Number.isInteger(limitValue) || (limitValue as number) < 1 || (limitValue as number) > 100) {
      return noStoreResponse({ error: 'daily_limit must be an integer between 1 and 100' }, { status: 400 });
    }
    dbPatch.daily_post_limit = limitValue as number;
  }

  if ('posts_today' in body.updates) {
    if (!Number.isInteger(body.updates.posts_today) || (body.updates.posts_today as number) < 0) {
      return noStoreResponse({ error: 'posts_today must be a non-negative integer' }, { status: 400 });
    }
    dbPatch.posts_today = body.updates.posts_today as number;
  }

  if (Object.keys(dbPatch).length === 0) {
    return noStoreResponse({ error: 'No supported fields to update' }, { status: 400 });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('social_platform_configs')
      .update(dbPatch)
      .eq('platform', body.platform)
      .select(SAFE_CONFIG_SELECT)
      .maybeSingle();

    if (error) throw error;
    if (!data) return noStoreResponse({ error: 'Platform configuration not found' }, { status: 404 });
    return noStoreResponse({ config: publicConfig(data as unknown as Record<string, unknown>) });
  } catch (error) {
    console.error('[social-configs] update failed:', sanitizeDbError(error, 'update failed'));
    return noStoreResponse({ error: 'Social configuration update failed' }, { status: 500 });
  }
}

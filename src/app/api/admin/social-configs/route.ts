import { createHmac } from 'crypto';
import { type NextRequest } from 'next/server';
import { isAdminRequest } from '@/lib/admin-guard';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
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
    return noStoreResponse({ error: '관리자 권한이 필요합니다.' }, { status: 403 });
  }
  if (!isSupabaseAdminConfigured) {
    return noStoreResponse({ error: '관리자 데이터베이스 연결이 필요합니다.' }, { status: 503 });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('social_platform_configs')
      .select(SAFE_CONFIG_SELECT)
      .order('platform', { ascending: true });
    if (error) throw error;

    const configs = (data ?? []).map((row) =>
      publicConfig(row as unknown as Record<string, unknown>),
    );
    return noStoreResponse({ configs });
  } catch (error) {
    console.error('[social-configs] 목록 조회 실패:', sanitizeDbError(error, 'query failed'));
    return noStoreResponse({ error: '소셜 채널 설정을 불러오지 못했습니다.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return noStoreResponse({ error: '관리자 권한이 필요합니다.' }, { status: 403 });
  }

  const body: unknown = await request.json().catch(() => null);
  const platform = isRecord(body) ? body.platform : null;
  if (platform !== 'threads') {
    return noStoreResponse({ error: '이 연결 화면에서는 Threads만 지원합니다.' }, { status: 400 });
  }

  const appId = getSecret('THREADS_APP_ID') || getSecret('META_APP_ID');
  const stateSecret = getSecret('OAUTH_STATE_SECRET');
  if (!appId || !stateSecret) {
    return noStoreResponse({
      error: 'Threads 연결에 필요한 앱 정보 또는 보안 설정이 없습니다.',
    }, { status: 503 });
  }

  const payload = Buffer.from(JSON.stringify({
    tenant_id: '00000000-0000-0000-0000-000000000000',
    ts: Date.now(),
    platform,
  })).toString('base64url');
  const signature = createHmac('sha256', stateSecret)
    .update(payload)
    .digest('hex')
    .slice(0, 16);
  const state = `${payload}.${signature}`;
  const siteUrl = getSecret('NEXT_PUBLIC_SITE_URL') || 'https://www.yeosonam.com';
  const redirectUri = `${siteUrl}/api/auth/meta-callback`;

  const oauthUrl = new URL('https://www.facebook.com/v21.0/dialog/oauth');
  oauthUrl.searchParams.set('client_id', appId);
  oauthUrl.searchParams.set('redirect_uri', redirectUri);
  oauthUrl.searchParams.set('state', state);
  oauthUrl.searchParams.set('scope', 'threads_basic,threads_content_publish');
  oauthUrl.searchParams.set('response_type', 'code');

  return noStoreResponse({ oauth_url: oauthUrl.toString(), platform });
}

export async function PATCH(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return noStoreResponse({ error: '관리자 권한이 필요합니다.' }, { status: 403 });
  }
  if (!isSupabaseAdminConfigured) {
    return noStoreResponse({ error: '관리자 데이터베이스 연결이 필요합니다.' }, { status: 503 });
  }

  const body: unknown = await request.json().catch(() => null);
  if (
    !isRecord(body) ||
    typeof body.platform !== 'string' ||
    !PLATFORMS.has(body.platform) ||
    !isRecord(body.updates)
  ) {
    return noStoreResponse({ error: '올바른 채널과 변경 내용을 보내 주세요.' }, { status: 400 });
  }

  const updateKeys = Object.keys(body.updates);
  if (updateKeys.some((key) => SECRET_UPDATE_FIELDS.has(key))) {
    return noStoreResponse({
      error: '계정 비밀 정보는 이 화면에서 직접 변경할 수 없습니다.',
    }, { status: 400 });
  }

  const dbPatch: Record<string, boolean | number> = {};
  if ('enabled' in body.updates) {
    if (typeof body.updates.enabled !== 'boolean') {
      return noStoreResponse({ error: '사용 여부 값이 올바르지 않습니다.' }, { status: 400 });
    }
    dbPatch.enabled = body.updates.enabled;
  }

  const limitValue = body.updates.daily_limit ?? body.updates.daily_post_limit;
  if (limitValue !== undefined) {
    if (!Number.isInteger(limitValue) || Number(limitValue) < 1 || Number(limitValue) > 100) {
      return noStoreResponse({ error: '하루 발행 수는 1~100 사이의 정수여야 합니다.' }, { status: 400 });
    }
    dbPatch.daily_post_limit = Number(limitValue);
  }

  if ('posts_today' in body.updates) {
    if (!Number.isInteger(body.updates.posts_today) || Number(body.updates.posts_today) < 0) {
      return noStoreResponse({ error: '오늘 발행 수는 0 이상의 정수여야 합니다.' }, { status: 400 });
    }
    dbPatch.posts_today = Number(body.updates.posts_today);
  }

  if (Object.keys(dbPatch).length === 0) {
    return noStoreResponse({ error: '변경할 수 있는 항목이 없습니다.' }, { status: 400 });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('social_platform_configs')
      .update(dbPatch)
      .eq('platform', body.platform)
      .select(SAFE_CONFIG_SELECT)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return noStoreResponse({ error: '해당 채널 설정을 찾지 못했습니다.' }, { status: 404 });
    }
    return noStoreResponse({
      config: publicConfig(data as unknown as Record<string, unknown>),
    });
  } catch (error) {
    console.error('[social-configs] 설정 변경 실패:', sanitizeDbError(error, 'update failed'));
    return noStoreResponse({ error: '소셜 채널 설정을 변경하지 못했습니다.' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { isAdminRequest } from '@/lib/admin-guard';
import { getSecret } from '@/lib/secret-registry';
import { createHmac } from 'crypto';

// ── GET /api/admin/social-configs ────────────────────────────────────────────
// 소셜 플랫폼 config 목록 조회
export async function GET(request: NextRequest) {
  if (!(await isAdminRequest(request))) return NextResponse.json({ error: 'admin 권한 필요' }, { status: 403 });
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  const { data, error } = await supabaseAdmin
    .from('social_platform_configs')
    .select('*')
    .order('platform', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // daily_limit → daily_post_limit 맵핑 (프론트엔드 호환)
  const configs = (data ?? []).map((c: Record<string, unknown>) => ({
    ...c,
    daily_limit: c.daily_post_limit,
  }));

  return NextResponse.json({ configs });
}

// ── POST /api/admin/social-configs ───────────────────────────────────────────
// Threads OAuth URL 생성
export async function POST(request: NextRequest) {
  if (!(await isAdminRequest(request))) return NextResponse.json({ error: 'admin 권한 필요' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const platform = body.platform as string;

  if (platform !== 'threads') {
    return NextResponse.json({ error: '현재 threads만 지원' }, { status: 400 });
  }

  const appId = getSecret('THREADS_APP_ID') || getSecret('META_APP_ID');
  if (!appId) {
    return NextResponse.json({ error: 'META_APP_ID 미설정' }, { status: 503 });
  }

  // state 생성 (CSRF 방지)
  const stateSecret = getSecret('OAUTH_STATE_SECRET') ?? 'dev';
  const payload = Buffer.from(JSON.stringify({
    tenant_id: '00000000-0000-0000-0000-000000000000', // 단일 테넌트
    ts: Date.now(),
    platform,
  })).toString('base64url');
  const sig = createHmac('sha256', stateSecret).update(payload).digest('hex').slice(0, 16);
  const state = `${payload}.${sig}`;

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.yeosonam.com';
  const redirectUri = `${siteUrl}/api/auth/meta-callback`;

  // Threads API v1.0 OAuth URL
  const oauthUrl = new URL('https://www.facebook.com/v21.0/dialog/oauth');
  oauthUrl.searchParams.set('client_id', appId);
  oauthUrl.searchParams.set('redirect_uri', redirectUri);
  oauthUrl.searchParams.set('state', state);
  oauthUrl.searchParams.set('scope', 'threads_basic,threads_content_publish');
  oauthUrl.searchParams.set('response_type', 'code');

  return NextResponse.json({ oauth_url: oauthUrl.toString(), platform });
}

// ── PATCH /api/admin/social-configs ──────────────────────────────────────────
// 소셜 플랫폼 config 업데이트 (enabled, daily_limit 등)
export async function PATCH(request: NextRequest) {
  // ...existing code...
  if (!(await isAdminRequest(request))) return NextResponse.json({ error: 'admin 권한 필요' }, { status: 403 });
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  const body = await request.json().catch(() => ({}));

  if (!body.platform || !body.updates) {
    return NextResponse.json({ error: 'platform과 updates 필드 필요' }, { status: 400 });
  }

  const allowed = ['enabled', 'daily_limit', 'daily_post_limit', 'posts_today', 'refresh_token'] as const;
  const dbPatch: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body.updates) {
      // 프론트엔드 → DB 컬럼명 맵핑
      const dbKey = key === 'daily_limit' ? 'daily_post_limit' : key;
      dbPatch[dbKey] = body.updates[key];
    }
  }

  if (Object.keys(dbPatch).length === 0) {
    return NextResponse.json({ error: '변경할 필드 없음' }, { status: 400 });
  }

  // OAuth refresh token은 암호화해서 저장
  if (dbPatch.refresh_token) {
    // 향후 암호화 로직 추가
  }

  // daily_limit는 DB에 없으므로 제거
  delete dbPatch.daily_limit;

  try {
    const { data, error } = await supabaseAdmin
      .from('social_platform_configs')
      .update({ ...dbPatch, updated_at: new Date().toISOString() })
      .eq('platform', body.platform)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) return NextResponse.json({ error: '플랫폼을 찾을 수 없습니다' }, { status: 404 });

    // 응답에 daily_limit 맵핑 포함
    return NextResponse.json({ config: { ...data, daily_limit: data.daily_post_limit } });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '수정 실패' },
      { status: 500 }
    );
  }
}

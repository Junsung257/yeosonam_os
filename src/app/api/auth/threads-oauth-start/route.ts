/**
 * Threads OAuth 시작
 * GET /api/auth/threads-oauth-start
 *
 * Threads API 접근을 위한 Meta OAuth 2.0 Authorization URL 반환.
 * threads_oauth.start URL parameter 참고.
 *
 * 필요 권한 (Meta App Review 필요):
 *   - threads_basic
 *   - threads_manage_posts
 *   - threads_read_replies
 *
 * 응답: { url: "https://www.facebook.com/v21.0/dialog/oauth?..." }
 */
import { NextRequest, NextResponse } from 'next/server';
import { createHmac } from 'crypto';
import { getSecret } from '@/lib/secret-registry';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  // Threads 전용 앱 ID 사용 (META_APP_ID와 다름)
  const appId = getSecret('THREADS_APP_ID') || getSecret('META_APP_ID');
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    'https://www.yeosonam.com';
  if (!appId || !siteUrl) {
    return NextResponse.json(
      { error: 'THREADS_APP_ID 또는 NEXT_PUBLIC_SITE_URL 미설정' },
      { status: 500 },
    );
  }

  // state: platform=threads 를 payload 에 포함
  const payload = Buffer.from(
    JSON.stringify({ tenant_id: 'threads', platform: 'threads', ts: Date.now() }),
  ).toString('base64url');
  const sig = createHmac('sha256', getSecret('OAUTH_STATE_SECRET') ?? 'dev')
    .update(payload)
    .digest('hex')
    .slice(0, 16);
  const state = `${payload}.${sig}`;

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: `${siteUrl}/api/auth/meta-callback`,
    scope: 'threads_basic,threads_manage_posts,threads_read_replies',
    state,
    response_type: 'code',
  });

  const url = `https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}`;
  return NextResponse.json({ url });
}

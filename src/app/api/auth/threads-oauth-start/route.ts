import { type NextRequest } from 'next/server';
import { createHmac } from 'crypto';
import { getSecret } from '@/lib/secret-registry';
import { apiResponse } from '@/lib/api-response';

/**
 * Start Threads OAuth.
 * GET /api/auth/threads-oauth-start
 */
export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest) {
  const appId = getSecret('THREADS_APP_ID') || getSecret('META_APP_ID');
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    'https://www.yeosonam.com';

  if (!appId || !siteUrl) {
    return apiResponse(
      { error: 'THREADS_APP_ID or NEXT_PUBLIC_SITE_URL is not configured' },
      { status: 500 },
    );
  }

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
  return apiResponse({ url });
}

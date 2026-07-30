import { type NextRequest } from 'next/server';
import { getSecret } from '@/lib/secret-registry';
import { apiResponse } from '@/lib/api-response';
import { createOAuthState, isOAuthStateConfigured } from '@/lib/oauth-state';

/**
 * Start Threads OAuth.
 * GET /api/auth/threads-oauth-start
 */
export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest) {
  const appId = getSecret('THREADS_APP_ID') || getSecret('META_APP_ID');
  const siteUrl = (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    'https://www.yeosonam.com'
  ).replace(/\/+$/, '');

  if (!appId || !siteUrl || !isOAuthStateConfigured()) {
    return apiResponse(
      { error: 'Threads OAuth is not configured' },
      { status: 503 },
    );
  }

  const state = createOAuthState({ tenantId: 'threads', provider: 'threads' });

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: `${siteUrl}/api/auth/meta-callback`,
    scope: [
      'threads_basic',
      'threads_content_publish',
      'threads_read_replies',
      'threads_manage_replies',
      'threads_manage_mentions',
      'threads_keyword_search',
      'threads_manage_insights',
    ].join(','),
    state,
    response_type: 'code',
  });

  const url = `https://threads.net/oauth/authorize?${params.toString()}`;
  return apiResponse({ url });
}

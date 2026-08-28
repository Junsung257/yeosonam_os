import { type NextRequest } from 'next/server';
import { getSecret } from '@/lib/secret-registry';
import { apiResponse } from '@/lib/api-response';
import { createOAuthState, registerOAuthState } from '@/lib/oauth-state';
import { requireHumanAdminActor, resolveAdminActorId } from '@/lib/admin-guard';

/**
 * Start Threads OAuth.
 * GET /api/auth/threads-oauth-start
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authError = await requireHumanAdminActor(request);
  if (authError) return authError;
  const actorUserId = await resolveAdminActorId(request);
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

  let state: string;
  try {
    state = createOAuthState({ provider: 'threads', scope: 'platform' });
    await registerOAuthState({
      rawState: state,
      provider: 'threads',
      actorUserId: actorUserId ?? undefined,
    });
  } catch (error) {
    console.error('[threads-oauth-start] state registration failed', error);
    return apiResponse({ error: 'OAuth state storage is unavailable' }, { status: 503 });
  }

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: `${siteUrl}/api/auth/meta-callback`,
    scope: 'threads_basic,threads_manage_posts,threads_read_replies',
    state,
    response_type: 'code',
  });

  const url = `https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}`;
  return apiResponse({ url }, { headers: { 'Cache-Control': 'private, no-store' } });
}

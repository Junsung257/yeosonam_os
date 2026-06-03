/**
 * Threads 연동 상태 확인 (GET)
 * /api/admin/check-threads
 */
import { apiResponse } from '@/lib/api-response';
import { withAdminGuard } from '@/lib/admin-guard';
import { isThreadsConfigured, getThreadsConfig } from '@/lib/threads-publisher';

export const dynamic = 'force-dynamic';

async function getHandler() {
  const configured = isThreadsConfigured();
  let config = null;
  let testResult = null;

  if (configured) {
    config = await getThreadsConfig();
    // 실제 발행 없이 연결만 확인 (GET /me)
    try {
      const r = await fetch(
        `https://graph.threads.net/v1.0/${config!.threadsUserId}/threads?fields=id,media_type,permalink&since=0&limit=1&access_token=${encodeURIComponent(config!.accessToken)}`,
      );
      const d = await r.json();
      testResult = { status: r.ok ? 'ok' : 'error', data: r.ok ? 'connected' : d?.error?.message ?? 'unknown' };
    } catch (e) {
      testResult = { status: 'error', data: String(e) };
    }
  }

  return apiResponse({
    configured,
    threadsUserId: config?.threadsUserId ?? null,
    hasAccessToken: !!config?.accessToken,
    testResult,
  });
}

export const GET = withAdminGuard(getHandler);

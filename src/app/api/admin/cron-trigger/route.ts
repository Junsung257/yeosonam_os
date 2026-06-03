import { NextRequest } from 'next/server';
import { isAdminRequest } from '@/lib/admin-guard';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { getSecret } from '@/lib/secret-registry';
import { logError } from '@/lib/sentry-logger';

/**
 * POST /api/admin/cron-trigger
 *
 * Allows an authenticated admin to manually trigger an internal cron route.
 * The server injects CRON_SECRET so the secret is never exposed to the client.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const isAdmin = await isAdminRequest(request);
  if (!isAdmin) {
    return apiResponse({ error: 'Admin privileges required' }, { status: 401 });
  }

  try {
    const { path } = await request.json() as { path?: string };

    if (!path || typeof path !== 'string') {
      return apiResponse(
        { error: 'path is required, for example /api/cron/review-sentiment' },
        { status: 400 },
      );
    }

    if (!path.startsWith('/api/cron/')) {
      return apiResponse({ error: 'Only /api/cron paths are allowed' }, { status: 400 });
    }

    const secret = getSecret('CRON_SECRET');
    if (!secret) {
      return apiResponse({ error: 'CRON_SECRET not configured' }, { status: 503 });
    }

    const baseUrl = request.headers.get('x-forwarded-proto') === 'https'
      ? `https://${request.headers.get('x-forwarded-host') || 'localhost'}`
      : `http://${request.headers.get('host') || 'localhost'}`;

    const res = await fetch(`${baseUrl}${path}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${secret}`,
      },
    });

    const data = await res.json();
    return apiResponse(data, { status: res.status });
  } catch (err) {
    logError('[admin/cron-trigger] cron request failed', err);
    return apiResponse({ error: sanitizeDbError(err, 'Cron trigger failed') }, { status: 500 });
  }
}

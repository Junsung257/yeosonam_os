/**
 * POST /api/revalidate
 *
 * Invalidates ISR cache paths after trusted database/admin scripts.
 * Body: { paths: string[], secret: string }
 */

import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { apiResponse } from '@/lib/api-response';
import { getSecret } from '@/lib/secret-registry';
import { safeEqualString } from '@/lib/timing-safe';
import { sanitizeDbError } from '@/lib/error-sanitizer';

function noStore(body: Record<string, unknown>, status: number) {
  const response = apiResponse(body, { status });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { paths, secret } = body;

    const expectedSecret = getSecret('REVALIDATE_SECRET');
    if (!expectedSecret) {
      return noStore({ error: 'Service unavailable' }, 503);
    }
    if (!safeEqualString(secret, expectedSecret)) {
      return noStore({ error: 'Invalid secret' }, 401);
    }

    if (!Array.isArray(paths) || paths.length === 0) {
      return apiResponse({ error: 'paths array is required' }, { status: 400 });
    }

    const revalidated: string[] = [];
    for (const path of paths) {
      if (typeof path !== 'string') continue;
      if (!path.startsWith('/')) continue;
      revalidatePath(path);
      revalidated.push(path);
    }

    return apiResponse({ success: true, revalidated });
  } catch (err) {
    return apiResponse(
      { error: sanitizeDbError(err, 'revalidate failed') },
      { status: 500 },
    );
  }
}

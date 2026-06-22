/**
 * POST /api/revalidate
 *
 * Invalidates ISR cache paths after trusted database/admin scripts.
 * Body: { path?: string, paths?: string[], tags?: string[], secret?: string }
 * Header fallback: x-revalidate-secret
 */

import { NextRequest } from 'next/server';
import { revalidatePath, revalidateTag } from 'next/cache';
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
    const { path, paths, tags } = body;
    const secret = typeof body.secret === 'string'
      ? body.secret
      : request.headers.get('x-revalidate-secret');

    const expectedSecret = getSecret('REVALIDATE_SECRET');
    if (!expectedSecret) {
      return noStore({ error: 'Service unavailable' }, 503);
    }
    if (!safeEqualString(secret, expectedSecret)) {
      return noStore({ error: 'Invalid secret' }, 401);
    }

    const normalizedPaths = Array.isArray(paths)
      ? paths
      : typeof path === 'string'
        ? [path]
        : [];
    const hasPaths = normalizedPaths.length > 0;
    const hasTags = Array.isArray(tags) && tags.length > 0;
    if (!hasPaths && !hasTags) {
      return apiResponse({ error: 'paths or tags array is required' }, { status: 400 });
    }

    const revalidated: string[] = [];
    for (const pathValue of hasPaths ? normalizedPaths : []) {
      if (typeof pathValue !== 'string') continue;
      if (!pathValue.startsWith('/')) continue;
      revalidatePath(pathValue);
      revalidated.push(pathValue);
    }

    const revalidatedTags: string[] = [];
    for (const tag of hasTags ? tags : []) {
      if (typeof tag !== 'string') continue;
      if (!/^[a-z0-9:_-]{1,80}$/i.test(tag)) continue;
      revalidateTag(tag);
      revalidatedTags.push(tag);
    }

    return apiResponse({ success: true, revalidated, revalidatedTags });
  } catch (err) {
    return apiResponse(
      { error: sanitizeDbError(err, 'revalidate failed') },
      { status: 500 },
    );
  }
}

/**
 * POST /api/revalidate
 *
 * Invalidates ISR cache paths after trusted database/admin scripts.
 * Body: { paths?: string[], tags?: string[], secret: string }
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
    const { paths, tags, secret } = body;

    const expectedSecret = getSecret('REVALIDATE_SECRET');
    if (!expectedSecret) {
      return noStore({ error: 'Service unavailable' }, 503);
    }
    if (!safeEqualString(secret, expectedSecret)) {
      return noStore({ error: 'Invalid secret' }, 401);
    }

    const hasPaths = Array.isArray(paths) && paths.length > 0;
    const hasTags = Array.isArray(tags) && tags.length > 0;
    if (!hasPaths && !hasTags) {
      return apiResponse({ error: 'paths or tags array is required' }, { status: 400 });
    }

    const revalidated: string[] = [];
    for (const path of hasPaths ? paths : []) {
      if (typeof path !== 'string') continue;
      if (!path.startsWith('/')) continue;
      revalidatePath(path);
      revalidated.push(path);
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

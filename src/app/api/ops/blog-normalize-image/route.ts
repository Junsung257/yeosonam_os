/**
 * POST /api/ops/blog-normalize-image
 * body: { url: string, watermarkLabel?: string }
 *
 * Downloads a remote image, strips metadata/re-encodes it, and returns base64.
 * Auth: Bearer CRON_SECRET for server-side scripts.
 */
import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { normalizeImageFromUrl } from '@/lib/blog-image-normalize';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { getSecret } from '@/lib/secret-registry';
import { safeEqualString } from '@/lib/timing-safe';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const auth = request.headers.get('authorization');
  const cronSecret = getSecret('CRON_SECRET');
  if (!cronSecret || !safeEqualString(auth, `Bearer ${cronSecret}`)) {
    return apiResponse({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const url = typeof body?.url === 'string' ? body.url.trim() : '';
    if (!url || !/^https?:\/\//i.test(url)) {
      return apiResponse({ error: 'valid https url required' }, { status: 400 });
    }

    const { buffer, contentType } = await normalizeImageFromUrl(url, {
      watermarkLabel: typeof body?.watermarkLabel === 'string' ? body.watermarkLabel : undefined,
    });

    return apiResponse({
      ok: true,
      contentType,
      dataBase64: buffer.toString('base64'),
      byteLength: buffer.length,
    });
  } catch (e) {
    console.error('[ops/blog-normalize-image] failed:', sanitizeDbError(e));
    return apiResponse(
      { error: 'image normalization failed' },
      { status: 500 },
    );
  }
}

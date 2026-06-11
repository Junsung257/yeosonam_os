import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { isPexelsConfigured } from '@/lib/pexels';
import { batchAttractionPhotoMatch } from '@/lib/attraction-photo-match';
import { withCronGuard } from '@/lib/cron-auth';
import { logError } from '@/lib/sentry-logger';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';

export const dynamic = 'force-dynamic';

const getHandler = async () => {
  if (!isSupabaseConfigured || !supabaseAdmin) {
    return apiResponse({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }
  if (!isPexelsConfigured()) {
    return apiResponse({ ok: false, error: 'Pexels API key not configured' }, { status: 503 });
  }

  const start = Date.now();

  try {
    const result = await batchAttractionPhotoMatch(30);

    return apiResponse({
      ok: true,
      total: result.processed,
      processed: result.processed,
      totalPhotos: result.totalPhotos,
      filled: result.totalPhotos > 0 ? result.processed : 0,
      skipped: result.totalPhotos > 0 ? 0 : result.processed,
      errors: 0,
      mode: 'attraction-name-alias-pexels-wikimedia',
      durationMs: Date.now() - start,
    });
  } catch (error) {
    logError('[cron/fill-attraction-photos] cron failed', error);
    return apiResponse(
      { ok: false, error: sanitizeDbError(error, 'Attraction photo fill failed'), durationMs: Date.now() - start },
      { status: 500 },
    );
  }
};

export const GET = withCronGuard(getHandler);

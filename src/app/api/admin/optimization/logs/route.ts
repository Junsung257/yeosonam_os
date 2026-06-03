import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { isAdminRequest } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { getSecret } from '@/lib/secret-registry';
import { safeEqualString } from '@/lib/timing-safe';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization') ?? '';
  const cronSecret = getSecret('CRON_SECRET');
  const serviceKey = getSecret('SUPABASE_SERVICE_ROLE_KEY');
  const isBearerAuthorized =
    authHeader.startsWith('Bearer ') &&
    (safeEqualString(authHeader.slice(7), cronSecret) || safeEqualString(authHeader.slice(7), serviceKey));

  if (!isBearerAuthorized && !(await isAdminRequest(request))) {
    return apiResponse({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const platform = searchParams.get('platform');
  const parsedLimit = Number.parseInt(searchParams.get('limit') ?? '50', 10);
  const limit = Math.min(Math.max(Number.isFinite(parsedLimit) ? parsedLimit : 50, 1), 200);

  try {
    const url = getSecret('NEXT_PUBLIC_SUPABASE_URL');
    const key = getSecret('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) {
      return apiResponse({ error: 'SUPABASE_NOT_CONFIGURED' }, { status: 503 });
    }

    const supabase = createClient(url, key);
    let query = supabase
      .from('optimization_log')
      .select('*')
      .order('ran_at', { ascending: false })
      .limit(limit);

    if (platform && platform !== 'all') {
      query = query.eq('platform', platform);
    }

    const { data, error } = await query;
    if (error) {
      return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });
    }

    return apiResponse(data ?? []);
  } catch (err) {
    return apiResponse({ error: sanitizeDbError(err) }, { status: 500 });
  }
}

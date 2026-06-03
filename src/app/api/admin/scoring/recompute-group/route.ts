import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { recomputeGroupForPackage, recomputeGroupScores } from '@/lib/scoring/recommend';
import { isSupabaseConfigured } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const postHandler = async (req: NextRequest) => {
  if (!isSupabaseConfigured) return apiResponse({ error: 'SUPABASE_NOT_CONFIGURED' }, { status: 503 });

  let body: { package_id?: string; destination?: string; departure_date?: string | null };
  try {
    body = await req.json();
  } catch {
    return apiResponse({ error: 'INVALID_JSON' }, { status: 400 });
  }

  try {
    let result;
    if (body.package_id) {
      result = await recomputeGroupForPackage(body.package_id);
    } else if (body.destination) {
      result = await recomputeGroupScores(body.destination, body.departure_date ?? null);
    } else {
      return apiResponse({ error: 'PACKAGE_ID_OR_DESTINATION_REQUIRED' }, { status: 400 });
    }

    return apiResponse({ ok: true, ...result });
  } catch (e) {
    return apiResponse({ error: sanitizeDbError(e) }, { status: 500 });
  }
};

export const POST = withAdminGuard(postHandler);

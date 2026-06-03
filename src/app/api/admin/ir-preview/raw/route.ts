import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

const postHandler = async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'DB not configured' }, { status: 503 });
  }

  const body = await request.json().catch(() => null) as { id?: string } | null;
  const id = body?.id;
  if (!id) {
    return apiResponse({ error: 'id required' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('normalized_intakes')
    .select('raw_text')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });
  }
  if (!data) {
    return apiResponse({ error: 'not found' }, { status: 404 });
  }

  return apiResponse({ rawText: String((data as { raw_text?: string | null }).raw_text ?? '') });
};

export const POST = withAdminGuard(postHandler);

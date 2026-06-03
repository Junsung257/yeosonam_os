import { NextRequest } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { withAdminGuard } from '@/lib/admin-guard';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';

export const dynamic = 'force-dynamic';

async function patchHandler(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isSupabaseConfigured || !supabaseAdmin) {
    return apiResponse({ error: 'Supabase not configured' }, { status: 503 });
  }

  const { id } = await params;
  const body = await _req.json();
  const { is_active } = body;

  if (typeof is_active !== 'boolean') {
    return apiResponse({ error: 'is_active (boolean) 필요' }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('response_corrections')
    .update({ is_active })
    .eq('id', id);

  if (error) {
    return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });
  }

  return apiResponse({ ok: true });
}

export const PATCH = withAdminGuard(patchHandler);

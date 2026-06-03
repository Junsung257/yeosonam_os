import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { withAdminGuard } from '@/lib/admin-guard';

export const dynamic = 'force-dynamic';

const deleteHandler = async (_req: NextRequest, { params }: { params: { id: string } }) => {
  if (!isSupabaseConfigured) return apiResponse({ error: 'SUPABASE_NOT_CONFIGURED' }, { status: 503 });

  const { error } = await supabaseAdmin
    .from('optional_tour_market_rates')
    .delete()
    .eq('id', params.id);

  if (error) return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });

  return apiResponse({ ok: true });
};

export const DELETE = withAdminGuard(deleteHandler);

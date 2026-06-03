import { type NextRequest } from 'next/server';
import { isAdminRequest } from '@/lib/admin-guard';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const STATUSES = new Set(['pending', 'active', 'archived']);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminRequest(request))) {
    return apiResponse({ error: 'admin required' }, { status: 403 });
  }
  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'Supabase not configured' }, { status: 503 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const status = typeof body.status === 'string' ? body.status : null;
  if (!status || !STATUSES.has(status)) {
    return apiResponse({ error: 'invalid status' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('qa_learning_scenarios')
    .update({ status, updated_at: new Date().toISOString() } as never)
    .eq('id', id)
    .select('id, status')
    .single();

  if (error) return apiResponse({ error: sanitizeDbError(error, 'Failed to update scenario') }, { status: 500 });
  return apiResponse({ scenario: data });
}


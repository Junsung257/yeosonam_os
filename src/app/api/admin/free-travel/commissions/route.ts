/**
 * GET /api/admin/free-travel/commissions
 * 자유여행 커미션 현황 조회 (어드민 전용).
 */

import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

async function getHandler(request: NextRequest) {
  if (!isSupabaseConfigured || !supabaseAdmin) {
    return apiResponse({ commissions: [] });
  }

  const { searchParams } = request.nextUrl;
  const status = searchParams.get('status');
  const ota    = searchParams.get('ota');

  let query = supabaseAdmin
    .from('free_travel_commissions')
    .select('*, free_travel_sessions(destination, date_from, customer_phone)')
    .order('created_at', { ascending: false })
    .limit(200);

  if (status) query = query.eq('status', status);
  if (ota)    query = query.eq('ota', ota);

  const { data, error } = await query;
  if (error) {
    return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });
  }

  return apiResponse({ commissions: data ?? [] });
}

export const GET = withAdminGuard(getHandler);

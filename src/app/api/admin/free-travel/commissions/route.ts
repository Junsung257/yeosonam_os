/**
 * GET /api/admin/free-travel/commissions
 * 자유여행 커미션 현황 조회 (어드민 전용).
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { isAdminRequest } from '@/lib/admin-guard';

export async function GET(request: NextRequest) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: 'admin 권한 필요' }, { status: 403 });
  }
  if (!isSupabaseConfigured || !supabaseAdmin) {
    return NextResponse.json({ commissions: [] });
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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ commissions: data ?? [] });
}

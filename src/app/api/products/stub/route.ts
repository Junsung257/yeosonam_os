import { NextRequest, NextResponse } from 'next/server';
import { requireAdminRequest } from '@/lib/admin-guard';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;
  return NextResponse.json({
    error: '근거 원문 없는 stub 상품 생성은 종료되었습니다. HWP 또는 원문 붙여넣기를 업로드해 주세요.',
    code: 'PRODUCT_STUB_CREATE_RETIRED',
    next: '/api/upload',
  }, { status: 410, headers: { 'Cache-Control': 'private, no-store' } });
}

export async function GET(request: NextRequest) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;

  if (!isSupabaseConfigured) {
    return NextResponse.json({ stubs: [] });
  }
  const { searchParams } = request.nextUrl;
  const destination = searchParams.get('destination');
  const land_operator_id = searchParams.get('land_operator_id');
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 200);

  let query = supabaseAdmin
    .from('travel_packages')
    .select('id, title, destination, price, land_operator, land_operator_id, confirmed_dates, nights, data_completeness, created_at')
    .eq('is_stub', true)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (destination) query = query.ilike('destination', `%${destination}%`);
  if (land_operator_id) query = query.eq('land_operator_id', land_operator_id);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ stubs: data ?? [] });
}

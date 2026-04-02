/**
 * GET  /api/campaigns/creatives — 소재 목록 조회
 * PATCH /api/campaigns/creatives — 소재 상태 변경
 */

import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ creatives: [] });

  const { supabaseAdmin } = await import('@/lib/supabase');
  const { searchParams } = request.nextUrl;

  const channel = searchParams.get('channel');
  const creativeType = searchParams.get('creative_type');
  const status = searchParams.get('status');
  const productId = searchParams.get('product_id');
  const limit = parseInt(searchParams.get('limit') ?? '50');

  let query = supabaseAdmin
    .from('ad_creatives')
    .select('*, travel_packages!inner(id, title, destination)')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (channel) query = query.eq('channel', channel);
  if (creativeType) query = query.eq('creative_type', creativeType);
  if (status) query = query.eq('status', status);
  if (productId) query = query.eq('product_id', productId);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ creatives: data ?? [] });
}

export async function PATCH(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  }

  const { supabaseAdmin } = await import('@/lib/supabase');
  const { id, status } = await request.json();

  if (!id || !status) {
    return NextResponse.json({ error: 'id, status 필수' }, { status: 400 });
  }

  const validStatuses = ['draft', 'review', 'active', 'paused', 'ended'];
  if (!validStatuses.includes(status)) {
    return NextResponse.json({ error: `유효하지 않은 상태: ${status}` }, { status: 400 });
  }

  const updateData: Record<string, any> = { status };
  if (status === 'ended') updateData.ended_at = new Date().toISOString();
  if (status === 'active') updateData.launched_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from('ad_creatives')
    .update(updateData)
    .eq('id', id)
    .select('id, status')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ creative: data });
}

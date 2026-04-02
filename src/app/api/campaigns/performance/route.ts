/**
 * GET /api/campaigns/performance
 * ?creative_id=xxx — 소재별 일별 성과
 * ?type=patterns — winning_patterns 상위 5개
 */

import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ performance: [], patterns: [] });

  const { supabaseAdmin } = await import('@/lib/supabase');
  const { searchParams } = request.nextUrl;

  const creativeId = searchParams.get('creative_id');
  const type = searchParams.get('type');

  // winning_patterns 조회
  if (type === 'patterns') {
    const destType = searchParams.get('destination_type');
    let query = supabaseAdmin
      .from('winning_patterns')
      .select('*')
      .gt('confidence_score', 0.1)
      .order('avg_ctr', { ascending: false })
      .limit(5);

    if (destType) query = query.eq('destination_type', destType);

    const { data } = await query;
    return NextResponse.json({ patterns: data ?? [] });
  }

  // 소재별 성과 조회
  if (creativeId) {
    const { data } = await supabaseAdmin
      .from('creative_performance')
      .select('*')
      .eq('creative_id', creativeId)
      .order('date', { ascending: false })
      .limit(30);

    // 집계
    const rows = data ?? [];
    const totals = rows.reduce((acc: { impressions: number; clicks: number; spend: number; inquiries: number }, r: any) => ({
      impressions: acc.impressions + (r.impressions || 0),
      clicks: acc.clicks + (r.clicks || 0),
      spend: acc.spend + Number(r.spend || 0),
      inquiries: acc.inquiries + (r.inquiries || 0),
    }), { impressions: 0, clicks: 0, spend: 0, inquiries: 0 });

    return NextResponse.json({
      performance: rows,
      totals: {
        ...totals,
        ctr: totals.impressions > 0 ? (totals.clicks / totals.impressions * 100).toFixed(2) : '0',
        conv_rate: totals.clicks > 0 ? (totals.inquiries / totals.clicks * 100).toFixed(2) : '0',
      },
    });
  }

  return NextResponse.json({ error: 'creative_id 또는 type=patterns 필수' }, { status: 400 });
}

import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, getAdPerformance, upsertAdPerformanceSnapshot } from '@/lib/supabase';
import { fetchCampaignInsights, isMetaConfigured } from '@/lib/meta-api';
import { getRateInfo } from '@/lib/exchange-rate';
import { getMonthlyAdStats } from '@/lib/roas-calculator';

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }

  const { searchParams } = request.nextUrl;
  const campaignId = searchParams.get('campaign_id');
  const from = searchParams.get('from') ?? undefined;
  const to = searchParams.get('to') ?? undefined;
  const type = searchParams.get('type'); // 'monthly' for chart data

  try {
    if (type === 'monthly') {
      const months = parseInt(searchParams.get('months') ?? '6');
      const stats = await getMonthlyAdStats(months);
      return NextResponse.json({ stats });
    }

    if (!campaignId) {
      return NextResponse.json({ error: 'campaign_id 또는 type=monthly 필수' }, { status: 400 });
    }

    const snapshots = await getAdPerformance(campaignId, from, to);
    return NextResponse.json({ snapshots });
  } catch (error) {
    return NextResponse.json({ error: '성과 데이터 조회 실패' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }

  try {
    const { campaign_id } = await request.json();
    if (!campaign_id) {
      return NextResponse.json({ error: 'campaign_id 필수' }, { status: 400 });
    }

    // 캠페인 조회
    const { createClient } = await import('@supabase/supabase-js');
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const { data: campaign } = await sb
      .from('ad_campaigns')
      .select('*')
      .eq('id', campaign_id)
      .single();

    if (!campaign) {
      return NextResponse.json({ error: '캠페인 없음' }, { status: 404 });
    }

    const today = new Date().toISOString().slice(0, 10);

    // Meta Insights API 조회 (설정된 경우)
    let spend_krw = 0;
    let impressions = 0;
    let clicks = 0;
    let cpc_krw = 0;
    let raw_meta_json = null;

    if (isMetaConfigured() && campaign.meta_campaign_id) {
      try {
        const { rate } = await getRateInfo();
        const insights = await fetchCampaignInsights(campaign.meta_campaign_id, today, today);
        if (insights.length > 0) {
          const insight = insights[0];
          const spendUsd = parseFloat(insight.spend ?? '0');
          const cpcUsd = parseFloat(insight.cpc ?? '0');

          spend_krw = Math.round(spendUsd * rate);
          cpc_krw = Math.round(cpcUsd * rate);
          impressions = parseInt(insight.impressions ?? '0', 10);
          clicks = parseInt(insight.clicks ?? '0', 10);
          raw_meta_json = insight as unknown as Record<string, unknown>;

          // 캠페인 총 지출 업데이트
          await sb
            .from('ad_campaigns')
            .update({ total_spend_krw: (campaign.total_spend_krw ?? 0) + spend_krw })
            .eq('id', campaign_id);
        }
      } catch (metaErr) {
        console.warn('Meta Insights 조회 실패:', metaErr);
      }
    }

    // 귀속 예약 마진 계산
    const { data: attributedBookings } = await sb
      .from('bookings')
      .select('id, margin')
      .eq('utm_attributed_campaign_id', campaign_id)
      .neq('status', 'cancelled')
      .eq('is_deleted', false)
      .eq('departure_date', today);

    const attributed_bookings = (attributedBookings ?? []).length;
    const attributed_margin = (attributedBookings ?? []).reduce(
      (s: number, b: any) => s + (b.margin ?? 0),
      0
    );
    const net_roas_pct =
      spend_krw > 0 ? Math.round((attributed_margin / spend_krw) * 10000) / 100 : 0;

    const snapshot = {
      campaign_id,
      snapshot_date: today,
      impressions,
      clicks,
      spend_krw,
      cpc_krw,
      attributed_bookings,
      attributed_margin,
      net_roas_pct,
      raw_meta_json,
    };

    await upsertAdPerformanceSnapshot(snapshot);

    return NextResponse.json({ snapshot });
  } catch (error) {
    console.error('스냅샷 생성 실패:', error);
    return NextResponse.json({ error: '스냅샷 생성 실패' }, { status: 500 });
  }
}

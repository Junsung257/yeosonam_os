import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, getAdCampaigns, upsertCampaign } from '@/lib/supabase';
import { pauseAd, activateAd, updateAdsetBudget, isMetaConfigured, krwToMetaCents } from '@/lib/meta-api';
import { getRateInfo } from '@/lib/exchange-rate';
import { getSecret } from '@/lib/secret-registry';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }

  try {
    const [campaign] = await getAdCampaigns({ packageId: undefined });
    // 단건 조회는 supabase 직접 사용
    const { createClient } = await import('@supabase/supabase-js');
    const sb = createClient(
      getSecret('NEXT_PUBLIC_SUPABASE_URL')!,
      getSecret('NEXT_PUBLIC_SUPABASE_ANON_KEY')!
    );
    const { data } = await sb
      .from('ad_campaigns')
      .select('*, travel_packages(title, destination)')
      .eq('id', params.id)
      .single();

    if (!data) return NextResponse.json({ error: '캠페인 없음' }, { status: 404 });
    return NextResponse.json({ campaign: data });
  } catch (error) {
    return NextResponse.json({ error: '조회 실패' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }

  try {
    const body = await request.json();
    const { status, daily_budget_krw } = body;

    const [current] = await getAdCampaigns();
    // 현재 캠페인 조회
    const { createClient } = await import('@supabase/supabase-js');
    const sb = createClient(
      getSecret('NEXT_PUBLIC_SUPABASE_URL')!,
      getSecret('NEXT_PUBLIC_SUPABASE_ANON_KEY')!
    );
    const { data: currentCampaign } = await sb
      .from('ad_campaigns')
      .select('*')
      .eq('id', params.id)
      .single();

    if (!currentCampaign) {
      return NextResponse.json({ error: '캠페인 없음' }, { status: 404 });
    }

    // Meta API 동기화
    if (isMetaConfigured() && currentCampaign.meta_ad_id) {
      try {
        if (status === 'ACTIVE') await activateAd(currentCampaign.meta_ad_id);
        if (status === 'PAUSED') await pauseAd(currentCampaign.meta_ad_id);
      } catch (metaErr) {
        console.warn('Meta 상태 동기화 실패 (DB는 업데이트):', metaErr);
      }
    }

    if (isMetaConfigured() && daily_budget_krw && currentCampaign.meta_adset_id) {
      try {
        const { rate } = await getRateInfo();
        const cents = krwToMetaCents(daily_budget_krw, rate);
        await updateAdsetBudget(currentCampaign.meta_adset_id, cents);
      } catch (metaErr) {
        console.warn('Meta 예산 동기화 실패:', metaErr);
      }
    }

    const updated = await upsertCampaign({
      id: params.id,
      ...(status && { status }),
      ...(daily_budget_krw && { daily_budget_krw }),
    });

    return NextResponse.json({ campaign: updated });
  } catch (error) {
    console.error('캠페인 수정 실패:', error);
    return NextResponse.json({ error: '수정 실패' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }

  try {
    const updated = await upsertCampaign({ id: params.id, status: 'ARCHIVED' });
    return NextResponse.json({ campaign: updated });
  } catch (error) {
    return NextResponse.json({ error: '아카이브 실패' }, { status: 500 });
  }
}

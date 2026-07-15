import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { getPublishedPackageMarketingClaims } from '@/lib/public-packages';
import { isSupabaseConfigured, supabaseAdmin, upsertCampaign } from '@/lib/supabase';
import { pauseAd, activateAd, updateAdsetBudget, isMetaConfigured, krwToMetaCents } from '@/lib/meta-api';
import { getRateInfo } from '@/lib/exchange-rate';

export async function GET(_request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'Supabase 미설정' }, { status: 503 });
  }

  try {
    const { data } = await supabaseAdmin
      .from('ad_campaigns')
      .select('*')
      .eq('id', params.id)
      .single();

    if (!data) return apiResponse({ error: '캠페인 없음' }, { status: 404 });
    const publicPackages = data.package_id
      ? await getPublishedPackageMarketingClaims(supabaseAdmin, [data.package_id])
      : [];
    return apiResponse({
      campaign: {
        ...data,
        travel_packages: publicPackages[0] ?? null,
      },
    });
  } catch (error) {
    return apiResponse({ error: '조회 실패' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'Supabase 미설정' }, { status: 503 });
  }

  try {
    const body = await request.json();
    const { status, daily_budget_krw } = body;

    const { data: currentCampaign } = await supabaseAdmin
      .from('ad_campaigns')
      .select('*')
      .eq('id', params.id)
      .single();

    if (!currentCampaign) {
      return apiResponse({ error: '캠페인 없음' }, { status: 404 });
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

    return apiResponse({ campaign: updated });
  } catch (error) {
    console.error('캠페인 수정 실패:', error);
    return apiResponse({ error: '수정 실패' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'Supabase 미설정' }, { status: 503 });
  }

  try {
    const updated = await upsertCampaign({ id: params.id, status: 'ARCHIVED' });
    return apiResponse({ campaign: updated });
  } catch (error) {
    return apiResponse({ error: '아카이브 실패' }, { status: 500 });
  }
}

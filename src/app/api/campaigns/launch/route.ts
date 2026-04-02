/**
 * POST /api/campaigns/launch
 * 선택된 소재를 Meta/네이버/구글에 배포
 */

import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { creative_ids, budgets = {} } = await request.json();

    if (!creative_ids?.length) {
      return NextResponse.json({ error: 'creative_ids 필수' }, { status: 400 });
    }

    const { supabaseAdmin } = await import('@/lib/supabase');

    // 소재 조회
    const { data: creatives, error: fetchErr } = await supabaseAdmin
      .from('ad_creatives')
      .select('*, travel_packages!inner(id, title, destination, price)')
      .in('id', creative_ids);

    if (fetchErr || !creatives?.length) {
      return NextResponse.json({ error: '소재 조회 실패' }, { status: 404 });
    }

    const results: { id: string; channel: string; status: string; error?: string }[] = [];

    for (const creative of creatives) {
      try {
        if (creative.channel === 'meta') {
          // Meta 배포 — 기존 meta-api.ts 활용
          const launched = await launchMeta(creative, budgets.meta_daily ?? 10000, supabaseAdmin);
          results.push({ id: creative.id, channel: 'meta', status: launched ? 'active' : 'review' });
        } else if (creative.channel === 'naver') {
          // 네이버 — 아직 API 미연동, review 상태로만 변경
          await supabaseAdmin
            .from('ad_creatives')
            .update({ status: 'review' })
            .eq('id', creative.id);
          results.push({ id: creative.id, channel: 'naver', status: 'review' });
        } else if (creative.channel === 'google') {
          // 구글 — 아직 API 미연동
          await supabaseAdmin
            .from('ad_creatives')
            .update({ status: 'review' })
            .eq('id', creative.id);
          results.push({ id: creative.id, channel: 'google', status: 'review' });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : '배포 실패';
        results.push({ id: creative.id, channel: creative.channel, status: 'error', error: msg });
      }
    }

    return NextResponse.json({
      success: true,
      launched: results.filter(r => r.status === 'active').length,
      review: results.filter(r => r.status === 'review').length,
      errors: results.filter(r => r.status === 'error').length,
      details: results,
    });
  } catch (error) {
    console.error('[launch] 오류:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '배포 실패' },
      { status: 500 }
    );
  }
}

async function launchMeta(creative: any, dailyBudget: number, sb: any): Promise<boolean> {
  // Meta API 키 확인
  const accessToken = process.env.META_ACCESS_TOKEN;
  const adAccountId = process.env.META_AD_ACCOUNT_ID;
  const pageId = process.env.META_PAGE_ID;

  if (!accessToken || !adAccountId || !pageId) {
    // Meta 미설정 → review 상태로만 변경
    await sb.from('ad_creatives').update({ status: 'review' }).eq('id', creative.id);
    return false;
  }

  // 기존 meta-api.ts 함수 활용
  const { createMetaCampaign, createAdSet, uploadCreativeToMeta, createAd, krwToMetaCents } = await import('@/lib/meta-api');

  const pkg = creative.travel_packages;
  const dest = pkg?.destination ?? '여행지';

  // 1. 캠페인
  const campaign = await createMetaCampaign({
    name: `여소남_${dest}_${creative.hook_type}`,
    objective: 'LINK_CLICKS',
  });

  // 2. 광고세트
  const adSet = await createAdSet({
    campaignId: campaign.id,
    name: `${creative.target_segment}_${creative.hook_type}`,
    dailyBudgetCents: krwToMetaCents(dailyBudget, 1350),
    targeting: { age_min: 40, age_max: 65 },
  });

  // 3. 크리에이티브
  const ctaUrl = `https://yeosonam.co.kr/packages/${pkg?.id}?utm_source=meta&utm_medium=paid_social&utm_campaign=${encodeURIComponent(dest)}&utm_content=${creative.creative_type}_${creative.hook_type}_v${creative.variant_index}`;

  const adCreative = await uploadCreativeToMeta({
    name: `${creative.creative_type}_${creative.hook_type}`,
    message: creative.primary_text || creative.headline || '',
    link: ctaUrl,
  });

  // 4. 광고
  const ad = await createAd({
    adsetId: adSet.id,
    creativeId: adCreative.id,
    name: `광고_${creative.hook_type}_v${creative.variant_index}`,
  });

  // 5. DB 업데이트
  const utm = {
    utm_source: 'meta',
    utm_medium: 'paid_social',
    utm_campaign: `yeosonam_${dest.replace(/[\/\s]/g, '-')}`,
    utm_content: `${creative.creative_type}_${creative.hook_type}_v${creative.variant_index}`,
    utm_term: creative.key_selling_point,
  };

  await sb.from('ad_creatives').update({
    meta_campaign_id: campaign.id,
    meta_adset_id: adSet.id,
    meta_ad_id: ad.id,
    meta_creative_id: adCreative.id,
    utm_params: utm,
    status: 'active',
    launched_at: new Date().toISOString(),
  }).eq('id', creative.id);

  // 캠페인 테이블에도 저장
  await sb.from('ad_campaigns').insert({
    package_id: pkg?.id,
    meta_campaign_id: campaign.id,
    meta_adset_id: adSet.id,
    meta_ad_id: ad.id,
    name: `여소남_${dest}_${creative.hook_type}`,
    channel: 'meta',
    status: 'ACTIVE',
    objective: 'LINK_CLICKS',
    daily_budget_krw: dailyBudget,
  });

  return true;
}

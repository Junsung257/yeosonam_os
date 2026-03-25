import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, getCardNewsById, upsertCardNews } from '@/lib/supabase';
import {
  createMetaCampaign,
  createAdSet,
  uploadCreativeToMeta,
  createAd,
  isMetaConfigured,
  krwToMetaCents,
} from '@/lib/meta-api';
import { getRateInfo } from '@/lib/exchange-rate';
import { upsertCampaign } from '@/lib/supabase';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }

  try {
    const cardNews = await getCardNewsById(params.id);
    if (!cardNews) {
      return NextResponse.json({ error: '카드뉴스를 찾을 수 없습니다' }, { status: 404 });
    }

    if (cardNews.status === 'LAUNCHED') {
      return NextResponse.json({ error: '이미 런치된 카드뉴스입니다', status: cardNews.status });
    }

    const body = await request.json().catch(() => ({}));
    const dailyBudgetKrw: number = body.daily_budget_krw ?? 50000;
    const objective: string = body.objective ?? 'LINK_CLICKS';

    // CONFIRMED 상태로 우선 저장 (Meta 실패해도 CONFIRMED 유지)
    await upsertCardNews({
      id: params.id,
      title: cardNews.title,
      status: 'CONFIRMED',
    });

    // Meta API가 설정된 경우 즉시 캠페인 생성
    if (!isMetaConfigured()) {
      return NextResponse.json({
        status: 'CONFIRMED',
        meta_launched: false,
        message: 'Meta API 미설정 — CONFIRMED 상태로 저장됐습니다. 환경변수 설정 후 재시도하세요.',
      });
    }

    const { createClient } = await import('@supabase/supabase-js');
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { rate } = await getRateInfo();
    const campaignName = `${cardNews.title} — ${new Date().toISOString().slice(0, 10)}`;

    // 1. Meta 캠페인 생성
    const metaCampaign = await createMetaCampaign({
      name: campaignName,
      objective,
    });

    // 2. Meta AdSet 생성
    const budgetCents = krwToMetaCents(dailyBudgetKrw, rate);
    const adSet = await createAdSet({
      campaignId: metaCampaign.id,
      name: `${campaignName} - AdSet`,
      dailyBudgetCents: budgetCents,
    });

    // 3. 첫 번째 슬라이드를 광고 소재로 업로드
    const firstSlide = cardNews.slides[0];
    const packageUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://yeosonam.com'}/packages`;
    const messageText = firstSlide
      ? `${firstSlide.headline}\n\n${firstSlide.body}`
      : cardNews.title;

    const metaCreative = await uploadCreativeToMeta({
      name: `${campaignName} - Creative`,
      message: messageText,
      link: packageUrl,
    });

    // 4. Meta 광고 생성
    const metaAd = await createAd({
      adsetId: adSet.id,
      creativeId: metaCreative.id,
      name: `${campaignName} - Ad`,
    });

    // 5. ad_campaigns DB에 저장
    const dbCampaign = await upsertCampaign({
      package_id: cardNews.package_id ?? undefined,
      name: campaignName,
      objective: objective as any,
      daily_budget_krw: dailyBudgetKrw,
      status: 'PAUSED',
      meta_campaign_id: metaCampaign.id,
      meta_adset_id: adSet.id,
      meta_ad_id: metaAd.id,
    });

    // 6. card_news 상태를 LAUNCHED로 업데이트
    await upsertCardNews({
      id: params.id,
      title: cardNews.title,
      status: 'LAUNCHED',
      campaign_id: dbCampaign?.id ?? null,
      meta_creative_id: metaCreative.id,
    });

    // 7. audit_logs 기록
    await sb.from('audit_logs').insert({
      action: 'CARD_NEWS_LAUNCHED',
      target_type: 'card_news',
      target_id: params.id,
      description: `카드뉴스 Meta 런치: ${campaignName}`,
      after_value: {
        meta_campaign_id: metaCampaign.id,
        meta_ad_id: metaAd.id,
        daily_budget_krw: dailyBudgetKrw,
      },
    });

    return NextResponse.json({
      status: 'LAUNCHED',
      meta_launched: true,
      meta_campaign_id: metaCampaign.id,
      meta_adset_id: adSet.id,
      meta_ad_id: metaAd.id,
      meta_creative_id: metaCreative.id,
      campaign_db_id: dbCampaign?.id,
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : '런치 실패';
    console.error('카드뉴스 런치 실패:', error);

    // META_TOKEN_EXPIRED 감지
    if (errMsg.includes('META_TOKEN_EXPIRED')) {
      const { createClient } = await import('@supabase/supabase-js');
      const sb = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );
      sb.from('audit_logs').insert({
        action: 'META_TOKEN_EXPIRED',
        target_type: 'card_news',
        target_id: params.id,
        description: errMsg,
      });
    }

    return NextResponse.json({ error: errMsg, status: 'CONFIRMED' }, { status: 500 });
  }
}

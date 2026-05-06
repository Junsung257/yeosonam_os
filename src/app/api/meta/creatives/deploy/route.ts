import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabase';
import { uploadCreativeToMeta, createAd, isMetaConfigured } from '@/lib/meta-api';
import { getSecret } from '@/lib/secret-registry';

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }

  if (!isMetaConfigured()) {
    return NextResponse.json({ error: 'Meta API 미설정 (META_ACCESS_TOKEN, META_AD_ACCOUNT_ID 확인)' }, { status: 503 });
  }

  try {
    const { creative_id, campaign_id, package_url } = await request.json();

    if (!creative_id || !campaign_id) {
      return NextResponse.json({ error: 'creative_id, campaign_id 필수' }, { status: 400 });
    }

    const { createClient } = await import('@supabase/supabase-js');
    const sb = createClient(
      getSecret('NEXT_PUBLIC_SUPABASE_URL')!,
      getSecret('NEXT_PUBLIC_SUPABASE_ANON_KEY')!
    );

    // 소재 조회
    const { data: creative } = await sb
      .from('ad_creatives')
      .select('*')
      .eq('id', creative_id)
      .single();

    if (!creative) {
      return NextResponse.json({ error: '소재를 찾을 수 없습니다' }, { status: 404 });
    }

    // 캠페인 조회 (adset_id 필요)
    const { data: campaign } = await sb
      .from('ad_campaigns')
      .select('meta_adset_id, name')
      .eq('id', campaign_id)
      .single();

    if (!campaign?.meta_adset_id) {
      return NextResponse.json(
        { error: '캠페인에 Meta adset_id가 없습니다. 캠페인을 먼저 Meta에 배포하세요.' },
        { status: 400 }
      );
    }

    // 소재 복사본 텍스트 준비
    const messageText = creative.headline
      ? `${creative.headline}\n\n${creative.body_copy}`
      : creative.body_copy;

    const targetUrl = package_url ?? `${getSecret('NEXT_PUBLIC_APP_URL') ?? 'https://yeosonam.com'}/packages`;

    // Meta에 소재 업로드
    const metaCreative = await uploadCreativeToMeta({
      name: `${creative.platform}-v${creative.variant_index}-${creative_id.slice(0, 8)}`,
      message: messageText,
      link: targetUrl,
    });

    // Meta 광고 생성
    const metaAd = await createAd({
      adsetId: campaign.meta_adset_id,
      creativeId: metaCreative.id,
      name: `${campaign.name} - ${creative.platform} v${creative.variant_index}`,
    });

    // DB 업데이트
    await sb.from('ad_creatives').update({
      meta_creative_id: metaCreative.id,
      is_deployed: true,
      campaign_id,
    }).eq('id', creative_id);

    // 캠페인의 meta_ad_id도 저장 (마지막 배포 광고)
    await sb.from('ad_campaigns').update({
      meta_ad_id: metaAd.id,
    }).eq('id', campaign_id);

    return NextResponse.json({
      meta_creative_id: metaCreative.id,
      meta_ad_id: metaAd.id,
      deployed: true,
    });
  } catch (error) {
    console.error('소재 배포 실패:', error);

    // META_TOKEN_EXPIRED 특별 처리
    const errMsg = error instanceof Error ? error.message : '배포 실패';
    if (errMsg.includes('META_TOKEN_EXPIRED')) {
      // audit_logs에 기록
      try {
        const { createClient } = await import('@supabase/supabase-js');
        const sb = createClient(
          getSecret('NEXT_PUBLIC_SUPABASE_URL')!,
          getSecret('NEXT_PUBLIC_SUPABASE_ANON_KEY')!
        );
        await sb.from('audit_logs').insert({
          action: 'META_TOKEN_EXPIRED',
          target_type: 'campaign',
          description: errMsg,
        });
      } catch { /* 로깅 실패는 무시 */ }
    }

    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

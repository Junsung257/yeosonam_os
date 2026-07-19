import { NextRequest, NextResponse } from 'next/server';

import {
  attachPublicPackagesToCampaignCreatives,
  CAMPAIGN_CREATIVE_PUBLIC_FIELDS,
  type CampaignCreativeWithPublicPackage,
} from '@/lib/campaign-public-packages';
import { requireAdminRequest } from '@/lib/admin-guard';
import { createAd, isMetaConfigured, uploadCreativeToMeta } from '@/lib/meta-api';
import { getSecret } from '@/lib/secret-registry';
import { isSupabaseConfigured } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;

  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 연동이 설정되지 않았습니다.' }, { status: 503 });
  }

  if (!isMetaConfigured()) {
    return NextResponse.json(
      { error: 'Meta API 연동이 설정되지 않았습니다. META_ACCESS_TOKEN, META_AD_ACCOUNT_ID를 확인해 주세요.' },
      { status: 503 },
    );
  }

  try {
    const { creative_id, campaign_id } = await request.json();

    if (!creative_id || !campaign_id) {
      return NextResponse.json({ error: 'creative_id와 campaign_id가 필요합니다.' }, { status: 400 });
    }

    const { createClient } = await import('@supabase/supabase-js');
    const sb = createClient(
      getSecret('NEXT_PUBLIC_SUPABASE_URL')!,
      getSecret('NEXT_PUBLIC_SUPABASE_ANON_KEY')!,
    );

    const { data: creative } = await sb
      .from('ad_creatives')
      .select(CAMPAIGN_CREATIVE_PUBLIC_FIELDS)
      .eq('id', creative_id)
      .single();

    if (!creative) {
      return NextResponse.json({ error: '광고 소재를 찾을 수 없습니다.' }, { status: 404 });
    }

    const [deployableCreative] = await attachPublicPackagesToCampaignCreatives(
      sb,
      [creative as unknown as CampaignCreativeWithPublicPackage],
    );
    const pkg = deployableCreative?.travel_packages;
    if (!pkg?.id) {
      return NextResponse.json(
        { error: 'PUBLIC_SNAPSHOT_REQUIRED_FOR_META_CREATIVE_DEPLOY' },
        { status: 409 },
      );
    }

    const { data: campaign } = await sb
      .from('ad_campaigns')
      .select('meta_adset_id, name')
      .eq('id', campaign_id)
      .single();

    if (!campaign?.meta_adset_id) {
      return NextResponse.json(
        { error: '광고 소재를 배포하려면 캠페인이 먼저 Meta에 배포되어 있어야 합니다.' },
        { status: 400 },
      );
    }

    const messageText = [
      deployableCreative.headline,
      deployableCreative.primary_text ?? deployableCreative.body ?? deployableCreative.description,
    ]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .join('\n\n');

    const targetUrl = `${getSecret('NEXT_PUBLIC_APP_URL') ?? 'https://yeosonam.com'}/packages/${pkg.id}`;
    const variant = deployableCreative.variant_index ?? 1;
    const channel = deployableCreative.channel ?? 'meta';

    const metaCreative = await uploadCreativeToMeta({
      name: `${channel}-v${variant}-${creative_id.slice(0, 8)}`,
      message: messageText,
      link: targetUrl,
    });

    const metaAd = await createAd({
      adsetId: campaign.meta_adset_id,
      creativeId: metaCreative.id,
      name: `${campaign.name} - ${channel} v${variant}`,
    });

    await sb.from('ad_creatives').update({
      meta_creative_id: metaCreative.id,
      is_deployed: true,
      campaign_id,
    }).eq('id', creative_id);

    await sb.from('ad_campaigns').update({
      meta_ad_id: metaAd.id,
    }).eq('id', campaign_id);

    return NextResponse.json({
      meta_creative_id: metaCreative.id,
      meta_ad_id: metaAd.id,
      deployed: true,
    });
  } catch (error) {
    console.error('[meta creative deploy] failed:', error);
    const message = error instanceof Error ? error.message : '광고 소재 배포에 실패했습니다.';

    if (message.includes('META_TOKEN_EXPIRED')) {
      try {
        const { createClient } = await import('@supabase/supabase-js');
        const sb = createClient(
          getSecret('NEXT_PUBLIC_SUPABASE_URL')!,
          getSecret('NEXT_PUBLIC_SUPABASE_ANON_KEY')!,
        );
        await sb.from('audit_logs').insert({
          action: 'META_TOKEN_EXPIRED',
          target_type: 'campaign',
          description: message,
        });
      } catch {
        // Ignore audit-log write failures while reporting the deploy error.
      }
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, getAdCampaigns, upsertCampaign } from '@/lib/supabase';
import {
  createMetaCampaign,
  createAdSet,
  isMetaConfigured,
  krwToMetaCents,
} from '@/lib/meta-api';
import { getRateInfo } from '@/lib/exchange-rate';
import type { CreateCampaignRequest } from '@/types/meta-ads';

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }

  const { searchParams } = request.nextUrl;
  const packageId = searchParams.get('package_id') ?? undefined;
  const status = searchParams.get('status') as any ?? undefined;
  const page = parseInt(searchParams.get('page') ?? '1');
  const limit = parseInt(searchParams.get('limit') ?? '20');

  try {
    const campaigns = await getAdCampaigns({ packageId, status, page, limit });
    return NextResponse.json({ campaigns });
  } catch (error) {
    console.error('캠페인 목록 조회 실패:', error);
    return NextResponse.json({ error: '조회 실패' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }

  try {
    const body: CreateCampaignRequest = await request.json();

    if (!body.package_id || !body.name || !body.daily_budget_krw) {
      return NextResponse.json(
        { error: 'package_id, name, daily_budget_krw 필수' },
        { status: 400 }
      );
    }

    // DB에 DRAFT 상태로 먼저 저장
    const campaign = await upsertCampaign({
      package_id: body.package_id,
      name: body.name,
      objective: body.objective ?? 'LINK_CLICKS',
      daily_budget_krw: body.daily_budget_krw,
      status: 'DRAFT',
    });

    if (!campaign) {
      return NextResponse.json({ error: '캠페인 저장 실패' }, { status: 500 });
    }

    // Meta API 연동이 설정된 경우에만 실제 캠페인 생성
    if (isMetaConfigured()) {
      try {
        const { rate } = await getRateInfo();

        // Meta 캠페인 생성
        const metaCampaign = await createMetaCampaign({
          name: body.name,
          objective: body.objective ?? 'LINK_CLICKS',
        });

        // Meta 광고 세트 생성
        const budgetCents = krwToMetaCents(body.daily_budget_krw, rate);
        const adSet = await createAdSet({
          campaignId: metaCampaign.id,
          name: `${body.name} - AdSet`,
          dailyBudgetCents: budgetCents,
          targeting: body.targeting,
        });

        // DB 업데이트 — Meta ID 저장
        await upsertCampaign({
          id: campaign.id,
          meta_campaign_id: metaCampaign.id,
          meta_adset_id: adSet.id,
          status: 'PAUSED', // Meta에 생성됐으나 아직 비활성
        });

        return NextResponse.json({
          campaign: { ...campaign, meta_campaign_id: metaCampaign.id, meta_adset_id: adSet.id, status: 'PAUSED' },
          meta_created: true,
        }, { status: 201 });
      } catch (metaError) {
        const errMsg = metaError instanceof Error ? metaError.message : '알 수 없는 오류';
        // Meta 오류여도 DB 저장은 성공 — DRAFT 상태로 반환
        return NextResponse.json({
          campaign,
          meta_created: false,
          meta_error: errMsg,
        }, { status: 201 });
      }
    }

    return NextResponse.json({ campaign, meta_created: false }, { status: 201 });
  } catch (error) {
    console.error('캠페인 생성 실패:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '캠페인 생성 실패' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/campaigns/launch
 * 선택된 소재를 Meta/네이버/구글에 배포
 */

import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { hasSecrets } from '@/lib/secret-registry';
import { isCustomerPubliclyOpenable } from '@/lib/package-public-eligibility';
import { fetchAndMergeCurrentPublicPackageCardSnapshots } from '@/lib/package-publication/snapshot-projection';
import { isPublicPublicationState } from '@/lib/package-publication/types';
import { isSupabaseConfigured } from '@/lib/supabase';

type AnyRecord = Record<string, any>;
type CampaignLaunchCreative = AnyRecord & {
  id: string;
  product_id?: string | null;
  channel: string;
  travel_packages?: AnyRecord | null;
};

const CAMPAIGN_LAUNCH_CREATIVE_FIELDS =
  'id, product_id, channel, creative_type, variant_index, hook_type, target_segment, key_selling_point, primary_text, headline, status';

const CAMPAIGN_LAUNCH_PACKAGE_FIELDS =
  'id, destination, status, publication_state, package_revision, audit_status, audit_report, updated_at, optional_tours, itinerary_data';

function isCampaignPublicSnapshotCandidate(row: unknown): row is Record<string, unknown> {
  if (!row || typeof row !== 'object') return false;
  const item = row as Record<string, unknown>;
  const publicationState = typeof item.publication_state === 'string' ? item.publication_state : null;
  return isPublicPublicationState(publicationState) && isCustomerPubliclyOpenable(item);
}

async function loadPublicPackagesForCampaignLaunch(
  sb: SupabaseClient,
  creatives: AnyRecord[],
): Promise<Map<string, AnyRecord>> {
  const productIds = [...new Set(
    creatives
      .map((creative) => typeof creative.product_id === 'string' ? creative.product_id : null)
      .filter((id): id is string => Boolean(id)),
  )];
  if (productIds.length === 0) return new Map();

  const { data, error } = await sb
    .from('travel_packages')
    .select(CAMPAIGN_LAUNCH_PACKAGE_FIELDS)
    .in('id', productIds)
    .in('publication_state', ['approved', 'published']);
  if (error) throw error;

  const publicRows = await fetchAndMergeCurrentPublicPackageCardSnapshots(
    sb,
    ((data ?? []) as Array<Record<string, unknown>>).filter(isCampaignPublicSnapshotCandidate),
  );
  return new Map(publicRows.map((row) => [String(row.id), row as AnyRecord]));
}

export async function POST(request: NextRequest) {
  try {
    const { creative_ids, budgets = {} } = await request.json();

    if (!creative_ids?.length) {
      return NextResponse.json({ error: 'creative_ids 필수' }, { status: 400 });
    }

    if (!isSupabaseConfigured) {
      return NextResponse.json(
        { error: 'Supabase 연동이 설정되지 않아 캠페인 소재를 배포할 수 없습니다.' },
        { status: 503 },
      );
    }

    const { supabaseAdmin } = await import('@/lib/supabase');

    // 소재 조회
    const { data: creatives, error: fetchErr } = await supabaseAdmin
      .from('ad_creatives')
      .select(CAMPAIGN_LAUNCH_CREATIVE_FIELDS)
      .in('id', creative_ids);

    if (fetchErr || !creatives?.length) {
      return NextResponse.json({ error: '소재 조회 실패' }, { status: 404 });
    }

    const creativeRows = creatives as CampaignLaunchCreative[];
    const publicPackagesById = await loadPublicPackagesForCampaignLaunch(
      supabaseAdmin,
      creativeRows,
    );
    const launchableCreatives: CampaignLaunchCreative[] = creativeRows.map((creative) => {
      const productId = typeof creative.product_id === 'string' ? creative.product_id : '';
      return {
        ...creative,
        travel_packages: publicPackagesById.get(productId) ?? null,
      };
    });
    const blockedCreatives = launchableCreatives.filter((creative) => !creative.travel_packages);
    if (blockedCreatives.length > 0) {
      return NextResponse.json({
        error: 'PUBLIC_SNAPSHOT_REQUIRED_FOR_CAMPAIGN_LAUNCH',
        blocked_creative_ids: blockedCreatives.map((creative) => creative.id),
      }, { status: 409 });
    }

    const results: { id: string; channel: string; status: string; error?: string }[] = [];

    for (const creative of launchableCreatives) {
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
  if (!hasSecrets(['META_ACCESS_TOKEN', 'META_AD_ACCOUNT_ID', 'META_PAGE_ID'])) {
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

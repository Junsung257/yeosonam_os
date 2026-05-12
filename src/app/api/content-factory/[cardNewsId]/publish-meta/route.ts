import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { isAdminRequest } from '@/lib/admin-guard';
import { publishToMetaAds } from '@/lib/content-pipeline/publishers/meta-ads-publisher';
import { getSecret } from '@/lib/secret-registry';

// ── POST /api/content-factory/[cardNewsId]/publish-meta ────────────────────
// Content Hub 메타 광고 직접 발행.
// 카드뉴스 1x1 렌더 이미지를 기반으로 Meta 캠페인을 생성+발행.
export async function POST(
  request: NextRequest,
  { params }: { params: { cardNewsId: string } }
) {
  if (!(await isAdminRequest(request))) return NextResponse.json({ error: 'admin 권한 필요' }, { status: 403 });
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  const { cardNewsId } = params;
  const body = await request.json().catch(() => ({})) as {
    campaign_name?: string;
    daily_budget_krw?: number;
    primary_text?: string;
    headline?: string;
    description?: string;
    cta_button?: string;
  };

  try {
    // 1. 카드뉴스 + 렌더 조회
    const { data: cn } = await supabaseAdmin
      .from('card_news')
      .select('id, title, package_id, slides')
      .eq('id', cardNewsId)
      .maybeSingle();
    if (!cn) return NextResponse.json({ error: '카드뉴스 없음' }, { status: 404 });

    const { data: renders } = await supabaseAdmin
      .from('card_news_renders')
      .select('url, slide_index')
      .eq('card_news_id', cardNewsId)
      .eq('format', '1x1')
      .order('slide_index');

    const renderRows = (renders ?? []) as Array<{ url: string; slide_index: number }>;
    const hasRenders = renderRows.some(r => r.url);
    if (!hasRenders) {
      return NextResponse.json({ error: '1x1 렌더 이미지가 없습니다. 먼저 렌더를 완료하세요.' }, { status: 400 });
    }

    // 2. landing URL 결정
    const appUrl = getSecret('NEXT_PUBLIC_APP_URL') ?? `https://${process.env.VERCEL_URL ?? 'localhost:3000'}`;
    const landingUrl = cn.package_id
      ? `${appUrl}/packages/${cn.package_id}`
      : appUrl;

    // 3. Meta 광고 발행
    const result = await publishToMetaAds({
      primary_texts: [body.primary_text ?? cn.title ?? '특별 여행 상품을 만나보세요'],
      headlines: [body.headline ?? cn.title ?? '지금 예약하세요'],
      descriptions: body.description ? [body.description] : [],
      cta_button: body.cta_button ?? 'LEARN_MORE',
      landing_url: landingUrl,
      daily_budget_krw: body.daily_budget_krw ?? 10000,
    });

    // 4. content_distributions 기록
    const { data: dist } = await supabaseAdmin
      .from('content_distributions')
      .insert({
        product_id: cn.package_id ?? null,
        card_news_id: cardNewsId,
        platform: 'meta_ads',
        status: result.status === 'published' ? 'published' : result.status === 'draft' ? 'draft' : 'failed',
        external_id: result.campaign_id ?? null,
        external_url: result.external_url ?? null,
        payload: {
          campaign_id: result.campaign_id,
          adset_id: result.adset_id,
          ad_ids: result.ad_ids,
          test_mode: result.test_mode,
          error: result.error,
        },
      })
      .select('id')
      .maybeSingle();

    // 5. content_factory_jobs.steps.meta_ads 업데이트
    try {
      const { data: jobRow } = await supabaseAdmin
        .from('content_factory_jobs')
        .select('steps, completed_steps, failed_steps')
        .eq('card_news_id', cardNewsId)
        .maybeSingle();

      if (jobRow) {
        const stepStatus = result.status === 'published' || result.status === 'draft' ? 'done' : 'failed';
        const steps = { ...(jobRow.steps as Record<string, unknown>) };
        const prev = (steps.meta_ads as Record<string, unknown> | undefined)?.status;
        steps.meta_ads = { status: stepStatus, updated_at: new Date().toISOString(), error: result.error ?? null };
        await supabaseAdmin
          .from('content_factory_jobs')
          .update({
            steps,
            ...(stepStatus === 'done' && prev !== 'done' ? { completed_steps: (jobRow.completed_steps ?? 0) + 1 } : {}),
            ...(stepStatus === 'failed' && prev !== 'failed' ? { failed_steps: (jobRow.failed_steps ?? 0) + 1 } : {}),
          })
          .eq('card_news_id', cardNewsId);
      }
    } catch {
      // 스텝 업데이트 실패는 발행 결과에 영향 없음
    }

    return NextResponse.json({
      ok: result.status !== 'error',
      status: result.status,
      campaign_id: result.campaign_id,
      ad_ids: result.ad_ids,
      external_url: result.external_url,
      test_mode: result.test_mode,
      distribution_id: dist?.id ?? null,
      error: result.error,
    });
  } catch (err) {
    console.error('[publish-meta]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '메타 광고 발행 실패' },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { isAdminRequest } from '@/lib/admin-guard';
import { updateFactoryJobStep } from '@/lib/content-factory-step';

// ── GET /api/content-factory/[cardNewsId] ──────────────────────────────────
// Content Hub 폴링 API: 카드뉴스 1개의 전 채널 상태를 집계해 반환
export async function GET(
  request: NextRequest,
  { params }: { params: { cardNewsId: string } }
) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  const { cardNewsId } = params;

  try {
    // 1) content_factory_jobs
    const { data: job } = await supabaseAdmin
      .from('content_factory_jobs')
      .select('*')
      .eq('card_news_id', cardNewsId)
      .maybeSingle();

    // 2) card_news + renders
    const { data: cn, error: cnErr } = await supabaseAdmin
      .from('card_news')
      .select('id, title, status, template_family, template_version, slides, package_id, linked_blog_id, ig_publish_status, ig_scheduled_for, ig_post_id, brand_kit_id')
      .eq('id', cardNewsId)
      .maybeSingle();

    if (cnErr || !cn) {
      return NextResponse.json({ error: '카드뉴스를 찾을 수 없습니다' }, { status: 404 });
    }

    const slideCount = Array.isArray(cn.slides) ? cn.slides.length : 0;

    const { data: renders } = await supabaseAdmin
      .from('card_news_renders')
      .select('format, url, slide_index, template_version')
      .eq('card_news_id', cardNewsId)
      .order('slide_index');

    // 3) 블로그
    let blog = null;
    if (cn.linked_blog_id) {
      const { data: bl } = await supabaseAdmin
        .from('content_creatives')
        .select('id, seo_title, status, slug, seo_description')
        .eq('id', cn.linked_blog_id)
        .maybeSingle();
      if (bl) {
        blog = {
          id: bl.id,
          title: bl.seo_title ?? null,
          status: bl.status ?? null,
          url: bl.slug ? `/blog/${bl.slug}` : null,
        };
      }
    }

    // 4) 인스타 상태
    const ig = {
      status: cn.ig_publish_status ?? 'idle',
      post_id: cn.ig_post_id ?? null,
      scheduled_for: cn.ig_scheduled_for ?? null,
    };

    // 5) content_distributions (Meta Ads / 기타 채널)
    let distributions: unknown[] = [];
    if (cn.package_id) {
      const { data: dists } = await supabaseAdmin
        .from('content_distributions')
        .select('id, platform, status, scheduled_for, created_at')
        .eq('product_id', cn.package_id)
        .order('created_at', { ascending: false })
        .limit(10);
      distributions = dists ?? [];
    }

    const metaAds = (distributions as any[]).filter(d =>
      (d.platform as string)?.toLowerCase().includes('meta')
    );

    // 6) 테넌트 채널 정보 (product_id → tenants → instagram_accounts, brand_kits)
    let tenantChannels: { ig_account: { display_name: string; is_active: boolean } | null; brand_kit: { code: string; name: string } | null } = {
      ig_account: null,
      brand_kit: null,
    };

    if (cn.package_id) {
      const { data: pkg } = await supabaseAdmin
        .from('travel_packages')
        .select('tenant_id')
        .eq('id', cn.package_id)
        .maybeSingle();

      if (pkg?.tenant_id) {
        // instagram_accounts 테이블은 P2에서 생성. 미리 준비된 쿼리.
        const { data: igAcc } = await supabaseAdmin
          .from('instagram_accounts')
          .select('display_name, is_active')
          .eq('tenant_id', pkg.tenant_id)
          .eq('is_active', true)
          .maybeSingle()
          .then((r: { data: { display_name: string; is_active: boolean } | null; error: unknown }) => r)
          .catch(() => ({ data: null, error: null }));

        // brand_kit_id가 있으면 해당 kit, 없으면 yeosonam 기본 kit
        const cnBrandKitId = (cn as Record<string, unknown>).brand_kit_id as string | null | undefined;
        const { data: bk } = await supabaseAdmin
          .from('brand_kits')
          .select('code, name')
          .eq('is_active', true)
          .eq(cnBrandKitId ? 'id' : 'code', cnBrandKitId ?? 'yeosonam')
          .maybeSingle();

        tenantChannels = {
          ig_account: igAcc ? { display_name: igAcc.display_name, is_active: igAcc.is_active } : null,
          brand_kit: bk ? { code: bk.code, name: bk.name } : null,
        };
      }
    }

    return NextResponse.json({
      job: job ?? null,
      card_news: {
        id: cn.id,
        title: cn.title,
        status: cn.status,
        template_family: cn.template_family ?? null,
        template_version: cn.template_version ?? null,
        slide_count: slideCount,
        renders: renders ?? [],
        ig_publish_status: cn.ig_publish_status ?? null,
        ig_scheduled_for: cn.ig_scheduled_for ?? null,
        linked_blog_id: cn.linked_blog_id ?? null,
        package_id: cn.package_id ?? null,
      },
      blog,
      ig,
      meta_ads: metaAds,
      distributions,
      tenant_channels: tenantChannels,
    });
  } catch (err) {
    console.error('[content-factory GET]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '조회 실패' },
      { status: 500 }
    );
  }
}

// ── POST /api/content-factory/[cardNewsId] ─────────────────────────────────
// action: 'start' → orchestrator 호출 + job 상태 running으로 전환
export async function POST(
  request: NextRequest,
  { params }: { params: { cardNewsId: string } }
) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: 'admin 권한 필요' }, { status: 403 });
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  const { cardNewsId } = params;
  const body = await request.json().catch(() => ({}));
  const { action } = body as { action?: string };

  if (action !== 'start') {
    return NextResponse.json({ error: 'action=start 필요' }, { status: 400 });
  }

  try {
    // 카드뉴스 + product_id 조회
    const { data: cn } = await supabaseAdmin
      .from('card_news')
      .select('id, package_id, linked_blog_id')
      .eq('id', cardNewsId)
      .maybeSingle();

    if (!cn) return NextResponse.json({ error: '카드뉴스 없음' }, { status: 404 });

    // job 상태 running으로 업데이트 (없으면 insert)
    await supabaseAdmin
      .from('content_factory_jobs')
      .upsert({
        card_news_id: cardNewsId,
        product_id: cn.package_id ?? null,
        status: 'running',
        started_at: new Date().toISOString(),
      }, { onConflict: 'card_news_id' });

    // orchestrator 호출 (fire-and-forget)
    if (cn.package_id) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? `https://${process.env.VERCEL_URL ?? 'localhost:3000'}`;
      fetch(`${appUrl}/api/orchestrator/auto-publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: cn.package_id,
          publishNow: false,
          dryRun: false,
        }),
      })
        .then(async r => {
          const data = await r.json().catch(() => ({}));
          // orchestrator 결과를 steps에 반영
          if (data.distributions?.length) {
            const hasMeta = (data.distributions as any[]).some(d => d.platform?.includes('meta'));
            const hasIg = (data.distributions as any[]).some(d => d.platform === 'instagram_caption');
            if (hasMeta) updateFactoryJobStep(cardNewsId, 'meta_ads', 'done');
            if (hasIg) updateFactoryJobStep(cardNewsId, 'ig_publish', 'queued');
          }
          await supabaseAdmin
            .from('content_factory_jobs')
            .update({ status: 'partial' })
            .eq('card_news_id', cardNewsId);
        })
        .catch(() => {});
    }

    return NextResponse.json({ ok: true, status: 'running' });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '시작 실패' },
      { status: 500 }
    );
  }
}

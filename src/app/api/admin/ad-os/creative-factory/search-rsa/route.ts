import { NextRequest, NextResponse } from 'next/server';
import { generateGoogleAdsRSA } from '@/lib/content-pipeline/agents/google-ads-rsa';
import type { ContentBrief } from '@/lib/validators/content-brief';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

function cleanText(value: unknown, fallback = ''): string {
  return String(value || fallback).trim();
}

function intValue(value: unknown): number | undefined {
  const num = Number(value || 0);
  return Number.isFinite(num) && num > 0 ? Math.round(num) : undefined;
}

function buildBrief(pkg: Record<string, any>, keywords: string[]): ContentBrief {
  const title = cleanText(pkg.title, '여행 상품');
  const destination = cleanText(pkg.destination, '');
  const audience = destination ? `${destination} 여행을 검토하는 고객` : '맞춤 여행 상담 고객';
  const points = [
    destination ? `${destination} 맞춤 일정` : '맞춤 일정',
    '상담 후 견적 확정',
    '검수된 여행 상품',
  ];

  return ({
    mode: 'product',
    h1: title.slice(0, 80),
    intro_hook: `${title} 검색광고 소재 자동 생성`,
    target_audience: audience.slice(0, 100),
    key_selling_points: points.slice(0, 5),
    sections: [
      {
        position: 1,
        h2: '상품 핵심',
        role: 'benefit',
        blog_paragraph_seed: `${title}의 핵심 혜택과 상담 전환 포인트를 요약합니다.`,
        card_slide: {
          headline: '맞춤 여행',
          body: keywords[0] || title,
          template_suggestion: 'bold-quote',
          pexels_keyword: destination || 'travel',
        },
      },
      {
        position: 2,
        h2: '신뢰 포인트',
        role: 'detail',
        blog_paragraph_seed: '가격, 일정, 포함사항을 상담으로 확인하도록 유도합니다.',
        card_slide: {
          headline: '상담 확정',
          body: '일정과 견적 확인',
          template_suggestion: 'checklist',
          pexels_keyword: destination || 'tour',
        },
      },
      {
        position: 3,
        h2: '전환 유도',
        role: 'cta',
        blog_paragraph_seed: '방문자가 상담 또는 상품 상세 페이지로 이동하도록 유도합니다.',
        card_slide: {
          headline: '견적 문의',
          body: '지금 상담하기',
          template_suggestion: 'cta',
          pexels_keyword: destination || 'trip',
        },
      },
    ],
    cta_slide: {
      headline: '상담하기',
      body: '맞춤 견적 받기',
      template_suggestion: 'cta',
      pexels_keyword: destination || 'travel',
    },
    seo: {
      title: `${title} 검색광고`.slice(0, 70),
      description: `${title} 검색광고 RSA 소재 초안입니다.`.slice(0, 200),
      slug_suggestion: `ads-${String(pkg.id || 'package').slice(0, 32)}`,
    },
  } as unknown) as ContentBrief;
}

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const apply = body.apply === true;
  const tenantId = body.tenant_id ? String(body.tenant_id) : null;
  const productId = body.product_id ? String(body.product_id) : null;
  const limit = Math.min(Math.max(Number(body.limit || 1), 1), 5);

  const { data: run, error: runError } = await supabaseAdmin
    .from('ad_os_automation_runs')
    .insert({
      run_type: 'creative_asset_group',
      platform: 'google',
      status: 'running',
      trigger_source: 'admin_api',
      started_at: new Date().toISOString(),
      config: { apply, tenant_id: tenantId, product_id: productId, source: 'search_rsa_v1' },
      summary: { external_spend_krw: 0, external_api_write: false },
    })
    .select('id')
    .single();

  if (runError || !run) {
    return NextResponse.json({ ok: false, error: runError?.message || 'run create failed' }, { status: 500 });
  }

  let packageQuery = supabaseAdmin.from('travel_packages').select('*').order('created_at', { ascending: false }).limit(limit);
  if (productId) packageQuery = packageQuery.eq('id', productId);
  const { data: packages, error: packageError } = await packageQuery;

  if (packageError || !packages?.length) {
    const message = packageError?.message || 'No package found for RSA generation.';
    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message }] })
      .eq('id', run.id);
    return NextResponse.json({ ok: false, error: message }, { status: packageError ? 500 : 404 });
  }

  const packageIds = packages.map((pkg: any) => pkg.id).filter(Boolean);
  let keywordQuery = supabaseAdmin
    .from('search_ad_keyword_plans')
    .select('id, package_id, keyword_text, platform, suggested_bid_krw, landing_url, utm_url, opportunity_score')
    .eq('platform', 'google')
    .in('package_id', packageIds)
    .in('plan_status', ['candidate', 'approved', 'testing'])
    .order('opportunity_score', { ascending: false })
    .limit(80);
  if (tenantId) keywordQuery = keywordQuery.eq('tenant_id', tenantId);
  const { data: keywordPlans, error: keywordError } = await keywordQuery;

  if (keywordError) {
    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: keywordError.message }] })
      .eq('id', run.id);
    return NextResponse.json({ ok: false, error: keywordError.message }, { status: 500 });
  }

  const generated = [];
  for (const pkg of packages as Record<string, any>[]) {
    const planRows = (keywordPlans || []).filter((row: any) => row.package_id === pkg.id);
    const targetKeywords = Array.from(new Set([
      ...((Array.isArray(body.target_keywords) ? body.target_keywords : []) as unknown[]).map((value) => cleanText(value)).filter(Boolean),
      ...planRows.map((row: any) => cleanText(row.keyword_text)).filter(Boolean),
      cleanText(pkg.destination),
      cleanText(pkg.title),
    ])).slice(0, 10);

    const rsa = await generateGoogleAdsRSA({
      brief: buildBrief(pkg, targetKeywords),
      product: {
        title: cleanText(pkg.title, '여행 상품'),
        destination: cleanText(pkg.destination) || undefined,
        duration: intValue(pkg.duration_days || pkg.duration),
        nights: intValue(pkg.nights),
        price: intValue(pkg.price || pkg.adult_price || pkg.base_price),
        product_summary: cleanText(pkg.description || pkg.summary || pkg.short_description) || undefined,
        product_highlights: targetKeywords.slice(0, 5),
      },
      target_keywords: targetKeywords,
    });

    const finalUrl = cleanText(body.final_url) || cleanText(rsa.final_url_suggestion) || `/packages/${pkg.id}`;
    const bodyText = rsa.descriptions.join('\n');
    const rows = rsa.headlines.map((headline, index) => ({
      tenant_id: tenantId,
      product_id: pkg.id,
      run_id: run.id,
      idempotency_key: `google-rsa:${pkg.id}:${headline}:${index}`.slice(0, 240),
      platform: 'google',
      asset_type: 'rsa_headline',
      lifecycle_status: 'draft',
      angle: rsa.core_keywords[index % Math.max(rsa.core_keywords.length, 1)] || 'search',
      audience: 'search_intent',
      headline,
      body: bodyText,
      cta: '상담하기',
      destination_url: finalUrl,
      performance_snapshot: { source_quality: 'draft', external_spend_krw: 0 },
      generation_payload: {
        rsa,
        target_keywords: targetKeywords,
        keyword_plan_ids: planRows.map((row: any) => row.id).filter(Boolean),
        source: 'search_rsa_v1',
      },
    }));

    generated.push({ product: { id: pkg.id, title: pkg.title, destination: pkg.destination }, rsa, variants: rows });
  }

  let insertedVariants: any[] = [];
  let changeRequests = 0;
  if (apply) {
    const variantRows = generated.flatMap((item) => item.variants);
    if (variantRows.length > 0) {
      const { data, error } = await supabaseAdmin
        .from('ad_os_creative_asset_variants')
        .upsert(variantRows as never, { onConflict: 'idempotency_key' })
        .select('*');
      if (error) {
        await supabaseAdmin
          .from('ad_os_automation_runs')
          .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: error.message }] })
          .eq('id', run.id);
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }
      insertedVariants = data || [];
    }

    if (insertedVariants.length > 0) {
      const { error } = await supabaseAdmin.from('ad_os_change_requests').insert(
        insertedVariants.slice(0, 20).map((variant: any) => ({
          tenant_id: variant.tenant_id || null,
          run_id: run.id,
          platform: 'google',
          automation_level: 2,
          request_type: 'create_creative_draft',
          target_table: 'ad_os_creative_asset_variants',
          target_id: variant.id,
          status: 'proposed',
          title: `Google RSA 소재 초안 승인: ${String(variant.headline || '').slice(0, 40)}`,
          reason: 'Search Ads RSA draft generated from Ad OS product and keyword signals.',
          risk_level: 'medium',
          expected_impact: { external_spend_krw: 0, external_api_write: false },
          proposed_change: { lifecycle_status: 'approved' },
          rollback_payload: { lifecycle_status: 'draft' },
          approval_required: true,
        })) as never,
      );
      if (error) {
        await supabaseAdmin
          .from('ad_os_automation_runs')
          .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: error.message }] })
          .eq('id', run.id);
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }
      changeRequests = Math.min(insertedVariants.length, 20);
    }
  }

  const summary = {
    apply,
    products_checked: packages.length,
    rsa_sets_generated: generated.length,
    variants_generated: generated.reduce((sum, item) => sum + item.variants.length, 0),
    variants_inserted: insertedVariants.length,
    change_requests_created: changeRequests,
    external_spend_krw: 0,
    external_api_write: false,
  };

  await supabaseAdmin
    .from('ad_os_automation_runs')
    .update({ status: 'completed', finished_at: new Date().toISOString(), summary })
    .eq('id', run.id);

  return NextResponse.json({
    ok: true,
    run_id: run.id,
    dry_run: !apply,
    summary,
    generated,
  });
});

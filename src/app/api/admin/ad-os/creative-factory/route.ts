import { NextRequest } from 'next/server';
import { buildCreativeFactoryDrafts } from '@/lib/ad-os-v13-v18';
import { withAdminGuard } from '@/lib/admin-guard';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
}

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return apiResponse({ ok: false, error: 'Service unavailable' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const apply = body.apply !== false;
  const packageId = typeof body.package_id === 'string' ? body.package_id : null;
  const limit = Math.min(Math.max(Number(body.limit || 6), 1), 12);

  const packageQuery = supabaseAdmin
    .from('travel_packages')
    .select('id,title,destination,tenant_id')
    .order('created_at', { ascending: false })
    .limit(1);
  const packageRes = packageId ? await packageQuery.eq('id', packageId).maybeSingle() : await packageQuery.maybeSingle();
  if (packageRes.error) return apiResponse({ ok: false, error: sanitizeDbError(packageRes.error) }, { status: 500 });
  const pkg = packageRes.data as { id: string; title: string | null; destination: string | null; tenant_id?: string | null } | null;
  if (!pkg) return apiResponse({ ok: false, error: 'No package found for creative factory' }, { status: 404 });

  const drafts = buildCreativeFactoryDrafts({
    destination: pkg.destination || 'travel',
    productTitle: pkg.title,
  }).slice(0, limit);

  const rows = drafts.map((draft) => {
    const channel = draft.channel === 'naver_search' ? 'naver_blog' : 'instagram_card';
    const title = draft.headline;
    return {
      tenant_id: pkg.tenant_id || null,
      product_id: pkg.id,
      angle_type: draft.angle,
      target_audience: draft.angle,
      channel,
      image_ratio: channel === 'instagram_card' ? '4:5' : '1:1',
      slides: [
        { type: 'hook', text: draft.headline },
        { type: 'proof', text: draft.brief },
        { type: 'cta', text: 'Check package availability before ticketing deadline.' },
      ],
      ad_copy: {
        headline: draft.headline,
        brief: draft.brief,
        guardrails: draft.guardrails,
        publish_mode: draft.publishMode,
      },
      tone: 'professional',
      status: 'draft',
      slug: `${slugify(`${pkg.destination || 'travel'}-${draft.angle}-${pkg.id}`)}`,
      seo_title: title,
      seo_description: draft.brief,
      category: 'ad_os_creative_factory',
      prompt_version: 'ad_os_v17_creative_factory',
      ai_model: 'rules_plus_ai_ready',
      sub_keyword: draft.headline,
      generation_params: {
        ad_os_v: 'v17',
        product_title: pkg.title,
        destination: pkg.destination,
      },
      topic_source: 'ad_os_creative_factory',
      generation_meta: {
        source: 'ad_os_creative_factory',
        angle: draft.angle,
        publish_policy: 'draft_only',
      },
      destination: pkg.destination || null,
      target_ad_keywords: [draft.headline],
      landing_headline: draft.headline,
      landing_subtitle: draft.brief,
      landing_enabled: false,
      content_type: draft.angle === 'anxiety' || draft.angle === 'comparison' ? 'guide' : 'product_ad',
      source: 'ad_os',
      cta_text: '상품 문의하기',
      metrics: {
        ad_os_v: 'v17',
        draft_only: true,
        auto_publish_allowed: false,
      },
    };
  });

  let inserted: Array<{ id: string }> = [];
  if (apply && rows.length > 0) {
    const { data, error } = await supabaseAdmin.from('content_creatives').insert(rows).select('id');
    if (error) return apiResponse({ ok: false, error: sanitizeDbError(error) }, { status: 500 });
    inserted = data || [];
  }

  return apiResponse({
    ok: true,
    applied: apply,
    package: pkg,
    prepared_drafts: rows.length,
    inserted_drafts: inserted.length,
    drafts: rows,
    inserted,
    safety: {
      publish_policy: 'draft_only',
      auto_publish_allowed: false,
    },
  });
});

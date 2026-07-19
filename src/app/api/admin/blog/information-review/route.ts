import { NextRequest } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { supabaseAdmin } from '@/lib/supabase';
import { verifySupabaseAccessToken } from '@/lib/supabase-jwt-verify';
import { prepareBlogForPublish } from '@/lib/blog-publish-quality';
import { revalidatePublicBlogCache } from '@/lib/revalidate-blog-cache';
import {
  executeBlogInformationEvidenceWorkflow,
} from '@/lib/blog-information-review-workflow';
import type { BlogInformationPlannerInput } from '@/lib/blog-information-planner';
import type { BlogInformationResearchBundle } from '@/lib/blog-information-evidence';
import {
  createBlogInformationEvidenceWorkflowStore,
  getBlogInformationReviewQueue,
  publishBlogInformationReviewedDraft,
  submitBlogInformationReviewDecision,
} from '@/lib/blog-information-review-repository';

export const dynamic = 'force-dynamic';

async function readActorId(request: NextRequest): Promise<string | null> {
  const token = request.cookies.get('sb-access-token')?.value;
  if (!token) return null;
  const verified = await verifySupabaseAccessToken(token);
  return verified.ok && typeof verified.payload?.sub === 'string' ? verified.payload.sub : null;
}

export const GET = withAdminGuard(async (request: NextRequest) => {
  const limit = Number(request.nextUrl.searchParams.get('limit') ?? 50);
  const queue = await getBlogInformationReviewQueue(limit);
  return apiResponse({ ok: true, queue }, { headers: { 'Cache-Control': 'private, no-store' } });
});

export const POST = withAdminGuard(async (request: NextRequest) => {
  try {
    const body = await request.json() as {
      action?: 'research' | 'decision' | 'publish';
      creative_id?: string;
      planner?: BlogInformationPlannerInput;
      research_bundle?: BlogInformationResearchBundle | null;
      decision?: 'approved' | 'rejected' | 'changes_requested';
      note?: string | null;
    };
    if (!body.creative_id || !body.action) {
      return apiResponse({ error: 'creative_id and action are required' }, { status: 400 });
    }
    const actorId = await readActorId(request);

    if (body.action === 'research') {
      if (!body.planner) return apiResponse({ error: 'planner is required' }, { status: 400 });
      const { data: creative, error } = await supabaseAdmin
        .from('content_creatives')
        .select('id, slug, blog_html, seo_title, seo_description, destination, tenant_id, product_id, generation_meta')
        .eq('id', body.creative_id)
        .single();
      if (error || !creative) return apiResponse({ error: 'Draft not found' }, { status: 404 });
      if (creative.product_id) {
        return apiResponse({ error: 'Product content is outside the informational review workflow' }, { status: 409 });
      }
      if (!creative.slug || !creative.blog_html) {
        return apiResponse({ error: 'Draft slug and body are required' }, { status: 422 });
      }
      const workflow = await executeBlogInformationEvidenceWorkflow({
        creativeId: creative.id,
        contentKey: creative.slug,
        markdown: creative.blog_html,
        seoTitle: creative.seo_title,
        seoDescription: creative.seo_description,
        slug: creative.slug,
        productId: null,
        tenantId: creative.tenant_id,
        plannerInput: {
          ...body.planner,
          destination: body.planner.destination ?? creative.destination,
        },
        expectedScope: {
          destination: creative.destination ?? undefined,
          applicableTo: body.planner.travelerNationality ?? undefined,
          locale: body.planner.locale ?? undefined,
        },
      }, {
        researcher: { research: async () => body.research_bundle ?? null },
        store: createBlogInformationEvidenceWorkflowStore({
          creativeId: creative.id,
          contentKey: creative.slug,
          tenantId: creative.tenant_id,
          generationMeta: creative.generation_meta,
        }),
      });
      return apiResponse({ ok: true, workflow });
    }

    if (body.action === 'decision') {
      if (!body.decision) return apiResponse({ error: 'decision is required' }, { status: 400 });
      const result = await submitBlogInformationReviewDecision({
        creativeId: body.creative_id,
        actorId,
        status: body.decision,
        note: body.note,
      });
      if (!result.handled) return apiResponse({ error: 'Information review case not found' }, { status: 404 });
      return apiResponse({ ok: true, ...result });
    }

    const { data: creative, error: creativeError } = await supabaseAdmin
      .from('content_creatives')
      .select('id, slug, blog_html, seo_title, seo_description, destination, angle_type, product_id')
      .eq('id', body.creative_id)
      .single();
    if (creativeError || !creative) return apiResponse({ error: 'Draft not found' }, { status: 404 });
    if (creative.product_id || !creative.slug || !creative.blog_html) {
      return apiResponse({ error: 'A complete informational draft is required' }, { status: 409 });
    }
    const prepared = await prepareBlogForPublish({
      id: creative.id,
      blog_html: creative.blog_html,
      slug: creative.slug,
      seo_title: creative.seo_title,
      seo_description: creative.seo_description,
      destination: creative.destination,
      angle_type: creative.angle_type,
      product_id: null,
      primary_keyword: creative.destination || creative.seo_title || creative.slug,
      excludeContentCreativeId: creative.id,
    });
    if (!prepared.report.passed) {
      return apiResponse({ error: 'Blog publish quality gate failed', quality: prepared.report }, { status: 422 });
    }
    if (prepared.blogHtml !== creative.blog_html) {
      return apiResponse({ error: 'Publish preparation changed reviewed content; save and review again' }, { status: 409 });
    }
    const result = await publishBlogInformationReviewedDraft({
      creativeId: creative.id,
      actorId,
      qualityGate: prepared.report.qualityGate,
    });
    if (!result.handled) return apiResponse({ error: 'Information review case not found' }, { status: 404 });
    revalidatePublicBlogCache(result.slug ?? null, creative.destination);
    return apiResponse({ ok: true, status: 'published', ...result });
  } catch (error) {
    const detail = sanitizeDbError(error, 'Information review workflow failed');
    const status = /reapproval|required|not_publishable|revalidation/.test(detail) ? 409 : 500;
    return apiResponse({ error: detail }, { status });
  }
});

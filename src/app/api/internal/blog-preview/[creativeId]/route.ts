import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { cronUnauthorizedResponse, isCronOrVercelAuthorized } from '@/lib/cron-auth';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase';
import {
  BLOG_BROWSER_PUBLIC_META_KEY,
  BLOG_BROWSER_PREVIEW_META_KEY,
  BLOG_BROWSER_PREVIEW_VERSION,
  createBlogPreviewContentHash,
  createBlogPreviewToken,
} from '@/lib/blog-browser-preview-v4';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RouteContext = { params: Promise<{ creativeId: string }> };

type BrowserAuditSurface = 'preview' | 'public';

async function loadCreative(creativeId: string, surface: BrowserAuditSurface) {
  if (!UUID.test(creativeId) || !isSupabaseAdminConfigured) return null;
  const { data, error } = await supabaseAdmin
    .from('content_creatives')
    .select('id,slug,seo_title,seo_description,blog_html,generation_meta,status,channel,updated_at')
    .eq('id', creativeId)
    .eq('status', surface === 'preview' ? 'draft' : 'published')
    .eq('channel', 'naver_blog')
    .maybeSingle();
  if (error || !data?.slug) return null;
  return data;
}

export async function GET(request: NextRequest, context: RouteContext) {
  if (!isCronOrVercelAuthorized(request)) return cronUnauthorizedResponse();
  const { creativeId } = await context.params;
  const surface: BrowserAuditSurface = request.nextUrl.searchParams.get('surface') === 'public' ? 'public' : 'preview';
  const draft = await loadCreative(creativeId, surface);
  if (!draft) return apiResponse({ error: `${surface}_creative_not_found` }, { status: 404 });
  const contentHash = createBlogPreviewContentHash({
    slug: draft.slug,
    title: draft.seo_title,
    description: draft.seo_description,
    markdown: draft.blog_html,
  });
  const token = surface === 'preview'
    ? createBlogPreviewToken({ creativeId, slug: draft.slug, ttlSeconds: 600 })
    : null;
  return apiResponse({
    creativeId,
    surface,
    contentHash,
    previewPath: surface === 'preview'
      ? `/blog/${encodeURIComponent(draft.slug)}?preview=${encodeURIComponent(token!)}`
      : `/blog/${encodeURIComponent(draft.slug)}`,
    expiresInSeconds: surface === 'preview' ? 600 : null,
    requiredScore: 95,
  });
}

export async function POST(request: NextRequest, context: RouteContext) {
  if (!isCronOrVercelAuthorized(request)) return cronUnauthorizedResponse();
  const { creativeId } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return apiResponse({ error: 'invalid_json' }, { status: 400 });
  const surface: BrowserAuditSurface = body.surface === 'public' ? 'public' : 'preview';
  const draft = await loadCreative(creativeId, surface);
  if (!draft) return apiResponse({ error: `${surface}_creative_not_found` }, { status: 404 });
  const expectedHash = createBlogPreviewContentHash({
    slug: draft.slug,
    title: draft.seo_title,
    description: draft.seo_description,
    markdown: draft.blog_html,
  });
  if (body.contentHash !== expectedHash) {
    return apiResponse({ error: 'preview_content_hash_mismatch' }, { status: 409 });
  }
  const score = Number(body.score);
  const mobileScore = Number(body.mobileScore);
  const desktopScore = Number(body.desktopScore);
  if (![score, mobileScore, desktopScore].every((value) => Number.isFinite(value) && value >= 0 && value <= 100)) {
    return apiResponse({ error: 'invalid_preview_scores' }, { status: 400 });
  }
  const issues = Array.isArray(body.issues)
    ? body.issues.filter((issue): issue is string => typeof issue === 'string').slice(0, 50)
    : [];
  const passed = score >= 95 && mobileScore >= 95 && desktopScore >= 95 && issues.length === 0;
  const generationMeta = draft.generation_meta && typeof draft.generation_meta === 'object'
    ? draft.generation_meta as Record<string, unknown>
    : {};
  const evidence = {
    version: BLOG_BROWSER_PREVIEW_VERSION,
    passed,
    score,
    mobileScore,
    desktopScore,
    auditedAt: new Date().toISOString(),
    previewPath: surface === 'preview' ? `/blog/${draft.slug}?preview=redacted` : `/blog/${draft.slug}`,
    issues,
    evaluator: 'playwright' as const,
    contentHash: expectedHash,
  };
  const { data: updated, error } = await supabaseAdmin
    .from('content_creatives')
    .update({
      generation_meta: {
        ...generationMeta,
        [surface === 'preview' ? BLOG_BROWSER_PREVIEW_META_KEY : BLOG_BROWSER_PUBLIC_META_KEY]: evidence,
      },
    })
    .eq('id', creativeId)
    .eq('status', surface === 'preview' ? 'draft' : 'published')
    .eq('updated_at', draft.updated_at)
    .select('id')
    .maybeSingle();
  if (error || !updated) {
    return apiResponse({ error: error?.message || `${surface}_browser_evidence_update_conflict` }, { status: 409 });
  }
  return apiResponse({ creativeId, surface, evidence });
}

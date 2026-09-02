import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { cronUnauthorizedResponse, isCronOrVercelAuthorized } from '@/lib/cron-auth';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase';
import {
  createBlogPreviewContentHash,
  readBlogBrowserPublicEvidenceV4,
  readBlogBrowserPreviewEvidenceV4,
} from '@/lib/blog-browser-preview-v4';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (!isCronOrVercelAuthorized(request)) return cronUnauthorizedResponse();
  if (!isSupabaseAdminConfigured) {
    return apiResponse({ pending: [], count: 0, reason: 'supabase_not_configured' });
  }

  const requestedLimit = Number(request.nextUrl.searchParams.get('limit') || 5);
  const limit = Math.max(1, Math.min(10, Number.isFinite(requestedLimit) ? Math.trunc(requestedLimit) : 5));
  const { data: runs, error: runError } = await supabaseAdmin
    .from('blog_generation_runs')
    .select('id,content_creative_id,scheduled_publish_at')
    .eq('status', 'approved_for_slot')
    .not('content_creative_id', 'is', null)
    .order('scheduled_publish_at', { ascending: true })
    .limit(limit * 3);
  if (runError) {
    return apiResponse({ error: `approved_run_query_failed:${runError.message}` }, { status: 503 });
  }

  const runByCreativeId = new Map<string, { id: string; scheduled_publish_at: string | null }>();
  for (const run of runs ?? []) {
    const creativeId = String(run.content_creative_id || '');
    if (creativeId && !runByCreativeId.has(creativeId)) {
      runByCreativeId.set(creativeId, {
        id: String(run.id),
        scheduled_publish_at: run.scheduled_publish_at ? String(run.scheduled_publish_at) : null,
      });
    }
  }
  const creativeIds = [...runByCreativeId.keys()];
  const publishedSince = new Date(Date.now() - 7 * 24 * 60 * 60 * 1_000).toISOString();
  const [draftResult, publishedResult] = await Promise.all([
    creativeIds.length > 0
      ? supabaseAdmin
          .from('content_creatives')
          .select('id,slug,seo_title,seo_description,blog_html,generation_meta')
          .in('id', creativeIds)
          .eq('status', 'draft')
          .eq('channel', 'naver_blog')
      : Promise.resolve({ data: [], error: null }),
    supabaseAdmin
      .from('content_creatives')
      .select('id,slug,seo_title,seo_description,blog_html,generation_meta,published_at')
      .eq('status', 'published')
      .eq('channel', 'naver_blog')
      .gte('published_at', publishedSince)
      .order('published_at', { ascending: false })
      .limit(limit * 3),
  ]);
  if (draftResult.error || publishedResult.error) {
    return apiResponse({
      error: `browser_audit_query_failed:${draftResult.error?.message || publishedResult.error?.message}`,
    }, { status: 503 });
  }

  const pendingPreviews = (draftResult.data ?? []).flatMap((creative) => {
    const contentHash = createBlogPreviewContentHash({
      slug: String(creative.slug || ''),
      title: creative.seo_title,
      description: creative.seo_description,
      markdown: creative.blog_html,
    });
    const evidence = readBlogBrowserPreviewEvidenceV4(creative.generation_meta);
    // One audit per immutable content hash. A failed audit is a terminal gate,
    // not an endlessly retried browser/network workflow.
    if (evidence?.contentHash === contentHash) {
      return [];
    }
    const run = runByCreativeId.get(String(creative.id));
    return [{
      runId: run?.id ?? null,
      creativeId: String(creative.id),
      slug: String(creative.slug || ''),
      surface: 'preview' as const,
      scheduledPublishAt: run?.scheduled_publish_at ?? null,
      reason: evidence ? 'failed_or_stale_evidence' : 'evidence_missing',
    }];
  });

  const pendingPublic = (publishedResult.data ?? []).flatMap((creative) => {
    const contentHash = createBlogPreviewContentHash({
      slug: String(creative.slug || ''),
      title: creative.seo_title,
      description: creative.seo_description,
      markdown: creative.blog_html,
    });
    const evidence = readBlogBrowserPublicEvidenceV4(creative.generation_meta);
    if (evidence?.contentHash === contentHash) return [];
    return [{
      runId: null,
      creativeId: String(creative.id),
      slug: String(creative.slug || ''),
      surface: 'public' as const,
      scheduledPublishAt: creative.published_at ? String(creative.published_at) : null,
      reason: evidence ? 'failed_or_stale_public_evidence' : 'public_evidence_missing',
    }];
  });

  const pending = [...pendingPreviews, ...pendingPublic].slice(0, limit);

  return apiResponse({ pending, count: pending.length });
}

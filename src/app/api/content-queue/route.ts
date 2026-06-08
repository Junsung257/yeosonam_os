import { NextRequest, NextResponse } from 'next/server';
import { cacheHeader } from '@/lib/api-response';
import { revalidatePath } from 'next/cache';
import { withAdminGuard } from '@/lib/admin-guard';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import {
  applyBlogPublishQualityToUpdate,
  blogPublishQualityWarnings,
  evaluateBlogPublishQuality,
  resolveBlogDestination,
} from '@/lib/blog-publish-quality';

const BLOG_SELECT = 'id, slug, seo_title, seo_description, og_image_url, blog_html, angle_type, channel, status, tracking_id, tone, created_at, updated_at, published_at, product_id, destination, travel_packages(id, title, destination)';

const getHandler = async (request: NextRequest) => {
  if (!isSupabaseConfigured) return NextResponse.json({ queue: [] });

  const { searchParams } = request.nextUrl;
  const status = searchParams.get('status') || 'draft';
  const limit = Math.min(100, parseInt(searchParams.get('limit') ?? '50'));

  try {
    const { data, error, count } = await supabaseAdmin
      .from('content_creatives')
      .select(BLOG_SELECT, { count: 'exact' })
      .eq('channel', 'naver_blog')
      .eq('status', status)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    const { count: pendingCount } = await supabaseAdmin
      .from('content_creatives')
      .select('id', { count: 'exact', head: true })
      .eq('channel', 'naver_blog')
      .eq('status', 'draft');

    return NextResponse.json({
      queue: data || [],
      total: count ?? 0,
      pending_count: pendingCount ?? 0,
    }, { headers: cacheHeader(60) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Query failed' }, { status: 500 });
  }
};

const postHandler = async (request: NextRequest) => {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB not configured' }, { status: 503 });

  try {
    const body = await request.json();
    const { creative_id, action, slug, seo_title, seo_description, og_image_url, reject_reason } = body as {
      creative_id: string;
      action: 'approve' | 'reject';
      slug?: string;
      seo_title?: string;
      seo_description?: string;
      og_image_url?: string;
      reject_reason?: string;
    };

    if (!creative_id || !action) {
      return NextResponse.json({ error: 'creative_id and action are required' }, { status: 400 });
    }

    if (action === 'approve') {
      if (!slug) {
        return NextResponse.json({ error: 'slug is required before publishing' }, { status: 400 });
      }
      if (!/^[\p{Letter}\p{Number}]+(?:-[\p{Letter}\p{Number}]+)*$/u.test(slug) || slug.length > 200) {
        return NextResponse.json({ error: 'slug format is invalid' }, { status: 400 });
      }

      const { data: existing, error: existingError } = await supabaseAdmin
        .from('content_creatives')
        .select(BLOG_SELECT)
        .eq('id', creative_id)
        .limit(1);
      if (existingError) throw existingError;
      const row = existing?.[0] as {
        blog_html?: string | null;
        slug?: string | null;
        seo_title?: string | null;
        seo_description?: string | null;
        destination?: string | null;
        angle_type?: string | null;
        product_id?: string | null;
        travel_packages?: { destination?: string | null } | Array<{ destination?: string | null }> | null;
      } | undefined;
      if (!row?.blog_html) {
        return NextResponse.json({ error: 'blog_html is missing' }, { status: 400 });
      }

      const finalTitle = seo_title ?? row.seo_title ?? null;
      const finalDescription = seo_description ?? row.seo_description ?? null;
      const destination = resolveBlogDestination(row);
      const qaReport = await evaluateBlogPublishQuality({
        id: creative_id,
        blog_html: row.blog_html,
        slug,
        seo_title: finalTitle,
        seo_description: finalDescription,
        destination,
        angle_type: row.angle_type ?? null,
        product_id: row.product_id ?? null,
        primary_keyword: destination || finalTitle || slug,
        excludeContentCreativeId: creative_id,
      });
      if (!qaReport.passed) {
        return NextResponse.json({
          error: 'Blog publish quality gate failed',
          summary: qaReport.summary,
          quality_warnings: blogPublishQualityWarnings(qaReport),
          quality_gate: qaReport.qualityGate,
          seo_score: qaReport.seoScore,
          readability: qaReport.readability,
        }, { status: 422 });
      }

      const updateData: Record<string, unknown> = {
        status: 'published',
        published_at: new Date().toISOString(),
        slug,
      };
      if (seo_title) updateData.seo_title = seo_title;
      if (seo_description) updateData.seo_description = seo_description;
      if (og_image_url) updateData.og_image_url = og_image_url;
      applyBlogPublishQualityToUpdate(updateData, qaReport);

      const { error } = await supabaseAdmin
        .from('content_creatives')
        .update(updateData)
        .eq('id', creative_id);

      if (error) throw error;

      revalidatePath('/blog');
      revalidatePath(`/blog/${slug}`);
      if (destination) revalidatePath(`/blog/destination/${encodeURIComponent(destination)}`);

      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.yeosonam.com';
      const { notifyIndexing } = await import('@/lib/indexing');
      notifyIndexing(`${baseUrl}/blog/${slug}`, baseUrl)
        .then(r => console.log(`[content-queue approve] indexing notified: google=${r.google}, indexnow=${r.indexnow}`))
        .catch(() => {});

      return NextResponse.json({ ok: true, status: 'published', seo_score: qaReport.seoScore.score });
    }

    if (action === 'reject') {
      const { error } = await supabaseAdmin
        .from('content_creatives')
        .update({
          status: 'archived',
          extra_prompt: reject_reason ? `[rejected] ${reject_reason}` : undefined,
        })
        .eq('id', creative_id);

      if (error) throw error;
      return NextResponse.json({ ok: true, status: 'archived' });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Processing failed' }, { status: 500 });
  }
};

export const GET = withAdminGuard(getHandler);
export const POST = withAdminGuard(postHandler);

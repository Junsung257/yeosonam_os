import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { isAdminRequest } from '@/lib/admin-guard';
import { notifyIndexing } from '@/lib/indexing';
import { revalidatePath } from 'next/cache';

/**
 * POST /api/blog/bulk-reindex
 *
 * 발행된 모든 블로그 글에 Google Indexing API + IndexNow 색인 요청.
 * Google Indexing API 일 200회 제한 → batchSize=200 기본.
 *
 * Body (선택):
 *   { batchSize?: number; dryRun?: boolean; since?: string }
 *   - batchSize: 한 번에 처리할 최대 수 (기본 200)
 *   - dryRun: true면 DB 조회만 하고 실제 알림 X
 *   - since: ISO 날짜 — 이 날짜 이후 발행된 글만 처리 (예: "2026-04-01")
 */
export async function POST(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'admin 권한 필요' }, { status: 403 });
  }
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const batchSize = Math.min(200, Math.max(1, Number(body.batchSize) || 200));
  const dryRun = body.dryRun === true;
  const since = body.since as string | undefined;

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.yeosonam.com';

  try {
    let query = supabaseAdmin
      .from('content_creatives')
      .select('id, slug, published_at')
      .eq('status', 'published')
      .eq('channel', 'naver_blog')
      .not('slug', 'is', null)
      .order('published_at', { ascending: false })
      .limit(batchSize);

    if (since) query = query.gte('published_at', since);

    const { data, error } = await query;
    if (error) throw error;

    const posts = (data || []) as Array<{ id: string; slug: string; published_at: string }>;

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        found: posts.length,
        slugs: posts.map(p => p.slug),
      });
    }

    // ISR 캐시 무효화 + Indexing API 알림 (순차 처리, 500ms 간격 — rate limit 방어)
    const results: Array<{ slug: string; google: string; indexnow: string; google_error?: string; indexnow_error?: string }> = [];
    for (const post of posts) {
      revalidatePath(`/blog/${post.slug}`);
      const url = `${baseUrl}/blog/${post.slug}`;
      try {
        const report = await notifyIndexing(url, baseUrl);
        results.push({ slug: post.slug, google: report.google, indexnow: report.indexnow, google_error: report.google_error, indexnow_error: report.indexnow_error });
      } catch {
        results.push({ slug: post.slug, google: 'error', indexnow: 'error' });
      }
      // 500ms 딜레이 — Google Indexing API 200req/day 준수
      await new Promise(r => setTimeout(r, 500));
    }

    revalidatePath('/blog');

    const googleOk = results.filter(r => r.google === 'success').length;
    const indexnowOk = results.filter(r => r.indexnow === 'success').length;

    return NextResponse.json({
      processed: results.length,
      google_success: googleOk,
      indexnow_success: indexnowOk,
      results,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '처리 실패' },
      { status: 500 },
    );
  }
}

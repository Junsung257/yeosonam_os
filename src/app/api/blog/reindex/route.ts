import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { notifyIndexing } from '@/lib/indexing';

/**
 * POST /api/blog/reindex
 *
 * 관리자가 수동으로 특정 블로그를 재색인 요청.
 *
 * Body:
 *   { id?: string; slug?: string; }
 *   - id 또는 slug 중 하나 필수
 *
 * Response:
 *   { report: IndexingReport }
 */
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  }

  try {
    const body = await request.json();
    const { id, slug } = body as { id?: string; slug?: string };

    if (!id && !slug) {
      return NextResponse.json({ error: 'id 또는 slug 필수' }, { status: 400 });
    }

    // 블로그 조회 (slug 확인 + 발행 상태 검증)
    let query = supabaseAdmin
      .from('content_creatives')
      .select('id, slug, status')
      .eq('channel', 'naver_blog');
    query = id ? query.eq('id', id) : query.eq('slug', slug as string);

    const { data, error } = await query.limit(1);
    if (error) throw error;
    if (!data || data.length === 0) {
      return NextResponse.json({ error: '블로그 글을 찾을 수 없습니다.' }, { status: 404 });
    }

    const post = data[0] as { slug: string; status: string };
    if (post.status !== 'published') {
      return NextResponse.json(
        { error: `발행된 글만 재색인 가능합니다. (현재 상태: ${post.status})` },
        { status: 400 },
      );
    }
    if (!post.slug) {
      return NextResponse.json({ error: 'slug가 없는 글은 재색인 불가' }, { status: 400 });
    }

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com';
    const url = `${baseUrl}/blog/${post.slug}`;

    const report = await notifyIndexing(url, baseUrl);

    return NextResponse.json({ report });
  } catch (err) {
    console.error('[blog/reindex] 오류:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '재색인 실패' },
      { status: 500 },
    );
  }
}

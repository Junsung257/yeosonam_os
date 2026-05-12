import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  try {
    const body = await request.json();
    const { creative_id, action } = body; // action: 'publish' | 'archive'

    if (!creative_id) return NextResponse.json({ error: 'creative_id 필요' }, { status: 400 });

    const status =
      action === 'archive' ? 'archived' :
      action === 'manually_published' ? 'manually_published' :
      'published';
    const updateData: Record<string, unknown> = { status };
    if (status === 'published' || status === 'manually_published') {
      updateData.published_at = new Date().toISOString();
    }

    const { error } = await supabaseAdmin
      .from('content_creatives')
      .update(updateData)
      .eq('id', creative_id);

    if (error) throw error;

    // 발행 시 블로그 캐시 즉시 갱신
    if (status === 'published' || status === 'manually_published') {
      revalidatePath('/blog');

      // slug가 있으면 상세 페이지도 갱신
      const { data: creative } = await supabaseAdmin
        .from('content_creatives')
        .select('slug, product_id, travel_packages(destination)')
        .eq('id', creative_id)
        .limit(1);
      const row = creative?.[0] as any;
      if (row?.slug) revalidatePath(`/blog/${row.slug}`);
      if (row?.travel_packages?.destination) {
        revalidatePath(`/blog/destination/${encodeURIComponent(row.travel_packages.destination)}`);
      }

      // 통합 색인 알림 (Google Indexing API + IndexNow)
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com';
      if (row?.slug) {
        const { notifyIndexing } = await import('@/lib/indexing');
        notifyIndexing(`${baseUrl}/blog/${row.slug}`, baseUrl)
          .then(r => console.log(`[content-hub/publish] indexing notified: google=${r.google}, indexnow=${r.indexnow}`))
          .catch(() => {});
      }
    }

    return NextResponse.json({ ok: true, status });
  } catch (err) {
    console.error('[content-hub/publish] 오류:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : '발행 실패' }, { status: 500 });
  }
}

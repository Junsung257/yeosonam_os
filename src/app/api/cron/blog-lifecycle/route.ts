import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

/**
 * 블로그 라이프사이클 크론 — 매일 1:30 KST 실행
 *
 * 수행:
 *   1) status='published' AND product_id IS NOT NULL 인 블로그 스캔
 *   2) 연결된 travel_packages 가 archived 이거나 모든 출발일+발권기한 지났으면
 *      → content_creatives.status='archived' 전환
 *   3) ISR 캐시 무효화
 *
 * 설계 의도:
 *   상품 블로그는 상품 수명과 함께 죽는다.
 *   정보성 블로그(product_id IS NULL)는 절대 건드리지 않는다 (영구 SEO 자산).
 */
export async function GET() {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ skipped: true, reason: 'Supabase 미설정' });
  }

  const today = new Date().toISOString().split('T')[0];
  let archivedCount = 0;
  const archived: Array<{ slug: string; reason: string }> = [];

  try {
    // 상품 연결된 발행 글만 대상
    const { data: posts, error } = await supabaseAdmin
      .from('content_creatives')
      .select('id, slug, product_id, travel_packages(id, status, ticketing_deadline, price_dates)')
      .eq('channel', 'naver_blog')
      .eq('status', 'published')
      .not('product_id', 'is', null);

    if (error) throw error;
    if (!posts || posts.length === 0) {
      return NextResponse.json({ archivedCount: 0, message: '상품 연결 글 없음' });
    }

    const toArchive: Array<{ id: string; slug: string; reason: string }> = [];

    for (const post of posts) {
      const pkg = Array.isArray(post.travel_packages) ? post.travel_packages[0] : post.travel_packages;
      if (!pkg) {
        // FK가 NULL로 세팅됐거나 상품이 지워짐 → 아카이브
        toArchive.push({ id: post.id, slug: post.slug, reason: 'linked_product_missing' });
        continue;
      }

      // 상품 자체가 archived → 블로그도 archived
      if (pkg.status === 'archived' || pkg.status === 'rejected') {
        toArchive.push({ id: post.id, slug: post.slug, reason: `product_${pkg.status}` });
        continue;
      }

      // 출발일 + 발권기한 모두 과거면 상품은 살아있어도 블로그 색인 가치 낮음
      const priceDates = Array.isArray(pkg.price_dates) ? pkg.price_dates as Array<{ date?: string }> : [];
      const futureDates = priceDates.filter(pd => pd.date && pd.date >= today);
      const deadlineAlive = pkg.ticketing_deadline && pkg.ticketing_deadline >= today;

      if (futureDates.length === 0 && !deadlineAlive && priceDates.length > 0) {
        toArchive.push({ id: post.id, slug: post.slug, reason: 'all_dates_past' });
      }
    }

    if (toArchive.length > 0) {
      const { error: upErr } = await supabaseAdmin
        .from('content_creatives')
        .update({ status: 'archived' })
        .in('id', toArchive.map(t => t.id));

      if (upErr) throw upErr;

      // ISR 무효화 — 목록 + 각 슬러그
      try { revalidatePath('/blog'); } catch { /* noop */ }
      for (const t of toArchive) {
        try { revalidatePath(`/blog/${t.slug}`); } catch { /* noop */ }
        archived.push({ slug: t.slug, reason: t.reason });
      }
      archivedCount = toArchive.length;
    }

    console.log(`[blog-lifecycle] ${archivedCount}개 블로그 아카이브`);
    return NextResponse.json({ archivedCount, archived, checkedAt: new Date().toISOString() });
  } catch (err) {
    console.error('[blog-lifecycle] 오류:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '라이프사이클 처리 실패' },
      { status: 500 },
    );
  }
}

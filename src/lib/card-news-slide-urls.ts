import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

/**
 * 블로그(from-card-news)·퍼블리셔가 사용하는 슬라이드 공개 URL 목록.
 * card_news.slide_image_urls 우선, 비어 있으면 card_news_renders 폴백.
 *
 * @param formats 조회할 렌더 포맷 우선순위 목록 (앞쪽 format 우선). 기본: ['1x1']
 *   블로그 가로 이미지가 필요하면 ['blog', '1x1'] 를 전달.
 */
export async function getSlideImagePublicUrlsForBlog(
  cardNewsId: string,
  formats: string[] = ['1x1'],
): Promise<string[]> {
  if (!isSupabaseConfigured) return [];

  const { data: row } = await supabaseAdmin
    .from('card_news')
    .select('slide_image_urls')
    .eq('id', cardNewsId)
    .maybeSingle();

  const direct = (row?.slide_image_urls as string[] | null) ?? [];
  if (direct.length > 0) return direct;

  // 요청된 포맷 목록 중 첫 번째로 일치하는 format의 렌더를 반환
  for (const fmt of formats) {
    const { data: renders } = await supabaseAdmin
      .from('card_news_renders')
      .select('slide_index, url, rendered_at')
      .eq('card_news_id', cardNewsId)
      .eq('format', fmt)
      .order('rendered_at', { ascending: false, nullsFirst: false })
      .order('slide_index', { ascending: true });

    if (!renders || renders.length === 0) continue;

    const latestBySlide = new Map<number, string>();
    for (const r of renders as Array<{ slide_index: number; url: string | null }>) {
      if (latestBySlide.has(r.slide_index)) continue;
      if (typeof r.url !== 'string' || r.url.length === 0) continue;
      latestBySlide.set(r.slide_index, r.url);
    }
    if (latestBySlide.size > 0) {
      return [...latestBySlide.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, url]) => url);
    }
  }

  return [];
}

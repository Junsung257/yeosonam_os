import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

/**
 * 블로그(from-card-news)·퍼블리셔가 사용하는 슬라이드 공개 URL 목록.
 * card_news.slide_image_urls 우선, 비어 있으면 card_news_renders(1x1) 폴백.
 */
export async function getSlideImagePublicUrlsForBlog(cardNewsId: string): Promise<string[]> {
  if (!isSupabaseConfigured) return [];

  const { data: row } = await supabaseAdmin
    .from('card_news')
    .select('slide_image_urls')
    .eq('id', cardNewsId)
    .maybeSingle();

  const direct = (row?.slide_image_urls as string[] | null) ?? [];
  if (direct.length > 0) return direct;

  const { data: renders } = await supabaseAdmin
    .from('card_news_renders')
    .select('slide_index, url, rendered_at')
    .eq('card_news_id', cardNewsId)
    .eq('format', '1x1')
    .order('rendered_at', { ascending: false, nullsFirst: false })
    .order('slide_index', { ascending: true });

  // 같은 slide_index에 여러 버전이 있으면 최신 rendered_at 1건만 사용.
  const latestBySlide = new Map<number, string>();
  for (const row of (renders ?? []) as Array<{ slide_index: number; url: string | null }>) {
    if (latestBySlide.has(row.slide_index)) continue;
    if (typeof row.url !== 'string' || row.url.length === 0) continue;
    latestBySlide.set(row.slide_index, row.url);
  }

  return [...latestBySlide.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, url]) => url);
}

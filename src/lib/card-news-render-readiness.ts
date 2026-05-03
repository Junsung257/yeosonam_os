import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

/** PNG 업로드·CDN 전파 안정화 버퍼 (기본 5분). */
export function getCardNewsRenderBufferMs(): number {
  const raw = process.env.BLOG_CARD_NEWS_RENDER_BUFFER_MS;
  const n = raw ? parseInt(raw, 10) : NaN;
  if (Number.isFinite(n) && n >= 0) return n;
  return 5 * 60 * 1000;
}

/**
 * 카드뉴스 블로그 자동발행이 안전하게 시작될 수 있는 최소 시각 (epoch ms).
 * - card_news_renders 최신 rendered_at
 * - 폴백: card_news.updated_at
 * - 둘 다 없으면 now (슬라이드 URL 검증은 퍼블리셔 후속 단계)
 */
export async function getEarliestBlogPublishEligibleMs(cardNewsId: string): Promise<number> {
  const buffer = getCardNewsRenderBufferMs();
  if (!isSupabaseConfigured) return Date.now() + buffer;

  const { data: cnRows, error: cnErr } = await supabaseAdmin
    .from('card_news')
    .select('slide_image_urls, updated_at')
    .eq('id', cardNewsId)
    .limit(1);

  if (cnErr || !cnRows?.[0]) return Date.now() + buffer;

  const row = cnRows[0] as { slide_image_urls?: unknown; updated_at?: string | null };
  const urls = (row.slide_image_urls as string[] | null) || [];
  const updatedMs = row.updated_at ? new Date(row.updated_at).getTime() : 0;

  const { data: rRows } = await supabaseAdmin
    .from('card_news_renders')
    .select('rendered_at')
    .eq('card_news_id', cardNewsId)
    .order('rendered_at', { ascending: false })
    .limit(1);

  const renderMs = rRows?.[0]?.rendered_at
    ? new Date(rRows[0].rendered_at as string).getTime()
    : 0;

  let anchor = Math.max(updatedMs, renderMs);
  if (urls.length === 0) anchor = Date.now();

  return anchor + buffer;
}

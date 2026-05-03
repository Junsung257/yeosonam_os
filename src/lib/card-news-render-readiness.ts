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
function eligibleMsForCardRow(
  row: { slide_image_urls?: unknown; updated_at?: string | null } | undefined,
  latestRenderMs: number,
  buffer: number,
): number {
  if (!row) return Date.now() + buffer;
  const urls = (row.slide_image_urls as string[] | null) || [];
  const updatedMs = row.updated_at ? new Date(row.updated_at).getTime() : 0;
  let anchor = Math.max(updatedMs, latestRenderMs);
  if (urls.length === 0) anchor = Date.now();
  return anchor + buffer;
}

/**
 * 크론 배치용 — 카드뉴스별 최소 발행 시각을 2번의 DB 왕복으로 조회 (N건 × 2회 방지).
 */
export async function getEarliestBlogPublishEligibleMsBatch(cardNewsIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const buffer = getCardNewsRenderBufferMs();
  const nowEligible = Date.now() + buffer;

  if (!isSupabaseConfigured || cardNewsIds.length === 0) {
    for (const id of cardNewsIds) out.set(id, nowEligible);
    return out;
  }

  const ids = [...new Set(cardNewsIds.filter(Boolean))];
  if (ids.length === 0) return out;

  const { data: cnRows, error: cnErr } = await supabaseAdmin
    .from('card_news')
    .select('id, slide_image_urls, updated_at')
    .in('id', ids);

  const cnById = new Map<string, { slide_image_urls?: unknown; updated_at?: string | null }>();
  if (!cnErr && cnRows) {
    for (const r of cnRows as { id: string; slide_image_urls?: unknown; updated_at?: string | null }[]) {
      if (r?.id) cnById.set(r.id, r);
    }
  }

  const { data: rRows } = await supabaseAdmin
    .from('card_news_renders')
    .select('card_news_id, rendered_at')
    .in('card_news_id', ids)
    .order('rendered_at', { ascending: false });

  const latestRenderByCn = new Map<string, number>();
  for (const r of rRows || []) {
    const cid = (r as { card_news_id?: string }).card_news_id;
    const ra = (r as { rendered_at?: string | null }).rendered_at;
    if (!cid || latestRenderByCn.has(cid) || !ra) continue;
    latestRenderByCn.set(cid, new Date(ra).getTime());
  }

  for (const id of ids) {
    const row = cnById.get(id);
    const renderMs = latestRenderByCn.get(id) ?? 0;
    out.set(id, eligibleMsForCardRow(row, renderMs, buffer));
  }

  return out;
}

export async function getEarliestBlogPublishEligibleMs(cardNewsId: string): Promise<number> {
  const m = await getEarliestBlogPublishEligibleMsBatch([cardNewsId]);
  return m.get(cardNewsId) ?? Date.now() + getCardNewsRenderBufferMs();
}

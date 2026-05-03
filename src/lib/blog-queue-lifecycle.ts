import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

/**
 * 판매 불가·아카이브 등으로 블로그 자동발행 큐를 중단한다.
 * - product_id 직결 항목
 * - 동일 패키지를 물고 있는 card_news 경로 항목
 */
export async function skipBlogQueueForPackages(
  packageIds: string[],
  reason: string,
): Promise<{ skipped: number }> {
  if (!isSupabaseConfigured || packageIds.length === 0) return { skipped: 0 };

  const now = new Date().toISOString();
  const baseMeta = {
    cancelled_at: now,
    cancel_reason: reason,
  };

  let skipped = 0;

  const { data: byProduct, error: e1 } = await supabaseAdmin
    .from('blog_topic_queue')
    .update({
      status: 'skipped',
      last_error: reason,
      updated_at: now,
      meta: baseMeta as never,
    })
    .in('product_id', packageIds)
    .in('status', ['queued', 'generating'])
    .select('id');

  if (!e1) skipped += byProduct?.length ?? 0;

  const { data: cnRows } = await supabaseAdmin
    .from('card_news')
    .select('id')
    .in('package_id', packageIds);

  const cardIds = (cnRows || []).map((r: { id: string }) => r.id).filter(Boolean);
  if (cardIds.length === 0) return { skipped };

  const { data: byCard, error: e2 } = await supabaseAdmin
    .from('blog_topic_queue')
    .update({
      status: 'skipped',
      last_error: reason,
      updated_at: now,
      meta: baseMeta as never,
    })
    .in('card_news_id', cardIds)
    .in('status', ['queued', 'generating'])
    .select('id');

  if (!e2) skipped += byCard?.length ?? 0;

  return { skipped };
}

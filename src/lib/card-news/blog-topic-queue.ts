import { supabaseAdmin } from '@/lib/supabase';
import { getEarliestBlogPublishEligibleMs } from '@/lib/card-news-render-readiness';

/**
 * 카드뉴스 CONFIRMED 전환 시 blog_topic_queue에 자동 삽입.
 * render-v2 완료 훅과 PATCH 핸들러 양쪽에서 재사용.
 * 이미 queued/published 레코드가 있으면 중복 삽입 스킵.
 */
export async function insertBlogTopicQueue(
  cardNewsId: string,
  source: 'card_news_confirm_hook' | 'render_complete_hook' = 'card_news_confirm_hook',
): Promise<void> {
  const { count } = await supabaseAdmin
    .from('blog_topic_queue')
    .select('id', { count: 'exact', head: true })
    .eq('card_news_id', cardNewsId)
    .neq('status', 'failed');
  if (count && count > 0) return;

  const { data: cn } = await supabaseAdmin
    .from('card_news')
    .select('title')
    .eq('id', cardNewsId)
    .maybeSingle();

  const eligibleMs = await getEarliestBlogPublishEligibleMs(cardNewsId);
  const minScheduleMs = Date.now() + 30 * 60 * 1000;
  const targetAt = new Date(Math.max(minScheduleMs, eligibleMs));

  await supabaseAdmin.from('blog_topic_queue').insert({
    source: 'card_news',
    card_news_id: cardNewsId,
    topic: cn?.title ?? '카드뉴스 블로그',
    priority: 90,
    category: 'card_news',
    primary_keyword: (cn?.title ?? '').substring(0, 30),
    keyword_tier: 'mid',
    target_publish_at: targetAt.toISOString(),
    status: 'queued',
    meta: { auto_queued_by: source },
  });
}

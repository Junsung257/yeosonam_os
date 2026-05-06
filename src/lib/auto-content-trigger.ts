/**
 * 밴드 임포트된 상품 → 콘텐츠 자동 생성 큐 등록
 *
 * 호출 시점: band-import/save 및 cron/band-rss에서 products INSERT 직후
 * 실패해도 상품 등록은 정상 완료 — 콘텐츠 큐는 선택적 사이드이펙트
 */

import { supabaseAdmin } from '@/lib/supabase';

interface TriggerPayload {
  productId: string;
  displayName: string;
  destination: string;
  destinationCode: string;
}

export async function triggerContentGeneration(payload: TriggerPayload): Promise<void> {
  const { productId, displayName, destination, destinationCode } = payload;

  const results = await Promise.allSettled([
    // 1. card_news 대기열 등록 (기존 cron/card-news-refine이 픽업)
    supabaseAdmin.from('card_news').insert({
      package_id:     productId,
      title:          displayName,
      status:         'PENDING',
      slides:         [],
      card_news_type: 'product',
    }),

    // 2. 블로그 발행 큐 등록 (기존 cron/blog-publisher가 픽업)
    supabaseAdmin.from('blog_topic_queue').insert({
      topic:      `${destination} 여행 패키지 추천 — ${displayName}`,
      destination: destinationCode,
      product_id:  productId,
      priority:    70,
      status:      'queued',
    }),
  ]);

  // 실패 로그 (throw하지 않음 — 상품 등록과 분리)
  for (const result of results) {
    if (result.status === 'rejected') {
      console.warn('[auto-content-trigger] 큐 등록 실패:', result.reason);
    }
  }
}

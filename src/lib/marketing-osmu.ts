/**
 * OSMU(One source, multi-use) — marketing_assets 적재 헬퍼
 * 채널별 변형은 상위 생성 파이프에서 body를 채운 뒤 호출한다.
 *
 * Threads: main + thread[] 구조를 body에 포함하여 저장.
 * 향후 재생성·분석 시 각 메시지별 확인 가능.
 */

import { supabaseAdmin } from '@/lib/supabase';

export type OsmuChannel = 'naver_blog' | 'naver_cafe' | 'instagram_card' | 'threads';

/**
 * Threads 포스트 본문을 조합하여 marketing_assets.body 에 저장.
 * thread[] 배열을 개행 + "2/N", "3/N" 포맷으로 직렬화.
 */
export function formatThreadsBody(main: string, thread?: string[]): string {
  if (!thread || thread.length === 0) return main;
  return [main, ...thread.map((t, i) => `${i + 2}/${thread.length}. ${t}`)].join('\n\n');
}

export async function persistMarketingAssetRow(opts: {
  seedTopic: string;
  channel: OsmuChannel;
  body: string;
  tenantId?: string | null;
  contentCreativeId?: string | null;
  meta?: Record<string, unknown>;
}): Promise<{ id: string } | null> {
  const { data, error } = await supabaseAdmin
    .from('marketing_assets')
    .insert({
      seed_topic: opts.seedTopic,
      channel: opts.channel,
      body: opts.body,
      tenant_id: opts.tenantId ?? null,
      content_creative_id: opts.contentCreativeId ?? null,
      meta: opts.meta ?? {},
    })
    .select('id')
    .limit(1);

  if (error || !data?.[0]) return null;
  return { id: (data[0] as { id: string }).id };
}

/**
 * Threads 포스트(main + thread[])를 content_distributions.payload 형식으로 변환.
 * 상위 파이프라인에서 content_distributions 생성 시 호출.
 */
export function buildThreadsDistributionPayload(
  main: string,
  thread?: string[],
  hashtags?: string[],
  ctaType?: string,
): Record<string, unknown> {
  return {
    main,
    thread: thread ?? [],
    hashtags: hashtags ?? [],
    cta_type: ctaType ?? 'dm_keyword',
  };
}

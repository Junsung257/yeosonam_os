/**
 * OSMU(One source, multi-use) — marketing_assets 적재 헬퍼
 * 채널별 변형은 상위 생성 파이프에서 body를 채운 뒤 호출한다.
 */

import { supabaseAdmin } from '@/lib/supabase';

export type OsmuChannel = 'naver_blog' | 'naver_cafe' | 'instagram_card' | 'threads';

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

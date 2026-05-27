import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

/**
 * 자동 발행 성공 로그를 marketing_logs 에 남긴다.
 * - content_distributions 의 published 상태와 병행 사용.
 * - 향후 멀티채널 사가가 완성되면 content_distributions 단일 채널로 대체 가능.
 */
export async function recordAutoPublishLog(params: {
  platform: 'blog' | 'instagram' | 'threads';
  url: string;
  productId?: string | null;
  travelPackageId?: string | null;
}): Promise<void> {
  const enabled =
    process.env.PUBLISH_ORCHESTRATION_WRITE_LOGS === '1' ||
    process.env.PUBLISH_ORCHESTRATION_WRITE_LOGS === 'true';
  if (!enabled) return;
  if (!isSupabaseConfigured || !params.url) return;
  await supabaseAdmin.from('marketing_logs').insert({
    product_id: params.productId ?? null,
    travel_package_id: params.travelPackageId ?? null,
    platform: params.platform,
    url: params.url,
  });
}

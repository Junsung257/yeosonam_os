import { enqueueConceptualMedia, isMediaCodexEnabled, isStableRolloutParticipant, MEDIA_BRIEF_VERSION } from '@/lib/media-generation';
import { getSupabaseAdmin } from '@/lib/supabase';

function isManagedFallback(url: string | null): boolean {
  if (!url) return true;
  return /\/og-image\.png(?:[?#].*)?$/i.test(url)
    || /\/media-assets\/code_rendered\/blog\/(?:brand_fallback|blog_cover)\//i.test(url);
}

export async function enqueuePublishedBlogCover(creativeId: string): Promise<{
  queued: boolean;
  reason: string;
  assetId?: string;
}> {
  if (!isMediaCodexEnabled()) return { queued: false, reason: 'codex_media_disabled' };
  if (!isStableRolloutParticipant(creativeId, 'blog')) return { queued: false, reason: 'rollout_excluded' };
  const client = getSupabaseAdmin();
  if (!client) return { queued: false, reason: 'supabase_unavailable' };
  const { data, error } = await client.from('content_creatives')
    .select('id, tenant_id, status, channel, slug, seo_title, destination, og_image_url, target_ad_keywords')
    .eq('id', creativeId)
    .maybeSingle();
  if (error) throw error;
  const creative = data as unknown as {
    id: string;
    tenant_id: string | null;
    status: string | null;
    channel: string | null;
    slug: string | null;
    seo_title: string | null;
    destination: string | null;
    og_image_url: string | null;
    target_ad_keywords: string[] | null;
  } | null;
  if (!creative || creative.status !== 'published' || creative.channel !== 'naver_blog') {
    return { queued: false, reason: 'creative_not_public' };
  }
  if (!isManagedFallback(creative.og_image_url)) {
    return { queued: false, reason: 'existing_non_managed_cover' };
  }
  const subject = (creative.seo_title || creative.destination || creative.slug || '여행 가이드').trim();
  const asset = await enqueueConceptualMedia({
    version: MEDIA_BRIEF_VERSION,
    tenantId: creative.tenant_id,
    ownerType: 'blog',
    ownerId: creative.id,
    purpose: 'blog_cover',
    assetClass: 'conceptual_allowed',
    locale: 'ko-KR',
    subject: `${creative.destination || '여행'} 여행 가이드: ${subject}`,
    destination: creative.destination,
    factualConstraints: [
      ...(creative.target_ad_keywords ?? []).slice(0, 3),
      '특정 호텔·객실·항공·식사·관광지의 실제 모습이나 최신 현황으로 오인되지 않아야 함',
      '텍스트·가격·로고·워터마크를 이미지 안에 생성하지 않음',
    ],
    stylePreset: 'yeosonam_editorial',
    aspectRatio: '16:9',
    disclosureRequired: true,
  }, {
    approvalMode: 'automatic',
    sourceMetadata: {
      auto_attach: true,
      fallback_url: creative.og_image_url,
      slug: creative.slug,
      publication_state: 'published',
    },
  });
  return { queued: true, reason: asset.status, assetId: asset.id };
}

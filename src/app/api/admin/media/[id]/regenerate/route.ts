import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { resolveAdminActorLabel, withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import {
  enqueueConceptualMedia,
  getMediaAssetById,
  markMediaAssetRegenerationRequested,
  MEDIA_BRIEF_VERSION,
  type MediaBriefV1,
  type MediaPurpose,
} from '@/lib/media-generation';

const OWNER_TYPES = new Set<MediaBriefV1['ownerType']>(['blog', 'home', 'package', 'card_news', 'marketing']);
const PURPOSES = new Set<MediaPurpose>([
  'blog_cover',
  'blog_inline_summary',
  'blog_inline_cta',
  'home_campaign_hero',
  'card_news_background',
  'social_og',
  'brand_fallback',
]);
const STYLE_PRESETS = new Set<MediaBriefV1['stylePreset']>([
  'yeosonam_editorial',
  'yeosonam_campaign',
  'yeosonam_information',
]);
const ASPECT_RATIOS = new Set<MediaBriefV1['aspectRatio']>(['16:9', '1:1', '4:5', '9:16', '1.91:1']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function postHandler(
  request: NextRequest,
  context?: { params?: Promise<{ id: string }> },
) {
  const { id } = await (context?.params ?? Promise.resolve({ id: '' }));
  if (!UUID_RE.test(id)) {
    return apiResponse({ error: 'invalid media asset id' }, { status: 400 });
  }

  try {
    const original = await getMediaAssetById(id);
    if (!original) return apiResponse({ error: '미디어를 찾을 수 없습니다.' }, { status: 404 });
    if (original.source_kind !== 'openai_generated') {
      return apiResponse({ error: 'AI 생성 원본만 다시 생성할 수 있습니다.' }, { status: 409 });
    }
    if (Number(original.source_metadata?.regeneration_count ?? 0) >= 1) {
      return apiResponse({ error: '다시 생성은 원본당 1회만 허용됩니다.' }, { status: 409 });
    }

    const subject = typeof original.source_metadata?.subject === 'string'
      ? original.source_metadata.subject.trim()
      : '';
    const ownerType = original.owner_type as MediaBriefV1['ownerType'];
    const purpose = original.purpose as MediaPurpose;
    const stylePreset = original.source_metadata?.style_preset as MediaBriefV1['stylePreset'];
    const aspectRatio = original.source_metadata?.aspect_ratio as MediaBriefV1['aspectRatio'];
    if (
      subject.length < 4
      || !OWNER_TYPES.has(ownerType)
      || !PURPOSES.has(purpose)
      || !STYLE_PRESETS.has(stylePreset)
      || !ASPECT_RATIOS.has(aspectRatio)
    ) {
      return apiResponse({ error: '원본 생성 브리프가 불완전해 다시 생성할 수 없습니다.' }, { status: 409 });
    }

    const actor = await resolveAdminActorLabel(request);
    const asset = await enqueueConceptualMedia({
      version: MEDIA_BRIEF_VERSION,
      tenantId: original.tenant_id,
      ownerType,
      ownerId: original.owner_id,
      purpose,
      assetClass: 'conceptual_allowed',
      locale: 'ko-KR',
      subject,
      destination: typeof original.source_metadata?.destination === 'string'
        ? original.source_metadata.destination
        : null,
      factualConstraints: [
        '실제 호텔·객실·항공·식사·관광지의 증거 이미지로 오인되면 안 됨',
        '텍스트·가격·로고·워터마크를 이미지 안에 생성하지 않음',
      ],
      stylePreset,
      aspectRatio,
      disclosureRequired: true,
    }, {
      approvalMode: 'manual',
      idempotencySalt: 'regenerate-1',
      sourceMetadata: {
        regeneration_of: original.id,
        regeneration_count: 1,
        regeneration_requested_by: actor,
        requested_quality: purpose === 'home_campaign_hero' ? 'high' : 'medium',
      },
    });
    await markMediaAssetRegenerationRequested({
      id: original.id,
      regenerationId: asset.id,
      actor,
    });
    return apiResponse({ asset }, { status: 202 });
  } catch (error) {
    return apiResponse(
      { error: sanitizeDbError(error, '미디어 다시 생성 실패') },
      { status: 500 },
    );
  }
}

export const POST = withAdminGuard(postHandler);

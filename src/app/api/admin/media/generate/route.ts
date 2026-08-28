import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import {
  enqueueConceptualMedia,
  MEDIA_BRIEF_VERSION,
  type MediaPurpose,
} from '@/lib/media-generation';

type ManualPurpose = Extract<MediaPurpose, 'home_campaign_hero' | 'blog_cover' | 'card_news_background' | 'social_og'>;

const CONFIG: Record<ManualPurpose, {
  ownerType: 'home' | 'blog' | 'card_news' | 'marketing';
  defaultOwnerId: string;
  stylePreset: 'yeosonam_editorial' | 'yeosonam_campaign';
  quality: 'medium' | 'high';
}> = {
  home_campaign_hero: {
    ownerType: 'home',
    defaultOwnerId: 'homepage',
    stylePreset: 'yeosonam_campaign',
    quality: 'high',
  },
  blog_cover: {
    ownerType: 'blog',
    defaultOwnerId: 'manual-blog-cover',
    stylePreset: 'yeosonam_editorial',
    quality: 'medium',
  },
  card_news_background: {
    ownerType: 'card_news',
    defaultOwnerId: 'manual-card-news',
    stylePreset: 'yeosonam_campaign',
    quality: 'medium',
  },
  social_og: {
    ownerType: 'marketing',
    defaultOwnerId: 'manual-social-og',
    stylePreset: 'yeosonam_campaign',
    quality: 'medium',
  },
};

async function postHandler(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiResponse({ error: 'invalid json' }, { status: 400 });
  }
  const purpose = typeof body.purpose === 'string' && body.purpose in CONFIG
    ? body.purpose as ManualPurpose
    : null;
  const subject = typeof body.subject === 'string' ? body.subject.replace(/\s+/g, ' ').trim().slice(0, 240) : '';
  const destination = typeof body.destination === 'string'
    ? body.destination.replace(/\s+/g, ' ').trim().slice(0, 100)
    : '';
  const ownerId = typeof body.owner_id === 'string'
    ? body.owner_id.replace(/[^a-zA-Z0-9:_-]/g, '-').slice(0, 120)
    : '';
  if (!purpose || subject.length < 4) {
    return apiResponse({ error: 'purpose와 4자 이상의 subject가 필요합니다.' }, { status: 400 });
  }
  const config = CONFIG[purpose];
  try {
    const asset = await enqueueConceptualMedia({
      version: MEDIA_BRIEF_VERSION,
      ownerType: config.ownerType,
      ownerId: ownerId || config.defaultOwnerId,
      purpose,
      assetClass: 'conceptual_allowed',
      locale: 'ko-KR',
      subject,
      destination: destination || null,
      factualConstraints: [
        '실제 호텔·객실·항공·식사·관광지의 증거 이미지로 오인되면 안 됨',
        '텍스트·가격·로고·워터마크를 이미지 안에 생성하지 않음',
      ],
      stylePreset: config.stylePreset,
      aspectRatio: purpose === 'social_og' ? '1.91:1' : '16:9',
      disclosureRequired: true,
    }, {
      approvalMode: 'manual',
      sourceMetadata: { requested_quality: config.quality, requested_from: 'admin_media' },
    });
    return apiResponse({ asset }, { status: 202 });
  } catch (error) {
    return apiResponse(
      { error: sanitizeDbError(error, '미디어 작업 생성 실패') },
      { status: 500 },
    );
  }
}

export const POST = withAdminGuard(postHandler);

import { getSecret } from './secret-registry';
import {
  buildBlogInformationalCtaSettings,
  type BlogInformationalCtaDefinition,
} from './blog-informational-cta';

export function loadBlogInformationalCtaSettings(input: {
  destination?: string | null;
  relatedArticlesHref?: string | null;
}): BlogInformationalCtaDefinition[] {
  return buildBlogInformationalCtaSettings({
    ...input,
    naverCafeUrl: getSecret('BLOG_NAVER_CAFE_URL'),
    dealRoomUrl: getSecret('BLOG_DEAL_ROOM_URL'),
    consultationUrl: getSecret('BLOG_CONSULTATION_URL'),
    kakaoChannelId: getSecret('KAKAO_CHANNEL_ID'),
  });
}

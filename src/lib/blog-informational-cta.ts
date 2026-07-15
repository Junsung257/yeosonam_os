import type { BlogInformationIntent } from './blog-information-contract';
import type { BlogInformationRiskLevel } from './blog-information-planner';

export const BLOG_INFORMATIONAL_CTA_KEYS = [
  'NAVER_CAFE',
  'DEAL_ROOM',
  'CONSULTATION',
  'RELATED_ARTICLES',
] as const;

export type BlogInformationalCtaKey = (typeof BLOG_INFORMATIONAL_CTA_KEYS)[number];
export type BlogInformationalCtaPlacement = 'mid' | 'bottom';
export type BlogInformationalCtaRole = 'primary' | 'secondary';

export interface BlogInformationalCtaDefinition {
  key: BlogInformationalCtaKey;
  label: string;
  description: string;
  href: string | null;
  enabled: boolean;
  external: boolean;
}

export interface SelectedBlogInformationalCta
  extends Omit<BlogInformationalCtaDefinition, 'href' | 'enabled'> {
  href: string;
  enabled: true;
  role: BlogInformationalCtaRole;
  placement: BlogInformationalCtaPlacement;
}

export interface BlogInformationalCtaSettingsInput {
  destination?: string | null;
  relatedArticlesHref?: string | null;
  naverCafeUrl?: string | null;
  dealRoomUrl?: string | null;
  consultationUrl?: string | null;
  kakaoChannelId?: string | null;
}

export interface BlogInformationalCtaSelectionInput {
  intent: BlogInformationIntent;
  destination?: string | null;
  riskLevel: BlogInformationRiskLevel;
  locale: string;
  placement?: BlogInformationalCtaPlacement;
  settings: BlogInformationalCtaDefinition[];
}

export interface BlogInformationalCtaEventContext {
  articleId: string;
  slug: string;
  destinationId: string;
  destination?: string | null;
  intent: BlogInformationIntent;
  ctaKey: BlogInformationalCtaKey;
  placement: BlogInformationalCtaPlacement;
  locale: string;
}

const EXTERNAL_PREFERENCE: Record<BlogInformationIntent, BlogInformationalCtaKey[]> = {
  food_budget: ['DEAL_ROOM', 'NAVER_CAFE', 'CONSULTATION'],
  monthly_weather: ['NAVER_CAFE', 'CONSULTATION', 'DEAL_ROOM'],
  airport_transport: ['CONSULTATION', 'NAVER_CAFE', 'DEAL_ROOM'],
  hotel_areas: ['CONSULTATION', 'NAVER_CAFE', 'DEAL_ROOM'],
  family_budget: ['DEAL_ROOM', 'CONSULTATION', 'NAVER_CAFE'],
  family_itinerary: ['NAVER_CAFE', 'CONSULTATION', 'DEAL_ROOM'],
  entry_requirements: ['NAVER_CAFE', 'CONSULTATION', 'DEAL_ROOM'],
  travel_insurance: ['CONSULTATION', 'NAVER_CAFE', 'DEAL_ROOM'],
  currency_payment: ['DEAL_ROOM', 'NAVER_CAFE', 'CONSULTATION'],
  general: ['NAVER_CAFE', 'CONSULTATION', 'DEAL_ROOM'],
};

function clean(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

function validExternalUrl(value?: string | null): string | null {
  const raw = clean(value);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:') return null;
    if (!parsed.hostname || parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function validRelatedHref(value?: string | null): string | null {
  const raw = clean(value);
  if (!raw || !raw.startsWith('/blog') || raw.startsWith('//')) return null;
  return raw;
}

function consultationFromChannelId(channelId?: string | null): string | null {
  const id = clean(channelId);
  if (!id || !/^_[A-Za-z0-9]+$/.test(id)) return null;
  return `https://pf.kakao.com/${id}/chat`;
}

function definition(
  key: BlogInformationalCtaKey,
  label: string,
  description: string,
  href: string | null,
  external: boolean,
): BlogInformationalCtaDefinition {
  return { key, label, description, href, enabled: href !== null, external };
}

export function buildBlogInformationalCtaSettings(
  input: BlogInformationalCtaSettingsInput,
): BlogInformationalCtaDefinition[] {
  const destination = clean(input.destination);
  const consultationUrl = validExternalUrl(input.consultationUrl)
    ?? consultationFromChannelId(input.kakaoChannelId);

  return [
    definition(
      'NAVER_CAFE',
      destination ? `${destination} 여행 팁 더 보기` : '여행 준비 팁 더 보기',
      '운영자가 확인한 커뮤니티 안내를 새 창에서 확인합니다.',
      validExternalUrl(input.naverCafeUrl),
      true,
    ),
    definition(
      'DEAL_ROOM',
      destination ? `${destination} 여행 소식 확인` : '여행 소식 확인',
      '운영자가 확인한 공개 여행 소식 채널로 이동합니다.',
      validExternalUrl(input.dealRoomUrl),
      true,
    ),
    definition(
      'CONSULTATION',
      '내 일정 기준으로 문의하기',
      '출발일과 인원을 정리한 뒤 상담 채널에서 확인합니다.',
      consultationUrl,
      true,
    ),
    definition(
      'RELATED_ARTICLES',
      destination ? `${destination} 관련 가이드 이어보기` : '관련 여행 가이드 이어보기',
      '같은 목적지와 검색 의도에 가까운 정보성 글을 이어서 읽습니다.',
      validRelatedHref(input.relatedArticlesHref),
      false,
    ),
  ];
}

export function selectBlogInformationalCtas(
  input: BlogInformationalCtaSelectionInput,
): SelectedBlogInformationalCta[] {
  const placement = input.placement ?? 'bottom';
  const enabled = new Map(
    input.settings
      .filter((item) => item.enabled && item.href)
      .map((item) => [item.key, item]),
  );
  const related = enabled.get('RELATED_ARTICLES');

  // External copy and destinations are currently Korean-only. Other locales
  // stay on a safe internal related-article route until localized settings exist.
  if (input.locale !== 'ko-KR') {
    return related ? [{ ...related, href: related.href!, enabled: true, role: 'primary', placement }] : [];
  }

  if (input.riskLevel === 'HIGH') {
    return related ? [{ ...related, href: related.href!, enabled: true, role: 'primary', placement }] : [];
  }

  const external = EXTERNAL_PREFERENCE[input.intent]
    .map((key) => enabled.get(key))
    .find((item): item is BlogInformationalCtaDefinition => Boolean(item));
  const ordered = [external, related]
    .filter((item): item is BlogInformationalCtaDefinition => Boolean(item));
  const maximum = placement === 'mid' ? 1 : 2;

  return ordered.slice(0, maximum).map((item, index) => ({
    ...item,
    href: item.href!,
    enabled: true,
    role: index === 0 ? 'primary' : 'secondary',
    placement,
  }));
}

export function stripBlogInformationalBodyCtas(markdown: string): string {
  return markdown
    .replace(
      /\[([^\]]+)]\((?:https?:\/\/(?:www\.)?yeosonam\.com)?\/(?:packages|group-inquiry)(?:[^)\s]*)\)/gi,
      '$1',
    )
    .replace(
      /\[([^\]]+)]\(https:\/\/pf\.kakao\.com\/[^)\s]+\)/gi,
      '$1',
    )
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function buildBlogInformationalCtaEvent(
  eventType: 'blog_cta_impression' | 'blog_cta_click',
  context: BlogInformationalCtaEventContext,
): {
  event_type: typeof eventType;
  event_source: 'blog_information_cta';
  destination: string | null;
  intent: BlogInformationIntent;
  metadata: Record<string, string>;
} {
  return {
    event_type: eventType,
    event_source: 'blog_information_cta',
    destination: clean(context.destination),
    intent: context.intent,
    metadata: {
      article_id: context.articleId,
      slug: context.slug,
      destination_id: context.destinationId,
      intent: context.intent,
      cta_key: context.ctaKey,
      placement: context.placement,
      locale: context.locale,
    },
  };
}

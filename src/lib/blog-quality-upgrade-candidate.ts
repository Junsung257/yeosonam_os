import { buildBlogContentBrief, type BlogContentBrief } from './blog-content-brief';
import type { BlogInformationIntent } from './blog-information-contract';
import {
  buildPublishedBlogUpgradeQueueTopic,
} from './blog-private-regeneration';
import {
  classifyBlogQualityUpgradeTopic,
  type BlogQualityUpgradeTopicDecision,
} from './blog-quality-upgrade-selection';
import { buildBlogInformationRepresentativeKey } from './blog-information-representative';
import { extractDestination } from './slug-utils';

export interface PublishedBlogQualityUpgradeInput {
  id: string;
  slug: string;
  seo_title?: string | null;
  destination?: string | null;
  category?: string | null;
}

export type PublishedBlogQualityUpgradeDecision =
  | {
      accepted: true;
      reason: 'safe_automatic_candidate';
      queueTopic: string;
      researchDestination: string;
      microAngle: string | null;
      brief: BlogContentBrief;
      topicDecision: BlogQualityUpgradeTopicDecision;
      representativeKey: string;
    }
  | {
      accepted: false;
      reason:
        | 'missing_destination'
        | 'classified_intent_mismatch'
        | 'content_brief_failed'
        | 'human_review_required'
        | string;
      queueTopic: string;
      researchDestination: string;
      microAngle: string | null;
      brief: BlogContentBrief;
      topicDecision: BlogQualityUpgradeTopicDecision;
      representativeKey: null;
    };

function extractUpgradeMonth(value: string): number | null {
  const numericMatch = value.match(/(?:^|\D)(1[0-2]|[1-9])\s*(?:월|month|\b|$)/i);
  if (numericMatch) return Number(numericMatch[1]);
  const englishMonths = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december',
  ];
  const normalized = value.toLowerCase();
  const index = englishMonths.findIndex(month => new RegExp(`\\b${month}\\b`).test(normalized));
  return index >= 0 ? index + 1 : null;
}

function buildIntentAnchoredUpgradeTopic(input: {
  destination: string;
  intent: BlogInformationIntent | null;
  microAngle: string | null;
  publicTopic: string;
}): string {
  if (!input.destination || !input.intent) return input.publicTopic;
  const month = input.intent === 'monthly_weather'
    ? extractUpgradeMonth(input.publicTopic)
    : null;
  const topics: Record<BlogInformationIntent, string> = {
    general: input.publicTopic,
    monthly_weather: `${input.destination} ${month ? `${month}월 ` : ''}날씨와 옷차림`,
    airport_transport: `${input.destination} 공항에서 시내 이동 교통`,
    local_transport: `${input.destination} 현지 대중교통 이용법`,
    hotel_areas: `${input.destination} 숙소 지역별 비교`,
    food_budget: `${input.destination} 식비 예산과 대표 메뉴 가격`,
    family_budget: `${input.destination} 가족여행 예산과 비용`,
    itinerary: input.microAngle === 'kid_friendly'
      ? `${input.destination} 아이와 가족 여행 일정과 이동 동선`
      : `${input.destination} 여행 일정과 이동 동선`,
    shopping_souvenirs: `${input.destination} 쇼핑 기념품 가격과 구매 장소`,
    currency_payment: `${input.destination} 화폐 환전과 카드 결제`,
    entry_requirements: `${input.destination} 입국 요건과 비자`,
    travel_insurance: `${input.destination} 여행자 보험 보장과 청구`,
  };
  return topics[input.intent];
}

export function evaluatePublishedBlogQualityUpgradeCandidate(
  post: PublishedBlogQualityUpgradeInput,
): PublishedBlogQualityUpgradeDecision {
  const topicDecision = classifyBlogQualityUpgradeTopic({
    slug: post.slug,
    seoTitle: post.seo_title,
    category: post.category,
  });
  const publicQueueTopic = buildPublishedBlogUpgradeQueueTopic(post);
  const storedDestination = post.destination?.trim() ?? '';
  const extractedDestination = extractDestination(publicQueueTopic).trim();
  const researchDestination = extractedDestination.length > storedDestination.length
    && extractedDestination.includes(storedDestination)
    ? extractedDestination
    : storedDestination;
  const queueTopic = buildIntentAnchoredUpgradeTopic({
    destination: researchDestination,
    intent: topicDecision.expectedIntent,
    microAngle: topicDecision.microAngle,
    publicTopic: `${publicQueueTopic} ${post.seo_title ?? ''}`.trim(),
  });
  const brief = buildBlogContentBrief({
    topic: queueTopic,
    destination: researchDestination,
    primaryKeyword: queueTopic,
    category: post.category,
    source: 'user_seed',
    microAngle: topicDecision.microAngle,
    locale: 'ko-KR',
  });

  let reason: PublishedBlogQualityUpgradeDecision['reason'] = 'safe_automatic_candidate';
  if (!post.destination?.trim()) reason = 'missing_destination';
  else if (!topicDecision.accepted) reason = topicDecision.reason;
  else if (topicDecision.expectedIntent !== brief.intentType) reason = 'classified_intent_mismatch';
  else if (!brief.passed) reason = 'content_brief_failed';
  else if (brief.requiresHumanReview) reason = 'human_review_required';

  if (reason !== 'safe_automatic_candidate') {
    return {
      accepted: false,
      reason,
      queueTopic,
      researchDestination,
      microAngle: topicDecision.microAngle,
      brief,
      topicDecision,
      representativeKey: null,
    };
  }

  return {
    accepted: true,
    reason,
    queueTopic,
    researchDestination,
    microAngle: topicDecision.microAngle,
    brief,
    topicDecision,
    representativeKey: buildBlogInformationRepresentativeKey({
      destinationId: brief.plan.destinationId as string,
      intent: brief.intentType,
      audience: brief.plan.audience,
      locale: brief.plan.locale,
    }),
  };
}

import { buildBlogContentBrief, type BlogContentBrief } from './blog-content-brief';
import {
  buildPublishedBlogUpgradeQueueTopic,
} from './blog-private-regeneration';
import {
  classifyBlogQualityUpgradeTopic,
  type BlogQualityUpgradeTopicDecision,
} from './blog-quality-upgrade-selection';
import { buildBlogInformationRepresentativeKey } from './blog-information-representative';

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
      microAngle: string | null;
      brief: BlogContentBrief;
      topicDecision: BlogQualityUpgradeTopicDecision;
      representativeKey: null;
    };

export function evaluatePublishedBlogQualityUpgradeCandidate(
  post: PublishedBlogQualityUpgradeInput,
): PublishedBlogQualityUpgradeDecision {
  const topicDecision = classifyBlogQualityUpgradeTopic({
    slug: post.slug,
    seoTitle: post.seo_title,
    category: post.category,
  });
  const queueTopic = buildPublishedBlogUpgradeQueueTopic(post);
  const brief = buildBlogContentBrief({
    topic: queueTopic,
    destination: post.destination,
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

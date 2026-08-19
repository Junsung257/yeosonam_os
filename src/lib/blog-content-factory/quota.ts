import type { BlogPublicationRampStage } from '@/lib/blog-publication-rollout';
import type { BlogContentOperationType } from './types';

export interface BlogContentFactoryPortfolioCapsV4 {
  totalOperations: number;
  newUrls: number;
  byType: Readonly<Partial<Record<BlogContentOperationType, number>>>;
}

export const BLOG_CONTENT_FACTORY_PORTFOLIO_CAPS_V4: Readonly<Record<
  BlogPublicationRampStage,
  BlogContentFactoryPortfolioCapsV4
>> = {
  pilot_3: {
    totalOperations: 3,
    newUrls: 2,
    byType: { new_info: 2, new_commercial: 1, new_seasonal: 1, material_refresh: 2, product_refresh: 1, merge_review: 1 },
  },
  ramp_10: {
    totalOperations: 10,
    newUrls: 6,
    byType: { new_info: 5, new_commercial: 2, new_seasonal: 1, material_refresh: 4, product_refresh: 2, merge_review: 2 },
  },
  max_30: {
    totalOperations: 30,
    newUrls: 18,
    byType: { new_info: 12, new_commercial: 4, new_seasonal: 2, material_refresh: 8, product_refresh: 4, merge_review: 4 },
  },
};

export interface BlogContentFactoryInventoryCountsV4 {
  totalOperations: number;
  newUrls: number;
  byType: Partial<Record<BlogContentOperationType, number>>;
}

export function evaluateBlogContentFactoryQuotaV4(input: {
  stage: BlogPublicationRampStage;
  environmentDailyCap: number;
  counts: BlogContentFactoryInventoryCountsV4;
  candidateType: BlogContentOperationType;
  candidateCreatesNewUrl: boolean;
}): { allowed: boolean; reasons: string[]; effectiveTotalCap: number; effectiveNewUrlCap: number } {
  const definition = BLOG_CONTENT_FACTORY_PORTFOLIO_CAPS_V4[input.stage];
  const environmentCap = Math.max(0, Math.min(30, Math.trunc(input.environmentDailyCap)));
  const effectiveTotalCap = Math.min(definition.totalOperations, environmentCap);
  const effectiveNewUrlCap = Math.min(definition.newUrls, effectiveTotalCap);
  const reasons: string[] = [];
  if (input.counts.totalOperations >= effectiveTotalCap) reasons.push('daily_operation_cap_reached');
  if (input.candidateCreatesNewUrl && input.counts.newUrls >= effectiveNewUrlCap) {
    reasons.push('daily_new_url_cap_reached');
  }
  const typeCap = definition.byType[input.candidateType] ?? 0;
  if ((input.counts.byType[input.candidateType] ?? 0) >= Math.min(typeCap, effectiveTotalCap)) {
    reasons.push(`daily_operation_type_cap_reached:${input.candidateType}`);
  }
  return { allowed: reasons.length === 0, reasons, effectiveTotalCap, effectiveNewUrlCap };
}

export const BLOG_CONTENT_FACTORY_KST_SLOTS_V4 = [
  '09:00', '10:30', '12:00', '13:30', '15:00',
  '16:30', '18:00', '19:30', '21:00', '22:00',
] as const;

export function cumulativeBlogContentFactorySlotCapsV4(
  stage: BlogPublicationRampStage,
): readonly number[] {
  const cap = BLOG_CONTENT_FACTORY_PORTFOLIO_CAPS_V4[stage].totalOperations;
  return BLOG_CONTENT_FACTORY_KST_SLOTS_V4.map((_, index) => Math.ceil(((index + 1) * cap) / 10));
}

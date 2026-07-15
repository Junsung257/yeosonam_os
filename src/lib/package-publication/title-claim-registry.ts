export type TitleClaimCode =
  | 'NO_OPTION'
  | 'NO_TIP'
  | 'NO_SHOPPING'
  | 'HOTEL_5_STAR'
  | 'ONSEN'
  | 'CORE_TOUR'
  | 'FREE_DAY';

export type TitleClaimPolicy = {
  code: TitleClaimCode;
  renderToken: string;
  missingAction: 'drop_token' | 'block_title';
  contradictionAction: 'block_customer_copy';
  policyVersion: number;
};

export const TITLE_CLAIM_POLICY_VERSION = 1;

export const TITLE_CLAIM_REGISTRY: TitleClaimPolicy[] = [
  { code: 'NO_OPTION', renderToken: '노옵션', missingAction: 'drop_token', contradictionAction: 'block_customer_copy', policyVersion: TITLE_CLAIM_POLICY_VERSION },
  { code: 'NO_TIP', renderToken: '노팁', missingAction: 'drop_token', contradictionAction: 'block_customer_copy', policyVersion: TITLE_CLAIM_POLICY_VERSION },
  { code: 'NO_SHOPPING', renderToken: '노쇼핑', missingAction: 'drop_token', contradictionAction: 'block_customer_copy', policyVersion: TITLE_CLAIM_POLICY_VERSION },
  { code: 'HOTEL_5_STAR', renderToken: '5성호텔', missingAction: 'drop_token', contradictionAction: 'block_customer_copy', policyVersion: TITLE_CLAIM_POLICY_VERSION },
  { code: 'ONSEN', renderToken: '온천', missingAction: 'drop_token', contradictionAction: 'block_customer_copy', policyVersion: TITLE_CLAIM_POLICY_VERSION },
  { code: 'CORE_TOUR', renderToken: '핵심관광', missingAction: 'drop_token', contradictionAction: 'block_customer_copy', policyVersion: TITLE_CLAIM_POLICY_VERSION },
  { code: 'FREE_DAY', renderToken: '자유일정', missingAction: 'drop_token', contradictionAction: 'block_customer_copy', policyVersion: TITLE_CLAIM_POLICY_VERSION },
];

export type TitleClaimEvidenceContext = {
  sourceText: string;
  itineraryDayCount?: number;
  attractionCount?: number;
  hasPaidOptionalTour?: boolean;
};

function occurrences(text: string, pattern: RegExp): number {
  return [...text.matchAll(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`))].length;
}
export function titleClaimHasEvidence(code: TitleClaimCode, context: TitleClaimEvidenceContext): boolean {
  const source = context.sourceText.replace(/\s+/g, ' ').trim();
  switch (code) {
    case 'NO_OPTION':
      return /노\s*옵션|선택\s*관광\s*[:：]?\s*(?:없음|무|노옵션|0회)/i.test(source)
        && context.hasPaidOptionalTour !== true;
    case 'NO_TIP':
      return /노\s*팁|NO\s*TIP|기사\s*\/?\s*가이드\s*팁\s*포함/i.test(source);
    case 'NO_SHOPPING':
      return /노\s*쇼핑|NO\s*SHOPPING|쇼핑\s*[:：]?\s*(?:없음|무|0회)/i.test(source);
    case 'HOTEL_5_STAR':
      return /(?:호텔|리조트|숙박|동급).{0,20}(?:5\s*성|준\s*5\s*성|특급)|(?:5\s*성|준\s*5\s*성|특급).{0,20}(?:호텔|리조트|숙박|동급)/i.test(source)
        && !/미정|예정|동급\s*미정/i.test(source);
    case 'ONSEN':
      return occurrences(source, /온천/i) >= 2
        && /온천\s*(?:호텔|리조트|숙박|마을|욕|체험)|(?:호텔|리조트|숙박).{0,20}온천/i.test(source);
    case 'CORE_TOUR':
      return /핵심\s*관광/i.test(source)
        && (context.itineraryDayCount ?? 0) >= 2
        && (context.attractionCount ?? 0) >= 2;
    case 'FREE_DAY':
      return /(?:전일|하루|1일)\s*자유\s*일정|자유\s*일정\s*(?:1일|포함)/i.test(source)
        && !/자유\s*시간|반일\s*자유/i.test(source);
  }
}

export function unsupportedTitleClaims(
  title: string,
  context: TitleClaimEvidenceContext,
): Array<{ code: TitleClaimCode; token: string }> {
  return TITLE_CLAIM_REGISTRY
    .filter(policy => title.includes(policy.renderToken))
    .filter(policy => !titleClaimHasEvidence(policy.code, context))
    .map(policy => ({ code: policy.code, token: policy.renderToken }));
}

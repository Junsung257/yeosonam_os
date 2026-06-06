export type BlogFreshnessRiskLevel = 'low' | 'medium' | 'high';

export interface BlogFreshnessRisk {
  level: BlogFreshnessRiskLevel;
  topics: string[];
  requiresOfficialSources: boolean;
  suggestedReviewDays: number;
}

const HIGH_RISK_PATTERNS = [
  { topic: 'visa_entry', re: /비자|입국|출입국|여권|전자\s*비자|eta|esta|evisa/i },
  { topic: 'safety', re: /안전|치안|분실|응급|대사관|영사관|주의보/i },
  { topic: 'regulation', re: /세관|반입|면세|검역|규정|벌금/i },
];

const MEDIUM_RISK_PATTERNS = [
  { topic: 'currency', re: /환율|환전|현금|카드|결제/i },
  { topic: 'weather', re: /날씨|기온|우기|건기|태풍|강수/i },
  { topic: 'transport', re: /공항\s*이동|교통|철도|버스|택시|셔틀/i },
  { topic: 'price', re: /비용|가격|요금|입장료|예산/i },
];

export function classifyBlogFreshnessRisk(input: string): BlogFreshnessRisk {
  const text = input || '';
  const highTopics = HIGH_RISK_PATTERNS.filter((item) => item.re.test(text)).map((item) => item.topic);
  const mediumTopics = MEDIUM_RISK_PATTERNS.filter((item) => item.re.test(text)).map((item) => item.topic);

  if (highTopics.length > 0) {
    return {
      level: 'high',
      topics: [...new Set([...highTopics, ...mediumTopics])],
      requiresOfficialSources: true,
      suggestedReviewDays: 14,
    };
  }

  if (mediumTopics.length > 0) {
    return {
      level: 'medium',
      topics: [...new Set(mediumTopics)],
      requiresOfficialSources: true,
      suggestedReviewDays: 30,
    };
  }

  return {
    level: 'low',
    topics: [],
    requiresOfficialSources: false,
    suggestedReviewDays: 90,
  };
}

export function buildFreshnessPromptBlock(risk: BlogFreshnessRisk): string {
  if (risk.level === 'low') return '';

  return `
## Freshness / 공식 출처 검증
- 이 주제는 ${risk.level.toUpperCase()} freshness risk입니다: ${risk.topics.join(', ')}
- 단정하지 말고 "확인 기준일"을 본문에 명시하세요.
- 비자/입국/안전/환율/교통/가격 정보는 공식기관 또는 운영 주체 확인이 필요하다고 안내하세요.
- 자동 발행 후 ${risk.suggestedReviewDays}일 안에 재검토 대상입니다.
`;
}

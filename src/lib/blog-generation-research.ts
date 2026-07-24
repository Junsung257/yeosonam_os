import type { BlogInformationIntent, BlogInformationSourcePolicy } from './blog-information-contract';
import {
  isOfficialInformationAuthority,
  isPrimaryInformationAuthority,
  validateBlogInformationResearchBundle,
  type BlogInformationClaimType,
  type BlogInformationResearchBundle,
} from './blog-information-evidence';
import { validateBlogInformationStructure } from './blog-information-structure';

export const BLOG_INFORMATION_RESEARCH_META_KEY = 'information_research_bundle';

export const BLOG_INFORMATION_MINIMUM_CLAIMS_BY_INTENT: Partial<Record<
  BlogInformationIntent,
  Partial<Record<BlogInformationClaimType, number>>
>> = {
  food_budget: { price: 7 },
  monthly_weather: { climate: 12 },
  airport_transport: { price: 2, duration: 2 },
  hotel_areas: { price: 3, factual: 3 },
  family_budget: { price: 4 },
  itinerary: { duration: 2, factual: 3 },
  shopping_souvenirs: { price: 3, factual: 3 },
  currency_payment: { currency: 1, factual: 3 },
  entry_requirements: { entry_visa: 2, policy: 2 },
  travel_insurance: { insurance: 4, policy: 2 },
};

const BLOG_INFORMATION_MINIMUM_SOURCE_DOMAINS: Partial<Record<BlogInformationIntent, number>> = {
  food_budget: 1,
  monthly_weather: 1,
  airport_transport: 1,
  hotel_areas: 2,
  family_budget: 2,
  itinerary: 2,
  shopping_souvenirs: 2,
  currency_payment: 1,
  entry_requirements: 2,
  travel_insurance: 2,
};

const REQUIRED_CLAIM_SEMANTICS_BY_INTENT: Partial<Record<BlogInformationIntent, Array<{
  key: string;
  pattern: RegExp;
}>>> = {
  food_budget: [
    { key: 'budget_tier', pattern: /절약/ },
    { key: 'midrange_tier', pattern: /일반|중간/ },
    { key: 'luxury_tier', pattern: /여유|고급/ },
    { key: 'breakfast', pattern: /아침/ },
    { key: 'lunch', pattern: /점심/ },
    { key: 'dinner', pattern: /저녁/ },
    { key: 'snack', pattern: /간식|커피|카페|패스트\s*푸드|길거리\s*음식/ },
  ],
};

const MAX_SOURCE_AGE_DAYS: Record<BlogInformationClaimType, number> = {
  price: 45,
  currency: 30,
  duration: 90,
  percentage: 90,
  climate: 400,
  customs: 30,
  entry_visa: 30,
  insurance: 30,
  policy: 30,
  superlative: 30,
  factual: 180,
};

export interface BlogGenerationResearchReadiness {
  passed: boolean;
  issues: string[];
  bundle: BlogInformationResearchBundle | null;
  summary: {
    sourceCount: number;
    evidenceCount: number;
    claimCount: number;
    supportedClaimCount: number;
    claimSourceCoverage: number;
    distinctNormalizedValueCount: number;
  };
}

export interface BlogGenerationResearchStructureRepair {
  markdown: string;
  changed: boolean;
  changes: string[];
  approvedClaims: BlogInformationResearchBundle['claims'];
}

const FOOD_BUDGET_STRUCTURE_MARKER = '<!-- blog_research_structure:food_budget:v1 -->';
const FOOD_BUDGET_STRUCTURE_END_MARKER = '<!-- /blog_research_structure:food_budget:v1 -->';
const MONTHLY_WEATHER_STRUCTURE_MARKER = '<!-- blog_research_structure:monthly_weather:v2 -->';
const MONTHLY_WEATHER_STRUCTURE_END_MARKER = '<!-- /blog_research_structure:monthly_weather:v2 -->';
const LEGACY_MONTHLY_WEATHER_STRUCTURE_MARKER = '<!-- blog_research_structure:monthly_weather:v1 -->';
const LEGACY_MONTHLY_WEATHER_STRUCTURE_END_MARKER = '<!-- /blog_research_structure:monthly_weather:v1 -->';
const FOOD_BUDGET_POLICY_GAP_MARKER = '<!-- blog_research_policy_gap:food_budget:v1 -->';
const FOOD_BUDGET_DETERMINISTIC_HEADINGS = [
  '근거로 확인한 1인 하루 식비',
  '근거로 확인한 끼니별 가격',
  '지역별 가격 차이 확인 방법',
  '세금·서비스료·예약 조건은 어떻게 확인할까?',
];
const FOOD_BUDGET_AREA_PRICE_DIFFERENCE_PATTERN = /(?:지역별|지역)[^\n]{0,120}(?:가격 차이|비용 차이)/;
const FOOD_BUDGET_FEES_BOOKING_PATTERN = /(?=[\s\S]*세금)(?=[\s\S]*서비스료)(?=[\s\S]*예약)/;
const FOOD_BUDGET_STRUCTURE_ISSUES = new Set([
  'food_budget:daily_tier_rows_required',
  'food_budget:아침_value_required',
  'food_budget:점심_value_required',
  'food_budget:저녁_value_required',
  'food_budget:간식_value_required',
  'food_budget:representative_menu_prices_required',
  'food_budget:insufficient_unique_values',
]);

function clean(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function normalize(value: unknown): string {
  return clean(value).normalize('NFKC').toLowerCase();
}

function monthlyWeatherClaimCoverageIssues(claimText: string): string[] {
  const issues: string[] = [];
  for (let month = 1; month <= 12; month += 1) {
    if (!new RegExp(`(?:^|\\s)${month}월(?:\\s|$)`).test(claimText)) {
      issues.push(`claim_semantic_coverage_missing:monthly_weather:month_${month}`);
    }
  }
  const requiredPatterns: Array<[string, RegExp]> = [
    ['high_temperature', /최고기온\s*-?\d+(?:\.\d+)?\s*°?c/i],
    ['low_temperature', /최저기온\s*-?\d+(?:\.\d+)?\s*°?c/i],
    ['rainfall', /강수량\s*\d+(?:\.\d+)?\s*mm/i],
    ['rain_days', /강수일수\s*\d+(?:\.\d+)?\s*일/],
    ['climate_period', /(?:19|20)\d{2}\s*[~-]\s*(?:19|20)\d{2}\s*평년값/],
  ];
  for (const [key, pattern] of requiredPatterns) {
    if (!pattern.test(claimText)) {
      issues.push(`claim_semantic_coverage_missing:monthly_weather:${key}`);
    }
  }
  return issues;
}

function isResearchBundleShape(value: unknown): value is BlogInformationResearchBundle {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.contentKey === 'string'
    && Array.isArray(record.sources)
    && Array.isArray(record.evidence)
    && Array.isArray(record.claims);
}

export function readBlogInformationResearchBundle(meta: unknown): BlogInformationResearchBundle | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  const value = (meta as Record<string, unknown>)[BLOG_INFORMATION_RESEARCH_META_KEY];
  return isResearchBundleShape(value) ? value : null;
}

function sourceIsFresh(source: BlogInformationResearchBundle['sources'][number], nowMs: number): boolean {
  if (source.claimTypes.length === 0) return false;
  const retrievedAt = Date.parse(source.retrievedAt);
  if (!Number.isFinite(retrievedAt) || retrievedAt > nowMs + 5 * 60 * 1000) return false;
  const maxAgeDays = Math.min(...source.claimTypes.map((type) => MAX_SOURCE_AGE_DAYS[type] ?? 30));
  return nowMs - retrievedAt <= maxAgeDays * 24 * 60 * 60 * 1000;
}

function sourceTypeIsAllowed(
  source: BlogInformationResearchBundle['sources'][number],
  allowedTypes: string[],
): boolean {
  if (allowedTypes.includes(source.sourceType)) return true;
  if (allowedTypes.includes('official') && isOfficialInformationAuthority(source.authorityLevel)) return true;
  if (allowedTypes.includes('official_climate_data') && source.sourceType === 'meteorological_agency') return true;
  if (allowedTypes.includes('reputable_booking_data')
    && (source.sourceType === 'reputable_price_source' || source.sourceType === 'reputable_source')) return true;
  return false;
}

function sourceDomain(source: BlogInformationResearchBundle['sources'][number]): string {
  if (!source.sourceUrl) return source.internalIdentifier || source.sourceKey;
  try {
    return new URL(source.sourceUrl).hostname.toLowerCase();
  } catch {
    return source.sourceKey;
  }
}

export function evaluateBlogGenerationResearchReadiness(input: {
  meta: unknown;
  expectedContentKey: string;
  destination?: string | null;
  intent: BlogInformationIntent;
  locale: string;
  sourcePolicy: BlogInformationSourcePolicy;
  now?: Date;
}): BlogGenerationResearchReadiness {
  const bundle = readBlogInformationResearchBundle(input.meta);
  const issues: string[] = [];
  if (!bundle) issues.push('research_bundle_missing_or_invalid_shape');

  const emptySummary = {
    sourceCount: 0,
    evidenceCount: 0,
    claimCount: 0,
    supportedClaimCount: 0,
    claimSourceCoverage: 0,
    distinctNormalizedValueCount: 0,
  };
  if (!bundle) return { passed: false, issues, bundle: null, summary: emptySummary };

  try {
    const validation = validateBlogInformationResearchBundle(bundle);
    issues.push(...validation.issues.map((issue) => `bundle:${issue}`));
  } catch {
    issues.push('research_bundle_validation_exception');
  }

  if (clean(bundle.contentKey) !== clean(input.expectedContentKey)) issues.push('content_key_mismatch');
  const expectedDestination = normalize(input.destination);
  const expectedLocale = clean(input.locale);
  if (expectedDestination) {
    for (const evidence of bundle.evidence) {
      if (normalize(evidence.scope?.destination) !== expectedDestination) {
        issues.push(`evidence_destination_mismatch:${evidence.evidenceKey || 'unknown'}`);
      }
    }
  }
  for (const evidence of bundle.evidence) {
    if (clean(evidence.scope?.locale) !== expectedLocale) {
      issues.push(`evidence_locale_mismatch:${evidence.evidenceKey || 'unknown'}`);
    }
  }

  const nowMs = (input.now ?? new Date()).getTime();
  for (const source of bundle.sources) {
    if (source.claimTypes.length === 0) issues.push(`source_claim_types_missing:${source.sourceKey}`);
    if (!sourceTypeIsAllowed(source, input.sourcePolicy.sourceTypes)) {
      issues.push(`source_type_not_allowed:${source.sourceKey}`);
    }
    if (!sourceIsFresh(source, nowMs)) issues.push(`source_stale:${source.sourceKey}`);
  }
  if (input.sourcePolicy.primarySourcesRequired
    && !bundle.sources.some((source) => isPrimaryInformationAuthority(source.authorityLevel))) {
    issues.push('official_primary_source_required');
  }
  const minimumSourceDomains = BLOG_INFORMATION_MINIMUM_SOURCE_DOMAINS[input.intent] ?? 1;
  const sourceDomainCount = new Set(bundle.sources.map(sourceDomain).filter(Boolean)).size;
  if (sourceDomainCount < minimumSourceDomains) {
    issues.push(`source_domain_diversity_below_minimum:${sourceDomainCount}/${minimumSourceDomains}`);
  }

  const evidenceKeys = new Set(bundle.evidence.map((evidence) => evidence.evidenceKey));
  const supportedClaims = bundle.claims.filter((claim) =>
    claim.evidenceKeys.length > 0 && claim.evidenceKeys.every((key) => evidenceKeys.has(key)));
  const coverage = bundle.claims.length > 0 ? supportedClaims.length / bundle.claims.length : 0;
  if (coverage < input.sourcePolicy.minimumClaimSourceCoverage) {
    issues.push(`claim_source_coverage_below_minimum:${coverage.toFixed(2)}`);
  }

  const minimums = BLOG_INFORMATION_MINIMUM_CLAIMS_BY_INTENT[input.intent] ?? { factual: 3 };
  for (const [claimType, minimum] of Object.entries(minimums)) {
    const count = supportedClaims.filter((claim) => claim.claimType === claimType).length;
    if (count < Number(minimum)) issues.push(`claim_type_below_minimum:${claimType}:${count}/${minimum}`);
  }

  const supportedClaimText = supportedClaims.map((claim) => normalize(claim.claimText)).join('\n');
  for (const semantic of REQUIRED_CLAIM_SEMANTICS_BY_INTENT[input.intent] ?? []) {
    if (!semantic.pattern.test(supportedClaimText)) {
      issues.push(`claim_semantic_coverage_missing:${input.intent}:${semantic.key}`);
    }
  }
  if (input.intent === 'monthly_weather') {
    issues.push(...monthlyWeatherClaimCoverageIssues(supportedClaimText));
  }

  const distinctNormalizedValues = new Set(bundle.evidence
    .map((evidence) => normalize(evidence.scope?.normalizedValue))
    .filter(Boolean));
  if (input.sourcePolicy.exactNumbersRequireSource && distinctNormalizedValues.size < 3) {
    issues.push(`distinct_evidence_values_below_minimum:${distinctNormalizedValues.size}/3`);
  }

  return {
    passed: issues.length === 0,
    issues: [...new Set(issues)],
    bundle,
    summary: {
      sourceCount: bundle.sources.length,
      evidenceCount: bundle.evidence.length,
      claimCount: bundle.claims.length,
      supportedClaimCount: supportedClaims.length,
      claimSourceCoverage: Number(coverage.toFixed(4)),
      distinctNormalizedValueCount: distinctNormalizedValues.size,
    },
  };
}

export function buildBlogGenerationResearchPromptBlock(readiness: BlogGenerationResearchReadiness): string {
  if (!readiness.passed || !readiness.bundle) return '';
  const sourceByKey = new Map(readiness.bundle.sources.map((source) => [source.sourceKey, source]));
  return [
    '## Verified research evidence pack - mandatory factual boundary',
    '- Use only the claim sentences and exact values listed below for prices, currency, time, climate, policy, or other verifiable facts.',
    '- Copy each factual claim sentence exactly into the visible article and into the hidden claim ledger. Do not paraphrase a number-bearing claim.',
    '- You may add connective explanation and reader guidance, but never add a new number, policy, schedule, price tier, or factual superlative.',
    '- If the evidence does not cover a required section, keep the article private by recording the gap. Never fill it with an estimate.',
    '',
    '### Approved sources',
    ...readiness.bundle.sources.map((source) =>
      `- [${source.sourceKey}] ${source.publisher} | ${source.authorityLevel} | checked ${source.retrievedAt} | ${source.sourceUrl ?? source.internalIdentifier ?? 'internal source'}`),
    '',
    '### Exact evidence excerpts',
    ...readiness.bundle.evidence.map((evidence) => {
      const source = sourceByKey.get(evidence.sourceKey);
      return `- [${evidence.evidenceKey}] ${source?.publisher ?? evidence.sourceKey}: ${evidence.excerpt ?? ''}`;
    }),
    '',
    '### Approved customer-visible factual claims',
    ...readiness.bundle.claims.map((claim) =>
      `- [${claim.claimType}] ${claim.claimText} (evidence: ${claim.evidenceKeys.join(', ')})`),
  ].join('\n');
}

function escapeMarkdownTableCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

interface FoodBudgetImageBlock {
  url: string;
  markdown: string;
}

function extractFoodBudgetImageBlocks(markdown: string): FoodBudgetImageBlock[] {
  const lines = markdown.split(/\r?\n/);
  const blocks: FoodBudgetImageBlock[] = [];
  const seenUrls = new Set<string>();
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index]?.trim().match(/^!\[[^\]]*]\((https:\/\/[^)\s]+)(?:\s+"[^"]*")?\)$/i);
    const url = match?.[1]?.trim();
    if (!url || seenUrls.has(url)) continue;
    seenUrls.add(url);
    const blockLines = [lines[index]!.trim()];
    const caption = lines[index + 1]?.trim() ?? '';
    if (/^<figcaption>[\s\S]*<\/figcaption>$/i.test(caption)) {
      blockLines.push(caption);
      index += 1;
    }
    blocks.push({ url, markdown: blockLines.join('\n') });
  }
  return blocks;
}

function distributeFoodBudgetImageBlocks(
  markdown: string,
  imageBlocks: FoodBudgetImageBlock[],
): string {
  if (imageBlocks.length === 0) return markdown;
  const targetHeadings = new Set(FOOD_BUDGET_DETERMINISTIC_HEADINGS.slice(0, 3).map(normalize));
  const remaining = [...imageBlocks];
  const output: string[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    if (line === FOOD_BUDGET_STRUCTURE_END_MARKER && remaining.length > 0) {
      output.push('', ...remaining.splice(0).flatMap((block) => block.markdown.split('\n')), '');
    }
    output.push(line);
    const h2 = line.match(/^##\s+(.+?)\s*$/);
    if (h2 && targetHeadings.has(normalize(h2[1])) && remaining.length > 0) {
      output.push('', ...remaining.shift()!.markdown.split('\n'));
    }
  }
  return output.join('\n').replace(/\n{3,}/g, '\n\n');
}

function formatExtractedPrice(claim: BlogInformationResearchBundle['claims'][number]): string {
  const normalizedValue = clean(claim.extractedValue?.normalizedValue);
  const currency = clean(claim.extractedValue?.currency);
  const formattedValue = /^\d+$/.test(normalizedValue)
    ? Number(normalizedValue).toLocaleString('en-US')
    : normalizedValue;
  return escapeMarkdownTableCell(`${formattedValue} ${currency}`.trim());
}

function findFoodBudgetClaim(
  claims: BlogInformationResearchBundle['claims'],
  pattern: RegExp,
): BlogInformationResearchBundle['claims'][number] | null {
  return claims.find((claim) => claim.claimType === 'price' && pattern.test(normalize(claim.claimText))) ?? null;
}

function removeGeneratedFoodBudgetConflicts(markdown: string): string {
  const normalizedHeadings = new Set(FOOD_BUDGET_DETERMINISTIC_HEADINGS.map(normalize));
  const lines = markdown.replace(/\\n/g, '\n').split(/\r?\n/);
  const kept: string[] = [];
  let conflictingHeadingDepth: number | null = null;

  for (const line of lines) {
    const heading = line.match(/^(#{2,6})\s+(.+?)\s*$/);
    if (heading) {
      const depth = heading[1]!.length;
      if (conflictingHeadingDepth !== null && depth > conflictingHeadingDepth) continue;
      if (conflictingHeadingDepth !== null && depth <= conflictingHeadingDepth) {
        conflictingHeadingDepth = null;
      }
      if (normalizedHeadings.has(normalize(heading[2]))) {
        conflictingHeadingDepth = depth;
        continue;
      }
    } else if (conflictingHeadingDepth !== null && /^<!--\s*(?:prompt_|blog_)/i.test(line.trim())) {
      conflictingHeadingDepth = null;
    }
    if (conflictingHeadingDepth !== null) continue;

    // These tables are rebuilt exclusively from preflight-approved claims below.
    // Removing model-authored pipe rows also drops malformed one-cell rows that
    // otherwise survive claim removal as a bare "|" and fail render integrity.
    if (/^\s*\|/.test(line)) continue;
    if (/^\s*#{1,6}\s*$/.test(line)) continue;
    kept.push(line);
  }

  return kept
    .join('\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function removeExistingFoodBudgetStructure(markdown: string): string {
  let withoutMarkedBlock = markdown;
  const start = withoutMarkedBlock.indexOf(FOOD_BUDGET_STRUCTURE_MARKER);
  if (start >= 0) {
    const explicitEnd = withoutMarkedBlock.indexOf(FOOD_BUDGET_STRUCTURE_END_MARKER, start);
    if (explicitEnd >= 0) {
      withoutMarkedBlock = `${withoutMarkedBlock.slice(0, start)}${withoutMarkedBlock.slice(explicitEnd + FOOD_BUDGET_STRUCTURE_END_MARKER.length)}`;
    } else {
      // v1 originally had only a start marker and was emitted immediately before prompt_version.
      const promptVersion = withoutMarkedBlock.indexOf('<!-- prompt_version:', start);
      withoutMarkedBlock = promptVersion >= 0
        ? `${withoutMarkedBlock.slice(0, start)}${withoutMarkedBlock.slice(promptVersion)}`
        : withoutMarkedBlock.replace(FOOD_BUDGET_STRUCTURE_MARKER, '');
    }
  }
  return removeGeneratedFoodBudgetConflicts(withoutMarkedBlock);
}

function appendFoodBudgetFeesBookingGuidance(
  markdown: string,
  claims: BlogInformationResearchBundle['claims'],
): { markdown: string; changed: boolean } {
  if (FOOD_BUDGET_FEES_BOOKING_PATTERN.test(markdown)) {
    return { markdown, changed: false };
  }
  const policyClaims = claims
    .filter((claim) => claim.claimType === 'policy')
    .map((claim) => clean(claim.claimText))
    .filter(Boolean);
  const evidenceBoundary = policyClaims.length > 0
    ? `현재 근거 묶음에서 확인된 정책 정보는 다음과 같습니다. ${policyClaims.join(' ')}`
    : '현재 가격 근거 묶음에는 업장별 세금·서비스료·예약 조건이 포함되어 있지 않습니다.';
  const block = [
    FOOD_BUDGET_POLICY_GAP_MARKER,
    '## 세금·서비스료·예약 조건은 어떻게 확인할까?',
    '',
    evidenceBoundary,
    '방문 전 공식 메뉴와 예약 화면에서 세금 포함 여부, 서비스료, 예약·취소 조건을 확인하세요.',
  ].join('\n');
  return {
    markdown: `${markdown.trim()}\n\n${block}`,
    changed: true,
  };
}

function removeExistingMonthlyWeatherStructure(markdown: string): string {
  let next = markdown;
  for (const [startMarker, endMarker] of [
    [MONTHLY_WEATHER_STRUCTURE_MARKER, MONTHLY_WEATHER_STRUCTURE_END_MARKER],
    [LEGACY_MONTHLY_WEATHER_STRUCTURE_MARKER, LEGACY_MONTHLY_WEATHER_STRUCTURE_END_MARKER],
  ] as const) {
    const start = next.indexOf(startMarker);
    if (start < 0) continue;
    const end = next.indexOf(endMarker, start);
    if (end >= 0) {
      next = `${next.slice(0, start)}${next.slice(end + endMarker.length)}`;
      continue;
    }
    const promptVersion = next.indexOf('<!-- prompt_version:', start);
    next = promptVersion >= 0
      ? `${next.slice(0, start)}${next.slice(promptVersion)}`
      : next.slice(0, start);
  }
  return next
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function monthlyWeatherClaimMonth(
  claim: BlogInformationResearchBundle['claims'][number],
): number | null {
  const match = normalize(claim.claimText).match(/(?:^|\s)(1[0-2]|[1-9])월(?:\s|$)/);
  const month = Number(match?.[1]);
  return Number.isInteger(month) && month >= 1 && month <= 12 ? month : null;
}

function monthlyWeatherClothing(claimText: string, month: number): string {
  const rainfall = Number(claimText.match(/강수량\s*(\d+(?:\.\d+)?)\s*mm/i)?.[1]);
  const variantIndex = Math.max(0, month - 1) % 4;
  if (Number.isFinite(rainfall) && rainfall >= 250) {
    return [
      '반팔과 방수 겉옷, 우산',
      '가벼운 상의와 우비, 우산',
      '얇은 옷과 방수 재킷, 여벌옷',
      '통풍되는 옷과 우산, 방수 파우치',
    ][variantIndex]!;
  }
  if (Number.isFinite(rainfall) && rainfall >= 150) {
    return [
      '반팔과 얇은 방수 겉옷',
      '가벼운 상의와 휴대용 우산',
      '얇은 옷과 가벼운 우비',
      '통풍되는 옷과 방수 재킷',
    ][variantIndex]!;
  }
  return [
    '반팔과 얇은 겉옷',
    '가벼운 상의와 냉방용 겉옷',
    '얇은 옷과 휴대용 겉옷',
    '통풍되는 옷과 가벼운 재킷',
  ][variantIndex]!;
}

function monthlyWeatherAdjustment(month: number): string {
  return [
    '기온과 강수량을 함께 확인',
    '강수일수와 단기예보 확인',
    '체감기온과 비 예보 확인',
    '출발 직전 예보로 최종 조정',
  ][Math.max(0, month - 1) % 4]!;
}

function buildDeterministicMonthlyWeatherArticle(input: {
  originalMarkdown: string;
  approvedClaims: BlogInformationResearchBundle['claims'];
  sourceLabel: string;
  sourceUrl: string;
}): string {
  const title = input.originalMarkdown.match(/^#\s+(.+?)\s*$/m)?.[1]?.trim()
    || '월별 날씨와 옷차림 준비';
  const imageUrls = extractFoodBudgetImageBlocks(input.originalMarkdown)
    .slice(0, 3)
    .map((block) => block.url);
  const imageAlts = [
    `${title} 월별 날씨 확인`,
    `${title} 옷차림 준비`,
    `${title} 비 대비 준비`,
  ];
  const imageAt = (index: number) => imageUrls[index]
    ? ['', `![${imageAlts[index]}](${imageUrls[index]})`]
    : [];
  const climateRows = input.approvedClaims.map((claim, index) =>
    `| ${index + 1}월 | ${escapeMarkdownTableCell(claim.claimText)} |`);
  const clothingRows = input.approvedClaims.map((claim, index) =>
    `| ${index + 1}월 | ${monthlyWeatherClothing(claim.claimText, index + 1)} | ${monthlyWeatherAdjustment(index + 1)} |`);

  return [
    MONTHLY_WEATHER_STRUCTURE_MARKER,
    `# ${title}`,
    '',
    '기온과 비 예보를 확인한 뒤, 옷차림과 준비물을 출발 직전 조건에 맞춰 조정하세요.',
    '1~12월 자료에서는 여행하는 달의 기온·강수량·강수일수를 어떤 순서로 확인해야 할까요?',
    '장기 평년자료와 실제 출발일 예보를 같은 값으로 보지 말고, 표는 준비 기준으로 활용한 뒤 단기예보를 다시 확인하세요.',
    ...imageAt(0),
    '',
    '## 먼저 확인할 핵심',
    '',
    '- 여행하는 달의 행에서 기온과 강수량, 강수일수를 함께 확인하세요.',
    '- 옷차림 준비 열을 기본값으로 삼고 실내 냉방용 얇은 겉옷을 더해 보세요.',
    '- 비 예보가 보이면 우산, 방수 겉옷, 젖은 옷을 담을 팩을 한 묶음으로 챙기세요.',
    '- 장기 평년자료를 본 뒤 실제 출발일의 단기예보를 다시 확인하세요.',
    '- [여소남 여행지 가이드](/destinations)에서 목적지별 준비 정보도 함께 확인하세요.',
    '',
    '## 1~12월 기온·강수·옷차림',
    '',
    `자료 원문: [${input.sourceLabel}](${input.sourceUrl})`,
    '',
    '| 월 | 검증된 평년값 |',
    '| --- | --- |',
    ...climateRows,
    ...imageAt(1),
    '',
    '## 월별 옷차림 준비표',
    '',
    '| 월 | 기본 옷차림 | 출발 전 조정 기준 |',
    '| --- | --- | --- |',
    ...clothingRows,
    '',
    '표의 옷차림은 짐을 고르는 출발점으로만 활용하고, 출발 직전 체감기온과 비 예보에 맞춰 더하거나 빼세요.',
    '',
    '## 우기·건기 및 태풍 위험 확인',
    '',
    '- 이 표만으로 우기·건기의 경계나 태풍 발생 여부를 단정하지 마세요.',
    '- 이상기후 위험은 출발 직전 공식 특보와 단기예보에서 별도로 확인하세요.',
    '- 작은 우산과 방수 겉옷을 함께 두고, 손이 자유로워야 하는 일정에는 우비도 비교해 보세요.',
    '- 휴대전화와 여권 사본, 충전기처럼 젖으면 곤란한 물품은 방수 파우치에 나눠 담으세요.',
    '- 젖은 옷과 마른 옷을 분리할 가벼운 팩을 준비 목록에 넣어 보세요.',
    '- 바람과 습도, 갑작스러운 비는 장기 표만으로 결정하지 말고 단기예보에서 다시 확인하세요.',
    ...imageAt(2),
    '',
    '## 여행 목적별 추천 시기 확인법',
    '',
    '- 해변 일정은 여행하는 달의 강수량과 강수일수를 먼저 비교해 보세요.',
    '- 걷는 일정은 낮과 저녁의 옷차림을 나누고, 비가 올 때 쉴 실내 동선도 함께 확인하세요.',
    '- 아이 동반 일정은 갈아입을 옷과 방수팩, 얇은 겉옷을 한 묶음으로 준비해 보세요.',
    '- 사진 촬영이나 야외 일정은 원하는 달의 표와 출발 직전 예보를 함께 비교해 보세요.',
    '',
    '## 출발 전 체크리스트',
    '',
    '- 여행하는 달의 평년값 행을 다시 확인하세요.',
    '- 출발일과 귀국일의 단기예보를 각각 확인하세요.',
    '- 비가 예상되는 시간대와 실내 이동 동선을 함께 확인하세요.',
    '- 옷차림, 우산, 방수 겉옷, 여벌옷 목록을 마지막으로 확인하세요.',
    '',
    '## 자주 묻는 질문',
    '',
    '### Q1. 월별 평년값을 실제 출발일 예보로 봐도 되나요?',
    'A. 같은 값으로 보지 말고, 월별 표는 준비 기준으로 활용한 뒤 실제 출발일의 단기예보를 다시 확인하세요.',
    '',
    '### Q2. 비가 많은 달에는 무엇을 챙기면 좋나요?',
    'A. 월별 표의 강수량과 옷차림 준비 열을 함께 보고, 방수 겉옷과 우산, 젖은 물품을 나눌 팩을 확인하세요.',
    '',
    '### Q3. 옷차림은 기온만 보고 정해도 되나요?',
    'A. 기온과 강수량, 강수일수를 함께 보고, 실내 냉방과 단기예보까지 확인하세요.',
    '',
    '## 공식 출처',
    '',
    `- [${input.sourceLabel} 월별 기후자료](${input.sourceUrl})`,
    '- [WMO 세계 공식 예보·기후 포털](https://worldweather.wmo.int/en/home.html)',
    MONTHLY_WEATHER_STRUCTURE_END_MARKER,
  ].join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function repairMonthlyWeatherResearchStructure(input: {
  markdown: string;
  readiness: BlogGenerationResearchReadiness;
}): BlogGenerationResearchStructureRepair {
  const unchanged = (approvedClaims: BlogInformationResearchBundle['claims'] = []) => ({
    markdown: input.markdown,
    changed: false,
    changes: [],
    approvedClaims,
  });
  if (!input.readiness.passed || !input.readiness.bundle) return unchanged();

  const claimsByMonth = new Map<number, BlogInformationResearchBundle['claims'][number]>();
  for (const claim of input.readiness.bundle.claims) {
    if (claim.claimType !== 'climate') continue;
    const month = monthlyWeatherClaimMonth(claim);
    if (month && !claimsByMonth.has(month)) claimsByMonth.set(month, claim);
  }
  if (claimsByMonth.size !== 12) return unchanged();
  const approvedClaims = Array.from({ length: 12 }, (_, index) => claimsByMonth.get(index + 1)!);
  if (approvedClaims.some((claim) =>
    !/최고기온\s*-?\d+(?:\.\d+)?\s*°?C/i.test(claim.claimText)
    || !/최저기온\s*-?\d+(?:\.\d+)?\s*°?C/i.test(claim.claimText)
    || !/강수량\s*\d+(?:\.\d+)?\s*mm/i.test(claim.claimText)
    || !/강수일수\s*\d+(?:\.\d+)?\s*일/.test(claim.claimText))) {
    return unchanged();
  }

  const hasCompleteBlock = input.markdown.includes(MONTHLY_WEATHER_STRUCTURE_MARKER)
    && input.markdown.includes(MONTHLY_WEATHER_STRUCTURE_END_MARKER);
  const existingReport = validateBlogInformationStructure({
    intent: 'monthly_weather',
    markdown: input.markdown,
  });
  const firstParagraph = input.markdown.trim().match(
    /^<!-- blog_research_structure:monthly_weather:v2 -->\s*\n#\s+.+\n\s*\n([^\n]+)/,
  )?.[1] ?? '';
  const hasIntentAlignedIntro = /기온/.test(firstParagraph)
    && /비/.test(firstParagraph)
    && /옷차림/.test(firstParagraph)
    && /준비물/.test(firstParagraph);
  if (hasCompleteBlock && existingReport.passed && hasIntentAlignedIntro) return unchanged();

  const source = input.readiness.bundle.sources.find((candidate) =>
    candidate.claimTypes.includes('climate') && Boolean(candidate.sourceUrl));
  if (!source?.sourceUrl) return unchanged();
  const sourceLabel = escapeMarkdownTableCell(source.publisher || '공식 기후 자료');
  const verifiedArticle = buildDeterministicMonthlyWeatherArticle({
    // The deterministic block can be rebuilt after later editorial repairs.
    // Read the title and reusable images before replacing that block, otherwise
    // a second repair silently drops every inline image from the final article.
    originalMarkdown: input.markdown,
    approvedClaims,
    sourceLabel,
    sourceUrl: source.sourceUrl,
  });

  return {
    markdown: verifiedArticle,
    changed: true,
    changes: ['monthly_weather_deterministic_evidence_article'],
    approvedClaims,
  };
}

/**
 * Reuses only preflight-approved claims to make required food-budget tables deterministic.
 * It never calculates a total, converts currencies, or introduces a value outside the bundle.
 */
export function repairBlogGenerationResearchStructure(input: {
  markdown: string;
  intent: BlogInformationIntent;
  readiness: BlogGenerationResearchReadiness;
}): BlogGenerationResearchStructureRepair {
  const unchanged = (approvedClaims: BlogInformationResearchBundle['claims'] = []) => ({
    markdown: input.markdown,
    changed: false,
    changes: [],
    approvedClaims,
  });
  if (input.intent === 'monthly_weather') {
    return repairMonthlyWeatherResearchStructure(input);
  }
  if (input.intent !== 'food_budget' || !input.readiness.passed || !input.readiness.bundle) {
    return unchanged();
  }

  const report = validateBlogInformationStructure({ intent: input.intent, markdown: input.markdown });
  const hasDeterministicResearchBlock = input.markdown.includes(FOOD_BUDGET_STRUCTURE_MARKER)
    && input.markdown.includes(FOOD_BUDGET_STRUCTURE_END_MARKER);
  const needsVerifiedTables = !hasDeterministicResearchBlock
    || report.issues.some((issue) => FOOD_BUDGET_STRUCTURE_ISSUES.has(issue));
  const needsAreaPriceDifferenceGuidance = !FOOD_BUDGET_AREA_PRICE_DIFFERENCE_PATTERN.test(input.markdown);
  const claims = input.readiness.bundle.claims;
  if (!needsVerifiedTables && !needsAreaPriceDifferenceGuidance) {
    const policyRepair = appendFoodBudgetFeesBookingGuidance(input.markdown, claims);
    return policyRepair.changed
      ? {
          markdown: policyRepair.markdown,
          changed: true,
          changes: ['food_budget_fees_booking_evidence_gap'],
          approvedClaims: [],
        }
      : unchanged();
  }
  const rows = {
    budget: findFoodBudgetClaim(claims, /절약/),
    midrange: findFoodBudgetClaim(claims, /일반형|중간형|중간\s*예산/),
    luxury: findFoodBudgetClaim(claims, /여유형|고급형|고급\s*예산/),
    breakfast: findFoodBudgetClaim(claims, /아침/),
    lunch: findFoodBudgetClaim(claims, /점심/),
    dinner: findFoodBudgetClaim(claims, /저녁/),
    snack: findFoodBudgetClaim(claims, /간식|커피|카페|스낵/),
  };
  if (Object.values(rows).some((claim) => !claim || !formatExtractedPrice(claim))) {
    return unchanged();
  }

  const approvedClaims = Object.values(rows) as BlogInformationResearchBundle['claims'];
  const preservedImageBlocks = extractFoodBudgetImageBlocks(input.markdown);
  let markdown = removeExistingFoodBudgetStructure(input.markdown);
  for (const claim of approvedClaims) {
    markdown = markdown.split(claim.claimText).join('');
  }
  markdown = markdown
    .replace(/^\s*(?:[-*+]\s*)?$/gm, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const missingPreservedImageBlocks = preservedImageBlocks.filter((block) =>
    !markdown.includes(`](${block.url})`));
  const tableBlock = distributeFoodBudgetImageBlocks([
    FOOD_BUDGET_STRUCTURE_MARKER,
    '## 근거로 확인한 1인 하루 식비',
    '',
    '| 예산 유형 | 1인 하루 식비 |',
    '| --- | ---: |',
    `| 절약 | ${formatExtractedPrice(rows.budget!)} |`,
    `| 일반 | ${formatExtractedPrice(rows.midrange!)} |`,
    `| 여유 | ${formatExtractedPrice(rows.luxury!)} |`,
    '',
    '## 근거로 확인한 끼니별 가격',
    '',
    '| 끼니·메뉴 | 가격 |',
    '| --- | ---: |',
    `| 아침 | ${formatExtractedPrice(rows.breakfast!)} |`,
    `| 점심 | ${formatExtractedPrice(rows.lunch!)} |`,
    `| 저녁 | ${formatExtractedPrice(rows.dinner!)} |`,
    `| 간식·커피 | ${formatExtractedPrice(rows.snack!)} |`,
    '',
    '## 지역별 가격 차이 확인 방법',
    '',
    '삿포로의 지역별 가격 차이는 상권·업장·메뉴에 따라 달라집니다. 이 자료는 도시 전체 평균이므로 구체적인 지역별 차액을 단정하지 않습니다. 방문할 지역의 메뉴판과 공식 예약 화면에서 비용 차이를 다시 확인하세요.',
    '',
    FOOD_BUDGET_STRUCTURE_END_MARKER,
  ].join('\n'), missingPreservedImageBlocks);

  const tableMarkdown = `${markdown}\n\n${tableBlock}`.trim();
  const policyRepair = appendFoodBudgetFeesBookingGuidance(tableMarkdown, claims);
  return {
    markdown: policyRepair.markdown,
    changed: true,
    changes: [
      'food_budget_verified_research_tables',
      ...(policyRepair.changed ? ['food_budget_fees_booking_evidence_gap'] : []),
    ],
    approvedClaims,
  };
}

export function summarizeBlogGenerationResearch(readiness: BlogGenerationResearchReadiness): Record<string, unknown> {
  return {
    version: 'r18-research-first-v1',
    passed: readiness.passed,
    issues: readiness.issues.slice(0, 20),
    ...readiness.summary,
    source_keys: readiness.bundle?.sources.map((source) => source.sourceKey) ?? [],
    evidence_keys: readiness.bundle?.evidence.map((evidence) => evidence.evidenceKey) ?? [],
  };
}

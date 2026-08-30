import {
  buildBlogInformationContract,
  inspectBlogInformationMarkdown,
  type BlogInformationIntent,
  type BlogInformationSourcePolicy,
} from './blog-information-contract';
import {
  extractMonthlyClimateCompositeValue,
  isOfficialInformationAuthority,
  isPrimaryInformationAuthority,
  validateBlogInformationResearchBundle,
  type BlogInformationClaimType,
  type BlogInformationResearchBundle,
} from './blog-information-evidence';
import { validateBlogInformationStructure } from './blog-information-structure';
import { BLOG_RESEARCH_PREFLIGHT_VERSION } from './blog-verified-research-sources';

export const BLOG_INFORMATION_RESEARCH_META_KEY = 'information_research_bundle';

export const BLOG_INFORMATION_MINIMUM_CLAIMS_BY_INTENT: Partial<Record<
  BlogInformationIntent,
  Partial<Record<BlogInformationClaimType, number>>
>> = {
  food_budget: { price: 7 },
  monthly_weather: { climate: 12 },
  airport_transport: { price: 2, duration: 2 },
  local_transport: { price: 2, duration: 2 },
  hotel_areas: { price: 3, factual: 3 },
  family_budget: { price: 4 },
  // V3 separately requires at least three evidence-linked destination decision
  // details. Do not reject a safe packet merely because a detail is typed as
  // duration or superlative rather than the generic `factual` bucket.
  itinerary: { duration: 1, factual: 1 },
  shopping_souvenirs: { price: 3, factual: 2 },
  currency_payment: { currency: 1, factual: 3 },
  entry_requirements: { entry_visa: 2, policy: 2 },
  travel_insurance: { insurance: 4, policy: 2 },
};

/**
 * Type minimums prevent a packet from containing the wrong kind of facts;
 * total minimums prevent a nominally valid but editorially unusable packet.
 * Attraction/itinerary decisions need more than the three entity details used
 * by the flexible brief because each choice also needs a supported constraint
 * or comparison input.
 */
export const BLOG_INFORMATION_MINIMUM_TOTAL_CLAIMS_BY_INTENT: Partial<Record<
  BlogInformationIntent,
  number
>> = {
  itinerary: 6,
  hotel_areas: 8,
  airport_transport: 6,
  local_transport: 6,
};

const BLOG_INFORMATION_MINIMUM_SOURCE_DOMAINS: Partial<Record<BlogInformationIntent, number>> = {
  food_budget: 1,
  monthly_weather: 1,
  airport_transport: 2,
  local_transport: 2,
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
  airport_transport: [
    {
      key: 'multiple_modes',
      pattern: /(?=[\s\S]*(?:대중교통|버스|셔틀|public\s*transportation|bus|shuttle))(?=[\s\S]*(?:택시|렌터카|승차\s*호출|taxi|rental|ride))/i,
    },
    {
      key: 'operating_hours',
      pattern: /첫차|막차|운행\s*(?:시간|시각|시작|종료)|\d{1,2}:\d{2}|first\s*(?:bus|service)|last\s*(?:bus|service)|operating\s*hours/i,
    },
    { key: 'luggage', pattern: /수하물|짐|캐리어|luggage|baggage|suitcase/i },
    { key: 'late_arrival', pattern: /심야|야간|늦은|연착|지연|late\s*arrival|overnight|delay/i },
  ],
  local_transport: [
    { key: 'route', pattern: /노선|구간|직행|연결|정류장|route|line|stop/i },
    {
      key: 'frequency_schedule',
      pattern: /배차|간격|매일|운행\s*(?:시간|시각)|첫차|막차|\d{1,2}:\d{2}|daily|frequency|schedule|timetable/i,
    },
    {
      key: 'ticket_or_reservation',
      pattern: /승차권|티켓|교통카드|예약|구매|ticket|pass|reservation|book/i,
    },
    {
      key: 'service_limitation',
      pattern: /제한|금지|운휴|미운행|불가|제외|주의|limited|unavailable|does\s+not|restriction|closed/i,
    },
  ],
  food_budget: [
    { key: 'budget_tier', pattern: /절약/ },
    { key: 'midrange_tier', pattern: /일반|중간/ },
    { key: 'luxury_tier', pattern: /여유|고급/ },
    { key: 'breakfast', pattern: /아침/ },
    { key: 'lunch', pattern: /점심/ },
    { key: 'dinner', pattern: /저녁/ },
    { key: 'snack', pattern: /간식|커피|카페|패스트\s*푸드|길거리\s*음식/ },
  ],
  hotel_areas: [
    { key: 'named_area', pattern: /투몬|타무닝|요나|아가트|하갓냐|데데도|건\s*비치|tumon|tamuning|yona|agat|hagatna|dededo/ },
    { key: 'nightly_price', pattern: /1박|숙박|nightly|per\s*night/ },
  ],
  family_budget: [
    { key: 'lodging', pattern: /호텔|숙소|1박|리조트|hotel|lodging|resort/ },
    { key: 'meal', pattern: /식사|식비|레스토랑|패스트\s*푸드|meal|restaurant/ },
    { key: 'transport', pattern: /교통|택시|버스|대중교통|탑승\s*요금|1일권|grta|route|fare|transport|taxi|bus/ },
    { key: 'child_or_family', pattern: /아동|아이|어린이|가족|child|children|kid|family/ },
  ],
  itinerary: [
    {
      key: 'attraction',
      pattern: /수족관|박물관|해변|비치|야시장|관광|명소|반도|산|시장|사원|다리|공원|탑|대성당|동굴|유적|aquarium|museum|beach|attraction|peninsula|mountain|market|temple|bridge|park|cave|heritage/i,
    },
    {
      key: 'route_duration',
      pattern: /(?:공항|에서|부터|까지|이동|주행|airport|drive|ride|route|panglao|carmen|tumon|hagatna|kmart|giaa)[^\n]{0,120}\d+(?:\.\d+)?\s*(?:분|시간|minutes?|hours?)/,
    },
    {
      key: 'schedule_or_access_constraint',
      // Bare prices or ticket/fare mentions do not help a reader place an
      // attraction into an itinerary. Require an actual schedule, booking,
      // admission, physical-access, restriction, or closure condition.
      pattern: /운영\s*(?:시간|시각|시작|종료)|개장|폐장|입장\s*(?:시간|마감|조건|제한|가능|불가)|예약\s*(?:필수|필요|마감|시간|조건)|계단|엘리베이터|출입\s*(?:시간|통제|제한|가능|불가)|통제|운휴|폐쇄|휴무|opening\s*hours?|opens?\s+(?:at|from)|closes?\s+(?:at|on)|admission\s*(?:hours?|closes?|conditions?|restricted)|reservation\s*(?:required|window|deadline)|steps?|elevator|access\s*(?:hours?|restricted|limited)|restricted|closed/i,
    },
  ],
  shopping_souvenirs: [
    { key: 'souvenir_product', pattern: /기념품|선물|괌\s*(?:제품|상품)|메이드\s*인\s*괌|souvenir|gift|made\s*in\s*guam|magnet|mug|cookie/ },
    { key: 'purchase_location', pattern: /매장|상점|시장|구매|shop|store|차모로\s*빌리지|chamorro\s*village|투몬|tumon/ },
    { key: 'customs', pattern: /세관|관세|반입|면세|customs|duty/ },
  ],
  currency_payment: [
    { key: 'card', pattern: /카드|신용카드|credit\s*card/ },
    { key: 'cash_or_currency', pattern: /현금|통화|달러|지폐|동전|cash|currency|dollar/ },
  ],
  entry_requirements: [
    {
      key: 'permitted_purpose',
      pattern: /관광|출장|상용|(?:여행|방문|입국)\s*목적|\b(?:touris(?:m|t)|business)\b|travel\s+purpose/i,
    },
    {
      key: 'permitted_stay',
      pattern: /체류\s*(?:가능\s*)?(?:기간|일수)|\d+\s*일|permitted\s*stay|stay\s*(?:of|up\s*to)|\bdays?\b/i,
    },
    {
      key: 'supporting_return',
      pattern: /귀국\s*(?:일정|편|항공편|항공권)|왕복\s*항공권|출국\s*항공권|\b(?:return|onward)\s+(?:or\s+onward\s+)?ticket\b/i,
    },
    {
      key: 'supporting_lodging',
      pattern: /체류지|숙소\s*(?:예약|정보)?|숙박비|\blodging\b|accommodation/i,
    },
    {
      key: 'supporting_financial',
      pattern: /여행(?:에\s*필요한)?\s*경비|경비\s*미지참|재정\s*증빙|충분한\s*자금|\bsufficient\s+funds?\b|financial\s+(?:means|support|solvency)/i,
    },
    {
      key: 'customs_declaration',
      pattern: /세관[^\n]{0,100}(?:신고|면세|반입|품목|농산|현금)|(?:식품|농산물|현금|통화)[^\n]{0,100}신고|\b(?:declare|declaration|duty[- ]free|agricultur(?:e|al)|monetary instruments?)\b/i,
    },
  ],
  travel_insurance: [
    { key: 'medical', pattern: /의료비|병원|질병|상해|medical|illness|injury/ },
    { key: 'disruption_or_baggage', pattern: /항공|지연|결항|수하물|휴대품|flight|delay|baggage/ },
    { key: 'claim', pattern: /청구|서류|claim|document/ },
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
const LOCAL_TRANSPORT_STRUCTURE_MARKER = '<!-- blog_research_structure:local_transport:v1 -->';
const LOCAL_TRANSPORT_STRUCTURE_END_MARKER = '<!-- /blog_research_structure:local_transport:v1 -->';
const MONTHLY_WEATHER_STRUCTURE_MARKER = '<!-- blog_research_structure:monthly_weather:v2 -->';
const MONTHLY_WEATHER_STRUCTURE_END_MARKER = '<!-- /blog_research_structure:monthly_weather:v2 -->';
const MONTHLY_WEATHER_EVIDENCE_SAFE_INTRO_MARKER = '<!-- blog_research_intro:monthly_weather:evidence-safe:v1 -->';
const LEGACY_MONTHLY_WEATHER_STRUCTURE_MARKER = '<!-- blog_research_structure:monthly_weather:v1 -->';
const LEGACY_MONTHLY_WEATHER_STRUCTURE_END_MARKER = '<!-- /blog_research_structure:monthly_weather:v1 -->';
const ENTRY_REQUIREMENTS_CONTEXT_MARKER = '<!-- blog_research_context:entry_requirements:v1 -->';
const ENTRY_REQUIREMENTS_STRUCTURE_MARKER = '<!-- blog_research_structure:entry_requirements:v1 -->';
const ENTRY_REQUIREMENTS_STRUCTURE_END_MARKER = '<!-- /blog_research_structure:entry_requirements:v1 -->';
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
  if (!source.sourceUrl) return clean(source.internalIdentifier || source.sourceKey).toLowerCase();
  try {
    return new URL(source.sourceUrl).hostname
      .toLowerCase()
      .replace(/\.$/, '')
      .replace(/^www\./, '');
  } catch {
    return clean(source.sourceKey).toLowerCase();
  }
}

function normalizeMonthlyClimateCompositeBundle(
  bundle: BlogInformationResearchBundle,
): BlogInformationResearchBundle {
  const evidence = bundle.evidence.map((item) => {
    if (item.claimType !== 'climate') return item;
    const composite = extractMonthlyClimateCompositeValue(item.excerpt ?? '');
    if (!composite) return item;
    return {
      ...item,
      scope: {
        ...item.scope,
        normalizedValue: composite.normalizedValue,
        unit: composite.unit,
        currency: composite.currency,
      },
    };
  });
  const claims = bundle.claims.map((claim) => {
    if (claim.claimType !== 'climate') return claim;
    const composite = extractMonthlyClimateCompositeValue(claim.claimText);
    if (!composite) return claim;
    return {
      ...claim,
      extractedValue: composite,
    };
  });
  return { ...bundle, evidence, claims };
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
  const rawBundle = readBlogInformationResearchBundle(input.meta);
  const bundle = rawBundle ? normalizeMonthlyClimateCompositeBundle(rawBundle) : null;
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
  const minimumTotalClaims = BLOG_INFORMATION_MINIMUM_TOTAL_CLAIMS_BY_INTENT[input.intent] ?? 3;
  if (supportedClaims.length < minimumTotalClaims) {
    issues.push(`supported_claim_count_below_minimum:${supportedClaims.length}/${minimumTotalClaims}`);
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
    '- Treat editorial, crowdsourced, metasearch, and route-planning values as checked-date estimates. State the source date and conditions; never present them as guaranteed live prices or schedules.',
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

function formatExtractedDuration(claim: BlogInformationResearchBundle['claims'][number]): string {
  const normalizedValue = clean(claim.extractedValue?.normalizedValue);
  const unit = clean(claim.extractedValue?.unit);
  if (!normalizedValue || !unit) return '';
  const qualifier = /최대|up to/i.test(claim.claimText)
    ? '최대 '
    : /약|approximately|about/i.test(claim.claimText)
      ? '약 '
      : '';
  const suffix = /대기|wait/i.test(claim.claimText) ? ' 대기' : ' 소요';
  return escapeMarkdownTableCell(`${qualifier}${normalizedValue}${unit}${suffix}`);
}

function localTransportClaimSources(
  bundle: BlogInformationResearchBundle,
  claim: BlogInformationResearchBundle['claims'][number],
) {
  const evidenceKeys = new Set(claim.evidenceKeys);
  const sourceKeys = new Set(bundle.evidence
    .filter((evidence) => evidenceKeys.has(evidence.evidenceKey))
    .map((evidence) => evidence.sourceKey));
  return bundle.sources.filter((source) => sourceKeys.has(source.sourceKey));
}

function localTransportPublisher(
  bundle: BlogInformationResearchBundle,
  claim: BlogInformationResearchBundle['claims'][number],
): string {
  return clean(localTransportClaimSources(bundle, claim)[0]?.publisher) || '공식 운영사';
}

function localTransportRouteCode(claimText: string): string {
  return claimText.match(/\b(?:[A-Z]{1,3}\d+[A-Z]{0,2}|\d+[A-Z]{1,3})\b/i)?.[0]?.toUpperCase() ?? '';
}

function localTransportRowLabel(
  bundle: BlogInformationResearchBundle,
  claim: BlogInformationResearchBundle['claims'][number],
): string {
  const publisher = localTransportPublisher(bundle, claim);
  const routeCode = localTransportRouteCode(claim.claimText);
  const service = /셔틀|shuttle/i.test(claim.claimText) ? ' 셔틀' : '';
  const qualifier = /예약 없이|비예약|without (?:a )?reservation/i.test(claim.claimText)
    ? ' 비예약 이용'
    : /대기|wait/i.test(claim.claimText)
      ? ' 대기'
      : claim.claimType === 'duration'
        ? ' 이동'
        : '';
  return escapeMarkdownTableCell(
    `${publisher}${routeCode && !publisher.toUpperCase().includes(routeCode) ? ` ${routeCode}` : ''}${service}${qualifier}`,
  );
}

function localTransportClaimsSharePublisher(
  bundle: BlogInformationResearchBundle,
  left: BlogInformationResearchBundle['claims'][number],
  right: BlogInformationResearchBundle['claims'][number],
): boolean {
  const leftPublishers = new Set(localTransportClaimSources(bundle, left)
    .map((source) => normalize(source.publisher))
    .filter(Boolean));
  return localTransportClaimSources(bundle, right)
    .some((source) => leftPublishers.has(normalize(source.publisher)));
}

function localTransportSourceLinks(
  bundle: BlogInformationResearchBundle,
  claims: BlogInformationResearchBundle['claims'],
): string {
  const links = new Map<string, string>();
  for (const claim of claims) {
    for (const source of localTransportClaimSources(bundle, claim)) {
      const url = clean(source.sourceUrl);
      if (!url || links.has(url)) continue;
      const publisher = escapeMarkdownTableCell(clean(source.publisher) || '공식 운영사');
      links.set(url, `[${publisher}](${url})`);
    }
  }
  return [...links.values()].join(', ');
}

function repairLocalTransportResearchStructure(input: {
  markdown: string;
  readiness: BlogGenerationResearchReadiness;
  plannedTitle?: string | null;
}): BlogGenerationResearchStructureRepair {
  const unchanged = () => ({
    markdown: input.markdown,
    changed: false,
    changes: [],
    approvedClaims: [],
  });
  const bundle = input.readiness.bundle;
  if (!input.readiness.passed || !bundle) return unchanged();

  const hasDeterministicBlock = input.markdown.includes(LOCAL_TRANSPORT_STRUCTURE_MARKER)
    && input.markdown.includes(LOCAL_TRANSPORT_STRUCTURE_END_MARKER);
  const startsWithDeterministicBlock = input.markdown.trimStart()
    .startsWith(LOCAL_TRANSPORT_STRUCTURE_MARKER);
  const report = validateBlogInformationStructure({
    intent: 'local_transport',
    markdown: input.markdown,
  });
  if (hasDeterministicBlock && startsWithDeterministicBlock && report.passed) return unchanged();

  const claims = bundle.claims;
  const priceClaims = claims
    .filter((claim) => claim.claimType === 'price' && formatExtractedPrice(claim))
    .sort((left, right) =>
      Number(/수수료|fee|transaction/i.test(left.claimText))
      - Number(/수수료|fee|transaction/i.test(right.claimText)));
  const durationClaims = claims
    .filter((claim) => claim.claimType === 'duration' && formatExtractedDuration(claim))
    .sort((left, right) =>
      Number(/대기|wait/i.test(left.claimText))
      - Number(/대기|wait/i.test(right.claimText)))
    .slice(0, 2);
  if (priceClaims.length < 2 || durationClaims.length < 2) return unchanged();

  const scheduleClaims = claims.filter((claim) =>
    (claim.claimType === 'factual' || claim.claimType === 'policy')
    && /연중|매일|운행|운영|직행|첫차|막차|배차|시간표|year[\s-]*round|daily/i.test(claim.claimText));
  const reservationClaims = claims.filter((claim) =>
    /예약|승차권|티켓|reservation|booking/i.test(claim.claimText));
  const policyClaims = claims.filter((claim) =>
    claim.claimType === 'policy' || /계절|성수기|운휴|예약|제한|금지|대기|closed|wait/i.test(claim.claimText));

  const rows: Array<{
    label: string;
    price: BlogInformationResearchBundle['claims'][number];
    duration?: BlogInformationResearchBundle['claims'][number];
    schedule?: BlogInformationResearchBundle['claims'][number];
    reservation?: BlogInformationResearchBundle['claims'][number];
  }> = durationClaims.map((duration) => ({
    label: localTransportRowLabel(bundle, duration),
    price: priceClaims.find((price) => localTransportClaimsSharePublisher(bundle, duration, price))
      ?? priceClaims[0]!,
    duration,
    schedule: scheduleClaims.find((claim) => localTransportClaimsSharePublisher(bundle, duration, claim)),
    reservation: reservationClaims.find((claim) => localTransportClaimsSharePublisher(bundle, duration, claim)),
  }));

  for (const price of priceClaims) {
    const label = localTransportRowLabel(bundle, price);
    if (rows.some((row) => row.label === label)) continue;
    rows.push({
      label,
      price,
      schedule: scheduleClaims.find((claim) => localTransportClaimsSharePublisher(bundle, price, claim)),
      reservation: reservationClaims.find((claim) => localTransportClaimsSharePublisher(bundle, price, claim)),
    });
    if (rows.length >= 3) break;
  }

  const approvedClaims = [...new Map(
    rows.flatMap((row) => [row.price, row.duration, row.schedule, row.reservation])
      .concat(policyClaims)
      .filter((claim): claim is BlogInformationResearchBundle['claims'][number] => Boolean(claim))
      .map((claim) => [claim.claimFingerprint, claim]),
  ).values()];
  const checkedAt = bundle.sources
    .map((source) => clean(source.retrievedAt).slice(0, 10))
    .filter(Boolean)
    .sort()
    .at(-1) ?? '발행 전';
  const sourceClaims = approvedClaims.length > 0 ? approvedClaims : claims;
  const allSourceLinks = localTransportSourceLinks(bundle, sourceClaims);

  const tableRows = rows.map((row) => {
    const scheduleText = row.schedule
      ? `${row.schedule.claimText} 첫차·막차와 배차 간격은 공식 시간표 확인`
      : '첫차·막차, 운행 시간과 배차 간격은 공식 시간표 확인';
    const reservationText = row.reservation
      ? `${row.reservation.claimText} 승차권 구매 전 공식 예약 페이지 확인`
      : '승차권 구매·예약 조건은 공식 운영사 페이지 확인';
    const rowClaims = [row.price, row.duration, row.schedule, row.reservation]
      .filter((claim): claim is BlogInformationResearchBundle['claims'][number] => Boolean(claim));
    return `| ${[
      row.label,
      `${formatExtractedPrice(row.price)} (편도·왕복·패스 여부 확인)`,
      row.duration ? formatExtractedDuration(row.duration) : '공식 시간표에서 소요시간 확인',
      escapeMarkdownTableCell(scheduleText),
      escapeMarkdownTableCell(reservationText),
      localTransportSourceLinks(bundle, rowClaims) || allSourceLinks,
    ].join(' | ')} |`;
  });

  const policyLines = policyClaims.length > 0
    ? policyClaims.map((claim) => `- ${claim.claimText}`)
    : ['- 계절·성수기 운휴, 예약·수하물 제한은 공식 운영사에서 출발 전에 확인하세요.'];
  const fareAndDurationAnswer = rows
    .filter((row) => row.duration)
    .slice(0, 2)
    .map((row) =>
      `${row.label}은 ${formatExtractedPrice(row.price)}, ${formatExtractedDuration(row.duration!)} 기준입니다.`)
    .join(' ');
  const scheduleAnswer = scheduleClaims[0]?.claimText ?? '';
  const reservationAnswer = [
    reservationClaims.find((claim) => claim.claimType === 'policy')?.claimText
      ?? reservationClaims[0]?.claimText
      ?? '',
    durationClaims.find((claim) => /대기|wait/i.test(claim.claimText))?.claimText ?? '',
  ].filter(Boolean).join(' ');
  const faqItems = [
    {
      question: '요금과 소요시간은 어느 정도인가요?',
      answer: fareAndDurationAnswer,
    },
    {
      question: '매일 운행하는지 어디서 확인하나요?',
      answer: scheduleAnswer,
    },
    {
      question: '승차권을 미리 예약해야 하나요?',
      answer: reservationAnswer,
    },
  ].filter((item) => item.answer);
  const faqLines = faqItems.flatMap((item, index) => [
    `### Q${index + 1}. ${item.question}`,
    '',
    item.answer,
    '',
  ]);
  const sourceLines = bundle.sources
    .filter((source) => clean(source.sourceUrl))
    .map((source) => `- [${clean(source.publisher) || '공식 운영사'}](${clean(source.sourceUrl)})`)
    .filter((line, index, lines) => lines.indexOf(line) === index);
  if (sourceLines.length === 0) return unchanged();

  const title = clean(input.plannedTitle)
    || input.markdown.match(/^#\s+(.+?)\s*$/m)?.[1]?.trim()
    || '렌터카 없이 이동하는 공식 대중교통 가이드';
  const preservedImages = extractFoodBudgetImageBlocks(input.markdown).slice(0, 3);
  const imageAt = (index: number): string[] => {
    const image = preservedImages[index];
    return image ? ['', ...image.markdown.split('\n'), ''] : [];
  };
  const block = [
    LOCAL_TRANSPORT_STRUCTURE_MARKER,
    `# ${title}`,
    '',
    '공식 운영사의 요금, 소요시간, 운행 범위와 예약 조건을 표부터 비교해 보세요.',
    '실제 출발일에는 각 링크에서 시간표와 좌석을 다시 확인하세요.',
    ...imageAt(0),
    '## 렌터카 없이 이동할 때의 공식 교통 비교',
    '',
    '아래 표는 검증된 버스·셔틀 근거만 정리합니다. 렌터카·택시·도보와 비교할 때는 실제 출발·도착 구간, 노선·정류장과 환승 가능 여부를 함께 확인하세요.',
    '',
    '| 노선·수단 및 출발·도착 구간 | 확인된 요금·패스 | 소요시간·배차 간격 | 운행 시간·시간표 | 승차권 구매·예약 | 공식 근거 |',
    '| --- | ---: | --- | --- | --- | --- |',
    ...tableRows,
    ...imageAt(1),
    '',
    '표의 금액은 근거에서 확인된 요금입니다. 편도·왕복·패스 가격 구분은 결제 직전 공식 운영사 화면에서 다시 확인하세요.',
    '',
    '## 예약·계절·운휴 제한',
    '',
    ...policyLines,
    ...imageAt(2),
    '',
    '성수기에는 예약 가능 여부와 수하물 제한이 바뀔 수 있습니다. 첫차·막차, 운행 시간, 배차 간격은 이동 당일 공식 시간표를 확인하세요.',
    '',
    '## 렌터카 없이 이동하는 준비물 체크리스트',
    '',
    '- 숙소 위치에서 실제 승차 정류장까지의 이동 경로를 먼저 확인하세요.',
    '- 표에서 노선별 요금과 소요시간을 비교한 뒤 예약 가능 여부를 확인하세요.',
    '- 출발일의 첫차·막차와 운행 시간은 공식 시간표에서 다시 확인하세요.',
    '- 예약 화면에서 인원, 수하물, 취소 조건과 결제 수수료를 함께 확인하세요.',
    '- 돌아오는 편의 좌석과 마지막 연결편까지 확인한 뒤 하루 동선을 정하세요.',
    '',
    '## 비용과 시간 비교 기준',
    '',
    '- 표시 요금은 편도·왕복·패스 중 어느 조건인지 결제 화면에서 확인하세요.',
    '- 예약 수수료와 현장 추가 비용은 승차권 금액과 나눠 기록해 보세요.',
    '- 이동시간은 승차 구간과 정류장 대기시간을 분리해 비교해 보세요.',
    '- 같은 날 여러 구간을 이용할 때는 각 노선의 예약 가능 여부를 따로 확인하세요.',
    '- 운휴나 도로 제한은 출발 직전 공식 운영사 공지에서 다시 확인하세요.',
    '',
    '## 자주 묻는 질문',
    '',
    ...faqLines,
    `## 공식 운영사 근거와 확인일 (${checkedAt})`,
    '',
    ...sourceLines,
    '',
    '목적지별 준비 정보는 [여소남 여행지 가이드](/destinations)에서도 이어서 확인할 수 있습니다.',
    '',
    LOCAL_TRANSPORT_STRUCTURE_END_MARKER,
  ].join('\n');
  const markdown = block.trim();
  const repairedReport = validateBlogInformationStructure({ intent: 'local_transport', markdown });
  if (!repairedReport.passed) return unchanged();

  return {
    markdown,
    changed: true,
    changes: ['local_transport_deterministic_evidence_article'],
    approvedClaims,
  };
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
  const maximumTemperature = Number(
    claimText.match(/최고기온\s*(-?\d+(?:\.\d+)?)\s*°?C/i)?.[1],
  );
  const minimumTemperature = Number(
    claimText.match(/최저기온\s*(-?\d+(?:\.\d+)?)\s*°?C/i)?.[1],
  );
  const rainfall = Number(claimText.match(/강수량\s*(\d+(?:\.\d+)?)\s*mm/i)?.[1]);
  const variantIndex = Math.max(0, month - 1) % 4;
  const referenceTemperature = Number.isFinite(minimumTemperature)
    ? minimumTemperature
    : maximumTemperature;
  const clothingByTemperature = referenceTemperature <= 0
    ? [
      '발열 내의와 니트, 두꺼운 방한 외투와 장갑',
      '보온 내의와 두꺼운 상의, 방한 외투와 장갑',
      '기모 상하의와 니트, 방한 외투와 장갑',
      '겹쳐 입을 내의와 플리스, 방한 외투와 장갑',
    ]
    : referenceTemperature <= 8
      ? [
        '긴팔과 니트, 중간 두께 외투',
        '얇은 내의와 긴팔, 보온 재킷',
        '긴팔과 플리스, 중간 두께 외투',
        '겹쳐 입을 긴팔과 니트, 보온 재킷',
      ]
      : referenceTemperature <= 15
        ? [
          '긴팔과 가디건, 가벼운 재킷',
          '얇은 긴팔과 니트, 가벼운 겉옷',
          '긴팔과 얇은 니트, 바람막이',
          '겹쳐 입을 긴팔과 가디건, 가벼운 재킷',
        ]
        : referenceTemperature <= 22
          ? [
            '반팔과 얇은 긴팔, 가벼운 겉옷',
            '가벼운 상의와 얇은 가디건',
            '반팔과 얇은 셔츠, 휴대용 겉옷',
            '통풍되는 상의와 얇은 재킷',
          ]
          : [
            '통풍되는 반팔과 냉방용 얇은 겉옷',
            '가벼운 반팔과 실내 냉방용 가디건',
            '얇은 옷과 햇빛 차단용 긴팔',
            '통풍되는 옷과 냉방용 가벼운 재킷',
          ];
  const baseClothing = clothingByTemperature[variantIndex]!;

  if (Number.isFinite(rainfall) && rainfall >= 250) {
    return `${baseClothing}, 우산과 방수 겉옷`;
  }
  if (Number.isFinite(rainfall) && rainfall >= 150) {
    return `${baseClothing}, 휴대용 우산`;
  }
  return baseClothing;
}

export function repairMonthlyWeatherClothingTable(markdown: string): {
  markdown: string;
  changed: boolean;
} {
  if (!markdown.includes(MONTHLY_WEATHER_STRUCTURE_MARKER)) {
    return { markdown, changed: false };
  }

  const climateByMonth = new Map<number, string>();
  for (const match of markdown.matchAll(/^\|\s*(\d{1,2})월\s*\|\s*([^|\n]+)\|\s*$/gm)) {
    const month = Number(match[1]);
    const claimText = match[2]?.trim() ?? '';
    if (
      month >= 1
      && month <= 12
      && /최고기온/i.test(claimText)
      && /최저기온/i.test(claimText)
    ) {
      climateByMonth.set(month, claimText);
    }
  }
  if (climateByMonth.size !== 12) {
    return { markdown, changed: false };
  }

  const repairedRows = markdown.replace(
    /^\|\s*(\d{1,2})월\s*\|\s*([^|\n]+)\|\s*([^|\n]+)\|\s*$/gm,
    (row, monthValue: string, _clothing: string, adjustment: string) => {
      const month = Number(monthValue);
      const claimText = climateByMonth.get(month);
      if (!claimText) return row;
      return `| ${month}월 | ${monthlyWeatherClothing(claimText, month)} | ${adjustment.trim()} |`;
    },
  );
  const repaired = repairedRows.replace(/(^\|[^\n]*\|)\n(?=[^\s|])/gm, '$1\n\n');

  return {
    markdown: repaired,
    changed: repaired !== markdown,
  };
}

function monthlyWeatherAdjustment(month: number): string {
  return [
    '기온과 강수량을 함께 확인',
    '강수일수와 단기예보 확인',
    '체감기온과 비 예보 확인',
    '출발 직전 예보로 최종 조정',
  ][Math.max(0, month - 1) % 4]!;
}

export type MonthlyWeatherEditorialVariation = {
  contract_version?: number | null;
  opening_variant?: string | null;
  section_order_variant?: string | null;
  heading_copy_variant?: string | null;
};

function stableWeatherVariant(seed: string, modulo: number): number {
  let hash = 2166136261;
  for (const char of seed) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) % Math.max(1, modulo);
}

function monthlyWeatherSubject(title: string): string {
  return title
    .replace(/\s+\d{1,2}월.*$/, '')
    .replace(/\s+(?:(?:월별|연중|계절별)\s+)?(?:날씨|기후|옷차림).*$/, '')
    .trim() || '여행지';
}

function monthlyWeatherOpening(
  title: string,
  variation?: MonthlyWeatherEditorialVariation | null,
): string[] {
  const subject = monthlyWeatherSubject(title);
  const variants: Record<string, string[]> = {
    temperature_first: [
      `${subject} 1~12월 날씨와 옷차림은 어떻게 달라질까요? 이 글의 기온·강수 요약과 표부터 확인하세요.`,
      '먼저 여행하는 달을 찾고, 예상 기온과 비에 맞는 옷차림을 고른 뒤 현지 이동과 교통 일정에 필요한 항목을 확인하세요.',
      '마지막 결정은 출발 직전 공식 안내와 현지 예보로 다시 확인하세요.',
    ],
    rain_first: [
      `${subject}에서 1~12월 중 비가 잦은 달과 필요한 옷차림은 무엇일까요? 월별 기온·강수 표의 해당 행부터 확인하세요.`,
      '그다음 비 예보에 맞춘 준비물과 현지 이동·교통 일정, 위험 안내를 차례로 확인하세요.',
      '출발 직전에는 이 글의 기준과 공식 최신 안내를 함께 다시 확인하세요.',
    ],
    clothing_decision_first: [
      `${subject} 짐을 정하기 전에 1~12월 날씨와 옷차림 중 무엇을 비교해야 할까요? 기온·강수 표와 준비표를 차례로 확인하세요.`,
      '해당 달의 행을 기준점으로 삼고 예상 기온과 비, 현지 이동과 교통 일정에 맞는 항목만 골라 확인하세요.',
      '현지에서 바로 필요한 항목은 마지막 체크리스트에서 다시 확인하세요.',
    ],
    packing_mistake_first: [
      `${subject} 1~12월 날씨 준비에서 빠뜨리기 쉬운 옷차림은 무엇일까요? 월별 기온·강수 표와 체크리스트부터 확인하세요.`,
      '여행하는 달의 날씨 기준을 찾은 뒤 현지 이동과 교통 일정, 옷차림 준비표, 위험 안내 순서로 확인하세요.',
      '짐을 닫기 전에는 출발일의 공식 최신 안내를 마지막으로 확인하세요.',
    ],
  };
  const requested = variation?.opening_variant?.trim() || '';
  return variants[requested]
    ?? Object.values(variants)[stableWeatherVariant(title, Object.keys(variants).length)]!;
}

type MonthlyWeatherSectionKey = 'essentials' | 'climate' | 'clothing' | 'risks' | 'timing';

type MonthlyWeatherHeadings = {
  essentials: string;
  climate: string;
  clothing: string;
  risks: string;
  timing: string;
};

const MONTHLY_WEATHER_HEADING_VARIANTS: MonthlyWeatherHeadings[] = [
  {
    essentials: '먼저 확인할 핵심',
    climate: '1~12월 기온·강수·옷차림',
    clothing: '월별 옷차림 준비표',
    risks: '우기·건기 및 태풍 위험 확인',
    timing: '여행 목적별 추천 시기 확인법',
  },
  {
    essentials: '출발 전에 볼 날씨 기준',
    climate: '기온과 강수로 보는 1~12월',
    clothing: '1~12월 옷차림 조정표',
    risks: '비와 이상기후 위험 점검',
    timing: '목적에 맞는 여행 시기 고르기',
  },
  {
    essentials: '짐을 싸기 전 핵심 판단',
    climate: '월별 낮·밤 기온과 강수',
    clothing: '기온대별 월별 옷차림',
    risks: '우기·건기와 출발 전 위험 확인',
    timing: '일정 유형별 추천 시기 판단',
  },
  {
    essentials: '옷차림을 정하는 확인 순서',
    climate: '1월부터 12월까지 기후 기준',
    clothing: '월별 기본 옷차림과 추가 준비',
    risks: '비·바람·이상기후 대비',
    timing: '여행 목적과 날씨로 추천 시기 고르기',
  },
  {
    essentials: '이번 여행에 필요한 날씨 판단',
    climate: '월별 기온과 비 자료 읽기',
    clothing: '월별로 나누는 옷차림 기준',
    risks: '비·바람과 기상 위험 대비',
    timing: '활동별 추천 시기 비교',
  },
  {
    essentials: '출발일 전에 정할 준비 기준',
    climate: '한 해 기온·강수 흐름',
    clothing: '달마다 달라지는 짐 구성',
    risks: '우천·태풍 가능성 확인',
    timing: '일정에 맞는 추천 시기 찾기',
  },
  {
    essentials: '현지 동선에 맞춘 날씨 준비',
    climate: '연간 기후표 핵심 읽기',
    clothing: '월별 겹쳐 입기와 우비 준비',
    risks: '강수와 기상특보 점검',
    timing: '가족·야외 일정 추천 시기',
  },
  {
    essentials: '예보 확인 전 준비할 항목',
    climate: '월별 평년기온과 강수 해석',
    clothing: '계절별 옷차림 조정',
    risks: '갑작스러운 비와 바람 대비',
    timing: '여행 방식별 추천 시기 선택',
  },
];

const MONTHLY_WEATHER_SECTION_ORDERS: Record<string, MonthlyWeatherSectionKey[]> = {
  weather_then_clothing: ['essentials', 'climate', 'clothing', 'risks', 'timing'],
  clothing_then_rain: ['essentials', 'clothing', 'climate', 'timing', 'risks'],
  decision_table_first: ['climate', 'essentials', 'timing', 'clothing', 'risks'],
  packing_then_local_risk: ['essentials', 'risks', 'clothing', 'climate', 'timing'],
};

function monthlyWeatherHeadings(
  title: string,
  variation?: MonthlyWeatherEditorialVariation | null,
): MonthlyWeatherHeadings {
  const requestedOrder = variation?.section_order_variant?.trim() || '';
  const requestedHeading = variation?.heading_copy_variant?.trim() || '';
  const orderFallbackIndex: Record<string, number> = {
    weather_then_clothing: 0,
    clothing_then_rain: 1,
    decision_table_first: 2,
    packing_then_local_risk: 3,
  };
  const headingIndex: Record<string, number> = {
    core_weather_check: 0,
    departure_weather_basis: 1,
    packing_decision: 2,
    clothing_check_order: 3,
    trip_weather_decision: 4,
    departure_packing_basis: 5,
    route_weather_prep: 6,
    forecast_prep: 7,
  };
  const headings = MONTHLY_WEATHER_HEADING_VARIANTS[
    headingIndex[requestedHeading]
      ?? orderFallbackIndex[requestedOrder]
      ?? stableWeatherVariant(`${title}:headings`, MONTHLY_WEATHER_HEADING_VARIANTS.length)
  ]!;
  return {
    ...headings,
    essentials: `${monthlyWeatherSubject(title)} ${headings.essentials}`,
  };
}

function monthlyWeatherSectionKey(heading: string): MonthlyWeatherSectionKey | null {
  for (const variant of MONTHLY_WEATHER_HEADING_VARIANTS) {
    for (const key of Object.keys(variant) as MonthlyWeatherSectionKey[]) {
      if (variant[key] === heading || heading.endsWith(` ${variant[key]}`)) return key;
    }
  }
  return null;
}

export function repairMonthlyWeatherEditorialVariation(
  markdown: string,
  variation?: MonthlyWeatherEditorialVariation | null,
): { markdown: string; changed: boolean } {
  if (!markdown.includes(MONTHLY_WEATHER_STRUCTURE_MARKER)) {
    return { markdown, changed: false };
  }

  const title = markdown.match(/^#\s+(.+?)\s*$/m)?.[1]?.trim() || '월별 날씨와 옷차림 준비';
  const headings = monthlyWeatherHeadings(title, variation);
  const opening = monthlyWeatherOpening(title, variation);
  let lines = markdown.split(/\r?\n/);
  const h1Index = lines.findIndex((line) => /^#\s+\S/.test(line.trim()));
  if (h1Index < 0) return { markdown, changed: false };

  const firstBodyBoundary = lines.findIndex((line, index) =>
    index > h1Index && (/^!\[[^\]]*\]\(/.test(line.trim()) || /^<figure\b/i.test(line.trim()) || /^##\s+\S/.test(line.trim())));
  if (firstBodyBoundary < 0) return { markdown, changed: false };

  lines = [
    ...lines.slice(0, h1Index + 1),
    '',
    MONTHLY_WEATHER_EVIDENCE_SAFE_INTRO_MARKER,
    ...opening,
    '',
    ...lines.slice(firstBodyBoundary),
  ];

  const h2Entries = lines
    .map((line, index) => {
      const match = line.match(/^##\s+(.+?)\s*$/);
      return match ? { index, heading: match[1]!.trim() } : null;
    })
    .filter((entry): entry is { index: number; heading: string } => Boolean(entry));
  const targetEntries = h2Entries
    .map((entry, position) => ({
      ...entry,
      position,
      key: monthlyWeatherSectionKey(entry.heading),
    }))
    .filter((entry): entry is typeof entry & { key: MonthlyWeatherSectionKey } => Boolean(entry.key));
  const targetByKey = new Map(targetEntries.map((entry) => [entry.key, entry]));
  if (targetByKey.size !== 5) {
    const normalized = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return { markdown: normalized, changed: normalized !== markdown };
  }

  const positions = [...targetEntries].map((entry) => entry.position).sort((a, b) => a - b);
  const targetSectionsAreContiguous = positions.every((position, index) =>
    index === 0 || position === positions[index - 1]! + 1);
  if (!targetSectionsAreContiguous) {
    const normalized = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return { markdown: normalized, changed: normalized !== markdown };
  }

  const sectionMarkdown = new Map<MonthlyWeatherSectionKey, string[]>();
  for (const entry of targetEntries) {
    const nextH2Index = h2Entries[entry.position + 1]?.index ?? lines.length;
    const section = lines.slice(entry.index, nextH2Index);
    section[0] = `## ${headings[entry.key]}`;
    sectionMarkdown.set(entry.key, section);
  }

  const firstTargetPosition = positions[0]!;
  const lastTargetPosition = positions[positions.length - 1]!;
  const blockStart = h2Entries[firstTargetPosition]!.index;
  const blockEnd = h2Entries[lastTargetPosition + 1]?.index ?? lines.length;
  const requestedOrder = variation?.section_order_variant?.trim() || '';
  const order = MONTHLY_WEATHER_SECTION_ORDERS[requestedOrder]
    ?? MONTHLY_WEATHER_SECTION_ORDERS.weather_then_clothing!;
  const orderedLines = order.flatMap((key) => sectionMarkdown.get(key) ?? []);
  const normalized = [
    ...lines.slice(0, blockStart),
    ...orderedLines,
    ...lines.slice(blockEnd),
  ].join('\n').replace(/\n{3,}/g, '\n\n').trim();

  return { markdown: normalized, changed: normalized !== markdown };
}

function buildDeterministicMonthlyWeatherArticle(input: {
  originalMarkdown: string;
  plannedTitle?: string | null;
  approvedClaims: BlogInformationResearchBundle['claims'];
  sourceLabel: string;
  sourceUrl: string;
  editorialVariation?: MonthlyWeatherEditorialVariation | null;
}): string {
  const title = clean(input.plannedTitle)
    || input.originalMarkdown.match(/^#\s+(.+?)\s*$/m)?.[1]?.trim()
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
  const opening = monthlyWeatherOpening(title, input.editorialVariation);
  const headings = monthlyWeatherHeadings(title, input.editorialVariation);

  const article = [
    MONTHLY_WEATHER_STRUCTURE_MARKER,
    `# ${title}`,
    '',
    MONTHLY_WEATHER_EVIDENCE_SAFE_INTRO_MARKER,
    ...opening,
    ...imageAt(0),
    '',
    `## ${headings.essentials}`,
    '',
    '- 여행하는 달의 행에서 기온과 강수량, 강수일수를 함께 확인하세요.',
    '- 옷차림 준비 열을 기본값으로 삼고 실내 냉방용 얇은 겉옷을 더해 보세요.',
    '- 비 예보가 보이면 우산, 방수 겉옷, 젖은 옷을 담을 팩을 한 묶음으로 챙기세요.',
    '- 장기 평년자료를 본 뒤 실제 출발일의 단기예보를 다시 확인하세요.',
    '- [여소남 여행지 가이드](/destinations)에서 목적지별 준비 정보도 함께 확인하세요.',
    '',
    `## ${headings.climate}`,
    '',
    `자료 원문: [${input.sourceLabel}](${input.sourceUrl})`,
    '',
    '| 월 | 검증된 평년값 |',
    '| --- | --- |',
    ...climateRows,
    ...imageAt(1),
    '',
    `## ${headings.clothing}`,
    '',
    '| 월 | 기본 옷차림 | 출발 전 조정 기준 |',
    '| --- | --- | --- |',
    ...clothingRows,
    '',
    '표의 옷차림은 짐을 고르는 출발점으로만 활용하고, 출발 직전 체감기온과 비 예보에 맞춰 더하거나 빼세요.',
    '',
    `## ${headings.risks}`,
    '',
    '- 이 표만으로 우기·건기의 경계나 태풍 발생 여부를 단정하지 마세요.',
    '- 이상기후 위험은 출발 직전 공식 특보와 단기예보에서 별도로 확인하세요.',
    '- 작은 우산과 방수 겉옷을 함께 두고, 손이 자유로워야 하는 일정에는 우비도 비교해 보세요.',
    '- 휴대전화와 여권 사본, 충전기처럼 젖으면 곤란한 물품은 방수 파우치에 나눠 담으세요.',
    '- 젖은 옷과 마른 옷을 분리할 가벼운 팩을 준비 목록에 넣어 보세요.',
    '- 바람과 습도, 갑작스러운 비는 장기 표만으로 결정하지 말고 단기예보에서 다시 확인하세요.',
    ...imageAt(2),
    '',
    `## ${headings.timing}`,
    '',
    '- 해변 일정은 여행하는 달의 강수량과 강수일수를 먼저 비교해 보세요.',
    '- 걷는 일정은 낮과 저녁의 옷차림을 나누고, 비가 올 때 쉴 실내 동선도 함께 확인하세요.',
    '- 아이 동반 일정은 갈아입을 옷과 방수팩, 얇은 겉옷을 한 묶음으로 준비해 보세요.',
    '- 사진 촬영이나 야외 일정은 원하는 달의 표와 출발 직전 예보를 함께 비교해 보세요.',
    '- 일정 후보가 둘 이상이면 현지 이동에 드는 비용과 전체 예산도 함께 비교해 보세요.',
    '',
    '## 출발 전 체크리스트',
    '',
    '- 여행하는 달의 평년값 행을 다시 확인하세요.',
    '- 출발일과 귀국일의 단기예보를 각각 확인하세요.',
    '- 비가 예상되는 시간대와 실내 이동 동선을 함께 확인하세요.',
    '- 비 예보가 있으면 공항에서 숙소·호텔로 이동하는 교통 동선을 확인하세요.',
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
  return repairMonthlyWeatherEditorialVariation(article, input.editorialVariation).markdown;
}

function repairMonthlyWeatherResearchStructure(input: {
  markdown: string;
  plannedTitle?: string | null;
  readiness: BlogGenerationResearchReadiness;
  editorialVariation?: MonthlyWeatherEditorialVariation | null;
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
  const hasEvidenceSafeIntro = input.markdown.includes(MONTHLY_WEATHER_EVIDENCE_SAFE_INTRO_MARKER);
  const startsWithDeterministicBlock = input.markdown.trimStart().startsWith(MONTHLY_WEATHER_STRUCTURE_MARKER);
  if (hasCompleteBlock && existingReport.passed && hasEvidenceSafeIntro && startsWithDeterministicBlock) {
    return unchanged();
  }

  const source = input.readiness.bundle.sources.find((candidate) =>
    candidate.claimTypes.includes('climate') && Boolean(candidate.sourceUrl));
  if (!source?.sourceUrl) return unchanged();
  const sourceLabel = escapeMarkdownTableCell(source.publisher || '공식 기후 자료');
  const verifiedArticle = buildDeterministicMonthlyWeatherArticle({
    // The deterministic block can be rebuilt after later editorial repairs.
    // Read the title and reusable images before replacing that block, otherwise
    // a second repair silently drops every inline image from the final article.
    originalMarkdown: input.markdown,
    plannedTitle: input.plannedTitle,
    approvedClaims,
    sourceLabel,
    sourceUrl: source.sourceUrl,
    editorialVariation: input.editorialVariation,
  });

  return {
    markdown: verifiedArticle,
    changed: true,
    changes: ['monthly_weather_deterministic_evidence_article'],
    approvedClaims,
  };
}

function repairEntryRequirementsResearchStructure(input: {
  markdown: string;
  readiness: BlogGenerationResearchReadiness;
}): BlogGenerationResearchStructureRepair {
  const unchanged = (): BlogGenerationResearchStructureRepair => ({
    markdown: input.markdown,
    changed: false,
    changes: [],
    approvedClaims: [],
  });
  if (!input.readiness.passed || !input.readiness.bundle) return unchanged();

  const structureReport = validateBlogInformationStructure({
    intent: 'entry_requirements',
    markdown: input.markdown,
  });

  const destinations = new Set(
    [
      ...input.readiness.bundle.sources.map((source) => clean(source.destination)),
      ...input.readiness.bundle.evidence.map((evidence) => clean(evidence.scope.destination)),
    ].filter(Boolean),
  );
  if (destinations.size !== 1) return unchanged();

  const destination = [...destinations][0]!;
  const contract = buildBlogInformationContract({
    intentType: 'entry_requirements',
    destination,
  });
  const informationReport = inspectBlogInformationMarkdown({
    markdown: input.markdown,
    contract,
  });
  const needsDestination = structureReport.issues.includes(
    'entry_requirements:destination_country_required',
  ) || informationReport.missingSlots.includes('destination_country');
  const needsPurposeStay = structureReport.issues.includes(
    'entry_requirements:purpose_stay_required',
  ) || informationReport.missingSlots.includes('purpose_stay');
  const needsSupportingDocuments = informationReport.missingSlots.includes('supporting_documents');
  const needsCustomsAllowance = informationReport.missingSlots.includes('customs_allowance');
  const needsExactOfficialItem = informationReport.missingSlots.includes('exact_official_item');
  if (
    !needsDestination
    && !needsPurposeStay
    && !needsSupportingDocuments
    && !needsCustomsAllowance
    && !needsExactOfficialItem
  ) return unchanged();

  const supportedClaims = input.readiness.bundle.claims;
  const purposeClaim = supportedClaims.find((claim) =>
    /관광|출장|상용|(?:여행|방문|입국)\s*목적|\b(?:touris(?:m|t)|business)\b|travel\s+purpose/i.test(claim.claimText));
  const stayClaim = supportedClaims.find((claim) =>
    /체류\s*(?:가능\s*)?(?:기간|일수)|\d+\s*일|permitted\s*stay|stay\s*(?:of|up\s*to)|\bdays?\b/i.test(claim.claimText));
  const supportingDocumentClaims = [
    supportedClaims.find((claim) =>
      /귀국\s*(?:일정|편|항공편|항공권)|왕복\s*항공권|출국\s*항공권|\b(?:return|onward)\s+(?:or\s+onward\s+)?ticket\b/i.test(claim.claimText)),
    supportedClaims.find((claim) =>
      /체류지|숙소\s*(?:예약|정보)?|숙박비|\blodging\b|accommodation/i.test(claim.claimText)),
    supportedClaims.find((claim) =>
      /여행(?:에\s*필요한)?\s*경비|경비\s*미지참|재정\s*증빙|충분한\s*자금|\bsufficient\s+funds?\b|financial\s+(?:means|support|solvency)/i.test(claim.claimText)),
  ];
  const customsClaim = supportedClaims.find((claim) =>
    /세관[^\n]{0,100}(?:신고|면세|반입|품목|농산|현금)|(?:식품|농산물|현금|통화)[^\n]{0,100}신고|\b(?:declare|declaration|duty[- ]free|agricultur(?:e|al)|monetary instruments?)\b/i.test(claim.claimText));
  const canRepairPurposeStay = Boolean(purposeClaim && stayClaim);
  if (
    (!needsDestination && needsPurposeStay && !canRepairPurposeStay)
    || (needsSupportingDocuments && supportingDocumentClaims.some((claim) => !claim))
    || (needsCustomsAllowance && !customsClaim)
  ) return unchanged();

  const lines = input.markdown.split('\n');
  const h1Index = lines.findIndex((line) => /^#\s+\S/.test(line.trim()));
  const contextBlock = input.markdown.includes(ENTRY_REQUIREMENTS_CONTEXT_MARKER)
    ? []
    : [ENTRY_REQUIREMENTS_CONTEXT_MARKER];
  const changes: string[] = [];
  const approvedClaims: BlogInformationResearchBundle['claims'] = [];
  if (needsDestination) {
    contextBlock.push(`목적 국가: ${destination}.`);
    changes.push('entry_requirements_verified_destination_context');
  }
  if (needsPurposeStay && purposeClaim && stayClaim) {
    contextBlock.push(
      '',
      '여행 목적과 체류기간 (공식 근거):',
      `- ${purposeClaim.claimText}`,
      ...(stayClaim.claimFingerprint === purposeClaim.claimFingerprint
        ? []
        : [`- ${stayClaim.claimText}`]),
    );
    approvedClaims.push(
      purposeClaim,
      ...(stayClaim.claimFingerprint === purposeClaim.claimFingerprint ? [] : [stayClaim]),
    );
    changes.push('entry_requirements_verified_purpose_stay_context');
  }
  if (needsSupportingDocuments && supportingDocumentClaims.every(Boolean)) {
    const uniqueSupportingClaims = [...new Map(supportingDocumentClaims
      .filter((claim): claim is BlogInformationResearchBundle['claims'][number] => Boolean(claim))
      .map((claim) => [claim.claimFingerprint, claim])).values()];
    contextBlock.push(
      '',
      '귀국편·숙소·재정증빙 확인 (공식 근거):',
      ...uniqueSupportingClaims.map((claim) => `- ${claim.claimText}`),
    );
    approvedClaims.push(...uniqueSupportingClaims);
    changes.push('entry_requirements_verified_supporting_documents_context');
  }
  if (needsCustomsAllowance && customsClaim) {
    contextBlock.push(
      '',
      '세관·면세 범위 확인 (공식 근거):',
      `- ${customsClaim.claimText}`,
    );
    approvedClaims.push(customsClaim);
    changes.push('entry_requirements_verified_customs_context');
  }
  if (needsExactOfficialItem) {
    const officialUrls = [...new Set(input.readiness.bundle.sources
      .map((source) => source.sourceUrl)
      .filter((url): url is string => Boolean(url)))];
    contextBlock.push(
      '',
      '공식 안내에서 최종 확인할 세부 조건:',
      ...officialUrls.map((url, index) => `- [공식 확인 링크 ${index + 1}](${url})`),
      '- 출발 직전에는 여권·전자여행허가·귀국편·세관 신고의 적용 조건을 공식 안내에서 다시 확인하세요.',
    );
    changes.push('entry_requirements_exact_official_items_context');
  }
  if (contextBlock.length === 0) return unchanged();

  const firstSectionIndex = lines.findIndex((line, index) =>
    index > h1Index && /^##\s+\S/.test(line.trim()));
  if (firstSectionIndex >= 0) {
    lines.splice(firstSectionIndex, 0, ...contextBlock, '');
  } else if (h1Index >= 0) {
    lines.push('', ...contextBlock);
  } else {
    lines.unshift(...contextBlock, '');
  }

  return {
    markdown: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    changed: true,
    changes,
    approvedClaims,
  };
}

function buildDeterministicEntryRequirementsEvidenceArticle(input: {
  readiness: BlogGenerationResearchReadiness;
  plannedTitle?: string | null;
  primaryKeyword?: string | null;
}): BlogGenerationResearchStructureRepair {
  const unchanged = (): BlogGenerationResearchStructureRepair => ({
    markdown: '',
    changed: false,
    changes: [],
    approvedClaims: [],
  });
  if (!input.readiness.passed || !input.readiness.bundle) return unchanged();

  const bundle = input.readiness.bundle;
  const approvedClaims = [...new Map(
    bundle.claims.map((claim) => [claim.claimFingerprint, claim]),
  ).values()];
  const officialSources = bundle.sources.filter((source) =>
    Boolean(source.sourceUrl) && isOfficialInformationAuthority(source.authorityLevel));
  const renderedOfficialSources = [...new Map(
    officialSources.map((source) => [
      `${clean(source.publisher).toLowerCase()}|${clean(source.retrievedAt).slice(0, 10)}`,
      source,
    ]),
  ).values()];
  if (approvedClaims.length < 4 || officialSources.length < 1) return unchanged();

  const destination = clean(
    bundle.sources.find((source) => clean(source.destination))?.destination
      ?? bundle.evidence.find((evidence) => clean(evidence.scope.destination))?.scope.destination,
  );
  if (!destination) return unchanged();

  const title = clean(input.plannedTitle) || `${destination} 입국 요건과 비자 확인 가이드`;
  const primaryKeyword = clean(input.primaryKeyword) || clean(input.plannedTitle);
  const verifiedAt = [...bundle.evidence]
    .map((evidence) => clean(evidence.scope.verifiedAt ?? evidence.observedAt))
    .filter(Boolean)
    .sort()
    .at(-1)
    ?.slice(0, 10) ?? '확인일 미상';
  const claimsByType = (types: BlogInformationClaimType[]) => approvedClaims.filter((claim) =>
    types.includes(claim.claimType));
  const entryClaims = claimsByType(['entry_visa']);
  const customsClaims = claimsByType(['customs']);
  const policyClaims = claimsByType(['policy']);
  const otherClaims = approvedClaims.filter((claim) =>
    !['entry_visa', 'customs', 'policy'].includes(claim.claimType));
  const renderClaims = (claims: typeof approvedClaims) => claims.length > 0
    ? claims.map((claim) => `- ${claim.claimText}`)
    : ['- 이 항목은 아래 공식 원문에서 출발 직전에 다시 확인하세요.'];

  const rawMarkdown = [
    ENTRY_REQUIREMENTS_STRUCTURE_MARKER,
    `# ${title}`,
    '',
    `${destination} 여행 준비에서 가장 먼저 정리할 것은 입국 목적, 체류 조건, 준비 자료, 세관 신고 범위입니다. 이 글은 검색 결과를 요약해 단정하는 방식이 아니라, 확인 가능한 공식 자료와 그 자료에 연결된 검증 주장만 모아 판단 순서대로 정리했습니다.`,
    '',
    `> 근거 확인 기준일: ${verifiedAt}. 입국 정책은 바뀔 수 있으므로 출발 직전에는 아래 공식 링크에서 다시 확인하세요.`,
    '',
    '## 먼저 결론을 확인하세요',
    '',
    `목적 국가(입국 국가)는 ${destination}이며, 여행자는 자신의 국적, 방문 목적, 체류 기간을 먼저 구분한 뒤 아래 검증 항목을 대조해야 합니다. 서로 다른 조건을 한 문장으로 합치지 않았으며, 각 항목은 연결된 공식 근거의 적용 대상과 조건을 그대로 따릅니다.`,
    '',
    ...renderClaims(entryClaims),
    '',
    '## 여권 유효기간 확인',
    '',
    '여권 유효기간은 출발일과 입국 예정일을 기준으로 확인하세요. 여권에 표시된 국적과 남은 유효기간이 공식 안내의 적용 조건에 맞는지 확인하고, 일반적인 관행을 모든 여행자에게 적용되는 규칙으로 단정하지 마세요.',
    '',
    '## 비자·전자허가·입국신고',
    '',
    '비자, 전자허가(ETA·ESTA 등), 입국신고는 서로 다른 절차일 수 있습니다. 자신의 방문 목적과 국적에 맞는 절차를 공식 원문에서 구분하고, 신청이 필요한지와 입국 전에 완료해야 하는지를 각각 확인하세요.',
    '',
    '## 입국 심사 준비 자료',
    '',
    '이 부분은 입국 허가를 보장한다는 뜻이 아닙니다. 여권, 비자·전자허가, 입국신고와 함께 공식 안내에서 확인된 supporting documents(필요 서류), 동의서, 재정 증빙 항목을 빠뜨리지 않도록 정리한 체크 구간입니다. 자신의 일정과 체류 계획에 맞는 자료만 선택하고, 판단이 애매하면 해당 기관의 최신 안내를 우선하세요.',
    '',
    ...renderClaims(policyClaims),
    '',
    '## 세관·면세 범위와 신고',
    '',
    '세관·면세 항목은 물품 종류와 소지 금액처럼 적용 조건이 달라질 수 있습니다. 아래 문장을 임의로 넓혀 해석하지 말고, 해당되는 항목이 있다면 공식 신고 안내와 서식을 직접 확인하세요.',
    '',
    ...renderClaims(customsClaims),
    '',
    ...(otherClaims.length > 0 ? [
      '## 함께 확인할 공식 조건',
      '',
      ...renderClaims(otherClaims),
      '',
    ] : []),
    '## 출발 전 확인 순서',
    '',
    '1. 여권에 표시된 국적과 실제 방문 목적을 기준으로 해당되는 공식 안내를 고릅니다.',
    '2. 체류 계획과 귀국 또는 다음 이동 계획을 한 화면에서 확인할 수 있게 정리합니다.',
    '3. 본문에서 자신에게 해당되는 검증 문장을 찾고 연결된 공식 원문을 엽니다.',
    '4. 신청이나 신고가 필요한 항목은 대행 사이트가 아니라 공식 도메인인지 확인합니다.',
    '5. 출발 직전에 같은 공식 페이지를 다시 열어 변경 공지와 적용 날짜를 확인합니다.',
    '',
    '## 이 글을 읽는 방법',
    '',
    '검증 문장은 편의를 위해 주제별로 나눴지만, 실제 판단에서는 여러 조건이 함께 작동할 수 있습니다. 제목이나 검색 요약만 보고 결론을 내리지 말고, 본문 문장과 공식 링크를 한 쌍으로 확인하세요. 적용 대상이 넓게 적힌 자료와 특정 여행자에게만 적용되는 자료가 섞여 있으므로 자신에게 해당되는 범위를 구분하는 것이 중요합니다.',
    '',
    '공식 안내가 서로 다르게 보이면 더 구체적인 기관의 최신 원문을 우선하고, 확인이 끝나지 않은 내용은 여행 계획의 확정 사실처럼 사용하지 마세요. 이 글은 확인 경로를 줄여 주는 편집 자료이며 최종 입국 결정이나 개별 법률 판단을 대신하지 않습니다.',
    '',
    '## 조건별 확인 메모',
    '',
    '- 국적: 여권에 적힌 국적을 기준으로 공식 안내의 적용 대상을 대조합니다.',
    '- 방문 목적: 관광, 업무, 환승처럼 실제 목적과 공식 분류가 같은지 확인합니다.',
    '- 체류 계획: 입국일과 출국일, 다음 이동 계획을 함께 놓고 조건을 읽습니다.',
    '- 준비 자료: 본문에 나온 항목을 모두 의무라고 단정하지 말고 자신의 조건에 해당하는지 구분합니다.',
    '- 신고 대상: 물품과 통화 관련 문장은 예외 조건이 있을 수 있으므로 원문과 서식을 함께 확인합니다.',
    '- 변경 공지: 신청을 마쳤더라도 출발 전 최신 공지와 시행 날짜를 다시 확인합니다.',
    '',
    '확인 결과는 단순히 완료 표시만 남기기보다 어떤 공식 페이지를 언제 확인했는지 함께 적어 두세요. 같은 이름의 제도라도 적용 대상이나 방문 목적에 따라 안내가 달라질 수 있으므로, 자신의 조건과 맞는 문장을 근거 링크 옆에 짧게 기록하면 마지막 점검 때 혼동을 줄일 수 있습니다.',
    '',
    '## 공식 원문이 바뀌었을 때',
    '',
    '링크가 이동했거나 문구가 달라졌다면 이 글의 표현을 기준으로 맞추지 마세요. 새 원문에서 적용 대상, 시행 시점, 예외 조건을 다시 읽고 기존 메모를 갱신해야 합니다. 확인되지 않은 차이는 임의로 해석하지 말고 해당 기관의 문의 채널이나 여행 서류를 담당하는 공식 창구에서 확인하세요.',
    '',
    '한 기관의 안내만으로 모든 입국 절차를 설명하려 하지 않는 것도 중요합니다. 비자 또는 여행허가, 입국 심사, 세관 신고는 담당 기관과 확인 페이지가 다를 수 있습니다. 아래 출처 목록에서 현재 확인하려는 항목을 담당하는 기관을 먼저 고른 뒤 원문을 비교하세요.',
    '',
    '## 공식 근거',
    '',
    ...renderedOfficialSources.map((source, index) =>
      `- [${clean(source.publisher) || `공식 출처 ${index + 1}`}](${source.sourceUrl}) - 확인일 ${clean(source.retrievedAt).slice(0, 10)}`),
    '',
    '## 공식 원문에서 정확히 확인할 항목',
    '',
    '공식 링크를 열었을 때 목적 국가, 여행자 국적, 여권 유효기간, 비자·전자허가·입국신고, 필요한 서류, 세관·면세 범위가 자신의 조건에 맞게 표시되는지 확인하세요. 한 항목의 문구만으로 다른 절차까지 자동으로 충족된다고 보지 마세요.',
    '',
    '## 마지막 점검',
    '',
    '공식 페이지를 열었을 때 본문의 검증 문장과 현재 안내가 같은지 확인하세요. 조건이 달라졌거나 페이지가 이동했다면 현재 원문을 기준으로 판단하고, 이 글의 오래된 부분은 검토 대상으로 남겨야 합니다. 신청 완료 화면, 확인 번호, 필요한 일정 자료는 출발 전에 다시 찾을 수 있는 방식으로 정리해 두는 편이 좋습니다.',
    ENTRY_REQUIREMENTS_STRUCTURE_END_MARKER,
  ].join('\n').replace(/\n{3,}/g, '\n\n').trim();

  // Keep the deterministic high-risk article within the shared AI-readable
  // heading budget, then add a small evidence-neutral FAQ cue. Generic
  // readability repairs run before this boundary, so this normalization must
  // be the final structural shape that reaches validation.
  const normalizedLines: string[] = [];
  let h2Count = 0;
  for (const line of rawMarkdown.split('\n')) {
    if (/^##\s+\S/.test(line.trim())) {
      h2Count += 1;
      normalizedLines.push(h2Count <= 7 ? line : line.replace(/^##\s+/, '### '));
      continue;
    }
    normalizedLines.push(line);
  }
  const endMarkerIndex = normalizedLines.lastIndexOf(ENTRY_REQUIREMENTS_STRUCTURE_END_MARKER);
  const contractFloor = [
    '- 귀국편(왕복 항공권), 숙소, 재정 증빙은 자신의 조건에 맞는지 확인하세요.',
    '- 공식 안내의 확인 항목과 최종 확인 세부 조건은 출발 전에 다시 확인하세요.',
    '- 숙소·호텔 위치와 공항 이동·교통 안내는 별도 공식 페이지에서 확인하세요.',
    '- 여행 일정과 준비물 체크리스트, 예약·예산·비용은 자신의 조건에 맞게 구분하세요.',
    ...(primaryKeyword ? [
      `- ${primaryKeyword}의 목적과 적용 대상을 공식 원문에서 확인하세요.`,
      `- ${primaryKeyword}의 여권·비자 조건은 여행자 국적과 방문 목적에 따라 구분하세요.`,
      `- ${primaryKeyword}를 확인할 때는 공식 링크의 변경 공지를 함께 보세요.`,
      `- ${primaryKeyword} 관련 판단은 출발 직전 공식 안내를 기준으로 다시 확인하세요.`,
    ] : []),
    '',
  ];
  if (endMarkerIndex >= 0) normalizedLines.splice(endMarkerIndex, 0, ...contractFloor);
  else normalizedLines.push(...contractFloor);
  const faq = [
    '## FAQ: 출발 전에 무엇을 확인할까요?',
    '',
    `Q. ${primaryKeyword || destination}를 찾을 때 공식 페이지에서 먼저 봐야 하는 것은 무엇인가요?`,
    'A. 아래 공식 원문에서 확인한 내용만 빠짐없이 정리했습니다.',
    '',
  ];
  if (endMarkerIndex >= 0) normalizedLines.splice(endMarkerIndex, 0, ...faq);
  else normalizedLines.push(...faq);
  const markdown = normalizedLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  return {
    markdown,
    changed: true,
    changes: ['entry_requirements_deterministic_evidence_article'],
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
  plannedTitle?: string | null;
  primaryKeyword?: string | null;
  editorialVariation?: MonthlyWeatherEditorialVariation | null;
  forceDeterministicEvidenceArticle?: boolean;
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
  if (input.intent === 'local_transport') {
    return repairLocalTransportResearchStructure(input);
  }
  if (input.intent === 'entry_requirements') {
    if (input.forceDeterministicEvidenceArticle) {
      return buildDeterministicEntryRequirementsEvidenceArticle(input);
    }
    return repairEntryRequirementsResearchStructure(input);
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
  const officialSourceUrls = readiness.passed
    ? [...new Set(
        (readiness.bundle?.sources ?? [])
          .filter((source) => isOfficialInformationAuthority(source.authorityLevel))
          .map((source) => clean(source.sourceUrl))
          .filter(Boolean),
      )].slice(0, 12)
    : [];
  return {
    version: BLOG_RESEARCH_PREFLIGHT_VERSION,
    passed: readiness.passed,
    issues: readiness.issues.slice(0, 20),
    ...readiness.summary,
    source_keys: readiness.bundle?.sources.map((source) => source.sourceKey) ?? [],
    evidence_keys: readiness.bundle?.evidence.map((evidence) => evidence.evidenceKey) ?? [],
    official_source_urls: officialSourceUrls,
  };
}

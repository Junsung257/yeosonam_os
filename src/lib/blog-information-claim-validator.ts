import { stripMarkup } from './blog-text-utils';
import type {
  BlogInformationClaimLedgerEntry,
  BlogInformationFactualCandidateKind,
} from './blog-information-claim-ledger';
import {
  createBlogInformationClaimFingerprint,
  blogInformationEvidenceSetSupportsClaim,
  extractMonthlyClimateCompositeValue,
  isPrimaryInformationAuthority,
  type BlogInformationAuthorityLevel,
  type BlogInformationClaimType,
  type BlogInformationEvidenceScope,
  type BlogInformationEvidenceRiskLevel,
  type BlogInformationExtractedValue,
} from './blog-information-evidence';

export interface ExtractedBlogInformationClaim {
  claimFingerprint: string;
  claimText: string;
  claimType: BlogInformationClaimType;
  riskLevel: BlogInformationEvidenceRiskLevel;
  candidateKind: BlogInformationFactualCandidateKind;
  extractedValue: BlogInformationExtractedValue;
}

export interface BlogInformationClaimEvidenceRecord {
  evidenceKey: string;
  sourceVersionId: string | null;
  claimType: BlogInformationClaimType;
  observedAt: string;
  validUntil?: string | null;
  excerpt: string | null;
  scope: BlogInformationEvidenceScope;
  source: {
    authorityLevel: BlogInformationAuthorityLevel;
    retrievedAt: string;
    validUntil?: string | null;
    status?: 'active' | 'expired' | 'revoked';
  };
}

export interface PersistedBlogInformationClaimRecord {
  claimFingerprint: string;
  claimText?: string;
  claimType: BlogInformationClaimType;
  extractedValue?: BlogInformationExtractedValue;
  validationStatus: 'pending' | 'supported' | 'unsupported' | 'stale' | 'review_required' | 'approved' | 'rejected';
  evidence: BlogInformationClaimEvidenceRecord[];
}

export interface BlogInformationClaimValidationIssue {
  code:
    | 'missing_evidence'
    | 'claim_not_supported'
    | 'stale_evidence'
    | 'official_source_required'
    | 'official_primary_required'
    | 'evidence_scope_mismatch'
    | 'evidence_semantic_mismatch'
    | 'source_version_required'
    | 'review_state_required'
    | 'review_fingerprint_mismatch'
    | 'human_approval_required'
    | 'unclassified_factual_candidate'
    | 'claim_ledger_body_mismatch'
    | 'invalid_claim_ledger'
    | 'validator_error';
  claimFingerprint: string;
  claimText?: string;
  claimType: BlogInformationClaimType;
  message: string;
}

export interface BlogInformationClaimValidationReport {
  passed: boolean;
  claims: ExtractedBlogInformationClaim[];
  issues: BlogInformationClaimValidationIssue[];
  coverage: number;
  requiresHumanReview: boolean;
  ledger?: {
    declaredCount: number;
    candidateCount: number;
    unclassifiedCount: number;
    issues: string[];
  };
}

const PRICE_RE = /(?:[₩￦¥￥$€₫]\s*\d[\d,.]*)|(?:\b(?:JPY|KRW|USD|VND|SGD|CNY|EUR|THB)\s*\d[\d,.]*)|(?:\d[\d,.]*\s*(?:원|엔|달러|위안|유로|바트|동|페소|링깃|루피|파운드|프랑|JPY|KRW|USD|VND|SGD|CNY|EUR|THB))|(?:(?:가격|요금|비용|예산|택시비|교통비|식비|숙박비)\s*(?:은|는|이|가|:)?\s*(?:약\s*)?\d)/i;
const DURATION_RE = /(?:약\s*)?\d+(?:\.\d+)?\s*(?:분|시간)(?:\s*(?:~|-|–)\s*\d+(?:\.\d+)?\s*(?:분|시간))?/i;
const PERCENT_RE = /\d+(?:\.\d+)?\s*%/;
const DISTANCE_RE = /(?:약|최대|최소|평균)?\s*\d+(?:\.\d+)?\s*(?:km|㎞|킬로미터|m|미터)/i;
const CLOCK_RE = /(?:[01]?\d|2[0-3]):[0-5]\d(?:\s*(?:~|-|–)\s*(?:[01]?\d|2[0-3]):[0-5]\d)?/;
const HOUR_CLOCK_RE = /(?:오전|오후)?\s*\d{1,2}시(?:\s*\d{1,2}분)?/i;
const SCHEDULE_RE = /(?:매일|주말|평일|연중무휴|24시간|첫차|막차|휴무)/i;
const SCHEDULE_ASSERTION_RE = /(?:영업|운영|개장|폐장|첫차|막차|출발|도착|체크인|체크아웃|휴무|혼잡|운행|합니다|됩니다|입니다|가능|불가)/i;
const DATE_PERIOD_RE = /(?:\d{4}[./-]\d{1,2}(?:[./-]\d{1,2})?|\d{4}년\s*\d{1,2}월(?:\s*\d{1,2}일)?|(?<!\d)\d{1,2}월\s*\d{1,2}일|(?<!\d)\d{1,3}\s*(?:일|주|개월)(?!\s*차)|(?<!\d)\d{1,2}\s*년(?:간|까지|이내|이상|이하|동안)?)/i;
const QUANTITY_RE = /(?:약|최대|최소|평균)?\s*\d+(?:\.\d+)?(?:\s*(?:~|-|–)\s*\d+(?:\.\d+)?)?\s*(?:병|개비|개|명|회|건|대|장|kg|g|㎏|L|ℓ|ml|mL|MB|GB)/i;
const COUNT_KIND_RE = /\d+\s*가지\s*(?:이상|이하|제공|포함|있|입니다|준비|판매)/i;
const REQUIREMENT_RE = /(?:필수|의무|금지|반드시|제한|허용(?:되지|됩니다|합니다)?|불가|해야\s*(?:합니다|됩니다|해요)|할\s*수\s*없)/i;
const AVAILABILITY_RE = /(?:(?:예약|판매|입장|이용|운영|영업|접수).*(?:가능|불가|마감|매진|중단|종료|휴무|중))|(?:(?:가능|불가|마감|매진).*(?:예약|판매|입장|이용|접수))/i;
const CLIMATE_RE = /(?:\d+(?:\.\d+)?\s*(?:℃|°C|mm)|(?:최고|최저|평균)\s*기온\s*-?\d|강수(?:량|일)\s*\d|습도\s*\d+\s*%)/i;
const CUSTOMS_RE = /(?:세관|면세|반입|반출|신고\s*한도|면세\s*한도).*(?:\d|한도|금지|허용|신고|면제|가능|불가)/i;
const ENTRY_RE = /(?:입국|출입국|비자|여권|전자여행허가|ETA|ESTA).*(?:필수|필요|불필요|면제|유효|가능|불가|금지|허용|의무|신고|체류)/i;
const INSURANCE_RE = /(?:여행자?\s*보험|보험).*(?:보장|면책|제외|자기부담|청구|한도|가입|의무)/i;
const POLICY_RE = /(?:규정|정책|법률|법정|의무|금지|허용|운영시간|첫차|막차).*(?:\d|변경|적용|위반|가능|불가|해야|됩니다|입니다)/i;
const SUPERLATIVE_RE = /(?:가장\s*(?:저렴|비싸|빠르|느리|좋|많|적|높|낮|인기)|최고|최저|유일|1위|최대|최소|압도적)/i;
const GENERAL_YEAR_ALLOWLIST_RE = /^\d{4}년(?:\s*(?:여행|가이드|목차|판|업데이트|기준))*$/;
const ITINERARY_ORDINAL_ALLOWLIST_RE = /\d+\s*일\s*차/i;

const HIGH_RISK_INTENTS = new Set(['entry_requirements', 'travel_insurance']);

const HIGH_RISK_CLAIM_TYPES = new Set<BlogInformationClaimType>([
  'customs',
  'entry_visa',
  'insurance',
  'policy',
]);

const MAX_SOURCE_AGE_DAYS: Record<BlogInformationClaimType, number> = {
  price: 30,
  currency: 7,
  duration: 30,
  percentage: 90,
  climate: 365,
  customs: 30,
  entry_visa: 30,
  insurance: 30,
  policy: 30,
  superlative: 30,
  factual: 365,
};

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/^[-*#>|\s]+/, '').trim();
}

function splitClaimSegments(markdown: string): string[] {
  const plain = stripMarkup(markdown.replace(/<!--[\s\S]*?-->/g, ' '), { collapseWhitespace: false })
    .replace(/\r\n?/g, '\n');
  const segments = plain.split(/\n+/).flatMap((line) => {
    const cleanedLine = clean(line.replace(/^\s*\d+[.)]\s+/, ''));
    if (!cleanedLine || /^\|?\s*:?-{3,}/.test(cleanedLine)) return [];
    const tableAwareLine = cleanedLine.includes('|')
      ? cleanedLine.replace(/^\|\s*|\s*\|$/g, '').replace(/\s*\|\s*/g, ' | ')
      : cleanedLine;
    return tableAwareLine.split(/(?<=[.!?。！？])\s+/).map(clean);
  });
  return [...new Set(segments.filter((segment) => segment.length >= 2 && segment.length <= 500))];
}

function classifyClaim(segment: string): Pick<ExtractedBlogInformationClaim, 'claimType' | 'riskLevel' | 'candidateKind'> | null {
  if (GENERAL_YEAR_ALLOWLIST_RE.test(segment)) return null;
  if (CUSTOMS_RE.test(segment)) return { claimType: 'customs', riskLevel: 'HIGH', candidateKind: 'regulated_policy' };
  if (ENTRY_RE.test(segment)) return { claimType: 'entry_visa', riskLevel: 'HIGH', candidateKind: 'regulated_policy' };
  if (INSURANCE_RE.test(segment)) return { claimType: 'insurance', riskLevel: 'HIGH', candidateKind: 'regulated_policy' };
  if (CLIMATE_RE.test(segment)) return { claimType: 'climate', riskLevel: 'MEDIUM', candidateKind: 'climate_measurement' };
  if (PRICE_RE.test(segment)) return { claimType: /환율|통화|환전/i.test(segment) ? 'currency' : 'price', riskLevel: 'MEDIUM', candidateKind: 'money_price' };
  if (PERCENT_RE.test(segment)) return { claimType: 'percentage', riskLevel: 'MEDIUM', candidateKind: 'percentage' };
  if (DISTANCE_RE.test(segment)) return { claimType: 'factual', riskLevel: 'MEDIUM', candidateKind: 'distance' };
  if (CLOCK_RE.test(segment) || HOUR_CLOCK_RE.test(segment) || (SCHEDULE_RE.test(segment) && SCHEDULE_ASSERTION_RE.test(segment))) {
    return { claimType: 'factual', riskLevel: 'MEDIUM', candidateKind: 'time_schedule' };
  }
  if (DURATION_RE.test(segment)) return { claimType: 'duration', riskLevel: 'MEDIUM', candidateKind: 'time_schedule' };
  if (!ITINERARY_ORDINAL_ALLOWLIST_RE.test(segment) && DATE_PERIOD_RE.test(segment)) {
    return { claimType: 'factual', riskLevel: 'MEDIUM', candidateKind: 'date_period' };
  }
  if (QUANTITY_RE.test(segment) || COUNT_KIND_RE.test(segment)) {
    return { claimType: 'factual', riskLevel: 'MEDIUM', candidateKind: 'quantity_limit' };
  }
  if (REQUIREMENT_RE.test(segment)) return { claimType: 'factual', riskLevel: 'MEDIUM', candidateKind: 'requirement_prohibition' };
  if (AVAILABILITY_RE.test(segment) && !/(?:변경|변동)\s*가능성/i.test(segment)) {
    return { claimType: 'factual', riskLevel: 'MEDIUM', candidateKind: 'availability_status' };
  }
  if (POLICY_RE.test(segment)) return { claimType: 'policy', riskLevel: 'HIGH', candidateKind: 'regulated_policy' };
  if (SUPERLATIVE_RE.test(segment)) return { claimType: 'superlative', riskLevel: 'MEDIUM', candidateKind: 'superlative' };
  return null;
}

export type BlogInformationStatementCategory =
  | 'verified_factual'
  | 'subjective_editorial'
  | 'navigation_boilerplate'
  | 'unknown_unclassified';

const NAVIGATION_OR_BOILERPLATE_RE = /(?:^|\s)(?:목차|FAQ|가이드|체크리스트|요약|마무리|공식 사이트|자세히 보기)(?:$|\s)|(?:비교|확인|참고|선택|살펴|알아|둘러|정)해?\s*보세요|(?:확인|참고)하세요/i;
const SUBJECTIVE_EDITORIAL_RE = /(?:저는|개인적으로|제 생각|느낌|취향|여행 스타일|선호).*(?:생각|느끼|좋|달라|추천)|(?:매력적|인상적|낭만적|즐겁|좋다고 생각)/i;
const EDITORIAL_READING_GUIDANCE_RE = /(?:(?:먼저|우선).*(?:봐야|확인해야).*(?:실수|혼선|누락).*(?:줄일|피할)\s*수\s*있)|(?:(?:처음 읽는 분|먼저).*(?:표|요약|체크리스트).*(?:골라 읽|저장해도|보면 됩니다|확인))|(?:숫자는\s*(?:확정값|실시간값)이\s*아니라\s*(?:비교|참고)\s*기준)|(?:출발\s*\d+\s*(?:일|시간)\s*전.*(?:공식 안내|예약 조건).*다시\s*확인)/i;
const V3_DECISION_GUIDANCE_RE = /(?:고를\s*때|선택할\s*때|일정에\s*넣는다면|자신의\s*여행\s*스타일|먼저\s*.+(?:정한|고른)|(?:무엇|어디|어떤).*(?:기준|질문)|(?:이|가)\s*핵심입니다|함께\s*보아야\s*합니다|확인해야\s*합니다|다른\s*.+(?:고르는|바꾸는)\s*것이\s*더\s*현실적입니다|자세한\s*.+에서\s*확인할\s*수\s*있습니다)/i;
const V3_NAVIGATION_HEADING_RE = /^(?:선택\s*기준|결정\s*질문|출발\s*전\s*확인|계획이\s*틀어질\s*때)\s*:/i;
const ASSERTIVE_STATEMENT_RE = /(?:입니다|합니다|됩니다|있습니다|없습니다|않습니다|필요합니다|가능합니다|불가능합니다|안전합니다|빠릅니다|느립니다|마칩니다|종료됩니다|중단합니다|사용할 수|운행|영업|예약|재고|현금만|대기 시간)/i;

export function classifyBlogInformationStatement(segment: string): {
  category: BlogInformationStatementCategory;
  factualClassification: Pick<ExtractedBlogInformationClaim, 'claimType' | 'riskLevel' | 'candidateKind'> | null;
} {
  // Measurable, regulated, availability and other explicit fact shapes always
  // win over editorial-language allowlists. This prevents a sentence such as
  // "먼저 15분 거리인지 확인하세요" from bypassing evidence validation.
  const factualClassification = classifyClaim(segment);
  if (factualClassification) return { category: 'verified_factual', factualClassification };
  if (
    EDITORIAL_READING_GUIDANCE_RE.test(segment)
    || V3_DECISION_GUIDANCE_RE.test(segment)
    || V3_NAVIGATION_HEADING_RE.test(segment)
  ) {
    return { category: 'navigation_boilerplate', factualClassification: null };
  }
  if (SUBJECTIVE_EDITORIAL_RE.test(segment)) {
    return { category: 'subjective_editorial', factualClassification: null };
  }
  if (NAVIGATION_OR_BOILERPLATE_RE.test(segment)) {
    return { category: 'navigation_boilerplate', factualClassification: null };
  }
  if (!ASSERTIVE_STATEMENT_RE.test(segment)) {
    return { category: 'navigation_boilerplate', factualClassification: null };
  }
  return {
    category: 'unknown_unclassified',
    factualClassification: {
      claimType: 'factual',
      riskLevel: 'MEDIUM',
      candidateKind: 'unknown_statement',
    },
  };
}

function normalizeNumericValue(value: string): string {
  return value.replace(/,/g, '').replace(/^\+/, '').trim();
}

function readCurrency(segment: string): string | null {
  const normalized = segment.normalize('NFKC');
  const currencies: Array<[string, RegExp]> = [
    ['KRW', /KRW|원|₩|￦/i],
    ['JPY', /JPY|엔|¥|￥/i],
    ['USD', /USD|달러|\$/i],
    ['VND', /VND|동|₫/i],
    ['SGD', /SGD|싱가포르\s*달러|S\$/i],
    ['EUR', /EUR|유로|€/i],
    ['CNY', /CNY|위안/i],
    ['THB', /THB|바트/i],
  ];
  return currencies.find(([, pattern]) => pattern.test(normalized))?.[0] ?? null;
}

function extractClaimValue(segment: string, kind: BlogInformationFactualCandidateKind): BlogInformationExtractedValue {
  const number = segment.match(/-?\d[\d,.]*/)?.[0];
  const currency = readCurrency(segment);
  const currencyAmount = segment.match(/(?:[₩￦¥￥$€₫]|\b(?:JPY|KRW|USD|VND|SGD|CNY|EUR|THB))\s*(-?\d[\d,.]*)|(-?\d[\d,.]*)\s*(?:원|엔|달러|위안|유로|바트|동|JPY|KRW|USD|VND|SGD|CNY|EUR|THB)/i);
  const currencyNumber = currencyAmount?.[1] ?? currencyAmount?.[2];
  if (currency && currencyNumber) {
    return { normalizedValue: normalizeNumericValue(currencyNumber), unit: null, currency };
  }
  const percent = segment.match(/-?\d+(?:\.\d+)?\s*%/);
  if (percent) return { normalizedValue: normalizeNumericValue(percent[0].replace('%', '')), unit: '%', currency: null };
  const clock = segment.match(/(?:[01]?\d|2[0-3]):[0-5]\d(?:\s*(?:~|-|–)\s*(?:[01]?\d|2[0-3]):[0-5]\d)?/);
  if (clock) return { normalizedValue: clock[0].replace(/\s+/g, ''), unit: 'time', currency: null };
  if (kind === 'climate_measurement') {
    const monthlyClimateValue = extractMonthlyClimateCompositeValue(segment);
    if (monthlyClimateValue) return monthlyClimateValue;
  }
  const measured = segment.match(/(-?\d+(?:\.\d+)?)\s*(km|㎞|킬로미터|m|미터|분|시간|℃|°C|mm|병|개비|개|명|회|건|대|장|kg|g|㎏|L|ℓ|ml|mL|MB|GB)/i);
  if (measured) return { normalizedValue: normalizeNumericValue(measured[1]), unit: measured[2], currency: null };
  const period = segment.match(/(?<!\d)(\d{1,3})\s*(일|주|개월|년)/);
  if (period && !ITINERARY_ORDINAL_ALLOWLIST_RE.test(segment)) {
    return { normalizedValue: period[1], unit: period[2], currency: null };
  }
  if (kind === 'requirement_prohibition' || kind === 'regulated_policy') {
    if (/불필요|필요하지|면제/.test(segment)) return { normalizedValue: 'not_required', unit: null, currency: null };
    if (/금지|불가|할\s*수\s*없/.test(segment)) return { normalizedValue: 'prohibited', unit: null, currency: null };
    if (/필수|의무|반드시|필요/.test(segment)) return { normalizedValue: 'required', unit: null, currency: null };
    if (/보장/.test(segment)) return { normalizedValue: 'covered', unit: null, currency: null };
  }
  if (kind === 'availability_status') {
    if (/불가|마감|매진|중단|종료|휴무/.test(segment)) return { normalizedValue: 'unavailable', unit: null, currency: null };
    return { normalizedValue: 'available', unit: null, currency: null };
  }
  if (kind === 'superlative') return { normalizedValue: 'superlative', unit: null, currency: null };
  return { normalizedValue: normalizeNumericValue(number ?? segment), unit: null, currency: null };
}

const FOOD_BUDGET_RESEARCH_BLOCK_START = '<!-- blog_research_structure:food_budget:v1 -->';
const FOOD_BUDGET_RESEARCH_BLOCK_END = '<!-- /blog_research_structure:food_budget:v1 -->';
const LOCAL_TRANSPORT_RESEARCH_BLOCK_START = '<!-- blog_research_structure:local_transport:v1 -->';
const LOCAL_TRANSPORT_RESEARCH_BLOCK_END = '<!-- /blog_research_structure:local_transport:v1 -->';
const ENTRY_REQUIREMENTS_RESEARCH_BLOCK_START = '<!-- blog_research_structure:entry_requirements:v1 -->';
const ENTRY_REQUIREMENTS_RESEARCH_BLOCK_END = '<!-- /blog_research_structure:entry_requirements:v1 -->';
const MONTHLY_WEATHER_RESEARCH_BLOCKS = [
  [
    '<!-- blog_research_structure:monthly_weather:v2 -->',
    '<!-- /blog_research_structure:monthly_weather:v2 -->',
  ],
  [
    '<!-- blog_research_structure:monthly_weather:v1 -->',
    '<!-- /blog_research_structure:monthly_weather:v1 -->',
  ],
] as const;

function sameExtractedValue(
  left: BlogInformationExtractedValue,
  right: BlogInformationExtractedValue,
): boolean {
  return normalizeNumericValue(left.normalizedValue) === normalizeNumericValue(right.normalizedValue)
    && (left.unit ?? '').normalize('NFKC').toLowerCase() === (right.unit ?? '').normalize('NFKC').toLowerCase()
    && (left.currency ?? '').normalize('NFKC').toUpperCase() === (right.currency ?? '').normalize('NFKC').toUpperCase();
}

function candidateKindForClaimType(
  claimType: BlogInformationClaimType,
): BlogInformationFactualCandidateKind {
  if (claimType === 'price' || claimType === 'currency') return 'money_price';
  if (claimType === 'duration') return 'time_schedule';
  if (claimType === 'percentage') return 'percentage';
  if (claimType === 'climate') return 'climate_measurement';
  if (claimType === 'superlative') return 'superlative';
  if (['customs', 'entry_visa', 'insurance', 'policy'].includes(claimType)) {
    return 'regulated_policy';
  }
  return 'unknown_statement';
}

function expandDeterministicResearchRowsForValidation(
  markdown: string,
  persistedClaims: PersistedBlogInformationClaimRecord[],
  claimLedger?: BlogInformationClaimLedgerEntry[],
): string {
  if (persistedClaims.length === 0) return markdown;
  const declaredFingerprints = claimLedger
    ? new Set(claimLedger.map((claim) => claim.claimFingerprint))
    : null;
  const eligibleClaims = declaredFingerprints
    ? persistedClaims.filter((claim) => declaredFingerprints.has(claim.claimFingerprint))
    : persistedClaims;

  const localTransportStart = markdown.indexOf(LOCAL_TRANSPORT_RESEARCH_BLOCK_START);
  const localTransportEnd = markdown.indexOf(
    LOCAL_TRANSPORT_RESEARCH_BLOCK_END,
    localTransportStart,
  );
  if (localTransportStart >= 0 && localTransportEnd >= 0) {
    const contentStart = localTransportStart + LOCAL_TRANSPORT_RESEARCH_BLOCK_START.length;
    const expanded = eligibleClaims
      .map((claim) => claim.claimText?.trim())
      .filter((claimText): claimText is string => Boolean(claimText))
      .join('\n');
    return `${markdown.slice(0, contentStart)}\n${expanded}\n${markdown.slice(localTransportEnd)}`;
  }

  const weatherMarkers = MONTHLY_WEATHER_RESEARCH_BLOCKS.find(([startMarker, endMarker]) => {
    const start = markdown.indexOf(startMarker);
    return start >= 0 && markdown.indexOf(endMarker, start) >= 0;
  });
  if (weatherMarkers) {
    const [startMarker, endMarker] = weatherMarkers;
    const weatherStart = markdown.indexOf(startMarker);
    const weatherEnd = markdown.indexOf(endMarker, weatherStart);
    const contentStart = weatherStart + startMarker.length;
    const block = markdown.slice(contentStart, weatherEnd);
    const expanded = block.split(/\r?\n/).map((line) => {
      if (!/^\s*\|.*\|\s*$/.test(line) || /^\s*\|\s*:?-{3,}/.test(line)) return line;
      const matches = eligibleClaims.filter((claim) =>
        claim.claimText && line.includes(claim.claimText));
      return matches.length === 1 ? matches[0].claimText! : line;
    }).join('\n');
    return `${markdown.slice(0, contentStart)}${expanded}${markdown.slice(weatherEnd)}`;
  }

  const start = markdown.indexOf(FOOD_BUDGET_RESEARCH_BLOCK_START);
  const end = markdown.indexOf(FOOD_BUDGET_RESEARCH_BLOCK_END, start);
  if (start < 0 || end < 0) return markdown;

  const contentStart = start + FOOD_BUDGET_RESEARCH_BLOCK_START.length;
  const block = markdown.slice(contentStart, end);
  const expanded = block.split(/\r?\n/).map((line) => {
    if (!/^\s*\|.*\|\s*$/.test(line) || /^\s*\|\s*:?-{3,}/.test(line)) return line;
    const classification = classifyBlogInformationStatement(line).factualClassification;
    if (!classification) return line;
    const extractedValue = extractClaimValue(line, classification.candidateKind);
    const matches = eligibleClaims.filter((claim) =>
      claim.claimText
      && claim.claimType === classification.claimType
      && claim.extractedValue
      && sameExtractedValue(claim.extractedValue, extractedValue));
    return matches.length === 1 ? matches[0].claimText! : line;
  }).join('\n');

  return `${markdown.slice(0, contentStart)}${expanded}${markdown.slice(end)}`;
}

export function extractBlogInformationClaims(markdown: string): ExtractedBlogInformationClaim[] {
  return splitClaimSegments(markdown).flatMap((segment) => {
    const classification = classifyBlogInformationStatement(segment).factualClassification;
    if (!classification) return [];
    return [{
      claimFingerprint: createBlogInformationClaimFingerprint(segment),
      claimText: segment,
      ...classification,
      extractedValue: extractClaimValue(segment, classification.candidateKind),
    }];
  });
}

function isEvidenceCurrent(
  evidence: BlogInformationClaimEvidenceRecord,
  claimType: BlogInformationClaimType,
  nowMs: number,
): boolean {
  if (evidence.source.status && evidence.source.status !== 'active') return false;
  const explicitExpiry = [evidence.validUntil, evidence.source.validUntil]
    .concat([evidence.scope?.validUntil, evidence.scope?.nextReviewAt])
    .filter((value): value is string => Boolean(value))
    .map((value) => Date.parse(value));
  if (explicitExpiry.some((expiry) => Number.isNaN(expiry) || expiry < nowMs)) return false;
  const explicitStarts = [evidence.scope?.validFrom, evidence.scope?.verifiedAt]
    .filter((value): value is string => Boolean(value))
    .map((value) => Date.parse(value));
  if (explicitStarts.some((start) => Number.isNaN(start) || start > nowMs)) return false;
  const retrievedAt = Date.parse(evidence.source.retrievedAt);
  if (Number.isNaN(retrievedAt)) return false;
  const maxAgeMs = MAX_SOURCE_AGE_DAYS[claimType] * 24 * 60 * 60 * 1000;
  return nowMs - retrievedAt <= maxAgeMs;
}

export function validateBlogInformationClaims(input: {
  markdown: string;
  persistedClaims: PersistedBlogInformationClaimRecord[];
  claimLedger?: BlogInformationClaimLedgerEntry[];
  claimLedgerIssues?: string[];
  intentType?: string | null;
  expectedScope?: Partial<Pick<BlogInformationEvidenceScope, 'country' | 'destination' | 'applicableTo' | 'locale'>>;
  reviewStatus?: string | null;
  now?: Date;
}): BlogInformationClaimValidationReport {
  try {
    const persistedByFingerprint = new Map(
      input.persistedClaims.map((claim) => [claim.claimFingerprint, claim]),
    );
    const declaredClaims = input.claimLedger
      ?? input.persistedClaims.map((claim) => ({
        claimFingerprint: claim.claimFingerprint,
        claimText: claim.claimText ?? '',
        claimType: claim.claimType,
        riskLevel: 'MEDIUM' as const,
      }));
    const validationMarkdown = expandDeterministicResearchRowsForValidation(
      input.markdown,
      input.persistedClaims,
      input.claimLedger,
    );
    const deterministicEvidenceArticle = (
      input.markdown.trimStart().startsWith(LOCAL_TRANSPORT_RESEARCH_BLOCK_START)
      && input.markdown.includes(LOCAL_TRANSPORT_RESEARCH_BLOCK_END)
    ) || (
      input.markdown.trimStart().startsWith(ENTRY_REQUIREMENTS_RESEARCH_BLOCK_START)
      && input.markdown.includes(ENTRY_REQUIREMENTS_RESEARCH_BLOCK_END)
    );
    const claims: ExtractedBlogInformationClaim[] = deterministicEvidenceArticle
      ? declaredClaims.map((declared) => {
          const persisted = persistedByFingerprint.get(declared.claimFingerprint);
          const candidateKind = candidateKindForClaimType(declared.claimType);
          return {
            claimFingerprint: declared.claimFingerprint,
            claimText: declared.claimText,
            claimType: declared.claimType,
            riskLevel: declared.riskLevel,
            candidateKind,
            extractedValue: persisted?.extractedValue
              ?? extractClaimValue(declared.claimText, candidateKind),
          };
        })
      : extractBlogInformationClaims(validationMarkdown);
    const declaredFingerprints = new Set(declaredClaims.map((claim) => claim.claimFingerprint));
    const declaredRiskByFingerprint = new Map(
      declaredClaims.map((claim) => [claim.claimFingerprint, claim.riskLevel]),
    );
    const issues: BlogInformationClaimValidationIssue[] = [];
    let supportedClaims = 0;
    let unclassifiedCount = 0;
    const nowMs = (input.now ?? new Date()).getTime();
    const ledgerIssues = [...new Set(input.claimLedgerIssues ?? [])];
    const contractFingerprint = createBlogInformationClaimFingerprint('information_claim_ledger_contract');

    for (const ledgerIssue of ledgerIssues) {
      issues.push({
        code: 'invalid_claim_ledger',
        claimFingerprint: contractFingerprint,
        claimType: 'factual',
        message: ledgerIssue,
      });
    }

    const normalizedBody = stripMarkup(validationMarkdown, { collapseWhitespace: true })
      .normalize('NFKC')
      .replace(/[|.,!?。！？:;"'“”‘’()[\]{}]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    for (const declared of input.claimLedger ?? []) {
      const normalizedClaim = stripMarkup(declared.claimText, { collapseWhitespace: true })
        .normalize('NFKC')
        .replace(/[|.,!?。！？:;"'“”‘’()[\]{}]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
      if (normalizedClaim && !normalizedBody.includes(normalizedClaim)) {
        issues.push({
          code: 'claim_ledger_body_mismatch',
          claimFingerprint: declared.claimFingerprint,
          claimType: declared.claimType,
          message: 'writer claim ledger의 문장이 최종 본문에 존재하지 않습니다.',
        });
      }
    }

    for (const claim of claims) {
      if (!declaredFingerprints.has(claim.claimFingerprint)) {
        unclassifiedCount += 1;
        issues.push({
          code: 'unclassified_factual_candidate',
          claimFingerprint: claim.claimFingerprint,
          claimText: claim.claimText,
          claimType: claim.claimType,
          message: `최종 본문 factual candidate가 구조화 claim ledger에 없습니다: ${claim.candidateKind}`,
        });
        continue;
      }
      const persisted = persistedByFingerprint.get(claim.claimFingerprint);
      if (!persisted || persisted.evidence.length === 0) {
        issues.push({
          code: 'missing_evidence',
          claimFingerprint: claim.claimFingerprint,
          claimType: claim.claimType,
          message: '검증 대상 claim에 연결된 정보성 evidence가 없습니다.',
        });
        continue;
      }
      if (!['supported', 'approved'].includes(persisted.validationStatus)) {
        issues.push({
          code: 'claim_not_supported',
          claimFingerprint: claim.claimFingerprint,
          claimType: claim.claimType,
          message: `claim validation status가 발행 가능하지 않습니다: ${persisted.validationStatus}`,
        });
        continue;
      }
      const claimTypeEvidence = persisted.evidence.filter((evidence) => evidence.claimType === claim.claimType);
      if (claimTypeEvidence.length > 0 && claimTypeEvidence.every((evidence) => !evidence.sourceVersionId)) {
        issues.push({
          code: 'source_version_required',
          claimFingerprint: claim.claimFingerprint,
          claimType: claim.claimType,
          message: 'claim evidence가 특정 불변 source version을 참조하지 않습니다.',
        });
        continue;
      }
      const currentEvidence = claimTypeEvidence.filter((evidence) =>
        Boolean(evidence.sourceVersionId) && isEvidenceCurrent(evidence, claim.claimType, nowMs));
      if (currentEvidence.length === 0) {
        issues.push({
          code: 'stale_evidence',
          claimFingerprint: claim.claimFingerprint,
          claimType: claim.claimType,
          message: '현재 유효한 evidence가 없습니다.',
        });
        continue;
      }
      const highRisk = HIGH_RISK_CLAIM_TYPES.has(claim.claimType)
        || HIGH_RISK_INTENTS.has(String(input.intentType ?? ''));
      if (highRisk && !currentEvidence.some((evidence) => isPrimaryInformationAuthority(evidence.source.authorityLevel))) {
        issues.push({
          code: 'official_primary_required',
          claimFingerprint: claim.claimFingerprint,
          claimType: claim.claimType,
          message: '고위험 intent·정책형 claim에는 공식 1차 source가 필요합니다.',
        });
        continue;
      }
      const authorityEligibleEvidence = highRisk
        ? currentEvidence.filter((evidence) => isPrimaryInformationAuthority(evidence.source.authorityLevel))
        : currentEvidence;
      const semanticReport = blogInformationEvidenceSetSupportsClaim({
        evidence: authorityEligibleEvidence,
        claimType: claim.claimType,
        extractedValue: claim.extractedValue,
        expectedScope: input.expectedScope,
      });
      if (!semanticReport.passed) {
        const mismatchCodes = semanticReport.issues;
        const hasScopeMismatch = mismatchCodes.some((code) =>
          /country|destination|applicable|locale|claim_type|scope_window|conditions/.test(code));
        issues.push({
          code: hasScopeMismatch ? 'evidence_scope_mismatch' : 'evidence_semantic_mismatch',
          claimFingerprint: claim.claimFingerprint,
          claimType: claim.claimType,
          message: `evidence scope/excerpt가 최종 claim과 일치하지 않습니다: ${[...new Set(mismatchCodes)].join(',')}`,
        });
        continue;
      }
      const requiresHumanApproval = HIGH_RISK_INTENTS.has(String(input.intentType ?? ''))
        || (HIGH_RISK_CLAIM_TYPES.has(claim.claimType) && claim.claimType !== 'policy')
        || declaredRiskByFingerprint.get(claim.claimFingerprint) === 'HIGH';
      if (requiresHumanApproval && input.reviewStatus !== 'approved') {
        issues.push({
          code: 'human_approval_required',
          claimFingerprint: claim.claimFingerprint,
          claimType: claim.claimType,
          message: '고위험·정책형 claim은 사람 승인 전 발행할 수 없습니다.',
        });
        continue;
      }
      supportedClaims += 1;
    }

    return {
      passed: issues.length === 0,
      claims,
      issues,
      coverage: claims.length === 0 ? (issues.length === 0 ? 1 : 0) : supportedClaims / claims.length,
      requiresHumanReview: issues.length > 0
        || HIGH_RISK_INTENTS.has(String(input.intentType ?? ''))
        || claims.some((claim) =>
          HIGH_RISK_CLAIM_TYPES.has(claim.claimType) && claim.claimType !== 'policy')
        || claims.some((claim) =>
          declaredRiskByFingerprint.get(claim.claimFingerprint) === 'HIGH'),
      ledger: {
        declaredCount: declaredClaims.length,
        candidateCount: claims.length,
        unclassifiedCount,
        issues: ledgerIssues,
      },
    };
  } catch (error) {
    return {
      passed: false,
      claims: [],
      issues: [{
        code: 'validator_error',
        claimFingerprint: createBlogInformationClaimFingerprint('information_claim_validator_error'),
        claimType: 'factual',
        message: error instanceof Error ? error.message : 'unknown_validator_error',
      }],
      coverage: 0,
      requiresHumanReview: true,
      ledger: {
        declaredCount: 0,
        candidateCount: 0,
        unclassifiedCount: 0,
        issues: ['validator_error'],
      },
    };
  }
}

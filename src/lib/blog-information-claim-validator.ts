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

export interface BlogInformationClaimTypeCompatibility {
  passed: boolean;
  declaredType: BlogInformationClaimType;
  deterministicType: BlogInformationClaimType | null;
  candidateKind: BlogInformationFactualCandidateKind | null;
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
    | 'invalid_derivation'
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

const NUMERIC_FACTUAL_CANDIDATE_KINDS = new Set<BlogInformationFactualCandidateKind>([
  'money_price',
  'percentage',
  'distance',
  'time_schedule',
  'date_period',
  'quantity_limit',
  'climate_measurement',
]);

const UNSUPPORTED_CLAIM_ISSUE_CODES = new Set<BlogInformationClaimValidationIssue['code']>([
  'missing_evidence',
  'claim_not_supported',
  'unclassified_factual_candidate',
]);

/** Count only unsupported numeric facts present in the visible article. */
export function countUnsupportedNumericBlogInformationClaims(
  report: BlogInformationClaimValidationReport,
): number {
  const unsupportedFingerprints = new Set(report.issues
    .filter((issue) => UNSUPPORTED_CLAIM_ISSUE_CODES.has(issue.code))
    .map((issue) => issue.claimFingerprint));

  return new Set(report.claims
    .filter((claim) => unsupportedFingerprints.has(claim.claimFingerprint))
    .filter((claim) => NUMERIC_FACTUAL_CANDIDATE_KINDS.has(claim.candidateKind))
    .filter((claim) => /\d|[₩￦¥￥$€₫]|\b(?:JPY|KRW|USD|VND|SGD|CNY|EUR|THB)\b/i.test(claim.claimText))
    .map((claim) => claim.claimFingerprint)).size;
}

const PRICE_RE = /(?:[₩￦¥￥$€₫]\s*\d[\d,.]*)|(?:\b(?:JPY|KRW|USD|VND|SGD|CNY|EUR|THB)\s*\d[\d,.]*)|(?:\d[\d,.]*\s*(?:원|엔|달러|위안|유로|바트|동|페소|링깃|루피|파운드|프랑|JPY|KRW|USD|VND|SGD|CNY|EUR|THB))|(?:(?:가격|요금|비용|예산|택시비|교통비|식비|숙박비)\s*(?:은|는|이|가|:)?\s*(?:약\s*)?\d)|(?:(?:취소|변경|예약)?\s*수수료(?:가|는|은)?\s*(?:없|무료|면제))/i;
const DURATION_RE = /(?:약\s*)?\d+(?:\.\d+)?(?:\s*(?:~|-|–)\s*\d+(?:\.\d+)?)?\s*-?\s*(?:분|시간|mins?|minutes?|hrs?|hours?)(?:\s*(?:~|-|–)\s*\d+(?:\.\d+)?\s*-?\s*(?:분|시간|mins?|minutes?|hrs?|hours?))?/iu;
const PERCENT_RE = /\d+(?:\.\d+)?\s*%/;
const DISTANCE_RE = /(?:약|최대|최소|평균)?\s*\d+(?:\.\d+)?\s*(?:km|㎞|킬로미터|m|미터)/i;
const CLOCK_RE = /(?:[01]?\d|2[0-3]):[0-5]\d(?:\s*(?:~|-|–)\s*(?:[01]?\d|2[0-3]):[0-5]\d)?/;
const HOUR_CLOCK_RE = /(?:오전|오후)?\s*\d{1,2}시(?!간)(?:\s*\d{1,2}분)?/i;
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
const REPORTED_SERVICE_FACT_RE = /(?:안내|명시|공개)(?:한다|합니다)/i;
const GENERAL_YEAR_ALLOWLIST_RE = /^\d{4}년(?:\s*(?:여행|가이드|목차|판|업데이트|기준))*$/;
const ITINERARY_ORDINAL_ALLOWLIST_RE = /\d+\s*일\s*차/i;
const ITINERARY_DURATION_ALLOWLIST_RE = /\d{1,2}\s*박\s*\d{1,2}\s*일/i;
const ITINERARY_CONTINGENCY_HEADING_RE = /^(?:우천|날씨|휴무|피로|지연|변동)(?:[·,/\s]*(?:우천|날씨|휴무|피로|지연|변동))*\s*(?:(?:시|때|경우)\s*)?(?:대체(?:안)?(?:과\s*휴식)?\s*)?(?:일정|동선|순서|계획|결정)$/i;

function stripItineraryStructureNumerals(segment: string): string {
  return segment
    .replace(/\d{1,2}\s*박\s*\d{1,2}\s*일/gu, '')
    .replace(/\d{1,2}\s*일\s*차(?:에는|는|에|:)?/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

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
  if (ITINERARY_CONTINGENCY_HEADING_RE.test(stripItineraryStructureNumerals(segment))) return null;
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
  if (
    !ITINERARY_ORDINAL_ALLOWLIST_RE.test(segment)
    && !ITINERARY_DURATION_ALLOWLIST_RE.test(segment)
    && DATE_PERIOD_RE.test(segment)
  ) {
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
  if (REPORTED_SERVICE_FACT_RE.test(segment)) return { claimType: 'factual', riskLevel: 'MEDIUM', candidateKind: 'unknown_statement' };
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
const V3_DECISION_GUIDANCE_RE = /(?:고를\s*때|선택할\s*때|일정에\s*넣는다면|자신의\s*여행\s*스타일|먼저\s*.+(?:정한|고른)|(?:무엇|어디|어떤).*(?:기준|질문)|어디를\s*갈지는.*(?:시간|체력|동행|일정|우선순위).*(?:따라\s*달라|정해야|고르면)|(?:이|가)\s*핵심입니다|함께\s*보아야\s*합니다|확인해야\s*합니다|다른\s*.+(?:고르는|바꾸는)\s*것이\s*더\s*현실적입니다|자세한\s*.+에서\s*확인할\s*수\s*있습니다)/i;
const V3_DIRECT_DECISION_ANSWER_RE = /(?:어디를\s*갈지|무엇을\s*고를지|장소를\s*(?:고르|선택)|후보를\s*(?:고르|선택)).*(?:일정|시간|체력|동행|우선순위|조건).*(?:확인|비교|결정|고르|선택)|(?:일정|시간|체력|동행|우선순위|조건).*(?:확인|비교).*(?:결정|고르|선택)/i;
const V3_SOURCE_NEUTRAL_DECISION_GUIDANCE_RE = /^(?:같은|내|자신의|여행자는|일정에|어디를|무엇을|먼저\s).*(?:선택\s*기준|우선순위|일정|체력|동행|비교|결정|확인).*(?:정하|고르|선택|비교|확인|좁히|달라지|방식)/i;
const V3_SOURCE_NEUTRAL_PLANNING_ACTION_RE = /^(?!.{0,160}(?:입니다|합니다|됩니다|있습니다|없습니다|가능합니다|불가능합니다))(?=.*(?:일정|순서|후보|구간|휴식|우선순위|동선))(?=.*(?:정하세요|나누세요|묶으세요|분리하세요|조정하세요|비교하세요|확인하세요|표시하세요|배치하세요)).+$/i;
const V3_AVAILABILITY_RECHECK_RE = /(?:예약|입장|이용|운영|영업).*(?:가능\s*여부|가능한?\s*(?:시간|날짜|조건)).*(?:공식|예약|홈페이지|채널).*(?:확인|비교|점검)/i;
const V3_AVAILABILITY_DECISION_RE = /(?:예약|입장|이용|운영|영업).*(?:가능\s*(?:여부|시간|날짜|조건)).*(?:맞춰|기준으로).*(?:결정|선택|비교|조정)하세요/i;
const V3_NAVIGATION_HEADING_RE = /^(?:선택\s*기준|결정\s*질문|출발\s*전\s*확인|계획이\s*틀어질\s*때)\s*:/i;
const V3_EDITORIAL_PLANNING_HEADING_RE = /^(?!.*(?:\d|가능|불가|마감|매진|휴무|운영\s*중|입니다|합니다|됩니다|있습니다|없습니다))(?=.*(?:예약|휴식|일정|동선|이동|대체))(?=.*(?:순서|기준|결정|확인|비교|계획|실행)).{2,80}$/i;
const V3_ARTICLE_SCOPE_DESCRIPTION_RE = /^(?!.*\d)(?=.*(?:정리했습니다|비교합니다|살펴보세요|좁혀\s*보세요))(?=.*(?:찾는\s*분|확인된|공식\s*근거|본문|기준|방법|항목|조건|정보)).+$/i;
const V3_RESERVATION_PLANNING_RECHECK_RE = /^(?!.*(?:\d|(?:현재|오늘).*(?:가능|불가|마감|매진|휴무|운영)))(?=.*(?:예약\s*(?:가능\s*여부|상태|조건)?|운영\s*공지))(?=.*(?:확인|점검))(?=.*(?:일정|동선|순서|후보|구간|휴식|출발\s*지점))(?=.*(?:확정|결정|정하|배치|비교|맞추)).+$/i;
const V3_ITINERARY_EDITORIAL_GUIDANCE_RE = /^(?!.*(?:\d|현재|실제로|항상|통상|평균|이동\s*시간이\s*(?:길|짧)|도심\s*(?:동|서|남|북)쪽|같은\s*권역|안전|적합|필수|의무|금지|불가|가능합니다))(?=.*(?:일정|동선|이동\s*구간|예약|휴식))(?=.*(?:정하|나누|묶|분리|얹|점검|비교|고르|선택|결정|남겨|두고|두며))(?=.*(?:순서|기준|먼저|마지막|쉽게|무리|부담|대체|흐름)).+$/i;
const V3_ITINERARY_CONTINGENCY_GUIDANCE_RE = /^(?!.*\d)(?=.*(?:우천|날씨|휴무|변동))(?=.*(?:경우|때|어긋|밀리|밀릴|바뀌|대비|가능성|어려우면|어렵다면))(?=.*(?:대체|조정|바꾸|남겨|정해|확인|빼|제외|앞당기|미루))(?=.*(?:일정|동선|순서|블록)).+$/i;
const V3_OPERATIONAL_RECHECK_GUIDANCE_RE = /^(?!.*(?:\d|(?:현재|오늘).*(?:가능|불가|휴무|운영)))(?=.*(?:공식\s*(?:채널|홈페이지|공지|사이트)))(?=.*(?:운영\s*여부|예약\s*조건|입장\s*여부|휴무\s*여부|변동\s*여부))(?=.*(?:확인|점검))(?=.*(?:일정|동선|대체|출발)).+$/i;
const V3_UNSUPPORTED_LOCAL_EVALUATION_RE = /(?:이동\s*시간(?:이|은|가)?\s*(?:긴|길|짧)|(?:긴|짧은)\s*이동\s*구간|이동(?:이|은)\s*분리되는|같은\s*권역|함께\s*묶을\s*동선|따로\s*둘\s*일정|동선(?:이|은)\s*복잡|(?:안전|적합|최적|효율적)(?:합니다|입니다|한|하))/i;
const V3_EXPLICIT_OPERATIONAL_STATUS_RE = /(?:(?:현재|오늘|지금)\s*)?(?:(?:예약|판매|입장|이용|운영|영업|접수)(?:은|는|이|가)?\s*(?:가능|불가|마감|매진|중단|종료|휴무|중)(?:합니다|입니다|됩니다)|(?:매일|주말|평일|연중무휴|24시간).*(?:영업|운영|운행|휴무)(?:합니다|입니다|됩니다))/i;
const V3_SOURCE_NEUTRAL_PLANNING_IMPERATIVE_RE = /^(?=.*(?:일정|동선|순서|후보|출발\s*(?:위치|지점)|휴식|체력|대체안|우천|예약\s*(?:가능\s*)?여부|운영\s*공지|공식\s*이동\s*시간))(?=.*(?:확인하세요|비교하세요|고르세요|선택하세요|정하세요|결정하세요|따져보세요|점검하세요|두세요|남겨\s*두세요|준비하세요|조정하세요|확정하세요)).+$/i;
const V3_SOURCE_NEUTRAL_PLANNING_MODAL_RE = /^(?=.*(?:일정|순서|후보|동선|출발\s*(?:위치|지점)|체력|휴식|대체안|우천))(?=.*(?:(?:내|자신의).*(?:맞는|기준)|(?:중간|마지막).*(?:쉴|대체)))(?=.*(?:고르는\s*것이\s*안전합니다|두는\s*쪽(?:에서)?\s*나옵니다|두는\s*편이\s*(?:낫|좋)|결정하는\s*편이\s*(?:낫|좋))).+$/i;
// A grounded writer may explain *how to judge* a route without asserting a
// destination fact. These sentences were previously promoted to unknown
// factual candidates when they used verbs such as 저울질하다 or 판단하다
// instead of the narrower "고르는 것이 안전합니다" wording. Keep this
// allowlist source-neutral: it rejects digits, regulated topics, and explicit
// operational status before it can classify a sentence as editorial guidance.
const V3_SOURCE_NEUTRAL_DECISION_METHOD_RE = /^(?=.*(?:동선|일정|구간|순서|후보|이동\s*시간|휴식|체력|숙소\s*위치))(?=.*(?:판단|저울질|따져|나란히|맞는|부담|무리|기준|직접)).*(?:해야|하면|두고|두며|고르는|판단하는|저울질|따져|맞춰|무리가\s*없).+$/i;
const V3_FOOD_BUDGET_EDITORIAL_GUIDANCE_RE = /^(?!.*(?:\d|[₩￦¥￥$€₫]|\b(?:JPY|KRW|USD|VND|SGD|CNY|EUR|THB)\b|저렴|비싸|평균|통상|대부분|현재|실제로|항상|포함되어|제공|절약됩니다|가능|불가|마감|운영|영업|예약))(?=.*(?:예산|식비|비용|가격))(?=.*(?:항목|여행\s*방식|식사\s*패턴|포함\s*범위|시나리오|총액))(?=.*(?:고르|선택|나누|비교|정하|결정|맞추|포함할)).+$/i;
const V3_FOOD_BUDGET_SCOPE_LIMITATION_RE = /^(?!.*(?:\d|[₩￦¥￥$€₫]|\b(?:JPY|KRW|USD|VND|SGD|CNY|EUR|THB)\b|저렴|비싸|평균|통상|대부분|현재|실제로|항상|제공|절약됩니다|가능|불가|마감|운영|영업|예약))(?=.*(?:예산|가격))(?=.*(?:특정\s*메뉴|외식\s*(?:물가\s*)?항목))(?=.*(?:확인일\s*기준|포함합니다|한정됩니다)).+$/i;
const V3_NAMED_PLACE_ASSERTION_RE = /(?:[가-힣]{2,}(?:산|힐|사원|파고다|마운틴|해변|시장|공원|박물관|수족관|반도|다리|브리지|대성당|동굴|유적)\s*(?:은|는|이|가)|\b[A-Z][A-Za-zÀ-ÖØ-öø-ÿ.-]{2,}(?:\s+[A-Z][A-Za-zÀ-ÖØ-öø-ÿ.-]{2,}){0,3}\s+(?:is|has|offers|takes|requires)\b)/u;
const V3_ITINERARY_PROPOSAL_RE = /(?:편집\s*제안|(?:제안\s*일정|동선\s*예시).*(?:배치|구성|정리)|동선(?:은|을|이)?[^.。!?]{0,140}제안|(?:일차|날짜별|마지막\s*일정).*(?:순서|동선|흐름).*(?:제안|배치)|(?:장소별\s*실행\s*순서|이동\s*근거).*(?:정리했습니다|비교합니다)|(?:미방문\s*장소|남은\s*장소).*(?:대체\s*블록|후보).*(?:삼|두)|확인할\s*블록(?:은|을).*(?:입니다|정))/i;
const V3_ITINERARY_SOURCE_NEUTRAL_GUIDANCE_RE = /^(?=.*(?:일정|동선|순서|블록|공식\s*이동\s*시간|운영\s*시간|입장\s*시각|체류\s*순서|숙소\s*위치|당일\s*컨디션))(?=.*(?:구성하세요|정하세요|정하면\s*됩니다|고르세요|고르면\s*됩니다|결정하세요|비교하세요|확인하세요|판단해야\s*합니다|제안합니다|배치하세요|삼을\s*수\s*있습니다)).+$/i;
const REGULATED_TRAVEL_TOPIC_RE = /(?:세관|면세|반입|반출|입국|출입국|비자|여권|전자여행허가|ETA|ESTA|여행자?\s*보험|보험\s*(?:보장|면책|청구))/i;
const ASSERTIVE_STATEMENT_RE = /(?:입니다|합니다|됩니다|있습니다|없습니다|않습니다|필요합니다|가능합니다|불가능합니다|안전합니다|빠릅니다|느립니다|마칩니다|종료됩니다|중단합니다|안내(?:한다|합니다)|사용할 수|운행|영업|예약|재고|현금만|대기 시간)/i;
// Reader-owned route decisions are editorial instructions, not destination
// facts. Keep the allowlist deliberately narrow: the sentence must start from
// the reader's decision/action, contain no measured value or operational
// status, and must not start by assigning a property to a named operator.
const V3_ROUTE_DECISION_GUIDANCE_RE = /^(?!.*(?:\d|[₩￦¥￥$€₫]|\b(?:JPY|KRW|USD|VND|SGD|CNY|EUR|THB)\b|현재|실제로|항상|통상|평균|저렴|비싸|빠르|느리|안전|적합|가능|불가|마감|매진|운영\s*중|영업\s*중))(?:(?:이동|교통)수단을|대중교통\s*요금을|예산을|수하물을|승차\s*전|하차\s*후|중간\s*구간에서는|이동\s*구간에서는|먼저\s|자신의\s)(?=.*(?:이동수단|교통수단|대중교통|택시|예산|요금|수하물|항공\s*지연|승차|하차|중간\s*구간|이동\s*구간|예약\s*화면|공식\s*(?:채널|안내)))(?=.*(?:보면|고르|선택|비교|확인|정하|결정|분리|대조|따로)).+$/i;
const V3_ROUTE_FARE_PRODUCT_GUIDANCE_RE = /^(?=.*1회\s*탑승)(?=.*1일권)(?=.*예상\s*탑승\s*횟수)(?=.*(?:비교|고르|선택)).+$/i;
const V3_ROUTE_SCOPE_HEADING_RE = /^(?!.*\d)(?=.*공항)(?=.*교통)(?=.*:)(?=.*(?:GRTA|택시))(?=.*(?:요금|승차|수하물|지연|공식\s*근거)).{8,100}$/i;
const SOURCE_NEUTRAL_PLANNING_CANDIDATE_KINDS = new Set<BlogInformationFactualCandidateKind>([
  'availability_status',
  'time_schedule',
  'requirement_prohibition',
]);

function isSourceNeutralPlanningAdvice(
  segment: string,
  factualClassification: Pick<ExtractedBlogInformationClaim, 'claimType' | 'riskLevel' | 'candidateKind'> | null,
  unsupportedLocalEvaluation: boolean,
): boolean {
  if (unsupportedLocalEvaluation) return false;
  if (factualClassification?.riskLevel === 'HIGH') return false;
  if (REGULATED_TRAVEL_TOPIC_RE.test(segment)) return false;
  if (/\d|[₩￦¥￥$€₫]|\b(?:JPY|KRW|USD|VND|SGD|CNY|EUR|THB)\b/i.test(segment)) return false;
  if (V3_EXPLICIT_OPERATIONAL_STATUS_RE.test(segment)) return false;
  if (
    factualClassification
    && !SOURCE_NEUTRAL_PLANNING_CANDIDATE_KINDS.has(factualClassification.candidateKind)
  ) {
    return false;
  }
  return V3_SOURCE_NEUTRAL_PLANNING_IMPERATIVE_RE.test(segment)
    || V3_SOURCE_NEUTRAL_PLANNING_MODAL_RE.test(segment)
    || V3_SOURCE_NEUTRAL_DECISION_METHOD_RE.test(segment);
}

export function classifyBlogInformationStatement(segment: string): {
  category: BlogInformationStatementCategory;
  factualClassification: Pick<ExtractedBlogInformationClaim, 'claimType' | 'riskLevel' | 'candidateKind'> | null;
} {
  // Measurable, regulated, availability and other explicit fact shapes always
  // win over editorial-language allowlists. This prevents a sentence such as
  // "먼저 15분 거리인지 확인하세요" from bypassing evidence validation.
  const factualClassification = classifyClaim(segment);
  const planningText = stripItineraryStructureNumerals(segment);
  const sourceNeutralSafetyChoice = (
    V3_SOURCE_NEUTRAL_PLANNING_MODAL_RE.test(segment)
    || V3_SOURCE_NEUTRAL_DECISION_METHOD_RE.test(segment)
  )
    && !/\d|[₩￦¥￥$€₫]|\b(?:JPY|KRW|USD|VND|SGD|CNY|EUR|THB)\b/i.test(segment)
    && !REGULATED_TRAVEL_TOPIC_RE.test(segment)
    && !V3_EXPLICIT_OPERATIONAL_STATUS_RE.test(segment)
    && !V3_NAMED_PLACE_ASSERTION_RE.test(segment)
    && /(?:내|자신의|독자의|직접|기준|판단|저울질|무리)/i.test(segment);
  const unsupportedLocalEvaluation = V3_UNSUPPORTED_LOCAL_EVALUATION_RE.test(segment)
    && !sourceNeutralSafetyChoice;
  const itineraryProposal = (
    V3_ITINERARY_PROPOSAL_RE.test(segment)
    || V3_ITINERARY_SOURCE_NEUTRAL_GUIDANCE_RE.test(planningText)
    || ITINERARY_CONTINGENCY_HEADING_RE.test(planningText)
  )
    && !unsupportedLocalEvaluation
    && !/\d|[₩￦¥￥$€₫]|\b(?:JPY|KRW|USD|VND|SGD|CNY|EUR|THB)\b/i.test(planningText)
    && !REGULATED_TRAVEL_TOPIC_RE.test(segment)
    && !V3_EXPLICIT_OPERATIONAL_STATUS_RE.test(segment);
  const sourceNeutralPlanningAdvice = isSourceNeutralPlanningAdvice(
    segment,
    factualClassification,
    unsupportedLocalEvaluation,
  );
  const directDecisionGuidance = !unsupportedLocalEvaluation && (
    V3_DECISION_GUIDANCE_RE.test(segment)
      || V3_DIRECT_DECISION_ANSWER_RE.test(segment)
      || V3_SOURCE_NEUTRAL_DECISION_GUIDANCE_RE.test(segment)
      || V3_SOURCE_NEUTRAL_PLANNING_ACTION_RE.test(segment)
      || V3_ITINERARY_EDITORIAL_GUIDANCE_RE.test(segment)
      || V3_SOURCE_NEUTRAL_DECISION_METHOD_RE.test(segment)
      || V3_FOOD_BUDGET_EDITORIAL_GUIDANCE_RE.test(segment)
      || V3_FOOD_BUDGET_SCOPE_LIMITATION_RE.test(segment)
      || V3_ROUTE_DECISION_GUIDANCE_RE.test(segment)
      || V3_ROUTE_FARE_PRODUCT_GUIDANCE_RE.test(segment)
      || V3_ROUTE_SCOPE_HEADING_RE.test(segment)
  );
  const itineraryContingencyGuidance = !unsupportedLocalEvaluation
    && V3_ITINERARY_CONTINGENCY_GUIDANCE_RE.test(planningText);
  const operationalRecheckGuidance = !unsupportedLocalEvaluation
    && V3_OPERATIONAL_RECHECK_GUIDANCE_RE.test(segment);
  const reservationPlanningRecheck = !unsupportedLocalEvaluation
    && V3_RESERVATION_PLANNING_RECHECK_RE.test(segment);
  const availabilityRecheck = factualClassification?.candidateKind === 'availability_status'
    && (
      V3_AVAILABILITY_RECHECK_RE.test(segment)
      || V3_AVAILABILITY_DECISION_RE.test(segment)
      || operationalRecheckGuidance
      || reservationPlanningRecheck
    );
  if (
    factualClassification
    && !(factualClassification.candidateKind === 'requirement_prohibition' && directDecisionGuidance)
    && !(factualClassification.candidateKind === 'time_schedule' && itineraryContingencyGuidance)
    && !V3_ROUTE_FARE_PRODUCT_GUIDANCE_RE.test(segment)
    && !V3_ROUTE_SCOPE_HEADING_RE.test(segment)
    && !itineraryProposal
    && !sourceNeutralPlanningAdvice
    && !availabilityRecheck
  ) {
    return { category: 'verified_factual', factualClassification };
  }
  if (
    EDITORIAL_READING_GUIDANCE_RE.test(segment)
    || directDecisionGuidance
    || itineraryContingencyGuidance
    || operationalRecheckGuidance
    || reservationPlanningRecheck
    || itineraryProposal
    || sourceNeutralPlanningAdvice
    || availabilityRecheck
    || V3_NAVIGATION_HEADING_RE.test(segment)
    || (!unsupportedLocalEvaluation && V3_EDITORIAL_PLANNING_HEADING_RE.test(segment))
    || (!unsupportedLocalEvaluation && V3_ARTICLE_SCOPE_DESCRIPTION_RE.test(segment))
  ) {
    return { category: 'navigation_boilerplate', factualClassification: null };
  }
  if (SUBJECTIVE_EDITORIAL_RE.test(segment)) {
    return { category: 'subjective_editorial', factualClassification: null };
  }
  if (NAVIGATION_OR_BOILERPLATE_RE.test(segment)) {
    return { category: 'navigation_boilerplate', factualClassification: null };
  }
  if (unsupportedLocalEvaluation) {
    return {
      category: 'unknown_unclassified',
      factualClassification: {
        claimType: 'factual',
        riskLevel: 'MEDIUM',
        candidateKind: 'unknown_statement',
      },
    };
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
  if (kind === 'money_price' && /(?:취소|변경|예약)?\s*수수료(?:가|는|은)?\s*(?:없|무료|면제)/i.test(segment)) {
    return { normalizedValue: '0', unit: 'fee', currency: readCurrency(segment) };
  }
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
const ROUTE_DECISION_RESEARCH_BLOCK_START = '<!-- blog_decision_artifact:route_decision:v1 -->';
const ROUTE_DECISION_RESEARCH_BLOCK_END = '<!-- /blog_decision_artifact:route_decision:v1 -->';
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

/**
 * A rewrite may only copy a researched claim when the same deterministic
 * classifier used by the publish gate assigns the declared claim type.
 *
 * This deliberately fails closed for unclassified claims. Rewriting a claim
 * type here would create new evidence semantics; excluding it keeps the
 * research packet and the final ledger on the same contract instead.
 */
export function inspectBlogInformationClaimTypeCompatibility(
  claimText: string,
  declaredType: BlogInformationClaimType,
): BlogInformationClaimTypeCompatibility {
  const deterministicClaim = extractBlogInformationClaims(claimText)[0] ?? null;
  return {
    passed: deterministicClaim?.claimType === declaredType,
    declaredType,
    deterministicType: deterministicClaim?.claimType ?? null,
    candidateKind: deterministicClaim?.candidateKind ?? null,
  };
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
        riskLevel: extractBlogInformationClaims(claim.claimText ?? '')[0]?.riskLevel
          ?? ('MEDIUM' as const),
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
      input.markdown.includes(ROUTE_DECISION_RESEARCH_BLOCK_START)
      && input.markdown.includes(ROUTE_DECISION_RESEARCH_BLOCK_END)
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
    const riskRank: Record<BlogInformationEvidenceRiskLevel, number> = {
      LOW: 1,
      MEDIUM: 2,
      HIGH: 3,
    };
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
      const declaredRisk = declaredRiskByFingerprint.get(claim.claimFingerprint);
      if (declaredRisk && riskRank[declaredRisk] < riskRank[claim.riskLevel]) {
        issues.push({
          code: 'invalid_claim_ledger',
          claimFingerprint: claim.claimFingerprint,
          claimText: claim.claimText,
          claimType: claim.claimType,
          message: `writer claim ledger가 결정론적 위험도를 낮췄습니다: ${declaredRisk}->${claim.riskLevel}`,
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
      const derivation = persisted.extractedValue?.derivation;
      if (derivation) {
        const operandFingerprints = derivation.operandClaimFingerprints;
        const operandValues = derivation.operandValues.map((value) => Number(value));
        const result = Number(persisted.extractedValue?.normalizedValue);
        const operands = operandFingerprints.map((fingerprint) => persistedByFingerprint.get(fingerprint));
        const structurallyValid = derivation.version === 'blog-claim-derivation-v1'
          && derivation.operation === 'sum'
          && operandFingerprints.length >= 2
          && operandFingerprints.length <= 12
          && operandFingerprints.length === operandValues.length
          && operandValues.every((value) => Number.isFinite(value) && value >= 0)
          && Number.isFinite(result)
          && Math.abs(operandValues.reduce((sum, value) => sum + value, 0) - result) < 0.005
          && operands.every((operand, index) => {
            if (!operand || !['supported', 'approved'].includes(operand.validationStatus)) return false;
            const operandValue = Number(operand.extractedValue?.normalizedValue);
            if (!Number.isFinite(operandValue) || Math.abs(operandValue - operandValues[index]!) >= 0.005) return false;
            if ((operand.extractedValue?.currency ?? '') !== (persisted.extractedValue?.currency ?? '')) return false;
            return operand.evidence.some((evidence) =>
              Boolean(evidence.sourceVersionId) && isEvidenceCurrent(evidence, operand.claimType, nowMs));
          });
        if (!structurallyValid) {
          issues.push({
            code: 'invalid_derivation',
            claimFingerprint: claim.claimFingerprint,
            claimText: claim.claimText,
            claimType: claim.claimType,
            message: '파생 금액의 피연산자·통화·공식이 승인된 원천 claim과 일치하지 않습니다.',
          });
          continue;
        }
        supportedClaims += 1;
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
        // An exact fingerprint means the visible sentence is byte-for-byte the
        // approved persisted claim. Its persisted structured value already
        // passed bundle validation (including literal numeric support), while
        // re-extracting a translated factual sentence can produce a different
        // free-text value or a localized unit such as "분" vs "minutes".
        // Paraphrases never reach this branch because their fingerprint differs.
        extractedValue: persisted.extractedValue ?? claim.extractedValue,
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

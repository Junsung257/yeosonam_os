import { createHash } from 'node:crypto';

export type MasterCandidateCategory =
  | 'attraction'
  | 'hotel'
  | 'shopping'
  | 'optional_tour'
  | 'notice'
  | 'unknown';

export type MasterCandidateAutoAction =
  | 'reject_noise'
  | 'structure_non_master'
  | 'create_internal_master'
  | 'create_publishable_master'
  | 'needs_review';

export type MasterCandidatePromotionStatus =
  | 'candidate'
  | 'rejected_noise'
  | 'auto_internal'
  | 'publishable_ready'
  | 'needs_review'
  | 'promoted';

export type CandidateEvidenceInput = {
  rawLabel: string;
  category?: string | null;
  country?: string | null;
  region?: string | null;
  destination?: string | null;
  occurrenceCount?: number | null;
  evidenceCount?: number | null;
  packageCount?: number | null;
  externalSources?: CandidateExternalSource[];
};

export type CandidateExternalSource = {
  source:
    | 'wikidata'
    | 'osm'
    | 'osm_nominatim'
    | 'google_places'
    | 'official_site'
    | 'naver_search'
    | 'naver_searchad'
    | 'supplier'
    | 'manual';
  id?: string | null;
  url?: string | null;
  confidence?: number | null;
  name?: string | null;
};

export type MasterCandidateDecision = {
  candidateKey: string;
  category: MasterCandidateCategory;
  rawLabel: string;
  normalizedLabel: string;
  destinationScope: string | null;
  countryScope: string | null;
  regionScope: string | null;
  confidence: number;
  autoAction: MasterCandidateAutoAction;
  promotionStatus: MasterCandidatePromotionStatus;
  decisionReason: string;
  suggestedMaster: Record<string, unknown>;
};

const CATEGORY_SET = new Set<MasterCandidateCategory>([
  'attraction',
  'hotel',
  'shopping',
  'optional_tour',
  'notice',
  'unknown',
]);

const WRAPPER_RE = /^[\s*[({<【\[]*(?:▶|★|☆|※|ㆍ|-|\*)?\s*/;
const TRAILING_PUNCT_RE = /[\s:：,，.。;；\-–—~]+$/;
const PRICE_OR_DATE_RE = /(?:\d[\d,]*\s*(?:원|KRW|\$|USD|엔|위안|\/인|1인|성인|아동|소아)|^\d{1,2}[./월]\d{1,2}|^\d{4}[./-]\d{1,2}[./-]\d{1,2})/i;
const SECTION_HEADING_RE = /^(?:\[?\s*)?(?:포함\s*사항|불포함\s*사항|포함사항|불포함사항|포함|불포함|상품가|요금|가격|일정표|행사일정|예약\s*안내|안내사항|주의사항|공지|특전|참고사항)(?:\s*\]?)?$/i;
const MOVEMENT_ONLY_RE = /^(?:도보|이동|차량|버스|전용차량|공항|호텔|출발|도착|경유|항공사|확정|미정|체크인|체크아웃|라운딩\s*후)$/i;
const ROOM_OR_GOLF_DETAIL_RE = /(?:^\d+\s*인실(?:-|$)|스탠다드|디럭스|슈페리어|객실|룸\s*타입|기\s*내\s*박|골프장\s*정보|코스\s*정보|그린피|캐디피|카트피|캐디팁|티타임|현장\s*결제|라운딩\s*후)/i;
const OPTIONAL_RE = /(?:선택\s*관광|옵션|optional|마사지|스파|쇼|공연|크루즈|입장권|체험|라운딩|골프|케이블카\s*옵션)/i;
const SHOPPING_RE = /(?:쇼핑|면세|쇼핑센터|기념품|특산품|라텍스|잡화|진주|건강보조|차\s*판매장)/i;
const NOTICE_RE = /(?:취소|환불|비자|여권|입국|출국|천재지변|현지\s*사정|변경될\s*수|예약금|보험|불포함|포함\s*사항|안내|주의|공지|추가\s*요금)/i;
const HOTEL_RE = /(?:호텔|리조트|hotel|resort|숙박|빌라|inn|suites|스테이|민박|펜션)/i;
const ATTRACTION_HINT_RE = /(?:공원|사원|성당|교회|전망대|유적|박물관|기념관|거리|시장|해변|비치|사막|협곡|폭포|호수|동굴|케이블카|정원|궁|성|신사|천만궁|마을|타운|브릿지|부두|광장|사찰|묘|생가|전쟁기념관)/i;
const ATTRACTION_SUFFIX_RE = /(?:공원|사원|성당|교회|전망대|유적지?|박물관|기념관|거리|시장|해변|비치|협곡|폭포|호수|동굴|케이블카|정원|궁|성|신사|천만궁|마을|타운|브릿지|부두|광장|사찰|묘|생가|슈라인)$/i;
const MULTI_ATTRACTION_RE = /(?:[,，+]|\s\/\s| 또는 | 중\s*1곳| 관광\s*\()/i;
const DESCRIPTIVE_PHRASE_RE = /(?:관광|감상|방문|코스|즐기기|제공|생산|유명|가장|듯한|아름다운|이국적인|상징|절경|꼽히며|볼거리|필수|성지|명소|곳$)/i;

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}

export function normalizeCandidateLabel(value: string): string {
  return value
    .replace(/\r?\n+/g, ' ')
    .replace(WRAPPER_RE, '')
    .replace(TRAILING_PUNCT_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function masterCandidateKey(input: {
  category: string;
  normalizedLabel: string;
  destinationScope?: string | null;
  countryScope?: string | null;
  regionScope?: string | null;
}): string {
  const scope = [
    input.countryScope ?? '',
    input.regionScope ?? '',
    input.destinationScope ?? '',
  ].map(part => normalizeCandidateLabel(part).toLowerCase()).join('|');
  const material = [
    input.category,
    normalizeCandidateLabel(input.normalizedLabel).toLowerCase(),
    scope,
  ].join('::');
  const hash = createHash('sha1').update(material).digest('hex').slice(0, 18);
  return `${input.category}:${hash}`;
}

function standardCategory(value?: string | null): MasterCandidateCategory {
  return CATEGORY_SET.has(value as MasterCandidateCategory)
    ? value as MasterCandidateCategory
    : 'unknown';
}

function hasReliableExternalSource(input: CandidateEvidenceInput): boolean {
  const sources = input.externalSources ?? [];
  const strongSources = sources.filter(source =>
    (source.confidence ?? 0.75) >= 0.7 && (source.id || source.url),
  );
  const identityKinds = new Set(
    strongSources
      .filter(source => (
        source.source === 'wikidata' ||
        source.source === 'osm' ||
        source.source === 'osm_nominatim' ||
        source.source === 'google_places' ||
        source.source === 'official_site' ||
        source.source === 'manual'
      ))
      .map(source => source.source),
  );
  const supportKinds = new Set(strongSources.map(source => source.source));

  return identityKinds.size >= 1 && supportKinds.size >= 2;
}

function inferCategory(input: CandidateEvidenceInput, normalizedLabel: string): MasterCandidateCategory {
  const current = standardCategory(input.category);
  if (current !== 'unknown') return current;
  if (HOTEL_RE.test(normalizedLabel)) return 'hotel';
  if (SHOPPING_RE.test(normalizedLabel)) return 'shopping';
  if (OPTIONAL_RE.test(normalizedLabel)) return 'optional_tour';
  if (NOTICE_RE.test(normalizedLabel)) return 'notice';
  if (ATTRACTION_HINT_RE.test(normalizedLabel)) return 'attraction';
  return normalizedLabel.length >= 3 ? 'attraction' : 'unknown';
}

const STANDALONE_COMPOUND_SUFFIXES = [
  '\uACF5\uC6D0',
  '\uC2DC\uC7A5',
  '\uB9C8\uCF13',
  '\uC81C\uC804',
  '\uC628\uCC9C',
  '\uD3ED\uD3EC',
  '\uD638\uC218',
  '\uBE44\uCE58',
  '\uD574\uBCC0',
  '\uD654\uC6D0',
];
const TWO_TOKEN_ATTRACTION_SUFFIXES = [
  ...STANDALONE_COMPOUND_SUFFIXES,
  '\uC800\uD0DD',
  '\uC131\uB2F9',
  '\uC0AC\uC6D0',
  '\uC2E0\uC0AC',
  '\uB9C8\uC744',
  '\uC804\uB9DD\uB300',
  '\uD611\uACE1',
  '\uC720\uB9AC\uB2E4\uB9AC',
  '\uC6CC\uD130\uD30C\uD06C',
];

function isHangulToken(value: string): boolean {
  return /^[\uAC00-\uD7A3]+$/u.test(value);
}

function endsWithAny(value: string, suffixes: string[]): boolean {
  return suffixes.some(suffix => value.endsWith(suffix));
}

function cleanExtractedAttractionLabel(value: string | undefined): string | null {
  if (!value) return null;
  let clean = normalizeCandidateLabel(value)
    .replace(/^(?:관광|탐방|방문|투어|코스|일정)\s+/i, '')
    .replace(/\s*(?:관광|탐방|방문)$/i, '')
    .replace(/[.。]+$/g, '')
    .trim();
  if (!clean) return null;

  const tokens = clean.split(/\s+/).filter(Boolean);
  const lastToken = tokens.at(-1) ?? '';
  if (tokens.length >= 2 && lastToken.length >= 4 && isHangulToken(lastToken) && endsWithAny(lastToken, STANDALONE_COMPOUND_SUFFIXES)) {
    clean = lastToken;
  } else
  if (tokens.length >= 2 && endsWithAny(lastToken, TWO_TOKEN_ATTRACTION_SUFFIXES)) {
    clean = lastToken.length >= 4 && isHangulToken(lastToken) && endsWithAny(lastToken, STANDALONE_COMPOUND_SUFFIXES)
      ? lastToken
      : tokens.slice(-2).join(' ');
  } else if (tokens.length >= 2 && /(?:인|의|한|중|약|해발|산비탈|지형|으뜸|아름다운|자태를|뽐내는)$/i.test(tokens.at(-2) ?? '')) {
    clean = tokens.at(-1) ?? clean;
  }

  if (clean.length < 2 || clean.length > 24) return null;
  if (/[+/,，]/.test(clean)) return null;
  if (/^(?:관광|탐방|방문|투어|코스|시내관광|일정|날짜|해발|산비탈|유럽풍|건축물)$/i.test(clean)) return null;
  if (/(?:입니다|합니다|가능|기준|동일|별도|문의|금액|요금|항공|출발|도착|날씨|선크림|환율)/i.test(clean)) return null;
  return clean;
}

function extractAttractionLabelFromDescription(normalizedLabel: string): string | null {
  const bracketMatch = normalizedLabel.match(/\[([^\]]{2,40})\]/);
  const bracketLabel = cleanExtractedAttractionLabel(bracketMatch?.[1]);
  if (bracketLabel) return bracketLabel;

  const parentheticalMatch = normalizedLabel.match(/\(([^()]{2,40})\)/);
  const parentheticalLabel = cleanExtractedAttractionLabel(parentheticalMatch?.[1]);
  if (parentheticalLabel) return parentheticalLabel;

  const dashMatch = normalizedLabel.match(/[-–—]\s*([^(){}\[\]+,/，]{2,30})$/u);
  const dashLabel = cleanExtractedAttractionLabel(dashMatch?.[1]);
  if (dashLabel) return dashLabel;

  const knownNameMatch = normalizedLabel.match(/(깟깟마을|성바울\s*성당|천문동|판시판산|아오이\s*이케|코코넛\s*수용소|도잔\s*신사|아쿠아토피아\s*워터파크)/u);
  const knownName = cleanExtractedAttractionLabel(knownNameMatch?.[1]);
  if (knownName) return knownName;

  const firstPlusSegment = normalizedLabel.split(/[+，,]/u)[0]?.trim();
  if (firstPlusSegment && /(?:관광|탐방|방문)$/i.test(firstPlusSegment)) {
    const label = cleanExtractedAttractionLabel(firstPlusSegment.replace(/\s*(?:관광|탐방|방문)$/i, ''));
    if (label) return label;
  }

  const tourismSegments = normalizedLabel
    .split(/[▶#ㆍ]+/u)
    .map(segment => segment.trim())
    .filter(segment => /(?:관광|탐방|방문)$/i.test(segment));
  for (const segment of tourismSegments) {
    const withoutVerb = segment.replace(/\s*(?:관광|탐방|방문)$/i, '');
    const label = cleanExtractedAttractionLabel(withoutVerb);
    if (label) return label;
  }

  const trailingTourism = normalizedLabel.match(/([^\s#▶ㆍ()]{2,24})\s*(?:관광|탐방|방문)$/i);
  const trailingLabel = cleanExtractedAttractionLabel(trailingTourism?.[1]);
  if (trailingLabel) return trailingLabel;

  const suffixMatch = normalizedLabel.match(/([\p{L}\p{N}\s]{2,40}(?:신사|제전|화원|유리다리|워터파크|마을|공원|시장|마켓|전망대|협곡|폭포|호수|온천))$/u);
  const suffixLabel = cleanExtractedAttractionLabel(suffixMatch?.[1]);
  if (suffixLabel) return suffixLabel;

  return null;
}

function deriveAttractionMasterLabel(normalizedLabel: string): string {
  const extracted = extractAttractionLabelFromDescription(normalizedLabel);
  if (extracted) return extracted;

  if (MULTI_ATTRACTION_RE.test(normalizedLabel)) return normalizedLabel;

  const tokens = normalizedLabel.split(/\s+/).filter(Boolean);
  const lastToken = tokens.at(-1);
  if (lastToken && ATTRACTION_SUFFIX_RE.test(lastToken) && lastToken.length >= 3) {
    return lastToken;
  }

  const suffixMatches = normalizedLabel.match(/([가-힣A-Za-z0-9·\s]{2,24}(?:공원|사원|성당|교회|전망대|유적지?|박물관|기념관|거리|시장|해변|비치|협곡|폭포|호수|동굴|케이블카|정원|궁|성|신사|천만궁|마을|타운|브릿지|부두|광장|사찰|묘|생가|슈라인))/gi);
  const candidate = suffixMatches?.at(-1);
  if (!candidate) return normalizedLabel;

  const cleaned = normalizeCandidateLabel(candidate)
    .replace(/^.*인\s+/, '')
    .replace(/^(?:명소|필수|방문|코스|성지|놀이터)\s+/, '');
  return cleaned.length >= 3 ? cleaned : normalizedLabel;
}

function isUnsafeDescriptiveMasterLabel(label: string, rawLabel: string): boolean {
  if (MULTI_ATTRACTION_RE.test(rawLabel)) return true;
  if (/(?:볼거리|제공|생산|유명|절경|꼽히며)/i.test(label)) return true;
  if (!ATTRACTION_HINT_RE.test(label) && DESCRIPTIVE_PHRASE_RE.test(rawLabel)) return true;
  if (label.length > 24 && DESCRIPTIVE_PHRASE_RE.test(label)) return true;
  if (rawLabel === label && rawLabel.length > 28 && DESCRIPTIVE_PHRASE_RE.test(rawLabel)) return true;
  return false;
}

function isNonMasterNoise(normalizedLabel: string): string | null {
  if (!normalizedLabel) return 'empty label';
  if (normalizedLabel.length <= 1) return 'too short';
  if (SECTION_HEADING_RE.test(normalizedLabel)) return 'section heading';
  if (MOVEMENT_ONLY_RE.test(normalizedLabel)) return 'movement or status token';
  if (PRICE_OR_DATE_RE.test(normalizedLabel)) return 'price/date fragment';
  if (ROOM_OR_GOLF_DETAIL_RE.test(normalizedLabel)) return 'room/golf detail fragment';
  if (/^https?:\/\//i.test(normalizedLabel) || /^www\./i.test(normalizedLabel)) return 'url fragment';
  return null;
}

export function evaluateMasterCandidate(input: CandidateEvidenceInput): MasterCandidateDecision {
  const rawLabel = input.rawLabel ?? '';
  const sourceLabel = normalizeCandidateLabel(rawLabel);
  const countryScope = normalizeCandidateLabel(input.country ?? '') || null;
  const regionScope = normalizeCandidateLabel(input.region ?? '') || null;
  const destinationScope = normalizeCandidateLabel(input.destination ?? input.region ?? input.country ?? '') || null;
  const category = inferCategory(input, sourceLabel);
  const normalizedLabel = category === 'attraction' ? deriveAttractionMasterLabel(sourceLabel) : sourceLabel;
  const evidenceCount = Math.max(1, input.evidenceCount ?? 1);
  const occurrenceCount = Math.max(1, input.occurrenceCount ?? 1);
  const packageCount = Math.max(0, input.packageCount ?? 0);
  const nonMasterReason = isNonMasterNoise(normalizedLabel);
  const unsafeDescriptiveAttraction = category === 'attraction' && isUnsafeDescriptiveMasterLabel(normalizedLabel, sourceLabel);
  const externalVerified = hasReliableExternalSource(input);

  let confidence = 0.48;
  let autoAction: MasterCandidateAutoAction = 'needs_review';
  let promotionStatus: MasterCandidatePromotionStatus = 'needs_review';
  let decisionReason = 'low evidence or unclear itinerary entity';

  if (nonMasterReason) {
    confidence = 0.92;
    autoAction = nonMasterReason.includes('room/golf') ? 'structure_non_master' : 'reject_noise';
    promotionStatus = nonMasterReason.includes('room/golf') ? 'candidate' : 'rejected_noise';
    decisionReason = `not a master entity: ${nonMasterReason}`;
  } else if (category === 'shopping' || category === 'optional_tour' || category === 'notice') {
    confidence = clamp(0.62 + Math.min(0.18, evidenceCount * 0.03) + Math.min(0.1, packageCount * 0.02));
    autoAction = 'needs_review';
    promotionStatus = 'needs_review';
    decisionReason = 'customer-visible commercial or notice text requires review';
  } else if (category === 'hotel') {
    confidence = clamp(0.58 + Math.min(0.18, evidenceCount * 0.03) + (HOTEL_RE.test(normalizedLabel) ? 0.12 : 0));
    autoAction = externalVerified ? 'create_internal_master' : 'needs_review';
    promotionStatus = externalVerified ? 'auto_internal' : 'needs_review';
    decisionReason = externalVerified
      ? 'hotel candidate has external identity evidence; create internal canonical only'
      : 'hotel candidate needs external identity or admin review';
  } else if (category === 'attraction') {
    const attractionHint = ATTRACTION_HINT_RE.test(normalizedLabel);
    confidence = clamp(0.55 + Math.min(0.16, evidenceCount * 0.025) + Math.min(0.12, occurrenceCount * 0.005) + (attractionHint ? 0.12 : 0));
    if (unsafeDescriptiveAttraction && !externalVerified) {
      autoAction = 'needs_review';
      promotionStatus = 'needs_review';
      confidence = Math.min(confidence, 0.68);
      decisionReason = 'descriptive or multi-attraction phrase needs canonical extraction or external proof';
    } else if (externalVerified && confidence >= 0.82) {
      autoAction = 'create_publishable_master';
      promotionStatus = 'publishable_ready';
      decisionReason = 'attraction candidate has repeated evidence and at least two reliable external identifiers';
    } else if (confidence >= 0.7 || attractionHint) {
      autoAction = 'create_internal_master';
      promotionStatus = 'auto_internal';
      decisionReason = 'probable new attraction; create internal non-customer-publishable master candidate';
    } else {
      autoAction = 'needs_review';
      promotionStatus = 'needs_review';
      decisionReason = 'possible attraction but insufficient evidence for automatic internal master';
    }
  }

  const candidateKey = masterCandidateKey({
    category,
    normalizedLabel,
    countryScope,
    regionScope,
    destinationScope,
  });

  return {
    candidateKey,
    category,
    rawLabel,
    normalizedLabel,
    destinationScope,
    countryScope,
    regionScope,
    confidence,
    autoAction,
    promotionStatus,
    decisionReason,
    suggestedMaster: {
      label: normalizedLabel,
      category,
      country: countryScope,
      region: regionScope,
      destination: destinationScope,
      external_verified: externalVerified,
      customer_publishable: autoAction === 'create_publishable_master',
      verification_status: promotionStatus,
    },
  };
}

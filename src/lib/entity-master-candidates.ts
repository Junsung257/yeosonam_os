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

export type MasterCandidatePublicGateContract = {
  customer_publishable: boolean;
  public_gate:
    | 'blocked_until_verified'
    | 'internal_only'
    | 'publishable_ready'
    | 'non_master';
  route_impact: 'hard_blocker' | 'warning' | 'none';
  required_evidence: string[];
  operator_action: string;
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
const AIRPORT_CODE_RE = /(?:^[A-Z]{3}(?:-[A-Z]{3})?$|[A-Z]{3}-[A-Z]{3})/;
const PRODUCT_TITLE_FRAGMENT_RE = /(?:\d+\s*박|\d+\s*일|갓성(?:비)?|시내핵심|부산\s*출발|출발|패키지|노옵션|노쇼핑|품격|실속|세이브|완전정복)/i;
const OPERATIONAL_FRAGMENT_RE = /(?:한국어\s*가능\s*현지\s*가이드|한국인\s*가이드|현지\s*가이드|가이드|총길이\s*\d+\s*M|상\s*동|^\s*동일\s*$|상행|하행|에스컬레이터|쾌속\s*케이블카|탑승하여|항공|기준|문의|예약|행사|일정|도착|귀환|증명서|반드시\s*지참|유류|할증료|팁\s*별도|팁별도|제공|전통식|음료|간식|활쏘기|액티비티|이용\s*가능)/i;
const UNSAFE_ATTRACTION_LABEL_RE = /(?:가파른|울창한|신선이|하늘과\s*바다|해발\s*\d|총길이|동물의\s*세계|자연경관|머드온천$|고산초원|초원\s*캠프파이어|유명한|비밀의\s*사원$|상행|하행|에스컬레이터|쾌속)/i;

const CUSTOMER_OPERATIONAL_MASTER_FRAGMENT_RE =
  /(?:^\d+\s*분$|^\d+\s*시간\s*소요$|관광\s*\d+\s*시간\s*소요|^VIP\s*통로$|^엘리베이터$|^도보\s*산책$|^도보산책$|^총길이\s*\d+|^선택\s*관광$|^선택관광$|^여권\s*유효기간|^상기\s*일정|^상기일정|^항공료\s*및\s*텍스|^성인\s*\d+\s*명\s*이상)/i;
const CUSTOMER_DESCRIPTIVE_ONLY_FRAGMENT_RE =
  /(?:세계\s*최고의$|높은\s*의자와\s*같다고\s*하여$|본따\s*만든\s*잠들지\s*않는\s*도시$|^특전\d+\]|^\[?★?\s*특전\d+\]?)/i;
const CUSTOMER_NUMERIC_LIST_FRAGMENT_RE =
  /^(?:\d{1,2}\s*,\s*){2,}\d{1,2}$/;
const CUSTOMER_PRODUCT_PROMO_FRAGMENT_RE =
  /(?:초특가|특가로\s*떠나는|가성비\s*\d*\s*일|부관훼리|패키지|일정표|출발)/i;
const CUSTOMER_VIEW_METHOD_FRAGMENT_RE =
  /^(?:차창|차창관광|자율|자율관광|개별자유|선상유람)$/i;
const CUSTOMER_FOOD_OR_SERVICE_FRAGMENT_RE =
  /(?:^\+?\s*(?:반세오|반짱느엉|오리구이|모듬구이|닭구이|짜조|정식|세트|전통식|정규|증편|매운탕|보쌈|스테이크|씨푸드|과일|옥수수|밀크티|새우장|백\s*숙|대통밥정식|돼지갈비정식|소고기모듬|넘능세트|올유캔잇|룩락)\)?$|땅콩\s*1?\s*봉지|보토콴\s*BBQ|모닝글로리\s*볶음|고구마\s*튀(?:김|킴)|열대\s*과일\s*시식|랍스터|특식|조식|중식|석식|식사|정식|분짜|쌀국수|샤브샤브|삼겹살|불고기|구이|커피|음료|맥주|디저트)/iu;
const CUSTOMER_DANGLING_PAREN_FRAGMENT_RE =
  /(?:^[\p{L}\p{N}⁄/]{1,12}[)]$|^[\p{L}\p{N}⁄/]{1,12}[(]$)/u;
const CUSTOMER_COMMERCIAL_PLACE_RE =
  /^(?:비어\s*플라자|비어플라자|쇼핑센터|쇼핑\s*센터)$/iu;
const CUSTOMER_READABLE_SECTION_FRAGMENT_RE =
  /^(?:=>|무제한|확인|월화수목금|수목금|토일월화|토일|비운항일|외관|외부|국가\s*명승|국가\s*5A급\s*풍경구|일본\s*3대\s*송림중\s*하나인|시\s*간|식\s*사|교\s*통|텍스|여행경비|싱글차지|룸\s*타\s*입|샤워실\s*보유|수영복\s*착용\s*필수|아쿠아슈즈|여벌\s*옷|반바지|무료존|생수|공예|문화|동선|비즈니스게르(?:\(2인실)?|호화호특|크라운|핫플\s*카페|불꽃축제|불꽃놀이|봅슬레이|레일바이크|루지|모래\s*썰매|낙타|실제\s*낙타|럭셔리\s*전동카|뉴카멜리아|쓰시마링크|몽골\s*로컬\s*마트|가볍게\s*떠나고|기암괴석|광활한\s*녹차밭|가파른\s*협곡|바다와\s*산의\s*만남|물과\s*빛|포\s*함\s*사\s*항|포\s*함\s*내\s*역|불\s*포\s*함(?:\s*내\s*역)?|비\s*고|일\s*자|요\s*금|상품\s*가|테마\s*파크)$/iu;
const CUSTOMER_DISCLOSURE_PRICE_OR_FEE_RE =
  /(?:\d[\d,]*\s*(?:\uC6D0|\uB9CC\uC6D0|USD|US\$|\$|KRW)|\uBCC4\uB3C4\s*(?:\uBE44\uC6A9|\uACB0\uC81C|\uBB38\uC758)|\uD604\uC9C0\s*\uACB0\uC81C|\uC720\uB8CC|\uC694\uAE08|\uBE44\uC6A9)/iu;
const LOW_RISK_OPTION_DESCRIPTIVE_FRAGMENT_RE =
  /(?:KISS\s*OF\s*THE\s*SEA\s*SHOW|\uC544\uC774\uBD80\uD130\s*\uC5B4\uB978\uAE4C\uC9C0|\uBAA8\uB450\uAC00\s*\uB9CC\uC871\uD558\uB294|\uBA40\uD2F0\uBBF8\uB514\uC5B4\s*\uC57C\uAC04\s*\uC1FC|\uC74C\uC545\uACFC\s*\uBD88\uAF43|\uC5B4\uC6B0\uB7EC\uC9C4\s*\uD37C\uD3EC\uBA3C\uC2A4|\uC544\uD2B8\s*\uD37C\uD3EC\uBA3C\uC2A4\s*\uACF5\uC5F0|\uB291\uB300\uAC00\s*\uCD9C\uC5F0|\uC2A4\uB9B4\uACFC\s*\uC0DD\uB3D9\uAC10|\uD478\uAFB8\uC625.{0,12}\uC1FC)/iu;
const LOW_RISK_NOTICE_NON_MASTER_RE =
  /(?:\uC778\uC194\uC790\s*\uBBF8\uB3D9\uD589|\uD30C\uD0C0\uC57C\s*\uD574\uBCC0.{0,8}\uAE08\uC5F0|\uC804\uC790\uB2F4\uBC30.{0,6}\uBD88\uAC00|\uC816\uC744\s*\uC218\s*\uC788\uB294\s*\uC637|\uC218\uC601\uBCF5\s*\uC900\uBE44)/u;
const LOW_RISK_SHOPPING_DESCRIPTION_RE =
  /(?:\uD2B9\uC0B0\uD488|\uD1A0\uC0B0\uD488|\uD6C4\uCD94\s*\uB18D\uC7A5|\uB300\uD45C\s*\uC0C1\uD488|\uAE30\uB150\uD488)/u;
const OPERATOR_COMPANY_FRAGMENT_RE =
  /^(?:FA\s*\uCF54\uB9AC\uC544|[A-Z]{2,}\s*\uCF54\uB9AC\uC544)$/iu;
const CUSTOMER_DISCLOSURE_TABLE_FRAGMENT_RE =
  /^(?:\uBD80\s*\uC0B0|\uC778\s*\uC6D0|\uD310\s*\uB9E4\s*\uAC00|\uCD9C\s*\uBC1C\s*\uC77C|\uC778\s*1\s*\uC2E4|1\s*\uC778\s*\d{2,6}|\d+\s*\uBD80\s*TEE\s*\uC870\uAC74)$/iu;
const CUSTOMER_DISCLOSURE_POLICY_FRAGMENT_RE =
  /(?:\uD604\uAE08\uC601\uC218\uC99D\s*\uBC1C\uAE09\s*\uC548\uB0B4|\uB098\uBA38\uC9C0\s*\uC778\uC6D0\uB3C4\s*\uCD94\uAC00\s*\uAE08\uC561\s*\uBC1C\uC0DD)/u;
const CUSTOMER_DISCLOSURE_GENERIC_HOTEL_FRAGMENT_RE =
  /^(?:\uD544\uB9AC\uD540|\uBCA0\uD2B8\uB0A8|\uC77C\uBCF8|\uC911\uAD6D|\uD0DC\uAD6D|\uD64D\uCF69)?\s*\uD638\uD154$/u;
const CUSTOMER_CURRENT_BACKLOG_GENERIC_NON_MASTER_RE =
  /^(?:케이블카\s*편도|궁전\s*게르(?:\s*\(?\s*2\s*인\s*실)?|대성당|오후\s*플레이\s*욕장)$/u;
const CUSTOMER_CURRENT_BACKLOG_DESCRIPTIVE_NON_MASTER_RE =
  /(?:세계에서\s*두\s*번째|해상\s*케이블카\s*왕복\s*티켓|동양의\s*유럽\s*마을|푸꾸옥의\s*작은\s*유럽|각종\s*동물쇼|다채로운\s*볼거리|소선이\s*신선을\s*만난|건축물들이\s*보전|공룡화석이\s*전시)/u;
const CUSTOMER_READABLE_BACKLOG_GENERIC_NON_MASTER_RE =
  /^(?:\uD638\uD551\uC2E0\uCCAD\uC2DC|\uC774\uB860\s*\uAD50\uC721|\uD55C\uC57D\uBC29\s*\uC911\s*2\uD68C|\uC9DA\uCC28\s*OR\s*7\uC778\uC2B9|\uCC9C\uC800\uC6B0\s*\uC2DC\uB0B4|\uC774\uB3C4\uBC31\uD558\uC11C\s*\uD30C)$/u;
const CUSTOMER_READABLE_BACKLOG_DESCRIPTIVE_NON_MASTER_RE =
  /(?:\uC911\uAD6D\s*\uC120\uC885\uC744\s*\uB300\uD45C\uD558\uB294\s*\uCC9C\uB144\uACE0\uCC30|\uCE6D\uB2E4\uC624\uC5D0\uC11C\s*\uB9CC\uB098\uB294\s*\uC791\uC740\s*\uC720\uB7FD|\uBE5B\uC73C\uB85C\s*\uBB3C\uB4E0\s*\uACC4\uB9BC\uC758\s*\uBC24|\uC0B0\uCC45\uB85C\uB97C\s*\uB530\uB77C\s*\uC790\uC720\uB86D\uAC8C\s*\uB3D9\uBB3C\uC6D0|\uC77C\uBCF8\uC774\s*\uD328\uB9DD\uD55C|\uB9AC\uC544\uC2A4\uC2DD\uD574\uC548\s*\uC544\uC18C\uB9CC\uC744\s*\uBCFC\s*\uC218\s*\uC788\uB294|\uC790\uC5F0\s*\uACBD\uAD00\uC744|\uC804\uACBD$|\uC0BC\uD310\uBC30\uB97C\s*\uD0C0\uACE0.*\uC790\uC5F0\uACBD\uAD00|\uC81C2\uCC28\s*\uC138\uACC4\uB300\uC804.*\uC790\uC774\uC2B9\s*\uC2B9\uC804\uD0D1)/u;
const CUSTOMER_READABLE_ROUTE_OR_GENERIC_NON_MASTER_RE =
  /^(?:\uBC1C\uAD8C|\uC720\s*\uD6C4\s*\uC778|\uB098\uC774\uD2B8\s*\uB9C8\uCF13|\uC57C\uC2DC\uC7A5)$/u;

const READABLE_KNOWN_ATTRACTION_LABELS = [
  '패치워크의 길',
  '간몬대교',
  '천하제일교',
  '진달래광장',
  '고산화원',
  '금강대협곡',
  '금편계곡',
  '천문호선쇼',
  '천문산',
  '사오비치',
  '캠비치',
  '소나씨 야시장',
  '부용진',
  '칠성산',
  '곡강유적지 공원',
  '호이안 구시가지',
  '한시장',
  '도야 불꽃놀이',
  '오타루운하',
  '성요셉 대성당',
  '청의 호수',
  '광동회관',
  '링엄사',
  '해수관음 보살상',
  '코코넛 빌리지',
  '핑크성당',
  '안호이교',
];

function isReadableKnownAttractionName(value: string): boolean {
  const cleanValue = value.replace(/\s+/g, ' ').trim();
  return READABLE_KNOWN_ATTRACTION_LABELS.some(label => label === cleanValue);
}

function findReadableKnownAttractionName(value: string): string | null {
  const cleanValue = value.replace(/\s+/g, ' ').trim();
  const segments = [
    cleanValue,
    ...cleanValue.split(/[()[\],/，]+/u).map(segment => segment.trim()).filter(Boolean),
  ];
  for (const label of READABLE_KNOWN_ATTRACTION_LABELS) {
    if (segments.some(segment => segment.includes(label))) return label;
  }
  return null;
}

function countReadableKnownAttractionNames(value: string): number {
  const cleanValue = value.replace(/\s+/g, ' ').trim();
  return READABLE_KNOWN_ATTRACTION_LABELS.filter(label => cleanValue.includes(label)).length;
}

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

export function mergeCandidateExternalSources(sources: CandidateExternalSource[]): CandidateExternalSource[] {
  const seen = new Set<string>();
  const result: CandidateExternalSource[] = [];
  for (const source of sources) {
    const sourceName = source.source || 'supplier';
    const key = [
      sourceName,
      source.id ?? '',
      source.url ?? '',
      source.name ?? '',
      source.confidence ?? '',
    ].join('|').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      source: sourceName,
      id: source.id ?? null,
      url: source.url ?? null,
      confidence: typeof source.confidence === 'number' ? source.confidence : null,
      name: source.name ?? null,
    });
  }
  return result;
}

function publicGateContract(input: {
  category: MasterCandidateCategory;
  autoAction: MasterCandidateAutoAction;
  promotionStatus: MasterCandidatePromotionStatus;
  externalVerified: boolean;
}): MasterCandidatePublicGateContract {
  if (input.autoAction === 'reject_noise' || input.autoAction === 'structure_non_master') {
    return {
      customer_publishable: false,
      public_gate: 'non_master',
      route_impact: 'none',
      required_evidence: [],
      operator_action: 'keep out of customer master data; preserve source evidence only',
    };
  }

  if (input.autoAction === 'create_publishable_master' && input.externalVerified) {
    return {
      customer_publishable: true,
      public_gate: 'publishable_ready',
      route_impact: 'none',
      required_evidence: [],
      operator_action: 'admin may publish after route proof and snapshot regeneration',
    };
  }

  if (input.autoAction === 'create_internal_master') {
    return {
      customer_publishable: false,
      public_gate: 'internal_only',
      route_impact: input.category === 'attraction' || input.category === 'hotel' ? 'warning' : 'hard_blocker',
      required_evidence: [
        'independent identity source such as Wikidata, OSM, official site, Google Places, or manual approval',
        'destination/region fit evidence',
        'fresh customer route proof after promotion',
      ],
      operator_action: 'keep as hidden internal candidate until verified; never expose in customer payload',
    };
  }

  return {
    customer_publishable: false,
    public_gate: 'blocked_until_verified',
    route_impact: input.category === 'attraction' || input.category === 'hotel' ? 'warning' : 'hard_blocker',
    required_evidence: [
      'source span from supplier itinerary or admin review',
      'identity evidence or explicit non-master classification',
      'fresh public snapshot after resolution',
    ],
    operator_action: input.promotionStatus === 'needs_review'
      ? 'manual review required before customer publication'
      : 'resolve candidate state before customer publication',
  };
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
    .replace(/^(?:또는|및|등)\s+/i, '')
    .replace(/\s*(?:관광|방문|관람|등정|야경관광|도보산책)$/i, '')
    .replace(/^(?:관광|탐방|방문|투어|코스|일정)\s+/i, '')
    .replace(/\s*(?:관광|탐방|방문)$/i, '')
    .replace(/[.。]+$/g, '')
    .trim();
  if (!clean) return null;
  if (/부이페스트\s*바자\s*나이트\s*마켓/u.test(clean)) return '부이페스트 바자 나이트 마켓';

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
  if (CUSTOMER_VIEW_METHOD_FRAGMENT_RE.test(clean)) return null;
  if (/[+/,，]/.test(clean)) return null;
  if (/^(?:관광|탐방|방문|투어|코스|시내관광|일정|날짜|해발|산비탈|유럽풍|건축물)$/i.test(clean)) return null;
  if (/(?:입니다|합니다|가능|기준|동일|별도|문의|금액|요금|항공|출발|도착|날씨|선크림|환율)/i.test(clean)) return null;
  return clean;
}

function extractPrefixBeforeParenthetical(normalizedLabel: string): string | null {
  const match = normalizedLabel.match(/^(.{2,40}?)\s*\([^()]{2,40}\)/u);
  const prefix = cleanExtractedAttractionLabel(match?.[1]);
  if (!prefix) return null;
  const tokenCount = prefix.split(/\s+/).filter(Boolean).length;
  if (prefix.length > 14 || tokenCount > 2) return null;
  if (DESCRIPTIVE_PHRASE_RE.test(prefix) && !ATTRACTION_HINT_RE.test(prefix)) return null;
  return prefix;
}

function extractAttractionLabelFromDescription(normalizedLabel: string): string | null {
  const parentheticalPrefix = extractPrefixBeforeParenthetical(normalizedLabel);
  if (parentheticalPrefix) return parentheticalPrefix;

  const knownNameBeforeBracket = normalizedLabel.match(/(부이페스트\s*바자\s*나이트\s*마켓|빈\s*사파리월드|소나시\s*야시장|동강호풍경구|무앙보란|오부치사사바|칭기스칸\s*기마동상|머드온천|유노하나|쇼화신산\s*활화산|신잔\s*활화산|비천산\s*구룡수채뗏목|백산수\s*공장|백산수공장)/u);
  const knownNameBeforeBracketLabel = cleanExtractedAttractionLabel(knownNameBeforeBracket?.[1]);
  if (knownNameBeforeBracketLabel) return knownNameBeforeBracketLabel;

  const bracketMatch = normalizedLabel.match(/\[([^\]]{2,40})\]/);
  const bracketLabel = cleanExtractedAttractionLabel(bracketMatch?.[1]);
  if (bracketLabel) return bracketLabel;

  if (/\uD328\uCE58\uC6CC\uD06C\uC758\s*\uAE38/u.test(normalizedLabel)) return '\uD328\uCE58\uC6CC\uD06C\uC758 \uAE38';
  if (/천문호선쇼/u.test(normalizedLabel)) return '천문호선쇼';
  const readableKnownName = cleanExtractedAttractionLabel(findReadableKnownAttractionName(normalizedLabel) ?? undefined);
  if (readableKnownName) return readableKnownName;

  const parentheticalMatch = normalizedLabel.match(/\(([^()]{2,40})\)/);
  const parentheticalLabel = cleanExtractedAttractionLabel(parentheticalMatch?.[1]);
  if (parentheticalLabel) return parentheticalLabel;

  const dashMatch = normalizedLabel.match(/[-–—]\s*([^(){}\[\]+,/，]{2,30})$/u);
  const dashLabel = cleanExtractedAttractionLabel(dashMatch?.[1]);
  if (dashLabel) return dashLabel;

  const knownNameMatch = normalizedLabel.match(/(깟깟마을|성바울\s*성당|천문동|판시판산|아오이\s*이케|코코넛\s*수용소|도잔\s*신사|아쿠아토피아\s*워터파크|빈\s*사파리월드|소나시\s*야시장|부이페스트\s*바자\s*나이트\s*마켓|동강호풍경구|무앙보란|오부치사사바|칭기스칸\s*기마동상|머드온천|유노하나|쇼화신산\s*활화산|신잔\s*활화산|비천산\s*구룡수채뗏목|백산수\s*공장|백산수공장)/u);
  const knownName = cleanExtractedAttractionLabel(knownNameMatch?.[1]);
  if (knownName) return knownName;

  const namedByDescription = normalizedLabel.match(/(?:불리는|대표\s*(?:산책\s*)?명소)\s+([가-힣A-Za-z·\s]{2,24})$/u);
  const namedByDescriptionLabel = cleanExtractedAttractionLabel(namedByDescription?.[1]);
  if (namedByDescriptionLabel) return namedByDescriptionLabel;

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

  const suffixMatch = normalizedLabel.match(/([\p{L}\p{N}\s]{2,40}(?:신사|제전|화원|유리다리|워터파크|마을|공원|시장|마켓|전망대|협곡|폭포|호수|온천|풍경구|활화산|기마동상|공장))$/u);
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
    if (tokens.length === 2) return tokens.join(' ');
    return lastToken;
  }

  const suffixMatches = normalizedLabel.match(/([가-힣A-Za-z0-9·\s]{2,24}(?:공원|사원|성당|교회|전망대|유적지?|박물관|기념관|거리|시장|해변|비치|협곡|폭포|호수|동굴|케이블카|정원|궁|성|신사|천만궁|마을|타운|브릿지|부두|광장|사찰|묘|생가|슈라인|풍경구|활화산|기마동상|공장))/gi);
  const candidate = suffixMatches?.at(-1);
  if (!candidate) return normalizedLabel;

  const cleaned = normalizeCandidateLabel(candidate)
    .replace(/^.*인\s+/, '')
    .replace(/^(?:명소|필수|방문|코스|성지|놀이터)\s+/, '');
  return cleaned.length >= 3 ? cleaned : normalizedLabel;
}

function isUnsafeDescriptiveMasterLabel(label: string, rawLabel: string): boolean {
  if (countReadableKnownAttractionNames(rawLabel) > 1) return true;
  if (isReadableKnownAttractionName(label)) return false;
  if (MULTI_ATTRACTION_RE.test(rawLabel)) return true;
  if (/(?:볼거리|제공|생산|유명|절경|꼽히며)/i.test(label)) return true;
  if (UNSAFE_ATTRACTION_LABEL_RE.test(label) || UNSAFE_ATTRACTION_LABEL_RE.test(rawLabel)) return true;
  if (!ATTRACTION_HINT_RE.test(label) && DESCRIPTIVE_PHRASE_RE.test(rawLabel)) return true;
  if (label.length > 24 && DESCRIPTIVE_PHRASE_RE.test(label)) return true;
  if (rawLabel === label && rawLabel.length > 28 && DESCRIPTIVE_PHRASE_RE.test(rawLabel)) return true;
  return false;
}

function isNonMasterNoise(normalizedLabel: string): string | null {
  if (!normalizedLabel) return 'empty label';
  if (normalizedLabel.length <= 1) return 'too short';
  if (CUSTOMER_DANGLING_PAREN_FRAGMENT_RE.test(normalizedLabel)) return 'dangling parenthetical fragment';
  if (CUSTOMER_FOOD_OR_SERVICE_FRAGMENT_RE.test(normalizedLabel)) return 'food or service fragment';
  if (SECTION_HEADING_RE.test(normalizedLabel)) return 'section heading';
  if (MOVEMENT_ONLY_RE.test(normalizedLabel)) return 'movement or status token';
  if (AIRPORT_CODE_RE.test(normalizedLabel)) return 'airport code fragment';
  if (PRICE_OR_DATE_RE.test(normalizedLabel)) return 'price/date fragment';
  if (CUSTOMER_NUMERIC_LIST_FRAGMENT_RE.test(normalizedLabel)) return 'date/list fragment';
  if (CUSTOMER_PRODUCT_PROMO_FRAGMENT_RE.test(normalizedLabel)) return 'product title fragment';
  if (CUSTOMER_READABLE_SECTION_FRAGMENT_RE.test(normalizedLabel)) return 'readable section or generic fragment';
  if (CUSTOMER_CURRENT_BACKLOG_GENERIC_NON_MASTER_RE.test(normalizedLabel)) return 'readable section or generic fragment';
  if (CUSTOMER_READABLE_BACKLOG_GENERIC_NON_MASTER_RE.test(normalizedLabel)) return 'readable section or generic fragment';
  if (CUSTOMER_READABLE_ROUTE_OR_GENERIC_NON_MASTER_RE.test(normalizedLabel)) return 'readable section or generic fragment';
  if (CUSTOMER_OPERATIONAL_MASTER_FRAGMENT_RE.test(normalizedLabel)) return 'operational schedule fragment';
  if (CUSTOMER_DESCRIPTIVE_ONLY_FRAGMENT_RE.test(normalizedLabel)) return 'descriptive schedule fragment';
  if (CUSTOMER_CURRENT_BACKLOG_DESCRIPTIVE_NON_MASTER_RE.test(normalizedLabel)) return 'descriptive schedule fragment';
  if (CUSTOMER_READABLE_BACKLOG_DESCRIPTIVE_NON_MASTER_RE.test(normalizedLabel)) return 'descriptive schedule fragment';
  if (CUSTOMER_VIEW_METHOD_FRAGMENT_RE.test(normalizedLabel)) return 'viewing method fragment';
  if (CUSTOMER_COMMERCIAL_PLACE_RE.test(normalizedLabel)) return 'commercial place fragment';
  if (ROOM_OR_GOLF_DETAIL_RE.test(normalizedLabel)) return 'room/golf detail fragment';
  if (/^#/.test(normalizedLabel)) return 'hashtag or destination tag';
  if (/^(?:놀이공원|옛거리|케이블카|온천|시장|비치|해변|공원|사원|성당|볼거리)$/.test(normalizedLabel)) return 'generic attraction type token';
  if (/^漠\s*:?\s*상\s*동$/i.test(normalizedLabel)) return 'corrupted repeat marker';
  if (PRODUCT_TITLE_FRAGMENT_RE.test(normalizedLabel)) return 'product title fragment';
  if (OPERATIONAL_FRAGMENT_RE.test(normalizedLabel)) return 'operational schedule fragment';
  if (/^https?:\/\//i.test(normalizedLabel) || /^www\./i.test(normalizedLabel)) return 'url fragment';
  return null;
}

function customerDisclosureNonMasterReason(
  category: MasterCandidateCategory,
  normalizedLabel: string,
  sourceLabel: string,
): string | null {
  const combined = `${sourceLabel} ${normalizedLabel}`;
  if (OPERATOR_COMPANY_FRAGMENT_RE.test(normalizedLabel) || OPERATOR_COMPANY_FRAGMENT_RE.test(sourceLabel)) {
    return 'supplier or operator company token, not a master entity';
  }
  if (
    (category === 'optional_tour' || category === 'notice' || category === 'unknown') &&
    CUSTOMER_DISCLOSURE_TABLE_FRAGMENT_RE.test(normalizedLabel)
  ) {
    return 'price table header or value fragment, not a master entity';
  }
  if (
    (category === 'optional_tour' || category === 'notice') &&
    CUSTOMER_DISCLOSURE_POLICY_FRAGMENT_RE.test(combined)
  ) {
    return 'source-backed customer policy fragment, not a master entity';
  }
  if (
    (category === 'optional_tour' || category === 'hotel' || category === 'unknown') &&
    CUSTOMER_DISCLOSURE_GENERIC_HOTEL_FRAGMENT_RE.test(normalizedLabel)
  ) {
    return 'generic hotel category fragment, not a master entity';
  }
  if (category === 'notice' && LOW_RISK_NOTICE_NON_MASTER_RE.test(combined)) {
    return 'low-risk notice or preparation detail, not a master entity';
  }
  if (
    category === 'optional_tour' &&
    LOW_RISK_OPTION_DESCRIPTIVE_FRAGMENT_RE.test(combined) &&
    !CUSTOMER_DISCLOSURE_PRICE_OR_FEE_RE.test(combined)
  ) {
    return 'option show description without price evidence, not a master entity';
  }
  if (
    category === 'shopping' &&
    LOW_RISK_SHOPPING_DESCRIPTION_RE.test(combined) &&
    !CUSTOMER_DISCLOSURE_PRICE_OR_FEE_RE.test(combined)
  ) {
    return 'shopping description without price evidence, not a master entity';
  }
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
  const rawNonMasterReason = isNonMasterNoise(normalizedLabel);
  const combinedCustomerDisclosureLabel = `${sourceLabel} ${normalizedLabel}`;
  const customerDisclosureWithPriceClaim =
    (category === 'optional_tour' || category === 'shopping' || category === 'notice') &&
    CUSTOMER_DISCLOSURE_PRICE_OR_FEE_RE.test(combinedCustomerDisclosureLabel) &&
    /(?:[A-Za-z]{2,}|[\uAC00-\uD7A3]{2,})/u.test(combinedCustomerDisclosureLabel);
  const nonMasterReason = customerDisclosureWithPriceClaim ? null : rawNonMasterReason;
  const customerNonMasterReason = customerDisclosureNonMasterReason(category, normalizedLabel, sourceLabel);
  const unsafeDescriptiveAttraction = category === 'attraction' && isUnsafeDescriptiveMasterLabel(normalizedLabel, sourceLabel);
  const externalVerified = hasReliableExternalSource(input);

  let confidence = 0.48;
  let autoAction: MasterCandidateAutoAction = 'needs_review';
  let promotionStatus: MasterCandidatePromotionStatus = 'needs_review';
  let decisionReason = 'low evidence or unclear itinerary entity';

  if (nonMasterReason || customerNonMasterReason) {
    const terminalReason = nonMasterReason || customerNonMasterReason || 'non-master fragment';
    confidence = 0.92;
    autoAction = terminalReason.includes('room/golf') || Boolean(customerNonMasterReason)
      ? 'structure_non_master'
      : 'reject_noise';
    promotionStatus = autoAction === 'structure_non_master' ? 'candidate' : 'rejected_noise';
    decisionReason = `not a master entity: ${terminalReason}`;
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
    const knownReadableAttraction = isReadableKnownAttractionName(normalizedLabel);
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
    } else if (attractionHint || knownReadableAttraction) {
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
  const publicGate = publicGateContract({
    category,
    autoAction,
    promotionStatus,
    externalVerified,
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
      customer_publishable: publicGate.customer_publishable,
      verification_status: promotionStatus,
      public_gate: publicGate,
    },
  };
}

import {
  evaluateMasterCandidate,
  normalizeCandidateLabel,
  type CandidateExternalSource,
  type MasterCandidateAutoAction,
  type MasterCandidatePromotionStatus,
} from '@/lib/entity-master-candidates';
import { verifyNaverEntityName, type NaverEntityVerificationResult } from '@/lib/naver-entity-verifier';
import {
  getGooglePlacesBudgetFromEnv,
  verifyGooglePlacesEntityName,
  type GooglePlacesBudget,
  type GooglePlacesVerificationResult,
} from '@/lib/google-places-entity-verifier';
import {
  verifyOsmNominatimEntityName,
  type OsmNominatimVerificationResult,
} from '@/lib/osm-nominatim-entity-verifier';
import { reconcilePlaceName, type ReconciledEntity } from '@/lib/wikidata-reconcile';

export type EntityCandidateRow = {
  id: string;
  candidate_key: string;
  category: string | null;
  raw_label: string | null;
  normalized_label: string | null;
  destination_scope: string | null;
  country_scope: string | null;
  region_scope: string | null;
  evidence_count: number | null;
  occurrence_count: number | null;
  package_count: number | null;
  source_context?: Record<string, unknown> | null;
  external_sources?: CandidateExternalSource[] | null;
  suggested_master?: Record<string, unknown> | null;
  confidence?: number | null;
  auto_action?: string | null;
  promotion_status?: string | null;
};

export type EntityVerificationAttempt = {
  candidate_id?: string;
  candidate_key: string;
  source: 'naver_search' | 'naver_searchad' | 'google_places' | 'wikidata' | 'osm_nominatim' | 'internal' | 'manual';
  query: string;
  status: 'success' | 'empty' | 'error' | 'skipped';
  score: number;
  evidence: Record<string, unknown>;
  error?: string | null;
};

export type EntityResolutionStatus =
  | 'unverified'
  | 'verified_publishable'
  | 'verified_internal'
  | 'template_matched'
  | 'structured_non_master'
  | 'rejected_noise'
  | 'conflict'
  | 'needs_review';

export type EntityResolutionDecision = {
  candidateKey: string;
  canonicalName: string;
  canonicalNameSource: string;
  verificationScore: number;
  autoVerificationStatus: EntityResolutionStatus;
  autoAction: MasterCandidateAutoAction;
  promotionStatus: MasterCandidatePromotionStatus;
  decisionReason: string;
  externalSources: CandidateExternalSource[];
  suggestedMaster: Record<string, unknown>;
  attempts: EntityVerificationAttempt[];
  naver?: NaverEntityVerificationResult;
  googlePlaces?: GooglePlacesVerificationResult;
  osmNominatim?: OsmNominatimVerificationResult;
  wikidata: ReconciledEntity[];
};

export type EntityResolutionDependencies = {
  naverVerifier?: typeof verifyNaverEntityName;
  googlePlacesVerifier?: typeof verifyGooglePlacesEntityName;
  googlePlacesBudget?: GooglePlacesBudget;
  osmNominatimVerifier?: typeof verifyOsmNominatimEntityName;
  wikidataReconciler?: typeof reconcilePlaceName;
};

const CUSTOMER_REVIEW_CATEGORIES = new Set(['shopping', 'optional_tour', 'notice']);
const NON_MASTER_ACTIONS = new Set(['reject_noise', 'structure_non_master']);
const HIGH_RISK_NOTICE_RE = /(?:취소|환불|비자|여권|입국|출국|보험|예약금|결제|추가\s*요금|가격\s*변동|유류|수수료|환율|여행자\s*보험)/i;
const LOW_RISK_SCHEDULE_NOTICE_RE = /(?:상기\s*일정|현지\s*사정|항공사의?\s*사정|다소\s*변동|변경될\s*수|양지하시기|천재지변)/i;
const OPTION_STRUCTURED_DETAIL_RE = /(?:골프장\s*정보|그린피|캐디피|카트피|캐디팁|티타임|코스정보|홀수\s*인원|싱글카트|클럽\s*렌탈|현장\s*결제|락카\s*사용|라커\s*사용)/i;
const HOTEL_STRUCTURED_DETAIL_RE = /(?:^\s*\d+\s*인실|스탠다드|디럭스|슈페리어|기\s*내\s*박|기내박|룸\s*타입|객실\s*타입)/i;
const GOLF_METRIC_RE = /(?:\b\d{2}\s*파|\b\d{3,5}\s*야드|주중\s*\/\s*주말\s*동일)/i;
const GOLF_STRUCTURED_OPTION_RE = /(?:CC\b|골프장|18홀\s*라운딩|라운딩|오후\s*티업|티업|스루|셀프라운딩|일몰시|플레이\s*종료|나리타노모리|나리타히가시|로얄센트럴|루이시따|파인힐스)/i;
const LOW_RISK_PREP_RE = /(?:준비물|수영복|구명조끼|미끼|편도\s*리프트|왕복\s*케이블카|유리전망대|편도\s*루지)/i;
const KOREAN_OPERATIONAL_ATTRACTION_FRAGMENT_RE = /(?:출항|도착|이동\s*후|왕복\s*전동차|전동차|항공권|증편\s*특가|특가|차창|자유\s*시간|선택\s*관광|선택관광|옵션|프리미엄)/;
const KOREAN_FOOD_OR_SERVICE_FRAGMENT_RE = /(?:디저트|무침|못\s*주스|반짱느엉|삼겹|백숙|옥수수\s*삶는법|메뉴|마사지|수영장|풀빌라)/;
const KOREAN_ACTIVITY_OR_OPERATION_FRAGMENT_RE = /(?:이용|감상|환복|락커|불가|탑승|승마|귀빈석|놀이공원\s*무제한|핫플레이스|유리잔도|소원등|쪽배)/;
const KOREAN_METRIC_OR_ATTRIBUTE_FRAGMENT_RE = /(?:해발|\d+\s*M\b|\d+\s*m\b|360\s*도|높이\s*\d+|총길이|넓이|붉은색|내부\s*욕실)/i;
const KOREAN_MULTI_ENTITY_OR_OPTION_FRAGMENT_RE = /(?:[,/&+]|또는)/;
const KOREAN_DESCRIPTIVE_ATTRACTION_PHRASE_RE = /(?:세계적으로\s*유명한|가장\s*유명한|꼽히는|환상적이고|아름다운|드넓은|어우러져|드러냅니다|내려다|세계\s*최고의|듯한|봉우리|절경|최초의|반야생|계림의\s*상징|에서\s*파\s*$|등\s*$)/;
const KOREAN_GENERIC_OR_ROUTE_TOKEN_RE = /^(?:초원|해발|귀빈석|북파|남파|서파|양구코스|양커우코스|노노노|완톤)$/;
const KOREAN_HOTEL_ROOM_OR_FACILITY_RE = /(?:객실|룸|BED|베드|풀빌라|가든풀빌라|욕실|락커|환복|체크\s*-?\s*인|체크\s*-?\s*아웃)/i;
const COUNTRY_TO_ISO2: Record<string, string> = {
  korea: 'KR',
  japan: 'JP',
  vietnam: 'VN',
  china: 'CN',
  taiwan: 'TW',
  thailand: 'TH',
  philippines: 'PH',
  singapore: 'SG',
  malaysia: 'MY',
  indonesia: 'ID',
  usa: 'US',
  america: 'US',
};

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}

function asSources(value: unknown): CandidateExternalSource[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(item => item && typeof item === 'object')
    .map(item => item as CandidateExternalSource);
}

function uniqueSources(sources: CandidateExternalSource[]): CandidateExternalSource[] {
  const seen = new Set<string>();
  const result: CandidateExternalSource[] = [];
  for (const source of sources) {
    const key = `${source.source}:${source.id ?? source.url ?? source.name ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(source);
  }
  return result;
}

function countryIso2(country?: string | null): string | undefined {
  if (!country) return undefined;
  const normalized = country.trim();
  if (/^[A-Z]{2}$/i.test(normalized)) return normalized.toUpperCase();
  return COUNTRY_TO_ISO2[normalized.toLowerCase()];
}

function aliasesFrom(row: EntityCandidateRow, extraLabels: unknown[] = []): string[] {
  const aliases = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === 'string' && value.trim().length >= 2) aliases.add(normalizeCandidateLabel(value));
  };
  add(row.raw_label);
  add(row.normalized_label);
  add(row.suggested_master?.label);
  for (const label of extraLabels) add(label);
  const examples = row.source_context?.examples;
  if (Array.isArray(examples)) {
    for (const example of examples) {
      if (example && typeof example === 'object') add((example as Record<string, unknown>).activity);
    }
  }
  return [...aliases].slice(0, 8);
}

function scopeHintsFrom(row: EntityCandidateRow): string[] {
  const hints = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value !== 'string') return;
    const normalized = normalizeCandidateLabel(value);
    if (normalized.length < 2 || normalized.length > 24) return;
    if (/^[A-Z]{2}$/i.test(normalized)) return;
    if (/^(?:PKG|패키지|노팁|노옵션|노쇼핑|고품격|실속|알뜰|슬림팩|스페셜팩|출|항공|이스타|부산)$/i.test(normalized)) return;
    if (/(?:PKG|패키지|노팁|노옵션|노쇼핑|\d+박|\d+일|출|항공|이스타|부산)/i.test(normalized)) return;
    hints.add(normalized);
  };

  add(row.region_scope);
  add(row.destination_scope);
  add(row.country_scope);

  const examples = row.source_context?.examples;
  if (Array.isArray(examples)) {
    for (const example of examples) {
      if (!example || typeof example !== 'object') continue;
      const record = example as Record<string, unknown>;
      add(record.region);
      add(record.country);
      const title = typeof record.package_title === 'string' ? record.package_title : '';
      for (const token of title.split(/[\/()[\]\s·,]+/)) add(token);
    }
  }

  const packageTitles = row.source_context?.package_titles;
  if (Array.isArray(packageTitles)) {
    for (const title of packageTitles) {
      if (typeof title !== 'string') continue;
      for (const token of title.split(/[\/()[\]\s·,]+/)) add(token);
    }
  }

  return [...hints].slice(0, 8);
}

function bestIdentitySource(sources: CandidateExternalSource[]): CandidateExternalSource | null {
  const identity = sources
    .filter(source => (
      source.source === 'wikidata' ||
      source.source === 'osm' ||
      source.source === 'osm_nominatim' ||
      source.source === 'google_places' ||
      source.source === 'official_site' ||
      source.source === 'manual'
    ))
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
  return identity[0] ?? null;
}

function supportingSourceCount(sources: CandidateExternalSource[]): number {
  return new Set(
    sources
      .filter(source => (source.confidence ?? 0) >= 0.55 && (source.id || source.url || source.name))
      .map(source => source.source),
  ).size;
}

function compactForGate(value: string | null | undefined): string {
  return normalizeCandidateLabel(value ?? '')
    .toLowerCase()
    .replace(/[\s"'`.,()[\]{}:;!?/\\|-]+/g, '');
}

function hasResolvedScope(row: EntityCandidateRow): boolean {
  return Boolean(row.country_scope || row.region_scope || row.destination_scope);
}

function hasCorpusSupport(row: EntityCandidateRow): boolean {
  return (row.evidence_count ?? 0) >= 2 ||
    (row.package_count ?? 0) >= 2 ||
    (row.occurrence_count ?? 0) >= 5;
}

function hasStrongIdentitySource(source: CandidateExternalSource | null): boolean {
  if (!source) return false;
  const reliable = (
    source.source === 'wikidata' ||
    source.source === 'osm' ||
    source.source === 'osm_nominatim' ||
    source.source === 'google_places' ||
    source.source === 'official_site' ||
    source.source === 'manual'
  );
  return reliable && (source.confidence ?? 0) >= 0.82 && Boolean(source.id || source.url);
}

function hasNaverLocalSupport(naver: NaverEntityVerificationResult | undefined): boolean {
  return Boolean(naver?.searchEvidence.some(row => (
    row.target === 'local' &&
    row.itemCount > 0 &&
    (
      row.exactTitleMatches > 0 ||
      row.addressMatches > 0 ||
      row.matchedItems >= 2
    )
  )));
}

function hasNaverNameSupport(naver: NaverEntityVerificationResult | undefined): boolean {
  return Boolean(naver?.searchEvidence.some(row => (
    row.matchedItems > 0 &&
    (row.exactTitleMatches > 0 || row.target === 'encyc' || row.target === 'local')
  )));
}

function hasRegionalNaverSupport(naver: NaverEntityVerificationResult | undefined): boolean {
  return Boolean(naver && naver.searchScore >= 0.55 && naver.searchEvidence.some(row => (
    row.matchedItems > 0 &&
    (
      row.regionMatches > 0 ||
      row.exactTitleMatches > 0 ||
      row.target === 'encyc' ||
      row.target === 'webkr' ||
      row.target === 'blog'
    )
  )));
}

function hasGooglePlaceSupport(googlePlaces: GooglePlacesVerificationResult | undefined): boolean {
  return Boolean(googlePlaces?.hasStrongPlaceIdentity && !googlePlaces.regionConflict && googlePlaces.score >= 0.78);
}

function hasOsmPlaceSupport(osmNominatim: OsmNominatimVerificationResult | undefined): boolean {
  return Boolean(osmNominatim?.hasStrongPlaceIdentity && !osmNominatim.regionConflict && osmNominatim.score >= 0.82);
}

function namesAgree(canonicalName: string, aliases: string[], identity: CandidateExternalSource | null): boolean {
  const canonical = compactForGate(canonicalName);
  const names = [identity?.name ?? '', ...aliases].map(compactForGate).filter(value => value.length >= 2);
  return canonical.length >= 2 && names.some(name => (
    canonical === name ||
    canonical.includes(name) ||
    name.includes(canonical)
  ));
}

function sourceNamesAgree(canonicalName: string, aliases: string[]): boolean {
  const canonical = compactForGate(canonicalName);
  if (canonical.length < 2) return false;
  return aliases.some(alias => {
    const value = compactForGate(alias);
    return value.length >= 2 && (
      canonical === value ||
      canonical.includes(value) ||
      value.includes(canonical)
    );
  });
}

function isSafeMasterName(category: string, canonicalName: string, rawLabel: string | null | undefined): boolean {
  const name = normalizeCandidateLabel(canonicalName);
  const raw = normalizeCandidateLabel(rawLabel ?? name);
  const combined = `${raw} ${name}`;
  const compacted = compactForGate(name);
  if (name.length < 2 || compacted.length < 2) return false;
  if (name.length > 32) return false;
  if (/^\d+$/.test(compacted)) return false;
  if (/[,:;!?]/.test(name) && name.length > 14) return false;
  if (/(?:\s\/\s| 또는 | 혹은 | 중\s*1|택\s*1|택일|or)/i.test(name)) return false;
  if (/(?:취소|환불|비자|여권|입국|출국|예약|결제|보험|수수료|요금|가격|추가\s*요금|불포함|포함사항|주의사항|안내사항)/i.test(name)) return false;
  if (/(?:\$|USD|KRW|%|\d[\d,]*\s*(?:원|만원|위안|엔)|\d{1,2}[./]\d{1,2})/i.test(name)) return false;
  if (/(?:항공권|항공사|이스타항공|제주항공|진에어|티웨이|대한항공|아시아나|에어부산|에어서울|선택관광|판매가|가볼만한곳|간식|제공|유일|전통\s*간식|즐길거리|이벤트쇼|특전|혜택|도착|출발|미팅|제\s*\d+\s*일|^\(?\d+\s*일|토,?\s*일|\d+\s*박|팁\s*별도|특별약관|약관적용|품격\s*\d+\s*색|자유시간|등\s*자유|차창|고대\s*황제|제외일|분위기를.*느낄|오아시스\s*감상|^\d+\s*년된\s*고찰)/i.test(name)) return false;
  if (category === 'hotel' && /(?:객실|룸타입|스탠다드|디럭스|슈페리어|조식|체크\s*-?\s*인|체크\s*-?\s*아웃|check\s*-?\s*in|check\s*-?\s*out|부대시설|호텔안내|숙박\s*:\s*기내|기내박|또는\s*동급|해당숙소|써차지|서차지|예약시|날짜별|노팁|노옵션|단독골프)/i.test(name)) return false;
  if (category === 'hotel' && /^(?:필리핀|베트남|일본|중국|대만|태국|라오스|캄보디아|인도네시아|말레이시아|싱가포르|마카오|홍콩)$/i.test(name)) return false;

  const attractionSuffix = /(?:공원|사원|성당|교회|유적|유적지|박물관|기념관|거리|시장|해변|비치|광장|정원|전망대|케이블카|브릿지|브리지|마을|사막|호수|폭포|궁|성|타워|전망|섬|항구|동굴)$/;
  if (category === 'attraction') {
    if (/^(?:필리핀|베트남|일본|중국|대만|태국|라오스|캄보디아|인도네시아|말레이시아|싱가포르|마카오|홍콩)$/i.test(name)) return false;
    if (/^(?:공원|사원|성당|교회|유적|유적지|박물관|기념관|거리|시장|해변|비치|광장|정원|전망대|마을)$/.test(name)) return false;
    if (!attractionSuffix.test(name) && name.length > 20) return false;
  }

  return true;
}

export function terminalNonMasterReason(category: string, canonicalName: string, rawLabel: string | null | undefined): string | null {
  const name = normalizeCandidateLabel(canonicalName);
  const raw = normalizeCandidateLabel(rawLabel ?? name);
  const combined = `${raw} ${name}`;
  if (!name || name.length <= 1) return 'empty or too short';
  if (category === 'attraction' && /[\uA500-\uABFF]/.test(combined)) {
    return 'mojibake or corrupted source text';
  }
  if (category === 'attraction' && /^\s*\uC778\s*\uC6D0\s*$/.test(name)) {
    return 'operational or non-attraction schedule fragment';
  }
  if (category === 'attraction' && KOREAN_OPERATIONAL_ATTRACTION_FRAGMENT_RE.test(combined)) {
    return 'operational or non-attraction schedule fragment';
  }
  if (category === 'attraction' && KOREAN_FOOD_OR_SERVICE_FRAGMENT_RE.test(combined)) {
    return 'activity, meal, or service detail, not an attraction master';
  }
  if (category === 'attraction' && KOREAN_ACTIVITY_OR_OPERATION_FRAGMENT_RE.test(name)) {
    return 'activity or operational detail, not an attraction master';
  }
  if (category === 'attraction' && KOREAN_METRIC_OR_ATTRIBUTE_FRAGMENT_RE.test(name)) {
    return 'metric or attribute fragment, not an attraction master';
  }
  if (category === 'attraction' && KOREAN_MULTI_ENTITY_OR_OPTION_FRAGMENT_RE.test(name)) {
    return 'multiple entities or option list, not a single attraction master';
  }
  if (category === 'attraction' && KOREAN_DESCRIPTIVE_ATTRACTION_PHRASE_RE.test(name)) {
    return 'descriptive itinerary phrase, not an attraction master';
  }
  if (category === 'attraction' && KOREAN_GENERIC_OR_ROUTE_TOKEN_RE.test(name)) {
    return 'generic or route token, not attraction master';
  }
  if (category === 'attraction' && /(?:la\s*la\s*port|lalaport)/i.test(combined)) {
    return 'shopping mall or commercial venue fragment';
  }
  if (category === 'attraction' && /(?:\uC804\uD1B5\uB9DB?\uC0AC\uC9C0|\uB9C8\uC0AC\uC9C0|\uB9DB\uC0AC\uC9C0).{0,12}\d+\s*\uBD84/i.test(combined)) {
    return 'activity or service detail, not an attraction master';
  }
  if (category === 'attraction' && /^\s*\d+\s*M\s*\uC5D0\uC11C\s*\d+\s*\uACC4\uB2E8/i.test(name)) {
    return 'descriptive route metric, not an attraction master';
  }
  if (category === 'attraction' && /(?:\uC720\uBA85\uD55C\s*\uC2E0\uC0AC|\uBAA8\uB4E0\s*\uAF43\uC744\s*\uD55C\uBC88\uC5D0\s*\uBCFC\s*\uC218\s*\uC788\uB294\s*\uD50C\uB77C\uC6CC\uAC00\uB4E0|\uD55C\uB098\uB77C\s*\uAC74\uB155\uC5D0\s*\uCC3D\uAC74|\uCF54\uB07C\uB9AC\s*\uBA39\uC774\uC8FC\uAE30\s*\uCCB4?험)/.test(combined)) {
    return 'descriptive itinerary phrase, not an attraction master';
  }
  if (/^\d+$/.test(compactForGate(name))) return 'numeric fragment';
  if (category === 'attraction' && /^\s*\d+\s*(?:회|세트당|인|kg)\s*$/i.test(name)) {
    return 'tour option, unit, or count fragment';
  }
  if (category === 'attraction' && /(?:온천욕|개화일|개화시기|즐거운\s*여행|^\s*\d+\s*~\s*\d+\s*시간|^\s*\d+\s*시간\s*소요|객\s*실\s*종\s*류|오후\s*자유|단독\s*골프|품격\s*노노|^\s*\d{4}\s*년\s*\d{1,2}\s*월|맥주원액|생맥주|땅콩안주|해발\s*\d+$)/i.test(combined)) {
    return 'operational or non-attraction schedule fragment';
  }
  if (category === 'attraction' && /(?:포\s*함\s*내\s*역|최\s*소\s*출\s*발|발제외\s*\/?\s*\d+\s*분|수많은\s*볼거리|볼거리를\s*제공|생태왕국|꼽히며\s*폭포|아름다운\s*자태|협곡입니다|개화시기는|상이\s*라벤더)/i.test(combined)) {
    return 'descriptive itinerary phrase, not an attraction master';
  }
  if (category === 'attraction' && /(?:출\s*발\s*(?:요\s*일|인\s*원)|여행의\s*피로|넓이\s*\d+\s*M|아동\s*제외|개인\s*여벌옷|여벌옷\s*지참|메뉴\s*다양|관내\s*사용조건|노가이드|전담기사|알뜰\s*3\s*색\s*골프|단독행사|미니\s*줄낚시|빛의\s*도시.*야간)/i.test(combined)) {
    return 'operational or non-attraction schedule fragment';
  }
  if (category === 'attraction' && /(?:^\s*인\s*원\s*$|날씨$|라라포트|LALAPORT|케이블카,?골든브릿지,?테마파크\s*등)/i.test(combined)) {
    return 'operational or non-attraction schedule fragment';
  }
  if (category === 'attraction' && /(?:^\s*\d+\s*(?:회|세트당|인|kg)\s*$|^\s*\d+\s*KG\s*$|^\s*\d+\s*인\s*\d+|(?:야간\s*)?시티\s*투어|지프차\s*투어|투어\s*A?\s*코스|나이트\s*바자\s*투어|재래시장\s*관광|툭툭이|올드타운\s*투어)/i.test(combined)) {
    return 'tour option, unit, or count fragment';
  }
  if (category === 'attraction' && /(?:행\s*사\s*일\s*정|주\s*요\s*일\s*정|날\s*짜|비운항|휴관|개인\s*경비|매너\s*팁|추가\s*금액|일반석|인\s*1\s*실\s*기준|선크림|간단한\s*선물|선물\s*구입|가이드.*기사\s*팁|실속\s*알뜰\s*3\s*색|^\s*\d+\s*회\s*$)/i.test(combined)) {
    return 'operational or non-attraction schedule fragment';
  }
  if (category === 'attraction' && /(?:시내\s*관광|관광\s*\(|유럽풍\s*건축물|흙으로\s*구워\s*만든\s*병사|짚차로.*등정|잠들지\s*않는\s*도시)/i.test(combined)) {
    return 'descriptive itinerary phrase, not an attraction master';
  }
  if (/(?:\$|USD|KRW|%|\d[\d,]*\s*(?:원|만원|위안|엔)|\d{1,2}[./]\d{1,2})/i.test(name)) {
    return 'price or date fragment';
  }
  if (/(?:항공권|항공사|이스타항공|제주항공|진에어|티웨이|대한항공|아시아나|에어부산|에어서울|선택관광|판매가|가볼만한곳|간식|제공|유일|전통\s*간식|즐길거리|이벤트쇼|특전|혜택|도착|출발|미팅|제\s*\d+\s*일|^\(?\d+\s*일|토,?\s*일|\d+\s*박|팁\s*별도|특별약관|약관적용|품격\s*\d+\s*색|자유시간|등\s*자유|차창|고대\s*황제|제외일|분위기를.*느낄|오아시스\s*감상|^\d+\s*년된\s*고찰)/i.test(name)) {
    return 'commercial benefit or package-description fragment';
  }
  if (/(?:취소|환불|비자|여권|입국|출국|예약|결제|보험|수수료|요금|가격|추가\s*요금|불포함|포함사항|주의사항|안내사항)/i.test(name)) {
    return 'customer disclosure fragment';
  }
  if (category === 'hotel' && /(?:객실|룸타입|스탠다드|디럭스|슈페리어|조식|체크\s*-?\s*인|체크\s*-?\s*아웃|check\s*-?\s*in|check\s*-?\s*out|부대시설|호텔안내|숙박\s*:\s*기내|기내박|또는\s*동급|해당숙소|써차지|서차지|예약시|날짜별|노팁|노옵션|단독골프)/i.test(name)) {
    return 'hotel operational or room fragment';
  }
  if (category === 'hotel' && KOREAN_HOTEL_ROOM_OR_FACILITY_RE.test(combined)) {
    return 'hotel operational or room fragment';
  }
  if (category === 'hotel' && /^(?:필리핀|베트남|일본|중국|대만|태국|라오스|캄보디아|인도네시아|말레이시아|싱가포르|마카오|홍콩)$/i.test(name)) {
    return 'country token, not hotel master';
  }
  if (category === 'attraction' && /^(?:공원|사원|성당|교회|유적|유적지|박물관|기념관|거리|시장|해변|비치|광장|정원|전망대|마을)$/.test(name)) {
    return 'generic attraction type token';
  }
  if (category === 'attraction' && /^(?:필리핀|베트남|일본|중국|대만|태국|라오스|캄보디아|인도네시아|말레이시아|싱가포르|마카오|홍콩)$/i.test(name)) {
    return 'country token, not attraction master';
  }
  return null;
}

function safeTemplateResolution(category: string, label: string): {
  status: EntityResolutionStatus;
  reason: string;
} | null {
  if (category === 'notice' && (
    (LOW_RISK_SCHEDULE_NOTICE_RE.test(label) && !HIGH_RISK_NOTICE_RE.test(label)) ||
    LOW_RISK_PREP_RE.test(label)
  )) {
    return {
      status: 'template_matched',
      reason: 'low-risk source-backed notice matched a standard template',
    };
  }

  if (category === 'optional_tour' && (
    OPTION_STRUCTURED_DETAIL_RE.test(label) ||
    GOLF_METRIC_RE.test(label) ||
    GOLF_STRUCTURED_OPTION_RE.test(label)
  )) {
    return {
      status: 'structured_non_master',
      reason: 'option detail is source-backed structured data and should not become a master entity',
    };
  }

  if (category === 'hotel' && HOTEL_STRUCTURED_DETAIL_RE.test(label)) {
    return {
      status: 'structured_non_master',
      reason: 'hotel room or in-flight lodging detail is source-backed structured data and should not become a hotel master',
    };
  }

  return null;
}

export async function resolveItineraryEntityCandidate(
  row: EntityCandidateRow,
  dependencies: EntityResolutionDependencies = {},
): Promise<EntityResolutionDecision> {
  const sourceLabel = normalizeCandidateLabel(row.normalized_label || row.raw_label || '');
  const baseDecision = evaluateMasterCandidate({
    rawLabel: row.raw_label || sourceLabel,
    category: row.category,
    country: row.country_scope,
    region: row.region_scope,
    destination: row.destination_scope,
    occurrenceCount: row.occurrence_count,
    evidenceCount: row.evidence_count,
    packageCount: row.package_count,
    externalSources: [
      ...asSources(row.external_sources),
      ...asSources(row.suggested_master?.external_sources),
    ],
  });
  const label = normalizeCandidateLabel(String(baseDecision.normalizedLabel || sourceLabel));
  const aliases = aliasesFrom(row, [baseDecision.normalizedLabel]);

  const attempts: EntityVerificationAttempt[] = [];
  const category = baseDecision.category;
  const baseSources = [
    ...asSources(row.external_sources),
    ...asSources(row.suggested_master?.external_sources),
  ];

  const templateResolution = label ? safeTemplateResolution(category, label) : null;
  if (templateResolution) {
    return {
      candidateKey: row.candidate_key || baseDecision.candidateKey,
      canonicalName: label,
      canonicalNameSource: 'standard_template',
      verificationScore: Math.max(baseDecision.confidence, templateResolution.status === 'template_matched' ? 0.84 : 0.88),
      autoVerificationStatus: templateResolution.status,
      autoAction: 'structure_non_master',
      promotionStatus: 'candidate',
      decisionReason: templateResolution.reason,
      externalSources: uniqueSources(baseSources),
      suggestedMaster: {
        ...baseDecision.suggestedMaster,
        ...(row.suggested_master ?? {}),
        label,
        canonical_name: label,
        canonical_name_source: 'standard_template',
        customer_publishable: false,
        verification_status: templateResolution.status,
        verification_score: Math.max(baseDecision.confidence, templateResolution.status === 'template_matched' ? 0.84 : 0.88),
      },
      attempts,
      wikidata: [],
    };
  }

  if (!label || NON_MASTER_ACTIONS.has(baseDecision.autoAction)) {
    const status: EntityResolutionStatus = baseDecision.autoAction === 'reject_noise'
      ? 'rejected_noise'
      : 'structured_non_master';
    return {
      candidateKey: row.candidate_key || baseDecision.candidateKey,
      canonicalName: label,
      canonicalNameSource: 'base_classifier',
      verificationScore: baseDecision.confidence,
      autoVerificationStatus: status,
      autoAction: baseDecision.autoAction,
      promotionStatus: baseDecision.promotionStatus,
      decisionReason: baseDecision.decisionReason,
      externalSources: uniqueSources(baseSources),
      suggestedMaster: {
        ...baseDecision.suggestedMaster,
        canonical_name: label,
        customer_publishable: false,
      },
      attempts,
      wikidata: [],
    };
  }

  if (CUSTOMER_REVIEW_CATEGORIES.has(category)) {
    return {
      candidateKey: row.candidate_key || baseDecision.candidateKey,
      canonicalName: label,
      canonicalNameSource: 'customer_disclosure_gate',
      verificationScore: baseDecision.confidence,
      autoVerificationStatus: 'needs_review',
      autoAction: 'needs_review',
      promotionStatus: 'needs_review',
      decisionReason: category === 'notice' && HIGH_RISK_NOTICE_RE.test(label)
        ? 'high-risk customer notice requires source-backed disclosure review'
        : 'customer-visible commercial or optional-tour text requires disclosure review',
      externalSources: uniqueSources(baseSources),
      suggestedMaster: {
        ...baseDecision.suggestedMaster,
        ...(row.suggested_master ?? {}),
        label,
        canonical_name: label,
        canonical_name_source: 'customer_disclosure_gate',
        customer_publishable: false,
        verification_status: 'needs_review',
        verification_score: baseDecision.confidence,
      },
      attempts,
      wikidata: [],
    };
  }

  const earlyNonMasterReason = terminalNonMasterReason(category, label, row.raw_label || label);
  if ((category === 'attraction' || category === 'hotel') && earlyNonMasterReason) {
    return {
      candidateKey: row.candidate_key || baseDecision.candidateKey,
      canonicalName: label,
      canonicalNameSource: 'auto_review_pattern',
      verificationScore: Math.max(baseDecision.confidence, 0.9),
      autoVerificationStatus: 'rejected_noise',
      autoAction: 'reject_noise',
      promotionStatus: 'rejected_noise',
      decisionReason: `auto-reviewed as non-master: ${earlyNonMasterReason}`,
      externalSources: uniqueSources(baseSources),
      suggestedMaster: {
        ...baseDecision.suggestedMaster,
        ...(row.suggested_master ?? {}),
        label,
        canonical_name: label,
        canonical_name_source: 'auto_review_pattern',
        customer_publishable: false,
        verification_status: 'rejected_noise',
        verification_score: Math.max(baseDecision.confidence, 0.9),
        auto_review: {
          mode: 'auto_rejected_non_master',
          reason: earlyNonMasterReason,
          reviewed_by: 'itinerary-entity-resolution-engine',
        },
      },
      attempts,
      wikidata: [],
    };
  }

  let naver: NaverEntityVerificationResult | undefined;
  try {
    naver = await (dependencies.naverVerifier ?? verifyNaverEntityName)({
      label,
      aliases,
      region: row.region_scope,
      country: row.country_scope,
      destination: row.destination_scope,
      scopeHints: scopeHintsFrom(row),
      category,
    });
    attempts.push(...naver.attempts.map(attempt => ({
      candidate_id: row.id,
      candidate_key: row.candidate_key || baseDecision.candidateKey,
      source: attempt.source,
      query: attempt.query || label,
      status: attempt.status,
      score: attempt.score,
      evidence: attempt.evidence,
      error: attempt.error ?? null,
    })));
  } catch (error) {
    attempts.push({
      candidate_id: row.id,
      candidate_key: row.candidate_key || baseDecision.candidateKey,
      source: 'naver_search',
      query: label,
      status: 'error',
      score: 0,
      evidence: {},
      error: error instanceof Error ? error.message : String(error),
    });
  }

  let wikidata: ReconciledEntity[] = [];
  if (category === 'attraction') {
    try {
      wikidata = await (dependencies.wikidataReconciler ?? reconcilePlaceName)(
        naver?.canonicalName || label,
        {
          country: countryIso2(row.country_scope),
          typeId: 'Q570',
          topRes: 3,
        },
      );
      const top = wikidata[0];
      attempts.push({
        candidate_id: row.id,
        candidate_key: row.candidate_key || baseDecision.candidateKey,
        source: 'wikidata',
        query: naver?.canonicalName || label,
        status: top ? 'success' : 'empty',
        score: top?.confidence ?? 0,
        evidence: top ? {
          qid: top.qid,
          label_ko: top.label_ko,
          label_en: top.label_en,
          description: top.description,
          aliases: top.aliases.slice(0, 12),
          image_url: top.image_url,
          type_qid: top.type_qid,
        } : {},
      });
    } catch (error) {
      attempts.push({
        candidate_id: row.id,
        candidate_key: row.candidate_key || baseDecision.candidateKey,
        source: 'wikidata',
        query: naver?.canonicalName || label,
        status: 'error',
        score: 0,
        evidence: {},
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  let osmNominatim: OsmNominatimVerificationResult | undefined;
  if (category === 'attraction' || category === 'hotel') {
    try {
      osmNominatim = await (dependencies.osmNominatimVerifier ?? verifyOsmNominatimEntityName)({
        label: naver?.canonicalName || label,
        aliases,
        region: row.region_scope,
        country: row.country_scope,
        destination: row.destination_scope,
        scopeHints: scopeHintsFrom(row),
        category,
        maxQueriesPerCandidate: 1,
      });
      attempts.push(...osmNominatim.attempts.map(attempt => ({
        candidate_id: row.id,
        candidate_key: row.candidate_key || baseDecision.candidateKey,
        source: attempt.source,
        query: attempt.query || label,
        status: attempt.status,
        score: attempt.score,
        evidence: attempt.evidence,
        error: attempt.error ?? null,
      })));
    } catch (error) {
      attempts.push({
        candidate_id: row.id,
        candidate_key: row.candidate_key || baseDecision.candidateKey,
        source: 'osm_nominatim',
        query: naver?.canonicalName || label,
        status: 'error',
        score: 0,
        evidence: {},
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const wikidataSources: CandidateExternalSource[] = wikidata.slice(0, 2).map(item => ({
    source: 'wikidata',
    id: item.qid,
    url: `https://www.wikidata.org/wiki/${item.qid}`,
    confidence: item.confidence,
    name: item.label_ko || item.label_en || undefined,
  }));
  const freeExternalSources = uniqueSources([
    ...baseSources,
    ...(naver?.sources ?? []),
    ...wikidataSources,
    ...(osmNominatim?.sources ?? []),
  ]);
  const freeIdentity = bestIdentitySource(freeExternalSources);
  const freeSupportCount = supportingSourceCount(freeExternalSources);
  const freeCanonicalName = naver?.canonicalName || osmNominatim?.canonicalName || label;
  const freeIdentityNameAgrees = namesAgree(freeCanonicalName, aliases, freeIdentity);
  const freeEvidenceIsEnough = (
    (hasStrongIdentitySource(freeIdentity) && freeSupportCount >= 2 && freeIdentityNameAgrees) ||
    (hasOsmPlaceSupport(osmNominatim) && sourceNamesAgree(osmNominatim?.canonicalName ?? '', aliases) && hasCorpusSupport(row)) ||
    (hasNaverLocalSupport(naver) && sourceNamesAgree(freeCanonicalName, aliases) && hasCorpusSupport(row))
  );

  let googlePlaces: GooglePlacesVerificationResult | undefined;
  if ((category === 'attraction' || category === 'hotel') && !freeEvidenceIsEnough) {
    const budget = dependencies.googlePlacesBudget ?? getGooglePlacesBudgetFromEnv();
    try {
      googlePlaces = await (dependencies.googlePlacesVerifier ?? verifyGooglePlacesEntityName)({
        label: naver?.canonicalName || label,
        aliases,
        region: row.region_scope,
        country: row.country_scope,
        destination: row.destination_scope,
        scopeHints: scopeHintsFrom(row),
        category,
        enabled: budget.enabled,
        remainingDailyCalls: budget.remainingDailyCalls,
        maxQueriesPerCandidate: budget.maxQueriesPerCandidate,
        skipReason: budget.skipReason,
      });
      attempts.push(...googlePlaces.attempts.map(attempt => ({
        candidate_id: row.id,
        candidate_key: row.candidate_key || baseDecision.candidateKey,
        source: attempt.source,
        query: attempt.query || label,
        status: attempt.status,
        score: attempt.score,
        evidence: attempt.evidence,
        error: attempt.error ?? null,
      })));
    } catch (error) {
      attempts.push({
        candidate_id: row.id,
        candidate_key: row.candidate_key || baseDecision.candidateKey,
        source: 'google_places',
        query: naver?.canonicalName || label,
        status: 'error',
        score: 0,
        evidence: {},
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const externalSources = uniqueSources([
    ...freeExternalSources,
    ...(googlePlaces?.sources ?? []),
  ]);

  const identity = bestIdentitySource(externalSources);
  const supportCount = supportingSourceCount(externalSources);
  const externalDecision = evaluateMasterCandidate({
    rawLabel: row.raw_label || label,
    category,
    country: row.country_scope,
    region: row.region_scope,
    destination: row.destination_scope,
    occurrenceCount: row.occurrence_count,
    evidenceCount: row.evidence_count,
    packageCount: row.package_count,
    externalSources,
  });

  const naverScore = naver?.overallScore ?? 0;
  const googlePlacesScore = googlePlaces?.score ?? 0;
  const osmNominatimScore = osmNominatim?.score ?? 0;
  const identityScore = identity?.confidence ?? 0;
  const evidenceScore = clamp(
    Math.min(0.2, Math.max(0, (row.evidence_count ?? 1) - 1) * 0.035) +
    Math.min(0.15, Math.max(0, (row.package_count ?? 0)) * 0.035),
  );
  const verificationScore = clamp(
    Math.max(baseDecision.confidence, externalDecision.confidence) * 0.22 +
    Math.max(naverScore, googlePlacesScore, osmNominatimScore) * 0.28 +
    identityScore * 0.36 +
    evidenceScore * 0.14,
  );
  const canonicalName = googlePlaces?.hasStrongPlaceIdentity && sourceNamesAgree(googlePlaces.canonicalName, aliases)
    ? googlePlaces.canonicalName
    : osmNominatim?.hasStrongPlaceIdentity && sourceNamesAgree(osmNominatim.canonicalName, aliases)
      ? osmNominatim.canonicalName
    : naver?.canonicalName || label;
  const canonicalNameSource = googlePlaces?.hasStrongPlaceIdentity && sourceNamesAgree(googlePlaces.canonicalName, aliases)
    ? 'google_places'
    : osmNominatim?.hasStrongPlaceIdentity && sourceNamesAgree(osmNominatim.canonicalName, aliases)
      ? 'osm_nominatim'
    : naver?.canonicalNameSource || 'input';
  const scopeReady = hasResolvedScope(row);
  const corpusSupported = hasCorpusSupport(row);
  const strongIdentity = hasStrongIdentitySource(identity);
  const naverLocalSupported = hasNaverLocalSupport(naver);
  const naverNameSupported = hasNaverNameSupport(naver);
  const naverRegionalSupported = hasRegionalNaverSupport(naver);
  const googlePlaceSupported = hasGooglePlaceSupport(googlePlaces);
  const osmPlaceSupported = hasOsmPlaceSupport(osmNominatim);
  const safeMasterName = isSafeMasterName(category, canonicalName, row.raw_label || label);
  const autoRejectNonMasterReason = terminalNonMasterReason(category, canonicalName, row.raw_label || label);
  const sourceNameAgrees = sourceNamesAgree(canonicalName, aliases);
  const identityNameAgrees = namesAgree(canonicalName, aliases, identity);
  const publishableGatePassed = safeMasterName &&
    scopeReady &&
    strongIdentity &&
    identityNameAgrees &&
    supportCount >= 2 &&
    (naverNameSupported || supportCount >= 3) &&
    verificationScore >= 0.86;
  const internalVerifiedGatePassed = safeMasterName &&
    scopeReady &&
    (
      (strongIdentity && supportCount >= 2 && identityNameAgrees && verificationScore >= 0.68) ||
      (osmPlaceSupported && sourceNameAgrees && corpusSupported && verificationScore >= 0.62) ||
      (googlePlaceSupported && sourceNameAgrees && corpusSupported && verificationScore >= 0.62) ||
      (naverLocalSupported && sourceNameAgrees && corpusSupported && naverScore >= 0.52)
    );

  let autoAction = externalDecision.autoAction;
  let promotionStatus = externalDecision.promotionStatus;
  let autoVerificationStatus: EntityResolutionStatus = 'needs_review';
  let decisionReason = externalDecision.decisionReason;

  if (CUSTOMER_REVIEW_CATEGORIES.has(category)) {
    autoAction = 'needs_review';
    promotionStatus = 'needs_review';
    autoVerificationStatus = naverScore >= 0.65 ? 'template_matched' : 'needs_review';
    decisionReason = 'customer-visible commercial or notice text stays review-gated even when search evidence exists';
  } else if (category === 'hotel') {
    if (autoRejectNonMasterReason) {
      autoAction = 'reject_noise';
      promotionStatus = 'rejected_noise';
      autoVerificationStatus = 'rejected_noise';
      decisionReason = `auto-reviewed as non-master: ${autoRejectNonMasterReason}`;
    } else if (internalVerifiedGatePassed) {
      autoAction = 'create_internal_master';
      promotionStatus = 'auto_internal';
      autoVerificationStatus = 'verified_internal';
      decisionReason = strongIdentity
        ? 'hotel identity has strong external support; internal canonical can be automated, customer-facing master stays gated'
        : osmPlaceSupported
          ? 'hotel has OSM/Nominatim identity plus repeated supplier evidence; internal canonical can be automated'
        : googlePlaceSupported
          ? 'hotel has Google Places identity plus repeated supplier evidence; internal canonical can be automated'
        : 'hotel has local search identity plus repeated supplier evidence; internal canonical can be automated';
    } else if (externalDecision.autoAction === 'create_internal_master' && safeMasterName) {
      autoAction = 'create_internal_master';
      promotionStatus = 'auto_internal';
      autoVerificationStatus = 'unverified';
      decisionReason = 'hotel looks like a master candidate, but identity evidence is not strong enough for verified automation';
    } else {
      autoAction = 'needs_review';
      promotionStatus = 'needs_review';
      autoVerificationStatus = verificationScore >= 0.55 ? 'unverified' : 'needs_review';
      decisionReason = safeMasterName
        ? 'hotel needs stronger identity evidence before automatic master promotion'
        : 'hotel label is too generic or descriptive for automatic master creation';
    }
  } else if (category === 'attraction') {
    if (autoRejectNonMasterReason) {
      autoAction = 'reject_noise';
      promotionStatus = 'rejected_noise';
      autoVerificationStatus = 'rejected_noise';
      decisionReason = `auto-reviewed as non-master: ${autoRejectNonMasterReason}`;
    } else if (publishableGatePassed) {
      autoAction = 'create_publishable_master';
      promotionStatus = 'publishable_ready';
      autoVerificationStatus = 'verified_publishable';
      decisionReason = 'attraction has identity evidence plus Korean naming support and can enter publishable-ready queue';
    } else if (internalVerifiedGatePassed) {
      autoAction = 'create_internal_master';
      promotionStatus = 'auto_internal';
      autoVerificationStatus = 'verified_internal';
      decisionReason = strongIdentity
        ? 'probable attraction has strong identity evidence for internal non-customer-publishable automation'
        : osmPlaceSupported
          ? 'probable attraction has OSM/Nominatim identity plus repeated supplier evidence for internal automation'
        : googlePlaceSupported
          ? 'probable attraction has Google Places identity plus repeated supplier evidence for internal automation'
        : 'probable attraction has local search support plus repeated supplier evidence for internal automation';
    } else if (externalDecision.autoAction === 'create_internal_master' && safeMasterName) {
      autoAction = 'create_internal_master';
      promotionStatus = 'auto_internal';
      autoVerificationStatus = 'unverified';
      decisionReason = 'classifier suggests an internal attraction candidate, but external verification is still weak';
    } else {
      autoAction = 'needs_review';
      promotionStatus = 'needs_review';
      autoVerificationStatus = verificationScore >= 0.45 ? 'unverified' : 'needs_review';
      decisionReason = safeMasterName
        ? 'possible attraction but evidence is not strong enough for automatic handling'
        : 'attraction label is too generic or descriptive for automatic master creation';
    }
  }

  return {
    candidateKey: row.candidate_key || baseDecision.candidateKey,
    canonicalName,
    canonicalNameSource,
    verificationScore,
    autoVerificationStatus,
    autoAction,
    promotionStatus,
    decisionReason,
    externalSources,
    suggestedMaster: {
      ...externalDecision.suggestedMaster,
      ...(row.suggested_master ?? {}),
      label: canonicalName,
      canonical_name: canonicalName,
      canonical_name_source: canonicalNameSource,
      external_verified: Boolean(identity && supportCount >= 2),
      verification_score: verificationScore,
      customer_publishable: autoVerificationStatus === 'verified_publishable',
      verification_status: autoVerificationStatus,
      external_sources: externalSources,
      assurance: {
        safe_master_name: safeMasterName,
        scope_ready: scopeReady,
        corpus_supported: corpusSupported,
        strong_identity: strongIdentity,
        identity_name_agrees: identityNameAgrees,
        naver_local_support: naverLocalSupported,
        naver_name_support: naverNameSupported,
        naver_regional_support: naverRegionalSupported,
        osm_nominatim_support: osmPlaceSupported,
        osm_nominatim_region_conflict: osmNominatim?.regionConflict ?? false,
        google_places_support: googlePlaceSupported,
        google_places_region_conflict: googlePlaces?.regionConflict ?? false,
        source_name_agrees: sourceNameAgrees,
        auto_reject_non_master_reason: autoRejectNonMasterReason,
        support_count: supportCount,
        publishable_gate_passed: publishableGatePassed,
        internal_verified_gate_passed: internalVerifiedGatePassed,
      },
    },
    attempts,
    naver,
    googlePlaces,
    osmNominatim,
    wikidata,
  };
}

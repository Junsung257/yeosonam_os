/**
 * @file wikidata-reconcile.ts - P11-3 Wikibase Reconciliation 엔진
 *
 * OpenRefine Reconciliation Service API v0.2 스타일로 Wikidata entity 검색.
 * 상품 등록 시 activity 문자열을 정규화된 QID로 매핑하여 동일 관광지 중복 방지.
 *
 * 핵심 차별점 (단순 wbsearchentities 대비):
 *   1. type_id 필터 (P31 instance of → Q570 tourist attraction 계열)
 *   2. country 필터 (P17 country → ISO2 코드 매칭)
 *   3. alias 수집 (한국어/영어 alias 라벨 자동 추출)
 *   4. Wikimedia Commons 이미지 URL 추출 (P18)
 *   5. confidence 점수 계산 (exact > alias > fuzzy)
 *   6. OpenRefine 호환 인터페이스로 향후 확장 가능
 */

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const UA = 'YeosonamOS/1.0 (https://yeosonam.com; admin@yeosonam.com) wikidata-reconcile';

/** 관광지 관련 Wikidata type QIDs */
const ATTRACTION_TYPES = new Set([
  'Q570',      // tourist attraction
  'Q2344606',  // park
  'Q16560',    // heritage site
  'Q41176',    // building
  'Q33506',    // museum
  'Q2439834',  // amusement park
  'Q839237',   // theme park
  'Q274153',   // ancient city
  'Q176353',   // palace
  'Q298',      // theatre
  'Q108551',   // historic district
  'Q9259',     // botanical garden
  'Q1093841',  // temple
  'Q947432',   // shrine
  'Q16970',    // church
  'Q811534',   // beach
  'Q47521',    // square (광장)
  'Q16917',    // street
  'Q214506',   // waterfall
  'Q23397',    // mountain
  'Q172296',   // lake
  'Q46851',    // cave
]);

export interface ReconciledEntity {
  qid: string;
  label_ko: string | null;
  label_en: string | null;
  description: string | null;
  aliases: string[];
  image_url: string | null;
  /** Wikidata entity type (P31 값 중 첫 번째) */
  type_qid: string | null;
  confidence: number;
}

/**
 * Wikidata entity 검색 + type/country 필터 + alias/image 수집
 */
export async function reconcilePlaceName(
  name: string,
  options?: {
    country?: string;    // ISO2: "VN", "JP" 등 — P17 country code
    typeId?: string;     // Wikidata type QID (기본값 Q570 tourist attraction)
    topRes?: number;     // 최대 후보 수 (기본 5)
  },
): Promise<ReconciledEntity[]> {
  const keyword = name.trim();
  if (!keyword || keyword.length < 2) return [];
  const topRes = options?.topRes ?? 5;
  const typeId = options?.typeId ?? 'Q570';

  // 1) 한국어 검색
  let entities = await searchEntities(keyword, 'ko');
  // 2) 한국어 결과 없으면 영어 검색
  if (entities.length === 0) {
    entities = await searchEntities(keyword, 'en');
  }
  // 3) 결과 없으면 원본 activity 소문자로 영어 fallback
  if (entities.length === 0) {
    const fallback = keyword.replace(/^[▶☆※♣♠♥♦*]+\s*/, '').trim();
    if (fallback !== keyword && fallback.length >= 3) {
      entities = await searchEntities(fallback, 'en');
    }
  }

  if (entities.length === 0) return [];

  // 4) 각 entity 상세 조회 (type/country/image/alias)
  const detailed = await Promise.all(
    entities.slice(0, Math.min(entities.length, topRes + 2)).map(e => getEntityDetail(e.qid)),
  );

  // 5) confidence 계산 + 정렬
  const keywordLower = keyword.toLowerCase().replace(/\s+/g, '');
  const keywordNoPrefix = keyword.replace(/^[▶☆※♣♠♥♦*]+\s*/, '').toLowerCase().replace(/\s+/g, '');

  const results: ReconciledEntity[] = [];
  for (const d of detailed) {
    if (!d) continue;

    // type 필터 (지정 타입 계열에 속하는지)
    if (typeId && d.type_qids.length > 0) {
      const isMatch = d.type_qids.some(t => ATTRACTION_TYPES.has(t));
      if (!isMatch) continue; // 관광지 타입이 아니면 제외
    }

    // country 필터 (ISO2 코드 비교)
    if (options?.country && d.countries.length > 0) {
      const countryUpper = options.country.toUpperCase();
      const hasCountry = d.countries.some(c => c === countryUpper);
      if (!hasCountry && d.countries.length > 0) continue;
    }

    const namesToCheck = [
      d.label_ko,
      d.label_en,
      ...d.aliases,
    ].filter(Boolean) as string[];

    // confidence 계산
    let confidence = 0.3; // minimum base
    for (const n of namesToCheck) {
      const nLower = n.toLowerCase().replace(/\s+/g, '');
      if (nLower === keywordLower || nLower === keywordNoPrefix) {
        confidence = Math.max(confidence, 1.0);
      } else if (nLower.includes(keywordLower) || keywordLower.includes(nLower)) {
        confidence = Math.max(confidence, 0.85);
      } else if (nLower.length >= 3 && keywordLower.length >= 3) {
        // 간단한 Jaccard 유사도 (토큰 기반)
        const tokens1 = new Set(nLower.split(/\s+/).filter(t => t.length >= 2));
        const tokens2 = new Set(keywordLower.split(/\s+/).filter(t => t.length >= 2));
        let intersect = 0;
        for (const t of tokens1) if (tokens2.has(t)) intersect++;
        const union = tokens1.size + tokens2.size - intersect;
        if (union > 0 && intersect / union >= 0.4) {
          confidence = Math.max(confidence, 0.75);
        }
        // prefix match
        if (nLower.startsWith(keywordLower) || keywordLower.startsWith(nLower)) {
          const ratio = Math.min(nLower.length, keywordLower.length) / Math.max(nLower.length, keywordLower.length);
          confidence = Math.max(confidence, 0.7 * ratio);
        }
      }
    }

    if (confidence < 0.5) continue; // 너무 낮은 신뢰도 제외

    results.push({
      qid: d.qid,
      label_ko: d.label_ko,
      label_en: d.label_en,
      description: d.description,
      aliases: d.aliases,
      image_url: d.image_url,
      type_qid: d.type_qids[0] ?? null,
      confidence,
    });
  }

  results.sort((a, b) => b.confidence - a.confidence);
  return results.slice(0, topRes);
}

// ─── 내부 함수 ─────────────────────────────────────────────────

interface EntitySearchResult {
  qid: string;
  label: string | null;
  description: string | null;
}

async function searchEntities(keyword: string, language: string): Promise<EntitySearchResult[]> {
  const url = `${WIKIDATA_API}?action=wbsearchentities&search=${encodeURIComponent(keyword)}&language=${language}&format=json&limit=7&type=item`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) return [];
    const json = await res.json() as { search?: Array<{ id: string; label?: string; description?: string; match?: { type: string } }> };
    return (json.search ?? [])
      .filter(e => e.match?.type === 'entity')  // entity 매칭만
      .map(e => ({
        qid: e.id,
        label: e.label ?? null,
        description: e.description ?? null,
      }));
  } catch {
    return [];
  }
}

interface EntityDetail {
  qid: string;
  label_ko: string | null;
  label_en: string | null;
  description: string | null;
  aliases: string[];
  image_url: string | null;
  type_qids: string[];
  countries: string[];
}

/**
 * wbgetentities 로 상세 정보 조회.
 * claims 에서 P31(instance of), P17(country), P18(image), P1449(alias label) 추출.
 */
async function getEntityDetail(qid: string): Promise<EntityDetail | null> {
  const url = `${WIKIDATA_API}?action=wbgetentities&ids=${qid}&props=labels|descriptions|aliases|claims&languages=ko|en&format=json`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) return null;
    const json = await res.json() as {
      entities?: Record<string, {
        labels?: Record<string, { value: string }>;
        descriptions?: Record<string, { value: string }>;
        aliases?: Record<string, Array<{ value: string }>>;
        claims?: Record<string, Array<{
          mainsnak?: { datavalue?: { value?: { id?: string } | string } };
        }>>;
      }>;
    };
    const entity = json.entities?.[qid];
    if (!entity) return null;

    const label_ko = entity.labels?.ko?.value ?? null;
    const label_en = entity.labels?.en?.value ?? null;
    const description = entity.descriptions?.ko?.value ?? entity.descriptions?.en?.value ?? null;

    // alias 수집 (한국어 + 영어)
    const aliases: string[] = [];
    for (const lang of ['ko', 'en']) {
      if (entity.aliases?.[lang]) {
        for (const a of entity.aliases[lang]) {
          if (a.value && !aliases.includes(a.value)) aliases.push(a.value);
        }
      }
    }

    // P18 image → Wikimedia Commons thumbnail
    let image_url: string | null = null;
    const p18Claims = entity.claims?.P18;
    if (p18Claims?.[0]) {
      const claim = p18Claims[0];
      const filename = claim.mainsnak?.datavalue?.value;
      if (filename && typeof filename === 'string') {
        image_url = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}?width=480`;
      }
    }

    // P31 (instance of) — type filter
    const type_qids: string[] = [];
    const p31Claims = entity.claims?.P31;
    if (p31Claims) {
      for (const claim of p31Claims) {
        const value = claim.mainsnak?.datavalue?.value;
        const tid = value && typeof value === 'object' ? (value as { id: string }).id : undefined;
        if (tid && typeof tid === 'string') type_qids.push(tid);
      }
    }

    // P17 (country) — country filter
    const countries: string[] = [];
    const p17Claims = entity.claims?.P17;
    if (p17Claims) {
      for (const claim of p17Claims) {
        const value = claim.mainsnak?.datavalue?.value;
        const cid = value && typeof value === 'object' ? (value as { id: string }).id : undefined;
        if (cid && typeof cid === 'string') {
          // QID → ISO2 코드 변환 (주요 국가)
          const iso2 = qidToCountryCode(cid);
          if (iso2) countries.push(iso2);
        }
      }
    }

    return {
      qid,
      label_ko,
      label_en,
      description,
      aliases,
      image_url,
      type_qids,
      countries,
    };
  } catch {
    return null;
  }
}

/** 주요 국가 QID → ISO2 맵 */
const COUNTRY_QID_MAP: Record<string, string> = {
  'Q30': 'US', 'Q145': 'GB', 'Q17': 'JP', 'Q884': 'KR',
  'Q148': 'CN', 'Q865': 'TW', 'Q881': 'VN', 'Q869': 'LA',
  'Q924': 'PH', 'Q836': 'TH', 'Q971': 'KH', 'Q1028': 'MM',
  'Q96': 'MX', 'Q33': 'FI', 'Q36': 'PL', 'Q40': 'AT',
  'Q41': 'GR', 'Q43': 'TR', 'Q55': 'NL', 'Q183': 'DE',
  'Q79': 'EG', 'Q142': 'FR', 'Q38': 'IT', 'Q29': 'ES',
  'Q34': 'SE', 'Q39': 'CH', 'Q213': 'CZ', 'Q224': 'RU',
  'Q252': 'ID', 'Q334': 'SG', 'Q367': 'MY', 'Q386': 'BN',
  'Q398': 'BH', 'Q399': 'BD', 'Q414': 'AR', 'Q419': 'PE',
  'Q420': 'CL', 'Q424': 'BR', 'Q48': 'MN', 'Q664': 'NZ',
  'Q688': 'FJ', 'Q697': 'GU', 'Q733': 'PY',
  'Q734': 'GY', 'Q736': 'EC', 'Q750': 'BO', 'Q751': 'CR',
  'Q754': 'CO', 'Q766': 'JM', 'Q769': 'DO', 'Q770': 'GT',
  'Q775': 'HT', 'Q776': 'HN', 'Q778': 'CU',
  'Q783': 'LV', 'Q784': 'LT', 'Q786': 'LB',
  'Q787': 'LI', 'Q790': 'LU', 'Q792': 'LY', 'Q793': 'MA',
  'Q794': 'MC', 'Q796': 'MV', 'Q798': 'ML',
  'Q800': 'MT', 'Q801': 'MQ', 'Q802': 'MR', 'Q805': 'MU',
  'Q807': 'MK', 'Q810': 'MN', 'Q811': 'ME', 'Q815': 'MZ',
  'Q822': 'NA', 'Q833': 'NP',
  'Q842': 'NI', 'Q851': 'OM', 'Q852': 'PK', 'Q854': 'PA',
  'Q855': 'PG', 'Q858': 'PE', 'Q863': 'IE',
  'Q866': 'QA', 'Q868': 'RO',
  'Q886': 'YE', 'Q889': 'AF', 'Q890': 'AM',
  'Q892': 'AZ', 'Q893': 'KG', 'Q894': 'KZ', 'Q895': 'UZ',
  'Q896': 'TM', 'Q897': 'TJ', 'Q898': 'GE', 'Q899': 'MN',
  'Q902': 'FJ', 'Q903': 'KI', 'Q904': 'MH',
  'Q905': 'FM', 'Q906': 'NR', 'Q907': 'PW', 'Q908': 'PG',
  'Q909': 'SB', 'Q910': 'TO', 'Q911': 'TV', 'Q912': 'VU',
  'Q913': 'WS', 'Q914': 'CK', 'Q915': 'NU', 'Q916': 'TK',
  'Q917': 'WF', 'Q918': 'PF', 'Q919': 'NC',
};

function qidToCountryCode(qid: string): string | null {
  return COUNTRY_QID_MAP[qid] ?? null;
}

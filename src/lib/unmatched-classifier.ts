import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { suggestAttractionsForActivity, type AttractionSuggestRow } from '@/lib/unmatched-suggest';

export type UnmatchedEntityCategory =
  | 'attraction'
  | 'hotel'
  | 'meal'
  | 'transfer'
  | 'shopping'
  | 'optional_tour'
  | 'free_time'
  | 'notice'
  | 'price_noise'
  | 'unknown';

export type ClassifiedUnmatched = {
  category: UnmatchedEntityCategory;
  confidence: number;
  terminalStatus: 'pending' | 'added' | 'ignored';
  suggestedAction:
    | 'auto_resolve_existing'
    | 'auto_ignore_noise'
    | 'structure_non_master'
    | 'needs_new_master'
    | 'suggest_alias'
    | 'needs_review';
  resolvedKind: string | null;
};

type UnmatchedRow = {
  id: string;
  activity: string;
  package_id: string | null;
  package_title: string | null;
  day_number: number | null;
  country: string | null;
  region: string | null;
  occurrence_count: number | null;
  segment_kind_guess: string | null;
  confidence: number | null;
};

const PRICE_NOISE_RE =
  /(?:^\s*$|^\d{1,4}(?:,\d{3})*(?:\s*(?:원|krw|usd|\$))?$|^\d+\s*월\s*기준$|가격|요금|판매가|출발일|마감일|성인|아동|소아|예약금|총\s*금액|취소료|수수료|^\d{1,2}[./-]\d{1,2})/i;
const MEAL_RE =
  /(?:조식|중식|석식|석\s*-\s*한\s*식|식사|식당|레스토랑|뷔페|뷔페식|현지식|한식|특식|선상식|클럽식|콜드밀|제육|찌개|과일\s*시식|연꽃잎차|못주스|breakfast|lunch|dinner|meal|restaurant|rice noodle|pho)/i;
const TRANSFER_RE =
  /(?:^[A-Z]{3}(?:-[A-Z]{3})?$|이동|차량|버스|공항|픽업|샌딩|전용차|기사|미팅|transfer|pickup|drop[-\s]?off|airport)/i;
const HOTEL_RE =
  /(?:호텔|리조트|숙박|객실|체크\s*인|체크\s*아웃|투숙|동급|준5성|정5성|노보텔|하얏트|힐튼|풀만|렌조이|hotel|resort|villa|room|check[-\s]?in|check[-\s]?out)/i;
const SHOPPING_RE =
  /(?:쇼핑|면세|기념품|토산품|특산품|아울렛|라텍스|잡화|mall|outlet|shopping)/i;
const OPTION_RE =
  /(?:선택\s*관광|옵션|마사지|스파|공연|쇼|투어|입장권|체험|골프|라운딩|optional|option|spa|massage|ticket|show|tour)/i;
const FREE_TIME_RE =
  /(?:^오\s*(?:전|후)$|자유\s*시간|자유일정|리조트내\s*자유|오전\s*자유|오후\s*자유|free\s*time|rest)/i;
const NOTICE_RE =
  /(?:안내|공지|주의|준비물|수영복|선크림|여벌\s*옷|아쿠아슈즈|장비|구명조끼|미끼|상기\s*일정|아래\s*일정|필수\s*관광\s*\d*|미진행시|제공\s*X|취소|환불|비자|여권|입국|출국|예약금|수수료|변경|현지\s*사정|항공\s*및\s*현지\s*사정|천재지변|양해|notice|caution|refund|cancel|visa|passport)/i;
const ATTRACTION_HINT_RE =
  /(?:공원|사원|성당|교회|유적|박물관|기념관|거리|시장|타워|비치|해변|광장|전망대|케이블카|마을|천등|폭포|온천|정원|야시장|유람선|호수|계림|temple|park|museum|beach|market|tower|garden)/i;

const KO_PRICE_NOISE_RE =
  /(?:^\s*$|^\d{1,4}(?:,\d{3})*(?:\s*(?:원|krw|usd|\$))?$|^\d+\s*원\s*기준?$|가격|요금|판매가|출발\s*마감|할인|성인|아동|소아|유아|예약금|총\s*금액|취소료|수수료|^\d{1,2}[./-]\d{1,2})/i;
const KO_MEAL_RE =
  /(?:조식|중식|석식|식사|식당|레스토랑|뷔페|특식|한식|현지식|도시락|제육|찌개|쌀국수|과일\s*제공|모닝콜|breakfast|lunch|dinner|meal|restaurant|rice noodle|pho)/i;
const KO_MEAL_ABBREVIATION_RE = /(?:\uC11D\s*-\s*\uD55C\s*\uC2DD)/i;
const KO_TRANSFER_RE =
  /(?:^[A-Z]{3}(?:-[A-Z]{3})?$|이동|차량|버스|공항|픽업|샌딩|전용차|기사|미팅|transfer|pickup|drop[-\s]?off|airport)/i;
const KO_HOTEL_RE =
  /(?:호텔|리조트|숙박|객실|체크\s*인|체크\s*아웃|투숙|휴식|동급|준\s*\d?\s*성급|풀빌라|hotel|resort|villa|room|check[-\s]?in|check[-\s]?out)/i;
const KO_SHOPPING_RE =
  /(?:쇼핑|면세|기념품|특산품|농수산|라텍스|잡화|쇼핑센터|호화호특|mall|outlet|shopping)/i;
const KO_OPTION_RE =
  /(?:선택\s*관광|옵션|마사지|스파|공연|투어|입장권|체험|골프|라운드|optional|option|spa|massage|ticket|show|tour)/i;
const KO_FREE_TIME_RE =
  /(?:^\s*(?:오\s*전|오\s*후)\s*$|자유\s*시간|자유\s*일정|리조트\s*내\s*자유|오전\s*자유|오후\s*자유|free\s*time|rest)/i;
const KO_NOTICE_RE =
  /(?:안내|공지|주의|준비물|상기\s*일정|아래\s*일정|필수\s*관광\s*\d*|미진행\s*시|제공\s*X|취소|환불|비자|여권|입국|출국|예약금|수수료|변경될\s*수|현지\s*사정|항공\s*및\s*현지\s*사정|천재지변|기상|notice|caution|refund|cancel|visa|passport)/i;
const KO_ATTRACTION_HINT_RE =
  /(?:공원|사원|성당|교회|유적|박물관|기념관|거리|시장|야시장|비치|해변|광장|전망대|케이블카|마을|천등|폭포|온천|정원|계림|관광지명|temple|park|museum|beach|market|tower|garden)/i;

const NORMAL_PRICE_NOISE_RE =
  /(?:^\s*\d{3,5}\s*M\s*$|^\s*\d{1,4}(?:,\d{3})*(?:\s*(?:원|KRW|USD|\$))?\s*$|가격|판매가|출발\s*마감|예약금|취소료|수수료)/i;
const NORMAL_MEAL_RE =
  /(?:조식|중식|석식|식사|식당|뷔페|특식|현지식|호텔식|한식|제육|찌개|보쌈|쌀국수|김밥|샤브샤브|양꼬치|삼겹살|씨푸드|해산물|맥주\s*1\s*병|노미호다이|breakfast|lunch|dinner|meal|restaurant|pho)/i;
const NORMAL_NOTICE_RE =
  /(?:상기\s*일정|현지\s*사정|항공\s*및\s*현지\s*사정|변동될\s*수|변경될\s*수|양해|안내|공지|주의|준비물|여권|비자|취소|환불|입국|출국|예약금|수수료|미제공|제공\s*X|필수\s*관광)/i;
const NORMAL_TRANSFER_RE =
  /(?:^[A-Z]{3}(?:-[A-Z]{3})?$|이동|차량|버스|공항|픽업|샌딩|전용차|기사|미팅|귀환|부산-광저우|샤오관|transfer|pickup|drop[-\s]?off|airport)/i;
const NORMAL_PLACE_TRANSFER_RE =
  /^(?:하노이|파타야|삿포로|치토세|후쿠오카|석가장|임주|다낭|푸꾸옥|나트랑|달랏|광저우|천저우|샤오관)$/i;
const NORMAL_HOTEL_RE =
  /(?:호텔|리조트|숙박|객실|체크\s*인|체크\s*아웃|뉴카멜리아|hotel|resort|villa|room|check[-\s]?in|check[-\s]?out)/i;
const NORMAL_SHOPPING_RE =
  /(?:쇼핑|면세|명품샵|기념품|토산품|특산품|농수산|라텍스|잡화|쇼핑센터|아울렛|mall|outlet|shopping)/i;
const NORMAL_OPTION_RE =
  /(?:선택\s*관광|옵션|마사지|스파|공연|쇼|입장권|자유이용권|케이블카|왕복케이블카|전통복장체험|소원배|소원등|드론촬영|나룻배|골프|라운드|라운딩|optional|option|spa|massage|ticket|show)/i;
const NORMAL_OPTION_HEADING_NOISE_RE =
  /^\s*[【[\(]?\s*(?:추천\s*)?(?:옵션|선택관광)\s*[】\]\)]?\s*$/i;
const NORMAL_GOLF_TAG_RE =
  /^\s*#\s*다색골프\s*$/i;
const NORMAL_FREE_TIME_RE =
  /(?:자유\s*시간|자유\s*일정|휴식|리조트\s*내\s*자유|오전\s*자유|오후\s*자유|free\s*time|rest)/i;
const NORMAL_NOISE_RE =
  /(?:^=+>$|^전용$|대기시간\s*최소화|중복\s*없는\s*관광\s*동선|탑승하여|차창|울창한\s*밀림과\s*자연경관|사막\s*진입시\s*케이블카\s*또는\s*버스\s*이용|^\s*\d{3,5}\s*M\s*$)/i;
const NORMAL_ATTRACTION_HINT_RE =
  /(?:공원|사원|성당|교회|유적|박물관|기념관|거리|시장|비치|해변|광장|브릿지|마을|천등|온천|정원|풍경구|구시가지|사찰|temple|park|museum|beach|market|tower|garden)/i;

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function categoryFromExisting(value: string | null): UnmatchedEntityCategory | null {
  const allowed = new Set<UnmatchedEntityCategory>([
    'attraction',
    'hotel',
    'meal',
    'transfer',
    'shopping',
    'optional_tour',
    'free_time',
    'notice',
    'price_noise',
    'unknown',
  ]);
  return allowed.has(value as UnmatchedEntityCategory) ? value as UnmatchedEntityCategory : null;
}

export function classifyUnmatchedActivity(
  activity: string,
  existingCategory: string | null = null,
): ClassifiedUnmatched {
  const text = normalizeText(activity);
  const existing = categoryFromExisting(existingCategory);

  let category: UnmatchedEntityCategory = existing ?? 'attraction';
  let confidence = existing ? 0.72 : 0.65;

  if (!text || KO_PRICE_NOISE_RE.test(text) || NORMAL_PRICE_NOISE_RE.test(text)) {
    category = 'price_noise';
    confidence = 0.92;
  } else if (NORMAL_OPTION_HEADING_NOISE_RE.test(text)) {
    category = 'free_time';
    confidence = 0.9;
  } else if (KO_MEAL_RE.test(text) || KO_MEAL_ABBREVIATION_RE.test(text) || NORMAL_MEAL_RE.test(text)) {
    category = 'meal';
    confidence = 0.9;
  } else if (KO_NOTICE_RE.test(text) || NORMAL_NOTICE_RE.test(text)) {
    category = 'notice';
    confidence = 0.84;
  } else if (NORMAL_NOISE_RE.test(text)) {
    category = 'free_time';
    confidence = 0.9;
  } else if (KO_TRANSFER_RE.test(text) || NORMAL_TRANSFER_RE.test(text) || NORMAL_PLACE_TRANSFER_RE.test(text)) {
    category = 'transfer';
    confidence = 0.9;
  } else if (KO_HOTEL_RE.test(text) || NORMAL_HOTEL_RE.test(text)) {
    category = 'hotel';
    confidence = 0.86;
  } else if (KO_SHOPPING_RE.test(text) || NORMAL_SHOPPING_RE.test(text)) {
    category = 'shopping';
    confidence = 0.86;
  } else if (KO_OPTION_RE.test(text) || NORMAL_OPTION_RE.test(text)) {
    category = 'optional_tour';
    confidence = 0.86;
  } else if (KO_FREE_TIME_RE.test(text) || NORMAL_FREE_TIME_RE.test(text)) {
    category = 'free_time';
    confidence = 0.92;
  } else if (KO_ATTRACTION_HINT_RE.test(text) || NORMAL_ATTRACTION_HINT_RE.test(text)) {
    category = 'attraction';
    confidence = 0.78;
  }

  if (category === 'meal' || category === 'transfer') {
    return {
      category,
      confidence,
      terminalStatus: confidence >= 0.85 ? 'added' : 'pending',
      suggestedAction: confidence >= 0.85 ? 'auto_resolve_existing' : 'needs_review',
      resolvedKind: confidence >= 0.85 ? `auto_entity_${category}` : null,
    };
  }

  if (category === 'shopping') {
    return {
      category,
      confidence,
      terminalStatus: confidence >= 0.85 ? 'added' : 'pending',
      suggestedAction: confidence >= 0.85 ? 'structure_non_master' : 'needs_review',
      resolvedKind: confidence >= 0.85 ? 'auto_entity_shopping_non_master' : null,
    };
  }

  if (category === 'optional_tour' && NORMAL_GOLF_TAG_RE.test(text)) {
    return {
      category,
      confidence,
      terminalStatus: 'added',
      suggestedAction: 'structure_non_master',
      resolvedKind: 'auto_entity_optional_tour_non_master',
    };
  }

  if (category === 'free_time' || category === 'price_noise') {
    return {
      category,
      confidence,
      terminalStatus: confidence >= 0.85 ? 'ignored' : 'pending',
      suggestedAction: confidence >= 0.85 ? 'auto_ignore_noise' : 'needs_review',
      resolvedKind: confidence >= 0.85 ? `auto_ignore_${category}` : null,
    };
  }

  return {
    category,
    confidence,
    terminalStatus: 'pending',
    suggestedAction: category === 'attraction'
      ? 'needs_new_master'
      : category === 'hotel'
        ? 'suggest_alias'
        : 'needs_review',
    resolvedKind: null,
  };
}

function sourceContext(row: UnmatchedRow, category: UnmatchedEntityCategory): Record<string, unknown> {
  return {
    package_id: row.package_id,
    package_title: row.package_title,
    day_number: row.day_number,
    country: row.country,
    destination: row.region ?? row.country,
    customer_visible: !['price_noise', 'free_time', 'notice'].includes(category),
    classifier: 'unmatched-classifier-v2',
    classified_at: new Date().toISOString(),
  };
}

function resolution(
  row: UnmatchedRow,
  classified: ClassifiedUnmatched,
  attractionSuggestion: Record<string, unknown> | null,
): Record<string, unknown> {
  return {
    category: classified.category,
    action: classified.suggestedAction,
    country_scope: row.country,
    destination_scope: row.region ?? row.country,
    attraction_suggestion: attractionSuggestion,
    policy: classified.category === 'attraction'
      ? 'match-existing-only-no-auto-create'
      : 'entity-category-classification-no-master-create',
  };
}

async function fetchActiveUnmatched(limit: number): Promise<UnmatchedRow[]> {
  const { data, error } = await supabaseAdmin
    .from('unmatched_activities')
    .select('id, activity, package_id, package_title, day_number, country, region, occurrence_count, segment_kind_guess, confidence')
    .eq('status', 'pending')
    .is('resolved_at', null)
    .order('occurrence_count', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as UnmatchedRow[];
}

async function fetchAttractions(): Promise<AttractionSuggestRow[]> {
  const rows: AttractionSuggestRow[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabaseAdmin
      .from('attractions')
      .select('id, name, aliases, region, country, category, emoji, short_desc')
      .eq('is_active', true)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...(data as AttractionSuggestRow[]));
    if (data.length < pageSize) break;
  }
  return rows;
}

async function addAlias(attraction: AttractionSuggestRow, alias: string): Promise<boolean> {
  const cleanAlias = normalizeText(alias);
  if (cleanAlias.length < 2 || cleanAlias.length > 80) return false;
  const aliases = attraction.aliases ?? [];
  if (aliases.includes(cleanAlias) || attraction.name === cleanAlias) return false;
  const nextAliases = [...new Set([...aliases, cleanAlias])];
  const { error } = await supabaseAdmin
    .from('attractions')
    .update({ aliases: nextAliases })
    .eq('id', attraction.id);
  if (error) throw error;
  attraction.aliases = nextAliases;
  return true;
}

export async function runUnmatchedClassification(options: {
  limit?: number;
  minAttractionScore?: number;
} = {}) {
  if (!isSupabaseConfigured) {
    return { ok: true, scanned: 0, updated: 0, autoAdded: 0, autoIgnored: 0, aliasAdded: 0, errors: [] as string[] };
  }

  const limit = Math.max(1, Math.min(1000, options.limit ?? 300));
  const minAttractionScore = Math.max(30, Math.min(120, options.minAttractionScore ?? 95));
  const [rows, attractions] = await Promise.all([fetchActiveUnmatched(limit), fetchAttractions()]);
  const errors: string[] = [];
  let updated = 0;
  let autoAdded = 0;
  let autoIgnored = 0;
  let aliasAdded = 0;

  for (const row of rows) {
    try {
      const classified = classifyUnmatchedActivity(row.activity, row.segment_kind_guess);
      let resolvedAttractionId: string | null = null;
      let attractionSuggestion: Record<string, unknown> | null = null;
      let status = classified.terminalStatus;
      let resolvedKind = classified.resolvedKind;
      let suggestedAction = classified.suggestedAction;

      if (classified.category === 'attraction') {
        const scoped = attractions.filter(attr =>
          (!row.region || !attr.region || row.region === attr.region) &&
          (!row.country || !attr.country || row.country === attr.country));
        const pool = scoped.length > 0 ? scoped : attractions;
        const { suggestions } = suggestAttractionsForActivity(row.activity, pool, minAttractionScore, 1);
        if (suggestions.length > 0) {
          const top = suggestions[0];
          const target = attractions.find(attr => attr.id === top.id);
          if (target) {
            if (await addAlias(target, row.activity)) aliasAdded++;
            resolvedAttractionId = top.id;
            status = 'added';
            resolvedKind = 'auto_classifier_existing_attraction';
            suggestedAction = 'auto_resolve_existing';
            attractionSuggestion = {
              id: top.id,
              name: top.name,
              score: top.score,
              matched_via: top.matched_via,
              matched_term: top.matched_term,
            };
          }
        }
      }

      const now = new Date().toISOString();
      const update: Record<string, unknown> = {
        segment_kind_guess: classified.category,
        confidence: classified.confidence,
        suggested_action: suggestedAction,
        suggested_resolution: resolution(row, { ...classified, suggestedAction }, attractionSuggestion),
        source_context: sourceContext(row, classified.category),
        classification_version: 'unmatched-classifier-v2',
        updated_at: now,
      };

      if (status !== 'pending') {
        update.status = status;
        update.resolved_at = now;
        update.resolved_kind = resolvedKind ?? `auto_classifier_${classified.category}`;
        update.resolved_by = 'cron_unmatched_classify';
        if (resolvedAttractionId) update.resolved_attraction_id = resolvedAttractionId;
      }

      const { error } = await supabaseAdmin
        .from('unmatched_activities')
        .update(update)
        .eq('id', row.id)
        .eq('status', 'pending')
        .is('resolved_at', null);
      if (error) throw error;
      updated++;
      if (status === 'added') autoAdded++;
      if (status === 'ignored') autoIgnored++;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return {
    ok: errors.length === 0,
    scanned: rows.length,
    updated,
    autoAdded,
    autoIgnored,
    aliasAdded,
    minAttractionScore,
    errors: errors.slice(0, 20),
  };
}

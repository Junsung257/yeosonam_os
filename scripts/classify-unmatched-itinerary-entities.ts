import { createHash } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { suggestAttractionsForActivity, type AttractionSuggestRow } from '../src/lib/unmatched-suggest';

loadEnv({ path: '.env.local' });
loadEnv();

type EntityCategory =
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

type SuggestedAction =
  | 'auto_resolve_existing'
  | 'auto_ignore_noise'
  | 'suggest_alias'
  | 'needs_new_master'
  | 'needs_review';

type UnmatchedRow = {
  id: string;
  activity: string;
  package_id: string | null;
  package_title: string | null;
  day_number: number | null;
  country: string | null;
  region: string | null;
  occurrence_count: number | null;
  status: string | null;
  resolved_at: string | null;
  segment_kind_guess: string | null;
  confidence: number | null;
};

type ClassifiedRow = {
  row: UnmatchedRow;
  category: EntityCategory;
  confidence: number;
  action: SuggestedAction;
  status: 'pending' | 'added' | 'ignored';
  resolvedKind: string | null;
  resolvedAttractionId: string | null;
  suggestedResolution: Record<string, unknown>;
  sourceContext: Record<string, unknown>;
};

const args = new Set(process.argv.slice(2));
const argValue = (name: string, fallback: string) => {
  const found = process.argv.find(arg => arg.startsWith(`${name}=`));
  return found ? found.slice(name.length + 1) : fallback;
};

const apply = args.has('--apply');
const json = args.has('--json');
const limit = Number(argValue('--limit', '5000'));
const minAttractionScore = Number(argValue('--min-attraction-score', '100'));
const classificationVersion = `entity-sweep-v1-${new Date().toISOString().slice(0, 10)}`;

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error('Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

const CATEGORY_VALUES: EntityCategory[] = [
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
];

const MEAL_RE = /breakfast|lunch|dinner|meal|조식|중식|석식|식사|특식|한식|현지식|뷔페|bbq|쌀\s*국수|pho|포\s*함\s*식|호텔식|가이세키|화양식|에피타이저|사시미|회정식|카이센|해물전골|샤브샤브|우동|디저트|야채절임|생선회|열대과일|못주스|연꽃잎차|커피|주스|음료|도시락|꿔바로우|규샤브샤브|된장국|튀김|구이|찜|御膳|刺身|鍋|季節|しゃぶしゃぶ|和牛/i;
const TRANSFER_RE = /transfer|이동|차량|전용\s*차량|버스|송영|픽업|샌딩|드랍|공항.*호텔|호텔.*공항|운전기사|셔틀\s*탑승|공항으로|전동차|부산\s*출발|개별\s*수속|국제공항\s*도착|약\s*\d+\s*(?:분|시간)\s*소요|약\s*\d+\s*분\s*~\s*\d+\s*분\s*소요/i;
const HOTEL_RE = /hotel|resort|호텔|리조트|숙박|풀\s*빌라|빌라|객실|체크\s*인|체크\s*아웃|기내\s*박|기\s*내\s*박|2\s*인실|룸\s*타입|스탠다드/i;
const SHOPPING_RE = /shopping|쇼핑|면세|쇼핑\s*센터|기념품|토산품|잡화|라텍스|노니|침향|건강보조식품|진주/i;
const OPTION_RE = /option|optional|선택\s*관광|추천\s*관광|옵션|현지\s*지불|마사지|스파|크루즈|공연|쇼|호핑|씨워크|파라세일링|다이빙|체험|티켓|입장권|디스커버리\s*투어|추천\s*옵션|강력\s*추천\s*옵션|무료\s*강습|특전/i;
const GOLF_DETAIL_RE = /골프장\s*정보|코스정보|티\s*타임|티업|그린피|캐디피|카트피|캐디\s*팁|캐디팁|싱글\s*카트|클럽\s*렌탈|현장\s*결제|홀수\s*인원|라운딩|스루\s*라운딩|셀프\s*라운딩|스루\s*플레이|락카|락커|대욕장|일몰시\s*플레이/i;
const FREE_TIME_RE = /free\s*time|자유\s*시간|자유일정|휴식/i;
const NOTICE_RE = /notice|안내|공지|주의|여권|비자|전자\s*담배|취소|환불|수수료|예약금|가이드|기사\s*팁|매너\s*팁|포함|불\s*포\s*함|불포함|보험|유류|싱글\s*차지|상기\s*일정|현지\s*사정|항공사\s*사정|천재지변|항\s*공|특별\s*약관|현금\s*영수증|사진은|날씨\s*사정|변경될\s*수|총\s*금액.*공제|추가\s*요금|공휴일|지상비|행사\s*완료|확정된\s*금액|출발\s*가능|패키지\s*상품|파이널|입금/i;
const PRICE_NOISE_RE = /^(?:price|가격|요금|판매가|출발일|요일|인원|룸타입|룸\s*타\s*입|pkg|package|product)\b|^[1-9]\d{0,2}(?:,\d{3})?,\s*-$|(?:\d[\d,]*\s*(?:원|KRW|₩|엔)|(?:KRW|₩)\s*\d|\d[\d,]*\s*\/\s*1인당)|^\d{1,2}\/\d{1,2}|^\d{3,}(?:,\d{3})*$/i;
const AGE_PRICE_RE = /^(?:[*\-]\s*)?(?:성인|소아|아동|유아|만\s*\d|어린이).*\d[\d,]*\s*원/i;
const TABLE_NOISE_RE = /^(?:월|화|수|목|금|토|일)(?:\s*,\s*(?:월|화|수|목|금|토|일))*$|^또는$|^확인$|^https?:?$|^www\.|\.html$|^travel\.|스팟\s*특가|실시간\s*항공\s*기준|항공\s*그룹\s*요금|^패턴$|선발\s*제외일|^지\s*역$|일정\s*정보\s*없음|^\d{4}년.*\[\d박\d일\]$|^\/?\d{1,2}(?:[,/]\d{1,2})*(?:\s*[월화수목금토일])?(?:\s*\d박)?$|^~\d+$|^\*?\d{1,2}\/\d{1,2}\s*[월화수목금토일]?\s*\d박\*?$|^세이브$|^노노노\+?$|프리미엄\s*노노노|투어코코넛\s*\d+%/i;
const CITY_LABEL_RE = /^(?:후쿠오카|치\s*바|도\s*스|choshi|연\s*길|나리타|달랏|푸꾸옥)$/i;
const PURE_SYMBOL_RE = /^[\s:.,\-+*/()[\]{}]+$/;
const HIGH_RISK_NOTICE_RE = /(?:취소|환불|비자|여권|입국|출국|보험|예약금|결제|추가\s*요금|가격\s*변동|유류|수수료|환율|여행자\s*보험)/i;
const LOW_RISK_SCHEDULE_NOTICE_RE = /(?:상기\s*일정|현지\s*사정|항공사의?\s*사정|다소\s*변동|변경될\s*수|양지하시기|천재지변)/i;
const OPTION_STRUCTURED_DETAIL_RE = /(?:골프장\s*정보|그린피|캐디피|카트피|캐디팁|티타임|코스정보|홀수\s*인원|싱글카트|클럽\s*렌탈|현장\s*결제|락카\s*사용|라커\s*사용)/i;
const HOTEL_STRUCTURED_DETAIL_RE = /(?:^\s*\d+\s*인실|스탠다드|디럭스|슈페리어|기\s*내\s*박|기내박|룸\s*타입|객실\s*타입)/i;
const ROUNDING_AFTER_RE = /^[-*\s]*라운딩\s*후$/i;
const GOLF_OPTION_RE = /(?:\b[A-Z]{1,4}\s*코리아\b|CC\b|골프|라운딩|티업|스루|셀프라운딩|일몰시|플레이\s*종료|나리타노모리|나리타히가시|로얄센트럴|루이시따|파인힐스)/i;
const GOLF_STRUCTURED_OPTION_RE = /(?:CC\b|골프장|18홀\s*라운딩|라운딩|오후\s*티업|티업|스루|셀프라운딩|일몰시|플레이\s*종료|나리타노모리|나리타히가시|로얄센트럴|루이시따|파인힐스)/i;
const GOLF_METRIC_RE = /(?:\b\d{2}\s*파|\b\d{3,5}\s*야드|주중\s*\/\s*주말\s*동일)/i;
const LOW_RISK_PREP_RE = /(?:준비물|수영복|구명조끼|미끼|편도\s*리프트|왕복\s*케이블카|유리전망대|편도\s*루지)/i;
const ATTRACTION_TEXT_RE = /(?:관광|공원|성당|마을|거리|비치|해변|호수|유람|케이블카|브릿지|다리|파크|타운|나이트\s*마켓|시장|성터|도자기|먹자골목|전망대|폭포|협곡|봉우리|절경|트래킹|테마파크|꽃놀이|녹차밭|사원|사찰|고성|성곽|박물관|유적|야간|정원|가든)/i;
const DESCRIPTIVE_FRAGMENT_RE = /(?:아름다운|에메랄드|광활한|유럽풍|기이한|형성된|역할을 하며|자태를 뽐내는|쏟아지는 별자리|길이\s*\d|높이\s*\d|직경\s*\d|총길이\s*\d)/i;
const SHOPPING_TEXT_RE = /(?:선물\s*구입|쇼핑|라텍스|잡화|기념품|면세|아울렛|몰\b|mall\b|Port\b)/i;
const HIGH_RISK_NOTICE_TEXT_RE = /(?:취소|공제|수수료|예약금|특별\s*약관|특별약관|현금영수증|여권|입국|이트래블|QR코드|발급|환불|결제|유효기간)/i;
const MEAL_TEXT_RE = /(?:^석\s*[:：]|^중\s*[:：]|^조\s*[:：]|반찬|일정식|쇼카도우고젠|저녁\s*메뉴|먹자골목|음식|식사|조식|중식|석식|디너|런치|메뉴\s*안내)/i;

function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function rawHash(value: string): string {
  return createHash('sha1').update(cleanText(value).toLowerCase()).digest('hex').slice(0, 16);
}

function standardCategory(value: string | null): EntityCategory | null {
  return CATEGORY_VALUES.includes(value as EntityCategory) ? value as EntityCategory : null;
}

function isSafeAutoStructuredEntity(category: EntityCategory, activity: string): boolean {
  if (category === 'notice') {
    return (LOW_RISK_SCHEDULE_NOTICE_RE.test(activity) && !HIGH_RISK_NOTICE_RE.test(activity)) ||
      LOW_RISK_PREP_RE.test(activity);
  }
  if (category === 'optional_tour') {
    return OPTION_STRUCTURED_DETAIL_RE.test(activity) ||
      GOLF_METRIC_RE.test(activity) ||
      GOLF_STRUCTURED_OPTION_RE.test(activity);
  }
  if (category === 'hotel') {
    return HOTEL_STRUCTURED_DETAIL_RE.test(activity);
  }
  return false;
}

function looksLikeRegionLabel(text: string, row?: Pick<UnmatchedRow, 'country' | 'region'>): boolean {
  if (!row) return false;
  const compact = text.replace(/\s+/g, '');
  if (compact.length < 2 || compact.length > 8) return false;
  const scope = `${row.country ?? ''} ${row.region ?? ''}`.replace(/\s+|\/|,/g, '');
  return scope.includes(compact);
}

function classifyText(
  activity: string,
  existingCategory: string | null,
  row?: Pick<UnmatchedRow, 'country' | 'region' | 'package_title'>,
): { category: EntityCategory; confidence: number } {
  const current = standardCategory(existingCategory);
  const text = cleanText(activity);
  const context = `${text} ${row?.package_title ?? ''}`;
  if (!text || PURE_SYMBOL_RE.test(text)) return { category: 'price_noise', confidence: 0.92 };
  if (ROUNDING_AFTER_RE.test(text)) return { category: 'price_noise', confidence: 0.92 };
  if (CITY_LABEL_RE.test(text) || looksLikeRegionLabel(text, row)) return { category: 'price_noise', confidence: 0.88 };
  if (TABLE_NOISE_RE.test(text)) return { category: 'price_noise', confidence: 0.9 };
  if (AGE_PRICE_RE.test(text)) return { category: 'price_noise', confidence: 0.92 };
  if (PRICE_NOISE_RE.test(text)) return { category: 'price_noise', confidence: 0.9 };
  if (/^(?:길이|높이|직경|총길이)\s*\d/i.test(text)) return { category: 'price_noise', confidence: 0.9 };
  if (SHOPPING_TEXT_RE.test(text)) return { category: 'shopping', confidence: 0.88 };
  if (GOLF_METRIC_RE.test(text)) return { category: 'optional_tour', confidence: 0.9 };
  if (LOW_RISK_PREP_RE.test(text)) return { category: 'notice', confidence: 0.88 };
  if (HIGH_RISK_NOTICE_TEXT_RE.test(text)) return { category: 'notice', confidence: 0.88 };
  if (MEAL_TEXT_RE.test(text)) return { category: 'meal', confidence: 0.88 };
  if (MEAL_RE.test(text)) return { category: 'meal', confidence: 0.9 };
  if (TRANSFER_RE.test(text)) return { category: 'transfer', confidence: 0.9 };
  if (FREE_TIME_RE.test(text)) return { category: 'free_time', confidence: 0.92 };
  if (HOTEL_RE.test(text)) return { category: 'hotel', confidence: 0.86 };
  if (SHOPPING_RE.test(text)) return { category: 'shopping', confidence: 0.88 };
  if (GOLF_DETAIL_RE.test(text)) return { category: 'optional_tour', confidence: 0.88 };
  if (OPTION_RE.test(text)) return { category: 'optional_tour', confidence: 0.88 };
  if (NOTICE_RE.test(text)) return { category: 'notice', confidence: 0.86 };
  if (GOLF_OPTION_RE.test(context)) return { category: 'optional_tour', confidence: 0.86 };
  if (ATTRACTION_TEXT_RE.test(text) || DESCRIPTIVE_FRAGMENT_RE.test(text)) return { category: 'attraction', confidence: 0.72 };
  if (current) return { category: current, confidence: 0.72 };
  return { category: text.length >= 2 ? 'attraction' : 'unknown', confidence: text.length >= 2 ? 0.65 : 0.5 };
}

function actionFor(category: EntityCategory, confidence: number, resolvedAttractionId: string | null): SuggestedAction {
  if (resolvedAttractionId) return 'auto_resolve_existing';
  if (category === 'meal' || category === 'transfer' || category === 'free_time' || category === 'price_noise') {
    return confidence >= 0.85 ? (category === 'price_noise' || category === 'free_time' ? 'auto_ignore_noise' : 'auto_resolve_existing') : 'needs_review';
  }
  if (category === 'attraction') return 'needs_new_master';
  if (category === 'hotel') return 'needs_new_master';
  return 'needs_review';
}

function statusFor(category: EntityCategory, confidence: number, resolvedAttractionId: string | null, activity = ''): ClassifiedRow['status'] {
  if (resolvedAttractionId) return 'added';
  if ((category === 'meal' || category === 'transfer') && confidence >= 0.85) return 'added';
  if ((category === 'free_time' || category === 'price_noise') && confidence >= 0.85) return 'ignored';
  if (confidence >= 0.85 && isSafeAutoStructuredEntity(category, activity)) return 'added';
  return 'pending';
}

function sourceContext(row: UnmatchedRow, category: EntityCategory): Record<string, unknown> {
  return {
    package_id: row.package_id,
    package_title: row.package_title,
    day_number: row.day_number,
    country: row.country,
    destination: row.region ?? row.country,
    raw_hash: rawHash(row.activity),
    customer_visible: !['price_noise', 'free_time'].includes(category),
    sweep: 'classify-unmatched-itinerary-entities',
    swept_at: new Date().toISOString(),
  };
}

function resolution(row: UnmatchedRow, category: EntityCategory, action: SuggestedAction, attractionSuggestion: unknown): Record<string, unknown> {
  return {
    category,
    action,
    auto_structured: isSafeAutoStructuredEntity(category, row.activity),
    country_scope: row.country,
    destination_scope: row.region ?? row.country,
    raw_hash: rawHash(row.activity),
    attraction_suggestion: attractionSuggestion,
    policy: category === 'attraction'
      ? 'match-existing-only-no-auto-create'
      : 'entity-category-classification-no-master-create',
  };
}

async function fetchUnmatchedRows(): Promise<UnmatchedRow[]> {
  const rows: UnmatchedRow[] = [];
  const pageSize = 1000;
  for (let from = 0; from < limit; from += pageSize) {
    const to = Math.min(from + pageSize - 1, limit - 1);
    const { data, error } = await supabase
      .from('unmatched_activities')
      .select('id, activity, package_id, package_title, day_number, country, region, occurrence_count, status, resolved_at, segment_kind_guess, confidence')
      .eq('status', 'pending')
      .is('resolved_at', null)
      .order('occurrence_count', { ascending: false })
      .range(from, to);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data as UnmatchedRow[]);
    if (data.length < pageSize) break;
  }
  return rows;
}

async function fetchAttractions(): Promise<AttractionSuggestRow[]> {
  const rows: AttractionSuggestRow[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('attractions')
      .select('id, name, aliases, region, country, category, emoji, short_desc')
      .eq('is_active', true)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data as AttractionSuggestRow[]);
    if (data.length < pageSize) break;
  }
  return rows;
}

function classifyRow(row: UnmatchedRow, attractions: AttractionSuggestRow[]): ClassifiedRow {
  const classified = classifyText(row.activity, row.segment_kind_guess, row);
  let attractionSuggestion: Record<string, unknown> | null = null;
  let resolvedAttractionId: string | null = null;

  if (classified.category === 'attraction') {
    const scoped = attractions.filter(attr =>
      (!row.region || !attr.region || row.region === attr.region) &&
      (!row.country || !attr.country || row.country === attr.country));
    const pool = scoped.length > 0 ? scoped : attractions;
    const { suggestions } = suggestAttractionsForActivity(row.activity, pool, minAttractionScore, 1);
    if (suggestions.length > 0) {
      const top = suggestions[0];
      resolvedAttractionId = top.id;
      attractionSuggestion = {
        id: top.id,
        name: top.name,
        score: top.score,
        matched_via: top.matched_via,
        matched_term: top.matched_term,
      };
    }
  }

  const status = statusFor(classified.category, classified.confidence, resolvedAttractionId, row.activity);
  const action = status === 'added' && isSafeAutoStructuredEntity(classified.category, row.activity)
    ? 'auto_resolve_existing'
    : actionFor(classified.category, classified.confidence, resolvedAttractionId);

  return {
    row,
    category: classified.category,
    confidence: classified.confidence,
    action,
    status,
    resolvedKind: status === 'added'
      ? (resolvedAttractionId
        ? 'sweep_existing_attraction_match'
        : isSafeAutoStructuredEntity(classified.category, row.activity)
          ? `sweep_auto_structured_${classified.category}`
          : `sweep_entity_${classified.category}`)
      : status === 'ignored'
        ? `sweep_ignore_${classified.category}`
        : null,
    resolvedAttractionId,
    suggestedResolution: resolution(row, classified.category, action, attractionSuggestion),
    sourceContext: sourceContext(row, classified.category),
  };
}

async function maybeAddAlias(item: ClassifiedRow, attractions: AttractionSuggestRow[]) {
  if (!item.resolvedAttractionId) return false;
  const raw = cleanText(item.row.activity);
  if (raw.length > 60) return false;
  const attraction = attractions.find(attr => attr.id === item.resolvedAttractionId);
  if (!attraction) return false;
  const aliases = attraction.aliases ?? [];
  if (aliases.includes(raw) || attraction.name === raw) return false;
  const { error } = await supabase
    .from('attractions')
    .update({ aliases: [...new Set([...aliases, raw])] })
    .eq('id', attraction.id);
  if (error) throw error;
  attraction.aliases = [...new Set([...aliases, raw])];
  return true;
}

async function applyClassification(item: ClassifiedRow, attractions: AttractionSuggestRow[]) {
  const update: Record<string, unknown> = {
    segment_kind_guess: item.category,
    confidence: item.confidence,
    suggested_action: item.action,
    suggested_resolution: item.suggestedResolution,
    source_context: item.sourceContext,
    classification_version: classificationVersion,
    updated_at: new Date().toISOString(),
  };

  if (item.status !== 'pending') {
    update.status = item.status;
    update.resolved_at = new Date().toISOString();
    update.resolved_kind = item.resolvedKind;
    update.resolved_by = 'classify_unmatched_itinerary_entities';
  }
  if (item.resolvedAttractionId) {
    update.resolved_attraction_id = item.resolvedAttractionId;
  }

  const aliasAdded = await maybeAddAlias(item, attractions);
  const { error } = await supabase
    .from('unmatched_activities')
    .update(update)
    .eq('id', item.row.id);
  if (error) throw error;
  return { aliasAdded };
}

function summarize(items: ClassifiedRow[]) {
  const summary = {
    scanned: items.length,
    by_category: Object.fromEntries(CATEGORY_VALUES.map(category => [category, 0])) as Record<EntityCategory, number>,
    by_action: {} as Record<SuggestedAction, number>,
    by_status: { pending: 0, added: 0, ignored: 0 },
    existing_attraction_matches: 0,
  };
  for (const item of items) {
    summary.by_category[item.category]++;
    summary.by_action[item.action] = (summary.by_action[item.action] ?? 0) + 1;
    summary.by_status[item.status]++;
    if (item.resolvedAttractionId) summary.existing_attraction_matches++;
  }
  return summary;
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null) {
    return JSON.stringify(error);
  }
  return String(error);
}

async function main() {
  const [rows, attractions] = await Promise.all([fetchUnmatchedRows(), fetchAttractions()]);
  const classified = rows.map(row => classifyRow(row, attractions));
  const summary = summarize(classified);
  let applied = 0;
  let aliasAdded = 0;
  const errors: Array<{ id: string; activity: string; error: string }> = [];

  if (apply) {
    for (const item of classified) {
      try {
        const result = await applyClassification(item, attractions);
        applied++;
        if (result.aliasAdded) aliasAdded++;
      } catch (error) {
        errors.push({
          id: item.row.id,
          activity: item.row.activity,
          error: formatError(error),
        });
      }
    }
  }

  const samples = classified.slice(0, 20).map(item => ({
    id: item.row.id,
    activity: item.row.activity,
    category: item.category,
    confidence: item.confidence,
    action: item.action,
    status: item.status,
    attraction_id: item.resolvedAttractionId,
  }));

  const output = {
    apply,
    classification_version: classificationVersion,
    min_attraction_score: minAttractionScore,
    summary,
    applied,
    alias_added: aliasAdded,
    errors,
    samples,
  };

  if (json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(output);
  }

  if (errors.length > 0) process.exitCode = 1;
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

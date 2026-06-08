import { createHash } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

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

type NoiseAuditKind =
  | 'true_noise'
  | 'price_or_date_evidence'
  | 'customer_notice'
  | 'shopping_notice'
  | 'optional_service'
  | 'transfer_event'
  | 'meal_event'
  | 'hotel_event'
  | 'flight_event'
  | 'possible_attraction'
  | 'unknown_review';

type RescueDecision = {
  category: EntityCategory;
  status: 'ignored' | 'added' | 'pending';
  suggestedAction: 'auto_resolve_existing' | 'auto_ignore_noise' | 'needs_new_master' | 'needs_review';
  resolvedKind: string | null;
  auditKind: NoiseAuditKind;
  confidence: number;
  usableSignal: boolean;
  reason: string;
};

type IgnoredRow = {
  id: string;
  activity: string | null;
  package_id: string | null;
  package_title: string | null;
  day_number: number | null;
  country: string | null;
  region: string | null;
  occurrence_count: number | null;
  status: string | null;
  resolved_kind: string | null;
  resolved_at: string | null;
  segment_kind_guess: string | null;
  confidence: number | null;
  suggested_action: string | null;
  suggested_resolution: Record<string, unknown> | null;
  source_context: Record<string, unknown> | null;
  classification_version: string | null;
};

const args = new Set(process.argv.slice(2));
const argValue = (name: string, fallback: string) => {
  const found = process.argv.find(arg => arg.startsWith(`${name}=`));
  return found ? found.slice(name.length + 1) : fallback;
};

const apply = args.has('--apply');
const json = args.has('--json');
const limit = Number(argValue('--limit', '5000'));
function koreaDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

const version = `ignored-noise-audit-v1-${koreaDate()}`;

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error('Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

function normalize(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function hash(value: string): string {
  return createHash('sha1').update(normalize(value).toLowerCase()).digest('hex').slice(0, 16);
}

const PURE_NOISE_RE = /^[\s:.,\-+*/()[\]{}|~]+$/;
const PRICE_FRAGMENT_RE = /^(?:[*\-]\s*)?(?:\d{1,3}(?:,\d{3})+|\d{3,}),\s*-$|^\d{1,3}(?:,\d{3})+\s*(?:원|엔|달러)(?:\s*\/\s*1인당)?$|^\d{1,2}\/\d{1,2}(?:\s*~\s*\d{1,2}\/\d{1,2})?$|^\d{1,2}:\d{2}$|^\d{1,2}(?:[,/]\d{1,2})+$|^(?:월|화|수|목|금|토|일)(?:[,/](?:월|화|수|목|금|토|일))*$/i;
const TABLE_OR_LABEL_RE = /^(?:[*\-●▶☞♣]\s*)?(?:또는|확인|https?:|www\.|스팟특가|실시간\s*항공\s*기준|상품가|출발일|성인|소아|유아|아동|PKG|PACKAGE)$/i;
const AGE_PRICE_RE = /(?:성인|소아|아동|유아|만\s*\d|cm\s*미만).*\d[\d,]*\s*원/;
const CUSTOMER_NOTICE_RE = /(?:여권|유효기간|입국|이트래블|QR|비자|예약|발권|취소|환불|수수료|공제|확정|결제|입금|현금영수증|보험|천재지변|노쇼|변경|추가\s*요금|항공.*기준|항공.*요금|그룹요금|출발\s*가능|행사\s*완료|영수증|증빙|규정|안내|고지)/i;
const SHOPPING_RE = /(?:쇼핑|잡화|커피|노니|침향|기념품|특산품|면세|상점|재래시장|시장|쇼핑센터|건강보조|라텍스)/i;
const OPTIONAL_RE = /(?:옵션|선택관광|추천관광|마사지|스파|라운딩|TEE|티\s*오프|그린피|캐디|카트|골프장|홀\s*라운딩|스노쿨링|스노클링|호핑|BBQ|체험|입장권|투어|특전|증정|팁\s*별도)/i;
const TRANSFER_RE = /(?:이동|도착|출발|공항|국제공항|터미널|항구|부두|훼리|페리|승선|하선|입국\s*수속|출국\s*수속|체크인|차량|버스|보트|스피드보트|호텔로\s*이동|(?:시모노세키|하카타|부산|인천)항)/i;
const FLIGHT_RE = /^[A-Z0-9]{2}\s?\d{2,4}$/;
const HOTEL_RE = /(?:호텔|리조트|풀빌라|빌라|객실|숙박|투숙|체크인|체크아웃|룸|스탠다드|디럭스)/i;
const MEAL_RE = /(?:조식|중식|석식|식사|BBQ|뷔페|레스토랑|쌀국수|커피|주스|아이스크림|열대과일|과일|현지식|호텔식|선내식|불포함)/i;
const FREE_TIME_RE = /(?:자유시간|자유일정|휴식|리조트\s*내\s*자유)/i;
const LOW_VALUE_TEXT_RE = /^(?:살펴보기|추천|신비한|기회|체크|도스|치\s*바)$/i;

function isRegionLabel(text: string, row: IgnoredRow): boolean {
  const compact = text.replace(/\s+/g, '');
  if (compact.length < 2 || compact.length > 8) return false;
  const scope = `${row.country ?? ''} ${row.region ?? ''} ${row.package_title ?? ''}`.replace(/[\s,/()·[\]#-]+/g, '');
  return scope.includes(compact) && !TRANSFER_RE.test(text) && !CUSTOMER_NOTICE_RE.test(text);
}

function classifyIgnored(row: IgnoredRow): RescueDecision {
  const text = normalize(row.activity);

  if (!text || PURE_NOISE_RE.test(text) || LOW_VALUE_TEXT_RE.test(text)) {
    return {
      category: 'price_noise',
      status: 'ignored',
      suggestedAction: 'auto_ignore_noise',
      resolvedKind: 'noise_audit_true_noise',
      auditKind: 'true_noise',
      confidence: 0.92,
      usableSignal: false,
      reason: 'empty_symbol_or_low_value_fragment',
    };
  }

  if (PRICE_FRAGMENT_RE.test(text) || TABLE_OR_LABEL_RE.test(text) || AGE_PRICE_RE.test(text) || isRegionLabel(text, row)) {
    return {
      category: 'price_noise',
      status: 'ignored',
      suggestedAction: 'auto_ignore_noise',
      resolvedKind: 'noise_audit_price_or_date_evidence',
      auditKind: 'price_or_date_evidence',
      confidence: 0.9,
      usableSignal: true,
      reason: 'price_date_table_fragment_preserve_as_parser_evidence',
    };
  }

  if (CUSTOMER_NOTICE_RE.test(text)) {
    return {
      category: 'notice',
      status: 'pending',
      suggestedAction: 'needs_review',
      resolvedKind: null,
      auditKind: 'customer_notice',
      confidence: 0.88,
      usableSignal: true,
      reason: 'customer_visible_notice_must_not_be_ignored',
    };
  }

  if (SHOPPING_RE.test(text)) {
    return {
      category: 'shopping',
      status: 'pending',
      suggestedAction: 'needs_review',
      resolvedKind: null,
      auditKind: 'shopping_notice',
      confidence: 0.87,
      usableSignal: true,
      reason: 'shopping_phrase_affects_customer_notice',
    };
  }

  if (OPTIONAL_RE.test(text)) {
    return {
      category: 'optional_tour',
      status: 'pending',
      suggestedAction: 'needs_review',
      resolvedKind: null,
      auditKind: 'optional_service',
      confidence: 0.87,
      usableSignal: true,
      reason: 'optional_or_included_service_requires_review',
    };
  }

  if (FLIGHT_RE.test(text)) {
    return {
      category: 'transfer',
      status: 'added',
      suggestedAction: 'auto_resolve_existing',
      resolvedKind: 'noise_rescue_flight_event',
      auditKind: 'flight_event',
      confidence: 0.9,
      usableSignal: true,
      reason: 'flight_code_structured_as_transfer_evidence',
    };
  }

  if (TRANSFER_RE.test(text)) {
    return {
      category: 'transfer',
      status: 'added',
      suggestedAction: 'auto_resolve_existing',
      resolvedKind: 'noise_rescue_transfer_event',
      auditKind: 'transfer_event',
      confidence: 0.88,
      usableSignal: true,
      reason: 'movement_or_arrival_departure_structured',
    };
  }

  if (HOTEL_RE.test(text)) {
    return {
      category: 'hotel',
      status: 'pending',
      suggestedAction: 'needs_review',
      resolvedKind: null,
      auditKind: 'hotel_event',
      confidence: 0.84,
      usableSignal: true,
      reason: 'hotel_occurrence_should_feed_canonical_review',
    };
  }

  if (MEAL_RE.test(text)) {
    return {
      category: 'meal',
      status: 'added',
      suggestedAction: 'auto_resolve_existing',
      resolvedKind: 'noise_rescue_meal_event',
      auditKind: 'meal_event',
      confidence: 0.88,
      usableSignal: true,
      reason: 'meal_phrase_structured',
    };
  }

  if (FREE_TIME_RE.test(text)) {
    return {
      category: 'free_time',
      status: 'ignored',
      suggestedAction: 'auto_ignore_noise',
      resolvedKind: 'noise_audit_free_time',
      auditKind: 'true_noise',
      confidence: 0.9,
      usableSignal: true,
      reason: 'free_time_is_non_blocking_schedule_state',
    };
  }

  if (text.length >= 2 && row.segment_kind_guess === 'attraction') {
    return {
      category: 'attraction',
      status: 'pending',
      suggestedAction: 'needs_new_master',
      resolvedKind: null,
      auditKind: 'possible_attraction',
      confidence: 0.7,
      usableSignal: true,
      reason: 'legacy_ignored_attraction_requires_admin_review_no_auto_create',
    };
  }

  return {
    category: 'unknown',
    status: 'pending',
    suggestedAction: 'needs_review',
    resolvedKind: null,
    auditKind: 'unknown_review',
    confidence: 0.55,
    usableSignal: true,
    reason: 'ignored_text_not_proven_safe_to_drop',
  };
}

function resolution(row: IgnoredRow, decision: RescueDecision): Record<string, unknown> {
  return {
    ...(row.suggested_resolution ?? {}),
    category: decision.category,
    action: decision.suggestedAction,
    noise_audit_kind: decision.auditKind,
    rescued_from_ignored: decision.status !== 'ignored',
    usable_signal: decision.usableSignal,
    reason: decision.reason,
    original_resolved_kind: row.resolved_kind,
    original_classification_version: row.classification_version,
    country_scope: row.country,
    destination_scope: row.region ?? row.country,
    raw_hash: hash(row.activity ?? ''),
    policy: decision.category === 'attraction'
      ? 'match-existing-only-no-auto-create'
      : 'ignored-noise-audit-no-master-create',
  };
}

function sourceContext(row: IgnoredRow, decision: RescueDecision): Record<string, unknown> {
  return {
    ...(row.source_context ?? {}),
    package_id: row.package_id,
    package_title: row.package_title,
    day_number: row.day_number,
    country: row.country,
    destination: row.region ?? row.country,
    raw_hash: hash(row.activity ?? ''),
    customer_visible: !['price_noise', 'free_time'].includes(decision.category),
    noise_audit_kind: decision.auditKind,
    ignored_noise_audit_at: new Date().toISOString(),
  };
}

async function fetchRows(): Promise<IgnoredRow[]> {
  const rows: IgnoredRow[] = [];
  const pageSize = 1000;

  for (let from = 0; from < limit; from += pageSize) {
    const to = Math.min(from + pageSize - 1, limit - 1);
    const { data, error } = await supabase
      .from('unmatched_activities')
      .select('id, activity, package_id, package_title, day_number, country, region, occurrence_count, status, resolved_kind, resolved_at, segment_kind_guess, confidence, suggested_action, suggested_resolution, source_context, classification_version')
      .eq('status', 'ignored')
      .order('occurrence_count', { ascending: false })
      .range(from, to);

    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data as IgnoredRow[]);
    if (data.length < pageSize) break;
  }

  return rows;
}

async function applyDecision(row: IgnoredRow, decision: RescueDecision): Promise<void> {
  const now = new Date().toISOString();
  const update: Record<string, unknown> = {
    status: decision.status,
    segment_kind_guess: decision.category,
    confidence: decision.confidence,
    suggested_action: decision.suggestedAction,
    suggested_resolution: resolution(row, decision),
    source_context: sourceContext(row, decision),
    classification_version: version,
  };

  if (decision.status === 'pending') {
    update.resolved_at = null;
    update.resolved_kind = null;
    update.resolved_by = null;
    update.resolved_attraction_id = null;
  } else {
    update.resolved_at = row.resolved_at ?? now;
    update.resolved_kind = decision.resolvedKind;
    update.resolved_by = 'audit_ignored_unmatched_entities';
  }

  const { error } = await supabase
    .from('unmatched_activities')
    .update(update)
    .eq('id', row.id);

  if (error) throw error;
}

function increment<T extends string>(map: Record<T, number>, key: T): void {
  map[key] = (map[key] ?? 0) + 1;
}

async function main() {
  const rows = await fetchRows();
  const classified = rows.map(row => ({ row, decision: classifyIgnored(row) }));

  const byStatus: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  const byAuditKind: Record<string, number> = {};
  const rescueSamples: Array<Record<string, unknown>> = [];

  for (const item of classified) {
    increment(byStatus, item.decision.status);
    increment(byCategory, item.decision.category);
    increment(byAuditKind, item.decision.auditKind);
    if (item.decision.status !== 'ignored' && rescueSamples.length < 80) {
      rescueSamples.push({
        id: item.row.id,
        activity: item.row.activity,
        title: item.row.package_title,
        day: item.row.day_number,
        from_resolved_kind: item.row.resolved_kind,
        to_status: item.decision.status,
        category: item.decision.category,
        audit_kind: item.decision.auditKind,
        reason: item.decision.reason,
      });
    }
  }

  if (apply) {
    for (const item of classified) {
      await applyDecision(item.row, item.decision);
    }
  }

  const output = {
    apply,
    version,
    scanned: rows.length,
    by_status: byStatus,
    by_category: byCategory,
    by_audit_kind: byAuditKind,
    rescued_count: classified.filter(item => item.decision.status !== 'ignored').length,
    usable_signal_count: classified.filter(item => item.decision.usableSignal).length,
    rescue_samples: rescueSamples,
  };

  if (json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(output);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

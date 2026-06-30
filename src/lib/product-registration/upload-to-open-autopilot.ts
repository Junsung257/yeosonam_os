import type { SupabaseClient } from '@supabase/supabase-js';

import type { AttractionData } from '@/lib/attraction-matcher';
import { runAutoMobileQA } from '@/lib/auto-mobile-qa';
import { normalizeCustomerVisibleCopy } from '@/lib/customer-copy-quality';
import { evaluateCustomerDeliveryReadiness } from '@/lib/customer-delivery-check';
import { evaluateCustomerMobileProof } from '@/lib/customer-mobile-proof';
import { isCustomerOptionalTourCandidate } from '@/lib/customer-option-classifier';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { normalizeOptionalTours } from '@/lib/package-acl';
import type { PriceDate } from '@/lib/price-dates';
import { compareKstDate, formatKstDate, isUpcomingKstDate, isValidIsoDateKst } from '@/lib/kst-date';
import {
  evaluateV3CustomerNoticeGate,
  getV3DraftGateStatus,
  hasSupplierRemarkRawLeakRisk,
  type LatestV3DraftForPackage,
  loadLatestV3DraftForPackage,
} from '@/lib/product-registration-v3/customer-payload';
import {
  applyProductRegistrationV3Matching,
  evaluateProductRegistrationV3Gate,
  ledgerToRenderPackageInputs,
  persistProductRegistrationDraftV3,
  runProductRegistrationV3,
} from '@/lib/product-registration-v3';
import { createSourceLineIndex, evidenceFromLines } from '@/lib/product-registration-v3/source-line-index';
import type { V3DraftLedger, V3Evidence, V3PipelineResult } from '@/lib/product-registration-v3';
import type { V3EventType, V3LedgerVariant } from '@/lib/product-registration-v3/types';
import { hashRawText } from '@/lib/source-evidence';
import { buildSourceBackedFieldRepair } from '@/lib/source-package-field-repair';
import {
  buildSourceBackedPriceDateRepair,
  hasTransportPriceVariantCue,
  type SourceBackedPriceDateRepair,
} from '@/lib/source-price-date-repair';
import { buildSourceBackedTermsRepair } from '@/lib/source-terms-repair';
import { runUploadVerify, evaluateVerifyChecks } from '@/lib/upload-verify';
import type { ProductPriceRowInput } from '@/lib/upload-validator';
import { isCustomerVisibleStatus } from '@/lib/visibility-status';
import { buildCustomerSourceRawText } from './source-evidence-raw-text';
import { replaceProductPricesForProduct } from './product-price-replacement';
import {
  evaluateRegistrationQualityScorecard,
  type RegistrationQualityProductPrice,
  type RegistrationQualityScorecard,
} from './registration-quality-scorecard';
import {
  customerOpenContractAuditPayload,
  evaluateCustomerOpenContract,
} from './customer-open-contract';
import {
  buildRepairFirstOpenabilitySummary,
  type RepairFirstOpenabilityState,
  type RepairFirstOpenabilitySummary,
} from './repair-first-openability';
import { hashSourceText } from './improvement-ledger';

export type UploadToOpenAutopilotPackage = {
  id: string;
  title: string | null;
  internal_code: string | null;
  destination: string | null;
  status: string | null;
  audit_status: string | null;
  audit_report: unknown;
  updated_at: string | null;
  raw_text: string | null;
  airline: string | null;
  duration: number | null;
  nights: number | null;
  min_participants?: number | null;
  price: number | null;
  display_title: string | null;
  hero_tagline: string | null;
  trip_style: string | null;
  itinerary_data: unknown;
  accommodations: string[] | null;
  inclusions: string[] | null;
  excludes: string[] | null;
  optional_tours: unknown[] | null;
  price_tiers?: unknown[] | null;
  price_dates: Array<{
    date?: string | null;
    price?: number | null;
    adult_price?: number | null;
    adult_selling_price?: number | null;
    selling_price?: number | null;
    child_price?: number | null;
    currency?: string | null;
    confirmed?: boolean | null;
  }> | null;
  price_list: unknown;
  departure_days: unknown;
  surcharges: unknown;
  notices_parsed?: unknown;
  customer_notes?: unknown;
  ticketing_deadline?: string | null;
};

export type UploadToOpenAutopilotOptions = {
  packageIds?: string[];
  catalogGroupId?: string | null;
  status?: string[];
  limit?: number;
  attempts?: number;
  autoOpen?: boolean;
  baseUrl?: string;
};

export type UploadToOpenPackageResult = {
  id: string;
  title: string | null;
  code: string | null;
  status: 'opened' | 'ready_not_opened' | 'blocked' | 'error';
  openabilityState: RepairFirstOpenabilityState;
  stage: string;
  reasons: string[];
  repairs: string[];
  repairFirstSummary: RepairFirstOpenabilitySummary;
  reviewActions?: UploadToOpenReviewAction[];
};

export type UploadToOpenReviewAction = {
  reason: string;
  category:
    | 'auto_repair_exhausted'
    | 'proof_retry_required'
    | 'source_evidence_required'
    | 'customer_copy_required'
    | 'entity_resolution_required'
    | 'v3_notice_required'
    | 'publish_gate_required'
    | 'possibly_unusable_source';
  canBeMadeUsable: boolean;
  nextAction: string;
};

type QualityLogRow = {
  failed_checks?: Array<{ id?: string; severity?: string; message?: string; passed?: boolean }>;
};

type IntakeRow = {
  ir?: { sourceEvidence?: unknown } | null;
};

type ProductSourceRow = {
  raw_extracted_text?: string | null;
};

type ProductPriceDbRow = RegistrationQualityProductPrice & {
  target_date?: string | null;
  net_price?: number | string | null;
  adult_selling_price?: number | string | null;
  child_price?: number | string | null;
  note?: string | null;
};

export type SourceTicketingDeadline = {
  deadline: string;
  expired: boolean;
  source: 'ticketing_deadline' | 'raw_text';
};

type RestorableV3DraftRow = LatestV3DraftForPackage & {
  raw_text?: string | null;
  raw_text_hash?: string | null;
  source_type?: string | null;
  supplier_hint?: string | null;
  document_type?: string | null;
  structure_plan?: unknown;
  evidence_index?: unknown;
  match_summary?: unknown;
};
type V3VariantDay = V3LedgerVariant['days'][number];

const V3_LIVE_QUEUE_RECONCILABLE_CHECK_IDS = new Set([
  'attraction_unmatched_queue_clear',
  'entity_attraction_unresolved_clear',
  'entity_shopping_review_clear',
  'entity_option_review_clear',
  'entity_unknown_customer_visible_clear',
]);

async function loadActiveAttractionsForV3(supabase: SupabaseClient): Promise<AttractionData[]> {
  const rows: AttractionData[] = [];
  const pageSize = 1000;
  for (let offset = 0; offset < 20_000; offset += pageSize) {
    const { data, error } = await supabase
      .from('attractions')
      .select('id,name,short_desc,long_desc,badge_type,emoji,country,region,category,aliases,photos,mrt_gid')
      .eq('is_active', true)
      .order('updated_at', { ascending: false, nullsFirst: false })
      .range(offset, offset + pageSize - 1);
    if (error) return rows;
    if (!data?.length) break;
    rows.push(...data as AttractionData[]);
    if (data.length < pageSize) break;
  }
  return rows;
}

function collapseV3ToCurrentPackageVariant(
  v3: V3PipelineResult,
  attractions: AttractionData[],
): V3PipelineResult {
  if (v3.ledger.variants.length <= 1) return v3;
  const ledger = {
    ...v3.ledger,
    document: {
      ...v3.ledger.document,
      expected_products: 1,
    },
    variants: [v3.ledger.variants[0]],
  };
  const structurePlan = {
    ...v3.structure_plan,
    expected_products: 1,
    product_boundaries: v3.structure_plan.product_boundaries.slice(0, 1),
  };
  const matched = applyProductRegistrationV3Matching(ledger, attractions, undefined);
  const gateResult = evaluateProductRegistrationV3Gate(structurePlan, matched.ledger, matched.matchSummary);
  return {
    ...v3,
    structure_plan: structurePlan,
    ledger: matched.ledger,
    match_summary: matched.matchSummary,
    gate_result: gateResult,
    render_contract_preview: v3.render_contract_preview.slice(0, 1),
  };
}

function packageFieldEvidence(field: string, value: unknown): V3Evidence {
  const quote = `travel_packages.${field}: ${String(value ?? '').slice(0, 220)}`;
  return {
    line_start: 0,
    line_end: 0,
    char_start: 0,
    char_end: quote.length,
    quote,
  };
}

function textList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map(item => typeof item === 'string' ? item.trim() : '')
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/\r?\n|[;；]/)
      .map(item => item.trim())
      .filter(Boolean);
  }
  return [];
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      const nested = firstText(record.raw_text, record.name, record.note, record.value, record.title);
      if (nested) return nested;
    }
  }
  return null;
}

function mealRecord(value: unknown, note?: unknown): Record<string, unknown> {
  const text = firstText(value, note);
  if (!text && value === true) return { raw_text: 'included' };
  return text ? { raw_text: text } : {};
}

function packageDaysForV3(itineraryData: unknown): V3LedgerVariant['days'] {
  const root = objectRecord(itineraryData);
  const rawDays = Array.isArray(root.days)
    ? root.days
    : Array.isArray(itineraryData)
      ? itineraryData
      : [];
  return rawDays
    .map((rawDay, index) => {
      const day = objectRecord(rawDay);
      const dayNumber = Number(day.day ?? day.day_number ?? day.dayIndex ?? index + 1);
      if (!Number.isFinite(dayNumber) || dayNumber <= 0) return null;
      const meals = objectRecord(day.meals);
      const hotelText = firstText(day.hotel, day.accommodation, day.hotel_name, day.hotelName);
      const dayPayload: V3VariantDay = {
        day: dayNumber,
        route: Array.isArray(day.regions)
          ? day.regions.map(String).filter(Boolean)
          : Array.isArray(day.route)
            ? day.route.map(String).filter(Boolean)
            : [],
        events: [],
        meals: {
          breakfast: mealRecord(meals.breakfast ?? day.breakfast, meals.breakfast_note ?? day.breakfast_note),
          lunch: mealRecord(meals.lunch ?? day.lunch, meals.lunch_note ?? day.lunch_note),
          dinner: mealRecord(meals.dinner ?? day.dinner, meals.dinner_note ?? day.dinner_note),
        },
        hotel: hotelText ? { raw_text: hotelText } : {},
      };
      return dayPayload;
    })
    .filter((day): day is V3VariantDay => Boolean(day));
}

function hasMealEvidence(variant: V3LedgerVariant): boolean {
  return variant.days.some(day => Object.values(day.meals).some(value => Object.keys(value).length > 0));
}

function hasHotelEvidence(variant: V3LedgerVariant): boolean {
  return variant.days.some(day => Object.keys(day.hotel).length > 0);
}

function mergePackageBackedDays(
  variant: V3LedgerVariant,
  packageDays: V3LedgerVariant['days'],
): boolean {
  if (packageDays.length === 0) return false;
  if (variant.days.length === 0) {
    variant.days = packageDays;
    return true;
  }

  let changed = false;
  const byDay = new Map(packageDays.map(day => [day.day, day]));
  for (const day of variant.days) {
    const sourceDay = byDay.get(day.day);
    if (!sourceDay) continue;
    for (const meal of ['breakfast', 'lunch', 'dinner'] as const) {
      if (Object.keys(day.meals[meal]).length === 0 && Object.keys(sourceDay.meals[meal]).length > 0) {
        day.meals[meal] = sourceDay.meals[meal];
        changed = true;
      }
    }
    if (Object.keys(day.hotel).length === 0 && Object.keys(sourceDay.hotel).length > 0) {
      day.hotel = sourceDay.hotel;
      changed = true;
    }
    if (day.route.length === 0 && sourceDay.route.length > 0) {
      day.route = sourceDay.route;
      changed = true;
    }
  }
  return changed;
}

export function patchV3WithPackageBackedEvidence(
  v3: V3PipelineResult,
  pkg: Pick<UploadToOpenAutopilotPackage, 'min_participants' | 'inclusions' | 'excludes' | 'itinerary_data'>,
): boolean {
  const packageDays = packageDaysForV3(pkg.itinerary_data);
  const inclusions = textList(pkg.inclusions);
  const exclusions = textList(pkg.excludes);
  const minParticipants = Number(pkg.min_participants);
  let changed = false;

  for (const variant of v3.ledger.variants) {
    if (!variant.minimum_departure && Number.isFinite(minParticipants) && minParticipants > 0) {
      variant.minimum_departure = {
        value: minParticipants,
        evidence: packageFieldEvidence('min_participants', minParticipants),
      };
      changed = true;
    }

    if (variant.inclusions.length === 0 && inclusions.length > 0) {
      variant.inclusions = inclusions.map(value => ({
        value,
        evidence: packageFieldEvidence('inclusions', value),
      }));
      changed = true;
    }

    if (variant.exclusions.length === 0 && exclusions.length > 0) {
      variant.exclusions = exclusions.map(value => ({
        value,
        evidence: packageFieldEvidence('excludes', value),
      }));
      changed = true;
    }

    changed = mergePackageBackedDays(variant, packageDays) || changed;
    variant.evidence_coverage = {
      ...variant.evidence_coverage,
      itinerary: variant.days.length > 0,
      meals: hasMealEvidence(variant),
      hotel: hasHotelEvidence(variant),
      inclusions: variant.inclusions.length > 0,
      exclusions: variant.exclusions.length > 0,
      minimum_departure: Boolean(variant.minimum_departure),
    };
  }

  if (changed) {
    v3.gate_result = evaluateProductRegistrationV3Gate(v3.structure_plan, v3.ledger, v3.match_summary);
  }
  return changed;
}

export function sanitizeCustomerOptionalTours(raw: unknown): unknown[] {
  return normalizeOptionalTours(raw)
    .filter(tour => isCustomerOptionalTourCandidate([
      tour.name,
      tour.price,
      tour.note,
    ].filter(Boolean).join(' ')));
}

const DEFAULT_STATUSES = ['pending_review', 'approved'];
const UPLOAD_TO_OPEN_PACKAGE_SELECT = [
  'id',
  'title',
  'internal_code',
  'destination',
  'status',
  'audit_status',
  'audit_report',
  'updated_at',
  'raw_text',
  'airline',
  'duration',
  'nights',
  'price',
  'display_title',
  'hero_tagline',
  'trip_style',
  'itinerary_data',
  'accommodations',
  'inclusions',
  'excludes',
  'optional_tours',
  'price_tiers',
  'price_dates',
  'price_list',
  'departure_days',
  'surcharges',
  'notices_parsed',
  'customer_notes',
  'min_participants',
  'ticketing_deadline',
].join(',');

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function uniqueIds(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map(value => value.trim()).filter(Boolean))];
}

function nowIso(): string {
  return new Date().toISOString();
}

function cloneJson<T>(value: T): T {
  return value == null ? value : JSON.parse(JSON.stringify(value)) as T;
}

function toIsoDateFromMonthDay(month: number, day: number, today: string): string | null {
  const year = Number(String(today).slice(0, 4));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return isValidIsoDateKst(iso) ? iso : null;
}

export function detectSourceTicketingDeadline(input: {
  ticketingDeadline?: string | null;
  rawText?: string | null;
  today?: string;
}): SourceTicketingDeadline | null {
  const today = input.today ?? formatKstDate();
  const explicit = String(input.ticketingDeadline ?? '').slice(0, 10);
  if (isValidIsoDateKst(explicit)) {
    return {
      deadline: explicit,
      expired: compareKstDate(explicit, today) < 0,
      source: 'ticketing_deadline',
    };
  }

  const rawText = String(input.rawText ?? '');
  if (!rawText.trim()) return null;

  const patterns = [
    /(\d{1,2})\s*[./-]\s*(\d{1,2})\s*(?:\uC77C\s*)?(?:\uC774\uB0B4\s*)?\uBC1C\uAD8C(?:\uC870\uAC74|\uB9C8\uAC10|\uAE30\uD55C)?/u,
    /\uBC1C\uAD8C\s*(?:\uB9C8\uAC10|\uAE30\uD55C|\uC870\uAC74)?(?:\uC77C)?\s*[:：]?\s*(\d{1,2})\s*[./-]\s*(\d{1,2})/u,
  ];
  for (const pattern of patterns) {
    const match = rawText.match(pattern);
    if (!match) continue;
    const month = Number(match[1]);
    const day = Number(match[2]);
    const deadline = toIsoDateFromMonthDay(month, day, today);
    if (!deadline) continue;
    return {
      deadline,
      expired: compareKstDate(deadline, today) < 0,
      source: 'raw_text',
    };
  }

  return null;
}

export function reconcileV3DraftWithLiveEntityQueueClear(input: {
  gateResult: unknown;
  matchSummary: unknown;
}): { gateResult: unknown; matchSummary: unknown; changed: boolean } {
  const gate = cloneJson(asRecord(input.gateResult));
  const checks = Array.isArray(gate.checks) ? gate.checks.map(check => asRecord(check)) : [];
  const failedChecks = checks.filter(check => check.status === 'fail');
  if (
    failedChecks.length === 0
    || failedChecks.some(check => !V3_LIVE_QUEUE_RECONCILABLE_CHECK_IDS.has(String(check.id ?? '')))
  ) {
    return { gateResult: input.gateResult, matchSummary: input.matchSummary, changed: false };
  }

  const nextChecks = checks.map(check => {
    const id = String(check.id ?? '');
    if (!V3_LIVE_QUEUE_RECONCILABLE_CHECK_IDS.has(id)) return check;
    return {
      ...check,
      status: 'pass',
      message: 'live unmatched entity queue has no pending customer-visible blockers',
    };
  });
  gate.checks = nextChecks;
  gate.status = nextChecks.some(check => check.status === 'fail') ? gate.status : 'ready_to_publish';
  gate.customer_publishable = !nextChecks.some(check => check.status === 'fail');

  const match = cloneJson(asRecord(input.matchSummary));
  match.attraction_unmatched_count = 0;
  match.unmatched = [];
  const entity = asRecord(match.entity_summary);
  match.entity_summary = {
    ...entity,
    attraction_unresolved_count: 0,
    shopping_review_needed_count: 0,
    option_review_needed_count: 0,
    unknown_customer_visible_count: 0,
  };

  return { gateResult: gate, matchSummary: match, changed: true };
}

function isMojibakeAttractionName(value: unknown): boolean {
  return typeof value === 'string' && /(?:\?{2,}|\uFFFD|\u7B4C|\u8F45|\u9954|\u58E4|\u30EB)/.test(value);
}

function inferAttractionNameFromActivity(activity: unknown): string | null {
  if (typeof activity !== 'string') return null;
  const text = activity.replace(/\s+/g, ' ').trim();
  if (!text) return null;

  const knownNames = [
    '\uD63C\uB610\uC12C \uD574\uC0C1 \uCF00\uC774\uBE14\uCE74',
    '\uB300\uB2F9\uBD88\uC57C\uC131',
    '\uC601\uD765\uC0AC',
    '\uB2E4\uB534\uB77C \uD3ED\uD3EC',
    '\uC8FD\uB9BC\uC0AC',
    '\uB3C4\uBA58 \uB4DC \uB9C8\uB9AC \uC131\uB2F9',
    '\uB9C8\uBE14 \uB9C8\uC6B4\uD2F4',
    '\uCF54\uCF54\uB11B\uBE4C\uB9AC\uC9C0',
    '\uD638\uC774\uC548 \uAD6C\uC2DC\uAC00\uC9C0',
    '\uBBF8\uCF00\uBE44\uCE58',
    '\uBC14\uB098\uD790',
    '\uB2E4\uB0AD\uB300\uC131\uB2F9',
    '\uD55C\uAC15\uC720\uB78C\uC120',
  ];
  const matchedKnownName = knownNames.find(name => text.includes(name));
  if (matchedKnownName) return matchedKnownName;
  if (/\uD574\uC218\uAD00\uC74C\uC0C1|\uC601\uD765\s*\uC0AC/.test(text)) {
    return '\uC601\uD765\uC0AC';
  }
  if (/\uD574\uC0C1\s*\uCF00\uC774\uBE14\uCE74|\uCF00\uC774\uBE14\uCE74\s*\uC655\uBCF5/.test(text)) {
    return '\uD63C\uB610\uC12C \uD574\uC0C1 \uCF00\uC774\uBE14\uCE74';
  }

  const descriptiveMatch = text.match(/(?:\uC720\uBA85\uD55C|\uAC00\uC7A5 \uD070|\uBC29\uBB38|\uAD00\uAD11)\s+([\uAC00-\uD7A3A-Za-z0-9&().\-\s]{2,30}?)(?:\s*\(|\s+\uAD00\uAD11|\s+\uBC29\uBB38|$)/);
  return descriptiveMatch?.[1]?.trim() || null;
}

function firstSourceBackedAttractionQuery(item: Record<string, unknown>): string | null {
  const direct = typeof item.attraction_query === 'string' ? item.attraction_query.trim() : '';
  if (direct) return direct;
  if (Array.isArray(item.attraction_queries)) {
    for (const query of item.attraction_queries) {
      if (typeof query === 'string' && query.trim()) return query.trim();
    }
  }
  const landing = inferAttractionNameFromActivity(item.landing_sentence);
  if (landing) return landing;
  const a4 = inferAttractionNameFromActivity(item.a4_sentence);
  if (a4) return a4;
  return null;
}

export function repairMojibakeAttractionNamesInItinerary(itineraryData: unknown): {
  itineraryData: unknown;
  repaired: boolean;
  replacements: Array<{ before: string; after: string; activity: string }>;
} {
  const root = asRecord(itineraryData);
  const days = Array.isArray(root.days) ? root.days : [];
  if (days.length === 0) return { itineraryData, repaired: false, replacements: [] };

  const next = cloneJson(root);
  const replacements: Array<{ before: string; after: string; activity: string }> = [];
  const nextDays = Array.isArray(next.days) ? next.days : [];

  for (const day of nextDays) {
    const schedule = Array.isArray(day?.schedule) ? day.schedule : [];
    for (const item of schedule) {
      if (!Array.isArray(item?.attraction_names)) continue;
      const inferred = inferAttractionNameFromActivity(item.activity) || firstSourceBackedAttractionQuery(item);
      if (!inferred) continue;
      item.attraction_names = item.attraction_names.map((name: unknown) => {
        if (!isMojibakeAttractionName(name)) return name;
        replacements.push({
          before: String(name),
          after: inferred,
          activity: typeof item.activity === 'string' ? item.activity : '',
        });
        return inferred;
      });
    }
  }

  return {
    itineraryData: replacements.length > 0 ? next : itineraryData,
    repaired: replacements.length > 0,
    replacements,
  };
}
function isPolicyOnlyScheduleActivity(activity: string): boolean {
  const text = activity.replace(/\s+/g, ' ').trim();
  if (!text) return false;
  if (/^X$/i.test(text)) return true;
  return /\uC0C1\uAE30\s*\uC77C\uC815.*(?:\uBCC0\uACBD|\uBCC0\uB3D9).*?\uC218/.test(text)
    || /(?:\uD604\uC9C0\s*\uC0AC\uC815|\uD56D\uACF5\s*\uC0AC\uC815|\uCC9C\uC7AC\uC9C0\uBCC0).*?\uBCC0\uACBD/.test(text)
    || /(?:\uCDE8\uC18C\s*\uADDC\uC815|\uD604\uAE08\uC601\uC218\uC99D|\uC608\uC57D\uAE08|\uC218\uC218\uB8CC|300,000)/.test(text)
    || /(?:\uCD94\uAC00\uAE08\s*\uBC1C\uC0DD|\uCD94\uAC00\s*\uC694\uAE08|\uC120\s*\uD3EC\uD568\s*\uC2DC).*?(?:\d+\s*\uB9CC|\$|\uC6D0|\uB80C\uD0C8\uD53C|\uC7A5\uBE44)/.test(text);
}

function sanitizeScheduleActivityPolicyFragment(activity: string): string {
  return activity
    .replace(/\s*[\(\[][^()\[\]]*(?:\uD658\uBD88|300,000|\uCDE8\uC18C|\uC218\uC218\uB8CC)[^()\[\]]*[\)\]]/g, '')
    .replace(/\s*\uD658\uBD88\s*X/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function repairPolicyLeakInItinerarySchedule(itineraryData: unknown): {
  itineraryData: unknown;
  repaired: boolean;
  removed: string[];
  sanitized: Array<{ before: string; after: string }>;
} {
  const root = asRecord(itineraryData);
  const days = Array.isArray(root.days) ? root.days : [];
  if (days.length === 0) return { itineraryData, repaired: false, removed: [], sanitized: [] };

  const next = cloneJson(root);
  const nextDays = Array.isArray(next.days) ? next.days : [];
  const removed: string[] = [];
  const sanitized: Array<{ before: string; after: string }> = [];

  for (const day of nextDays) {
    if (!Array.isArray(day?.schedule)) continue;
    const kept = [];
    for (const item of day.schedule) {
      const record = asRecord(item);
      const activity = typeof record.activity === 'string' ? record.activity : '';
      if (isPolicyOnlyScheduleActivity(activity)) {
        removed.push(activity);
        continue;
      }
      const cleanActivity = sanitizeScheduleActivityPolicyFragment(activity);
      if (cleanActivity && cleanActivity !== activity) {
        item.activity = cleanActivity;
        if (typeof item.a4_sentence === 'string' && isPolicyOnlyScheduleActivity(item.a4_sentence)) {
          item.a4_sentence = cleanActivity;
        }
        if (typeof item.landing_sentence === 'string' && isPolicyOnlyScheduleActivity(item.landing_sentence)) {
          item.landing_sentence = cleanActivity;
        }
        sanitized.push({ before: activity, after: cleanActivity });
      }
      kept.push(item);
    }
    day.schedule = kept;
  }

  const repaired = removed.length > 0 || sanitized.length > 0;
  return {
    itineraryData: repaired ? next : itineraryData,
    repaired,
    removed,
    sanitized,
  };
}

function isNonLodgingHotelName(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const compact = value.replace(/\s+/g, '');
  if (!compact) return false;
  if (/^(?:\uC0C1\uB3D9|\uC0C1\uB3D9\uAE09|\uC804\uC77C\uB3D9\uC77C|\uB3D9\uC77C)$/.test(compact)) return true;
  if (/\uD638\uD154/.test(compact) && /(?:\uBD80\uB300\uC2DC\uC124|\uC774\uC6A9|\uD734\uC2DD|\uC870\uC2DD|\uCCB4\uD06C\uC778|\uCCB4\uD06C\uC544\uC6C3|\uBBF8\uD305|\uCD9C\uBC1C|\uC774\uB3D9)/.test(compact)) {
    return true;
  }
  return false;
}

export function repairNonLodgingHotelNamesInItinerary(itineraryData: unknown): {
  itineraryData: unknown;
  repaired: boolean;
  replacements: Array<{ day: number | null; before: string; after: string | null }>;
} {
  const root = asRecord(itineraryData);
  const days = Array.isArray(root.days) ? root.days : [];
  if (days.length === 0) return { itineraryData, repaired: false, replacements: [] };

  const next = cloneJson(root);
  const nextDays = Array.isArray(next.days) ? next.days : [];
  const replacements: Array<{ day: number | null; before: string; after: string | null }> = [];
  let lastValidHotel: string | null = null;

  for (const day of nextDays) {
    const dayNumber = typeof day?.day === 'number' ? day.day : null;
    const hotel = asRecord(day?.hotel);
    const hotelName = typeof hotel?.name === 'string' ? hotel.name.trim() : '';
    if (!hotelName) continue;
    if (isNonLodgingHotelName(hotelName)) {
      replacements.push({ day: dayNumber, before: hotelName, after: lastValidHotel });
      if (lastValidHotel) {
        day.hotel = { ...hotel, name: lastValidHotel };
      } else {
        day.hotel = null;
      }
      continue;
    }
    lastValidHotel = hotelName;
  }

  return {
    itineraryData: replacements.length > 0 ? next : itineraryData,
    repaired: replacements.length > 0,
    replacements,
  };
}

function isOptionalTourScheduleDuplicate(item: unknown): boolean {
  const record = asRecord(item);
  if (!record) return false;
  const type = typeof record.type === 'string' ? record.type : '';
  const entityKind = typeof record.entity_kind === 'string' ? record.entity_kind : '';
  const activity = typeof record.activity === 'string' ? record.activity.replace(/\s+/g, ' ').trim() : '';
  if (type === 'optional' || entityKind === 'optional_tour') return true;
  return /(?:\uC120\uD0DD\uAD00\uAD11|\uCD94\uCC9C\s*\uC120\uD0DD)/.test(activity);
}

function optionalTourText(value: unknown): string {
  const record = asRecord(value);
  return [
    record.name,
    record.displayName,
    record.title,
    record.region,
    record.note,
  ]
    .map(part => (typeof part === 'string' ? part : ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripSupplierOptionalTourPrefix(value: string): string {
  return value
    .replace(/^\s*(?:\uCD94\uCC9C\s*)?\uC120\uD0DD\s*\uAD00\uAD11\s*[:：-]?\s*/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isShoppingOptionalTour(value: unknown): boolean {
  const text = optionalTourText(value);
  return /(?:\uC1FC\uD551|\uAE30\uB150\uD488|\uD1A0\uC0B0\uD488)/u.test(text);
}

function normalizeOptionalTourPrice(value: unknown): unknown {
  return typeof value === 'string'
    ? value.replace(/^\$\$+/, '$').replace(/\s+/g, ' ').trim()
    : value;
}

export function repairOptionalToursForCustomerDisplay(optionalTours: unknown): {
  optionalTours: unknown;
  repaired: boolean;
  removed: string[];
  renamed: Array<{ before: string; after: string }>;
} {
  if (!Array.isArray(optionalTours) || optionalTours.length === 0) {
    return { optionalTours, repaired: false, removed: [], renamed: [] };
  }

  const next: unknown[] = [];
  const seen = new Set<string>();
  const removed: string[] = [];
  const renamed: Array<{ before: string; after: string }> = [];

  for (const tour of optionalTours) {
    const record = asRecord(tour);
    const label = optionalTourText(tour);
    if (isShoppingOptionalTour(tour)) {
      removed.push(label);
      continue;
    }

    const copy = cloneJson(record);
    const name = typeof copy.name === 'string' ? copy.name : '';
    const displayName = typeof copy.displayName === 'string' ? copy.displayName : '';
    const cleanedName = name ? stripSupplierOptionalTourPrefix(name) : name;
    const cleanedDisplayName = displayName ? stripSupplierOptionalTourPrefix(displayName) : displayName;
    if (cleanedName && cleanedName !== name) {
      copy.name = cleanedName;
      renamed.push({ before: name, after: cleanedName });
    }
    if (cleanedDisplayName && cleanedDisplayName !== displayName) {
      copy.displayName = cleanedDisplayName;
      if (cleanedDisplayName !== cleanedName) renamed.push({ before: displayName, after: cleanedDisplayName });
    }
    if ('price' in copy) copy.price = normalizeOptionalTourPrice(copy.price);

    const key = [
      typeof copy.name === 'string' ? copy.name : '',
      typeof copy.displayName === 'string' ? copy.displayName : '',
      typeof copy.price === 'string' ? copy.price : '',
      typeof copy.region === 'string' ? copy.region : '',
    ].join('|').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(copy);
  }

  return {
    optionalTours: removed.length > 0 || renamed.length > 0 || next.length !== optionalTours.length ? next : optionalTours,
    repaired: removed.length > 0 || renamed.length > 0 || next.length !== optionalTours.length,
    removed,
    renamed,
  };
}

export function repairOptionalTourScheduleDuplicates(
  itineraryData: unknown,
  optionalTours: unknown,
): {
  itineraryData: unknown;
  repaired: boolean;
  removed: string[];
} {
  if (!Array.isArray(optionalTours) || optionalTours.length === 0) {
    return { itineraryData, repaired: false, removed: [] };
  }
  const root = asRecord(itineraryData);
  const days = Array.isArray(root.days) ? root.days : [];
  if (days.length === 0) return { itineraryData, repaired: false, removed: [] };

  const next = cloneJson(root);
  const nextDays = Array.isArray(next.days) ? next.days : [];
  const removed: string[] = [];

  for (const day of nextDays) {
    if (!Array.isArray(day?.schedule)) continue;
    const kept = [];
    for (const item of day.schedule) {
      if (isOptionalTourScheduleDuplicate(item)) {
        const activity = typeof item?.activity === 'string' ? item.activity : '';
        if (activity) removed.push(activity);
        continue;
      }
      kept.push(item);
    }
    day.schedule = kept;
  }

  return {
    itineraryData: removed.length > 0 ? next : itineraryData,
    repaired: removed.length > 0,
    removed,
  };
}

function repairCustomerNoticeText(value: string): string {
  return value
    .replace(/\uBC14\uB098\uC0B0\s*\uC815\uC0B0/g, '\uBC14\uB098\uC0B0 \uC815\uC0C1')
    .replace(/([\uAC00-\uD7A3])\s*OR\s*([\uAC00-\uD7A3])/gi, '$1 \uB610\uB294 $2')
    .replace(/\uCEE8\uD38C/g, '\uD655\uC815')
    .replace(/\uAC1C\uB7F0\uD2F0/g, '\uBCF4\uC7A5')
    .replace(/\uC694\uCCAD\uC870\uAC74/g, '\uC694\uCCAD \uAE30\uC900')
    .replace(/\uBD88\uAC00\uC2DC/g, '\uBD88\uAC00 \uC2DC')
    .replace(/\uD2B8\uC708OR\uB354\uBE14\uBCA0\uB4DC\+\uC5D1\uC2A4\uD2B8\uB77C\uBCA0\uB4DC/gi, '\uD2B8\uC708/\uB354\uBE14\uBCA0\uB4DC\uC640 \uC5D1\uC2A4\uD2B8\uB77C\uBCA0\uB4DC')
    .replace(/\uB8F8\uBC30\uC815/g, '\uAC1D\uC2E4 \uBC30\uC815')
    .replace(/\s+/g, ' ')
    .replace(/\s+•\s+/g, '\n• ')
    .trim();
}

const CUSTOMER_COPY_REPAIR_SKIP_KEYS = new Set([
  'raw_text',
  'rawText',
  'source_text',
  'sourceText',
  'source',
  'sources',
  'evidence',
  'evidence_index',
  'evidenceIndex',
  'quote',
  'quotes',
  'raw_quote',
  'rawQuote',
]);

function repairCustomerVisibleCopyTree(value: unknown, path: string[] = []): {
  value: unknown;
  changed: boolean;
} {
  const key = path[path.length - 1] ?? '';
  if (CUSTOMER_COPY_REPAIR_SKIP_KEYS.has(key)) {
    return { value, changed: false };
  }
  if (typeof value === 'string') {
    const repaired = normalizeCustomerVisibleCopy(repairCustomerNoticeText(value));
    return { value: repaired, changed: repaired !== value };
  }
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item, index) => {
      const repaired = repairCustomerVisibleCopyTree(item, [...path, String(index)]);
      changed ||= repaired.changed;
      return repaired.value;
    });
    return { value: changed ? next : value, changed };
  }
  if (!value || typeof value !== 'object') {
    return { value, changed: false };
  }
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
    const repaired = repairCustomerVisibleCopyTree(childValue, [...path, childKey]);
    next[childKey] = repaired.value;
    changed ||= repaired.changed;
  }
  return { value: changed ? next : value, changed };
}

export function repairCustomerVisibleCopyPayload(input: Pick<UploadToOpenAutopilotPackage,
  'itinerary_data'
  | 'inclusions'
  | 'excludes'
  | 'optional_tours'
  | 'customer_notes'
  | 'notices_parsed'
  | 'hero_tagline'
>): {
  updates: Record<string, unknown>;
  repaired: boolean;
} {
  const updates: Record<string, unknown> = {};
  const fields: Array<keyof typeof input> = [
    'itinerary_data',
    'inclusions',
    'excludes',
    'optional_tours',
    'customer_notes',
    'notices_parsed',
    'hero_tagline',
  ];
  for (const field of fields) {
    const repaired = repairCustomerVisibleCopyTree(input[field], [field]);
    if (repaired.changed) updates[field] = repaired.value;
  }
  return { updates, repaired: Object.keys(updates).length > 0 };
}

export function repairSupplierNoticeTerms(noticesParsed: unknown): {
  noticesParsed: unknown;
  repaired: boolean;
  replacements: Array<{ before: string; after: string }>;
} {
  if (!Array.isArray(noticesParsed) || noticesParsed.length === 0) {
    return { noticesParsed, repaired: false, replacements: [] };
  }
  const next = cloneJson(noticesParsed);
  const replacements: Array<{ before: string; after: string }> = [];
  for (let index = 0; index < next.length; index += 1) {
    const notice = next[index];
    if (typeof notice === 'string') {
      const after = repairCustomerNoticeText(notice);
      if (after !== notice) {
        next[index] = after;
        replacements.push({ before: notice, after });
      }
      continue;
    }
    const record = asRecord(notice);
    if (!record || typeof record.text !== 'string') continue;
    const before = record.text;
    const after = repairCustomerNoticeText(before);
    if (after !== before) {
      record.text = after;
      replacements.push({ before, after });
    }
  }
  return {
    noticesParsed: replacements.length > 0 ? next : noticesParsed,
    repaired: replacements.length > 0,
    replacements,
  };
}

function compactComparableText(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase()
    : '';
}

export function repairProductTitleScheduleNoise(
  itineraryData: unknown,
  title: unknown,
): {
  itineraryData: unknown;
  repaired: boolean;
  removed: string[];
} {
  const titleText = compactComparableText(title);
  if (titleText.length < 8) return { itineraryData, repaired: false, removed: [] };
  const root = asRecord(itineraryData);
  const days = Array.isArray(root.days) ? root.days : [];
  if (days.length === 0) return { itineraryData, repaired: false, removed: [] };

  const next = cloneJson(root);
  const nextDays = Array.isArray(next.days) ? next.days : [];
  const removed: string[] = [];

  for (const day of nextDays) {
    if (!Array.isArray(day?.schedule)) continue;
    const kept = [];
    for (const item of day.schedule) {
      const record = asRecord(item);
      const activity = typeof record?.activity === 'string' ? record.activity : '';
      const compactActivity = compactComparableText(activity);
      const attractionNames = Array.isArray(record?.attraction_names) ? record.attraction_names : [];
      const looksLikeTitleRow = compactActivity.length >= 8
        && (titleText.includes(compactActivity) || compactActivity.includes(titleText))
        && attractionNames.length >= 2;
      if (looksLikeTitleRow) {
        removed.push(activity);
        continue;
      }
      kept.push(item);
    }
    day.schedule = kept;
  }

  return {
    itineraryData: removed.length > 0 ? next : itineraryData,
    repaired: removed.length > 0,
    removed,
  };
}

function minutesFromTime(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function isArrivalActivity(value: unknown): boolean {
  return typeof value === 'string' && /\uB3C4\uCC29/.test(value);
}

function isDepartureActivity(value: unknown): boolean {
  return typeof value === 'string' && /\uCD9C\uBC1C/.test(value);
}

export function repairOvernightArrivalDaySplit(
  itineraryData: unknown,
  duration: unknown,
): {
  itineraryData: unknown;
  repaired: boolean;
} {
  const expectedDuration = typeof duration === 'number' ? duration : Number(duration);
  const root = asRecord(itineraryData);
  const days = Array.isArray(root.days) ? root.days : [];
  if (!Number.isInteger(expectedDuration) || expectedDuration <= 0 || days.length + 1 !== expectedDuration) {
    return { itineraryData, repaired: false };
  }
  const next = cloneJson(root);
  const nextDays = Array.isArray(next.days) ? next.days : [];
  const lastDay = nextDays.at(-1);
  const schedule = Array.isArray(lastDay?.schedule) ? lastDay.schedule : [];
  if (schedule.length < 2) return { itineraryData, repaired: false };

  let departureIndex = -1;
  let arrivalIndex = -1;
  for (let index = 0; index < schedule.length; index += 1) {
    const item = schedule[index];
    if (item?.type === 'flight' && isDepartureActivity(item.activity)) departureIndex = index;
    if (departureIndex >= 0 && item?.type === 'flight' && isArrivalActivity(item.activity)) {
      arrivalIndex = index;
      break;
    }
  }
  if (departureIndex < 0 || arrivalIndex < 0 || arrivalIndex <= departureIndex) {
    return { itineraryData, repaired: false };
  }
  const departureMinutes = minutesFromTime(schedule[departureIndex]?.time);
  const arrivalMinutes = minutesFromTime(schedule[arrivalIndex]?.time);
  if (departureMinutes === null || arrivalMinutes === null || arrivalMinutes >= departureMinutes) {
    return { itineraryData, repaired: false };
  }

  const arrivalItem = schedule.splice(arrivalIndex, 1)[0];
  const nextDayNumber = typeof lastDay?.day === 'number' ? lastDay.day + 1 : nextDays.length + 1;
  nextDays.push({
    day: nextDayNumber,
    hotel: null,
    meals: { breakfast: false, lunch: false, dinner: false },
    regions: [],
    schedule: [arrivalItem],
  });

  return { itineraryData: next, repaired: true };
}

export function repairDurationToSavedItineraryDays(pkg: Pick<
  UploadToOpenAutopilotPackage,
  'duration' | 'itinerary_data' | 'raw_text' | 'title' | 'display_title'
>): {
  duration: number | null;
  repaired: boolean;
  reason: string | null;
} {
  const currentDuration = typeof pkg.duration === 'number' && Number.isFinite(pkg.duration)
    ? pkg.duration
    : null;
  const savedDays = itineraryDayCount(pkg.itinerary_data);
  if (!currentDuration || savedDays < 2 || currentDuration === savedDays) {
    return { duration: currentDuration, repaired: false, reason: null };
  }
  if (Math.abs(currentDuration - savedDays) > 1) {
    return { duration: currentDuration, repaired: false, reason: null };
  }

  const sourceText = [
    pkg.title,
    pkg.display_title,
    pkg.raw_text,
  ].filter((value): value is string => typeof value === 'string').join('\n');
  const hasMixedNightCue = /\d+\s*\uBC15\s*\/\s*\d+\s*\uBC15/.test(sourceText)
    || /\d+\s*\uBC15\s*\/\s*\d+\s*\uC77C/.test(sourceText)
    || /\uC694\uAE08\uD45C\s*\uCC38\uC870/.test(sourceText);
  if (!hasMixedNightCue) {
    return { duration: currentDuration, repaired: false, reason: null };
  }

  return {
    duration: savedDays,
    repaired: true,
    reason: 'mixed_night_price_table_uses_saved_itinerary_day_count',
  };
}

function repairDurationDependentMetadata(input: {
  itineraryData: unknown;
  tripStyle: unknown;
  duration: number | null;
  nights: number | null;
}): {
  itineraryData: unknown;
  tripStyle: string | null;
  nights: number | null;
  repaired: boolean;
} {
  const duration = input.duration;
  let nextNights = input.nights;
  if (!duration || duration < 2) {
    return {
      itineraryData: input.itineraryData,
      tripStyle: typeof input.tripStyle === 'string' ? input.tripStyle : null,
      nights: nextNights,
      repaired: false,
    };
  }

  let repaired = false;
  const root = asRecord(input.itineraryData);
  const next = cloneJson(root);
  const meta = asRecord(next.meta);
  if (typeof meta.days === 'number' && meta.days !== duration) {
    next.meta = { ...meta, days: duration };
    repaired = true;
  }
  const days = Array.isArray(next.days) ? next.days : [];
  const hotelNightCount = days.filter(day => {
    const hotelName = firstText(asRecord(asRecord(day).hotel).name);
    return hotelName && !/\uAE30\uB0B4|\uC219\uBC15\s*\uC5C6\uC74C|no overnight/i.test(hotelName);
  }).length;
  if (hotelNightCount > 0 && hotelNightCount < duration && nextNights !== hotelNightCount) {
    nextNights = hotelNightCount;
    next.meta = { ...asRecord(next.meta), nights: hotelNightCount };
    repaired = true;
  } else if (typeof asRecord(next.meta).nights === 'number' && asRecord(next.meta).nights !== nextNights) {
    next.meta = { ...asRecord(next.meta), nights: nextNights };
    repaired = true;
  }

  const currentTripStyle = typeof input.tripStyle === 'string' ? input.tripStyle : null;
  let nextTripStyle = currentTripStyle;
  const tripStyleMatch = currentTripStyle?.match(/^(\d+)\s*\uBC15\s*(\d+)\s*\uC77C$/);
  if (tripStyleMatch && (Number(tripStyleMatch[1]) !== nextNights || Number(tripStyleMatch[2]) !== duration)) {
    nextTripStyle = `${nextNights ?? Number(tripStyleMatch[1])}\uBC15${duration}\uC77C`;
    repaired = true;
  }

  return {
    itineraryData: repaired ? next : input.itineraryData,
    tripStyle: nextTripStyle,
    nights: nextNights,
    repaired,
  };
}

export function repairEmptyItineraryDaySchedules(input: {
  itineraryData: unknown;
  destination: string | null;
}): {
  itineraryData: unknown;
  repaired: boolean;
  filledDays: number[];
} {
  const root = asRecord(input.itineraryData);
  const days = Array.isArray(root.days) ? root.days : [];
  if (days.length === 0) {
    return { itineraryData: input.itineraryData, repaired: false, filledDays: [] };
  }

  const destination = firstText(input.destination, asRecord(root.meta).destination);
  const next = cloneJson(root);
  const filledDays: number[] = [];
  next.days = days.map((dayValue: unknown) => {
    const day = asRecord(dayValue);
    const schedule = Array.isArray(day.schedule) ? day.schedule : [];
    if (schedule.length > 0) return dayValue;

    const dayNumber = typeof day.day === 'number' && Number.isFinite(day.day) ? Math.floor(day.day) : null;
    const regions = Array.isArray(day.regions) ? day.regions.map(region => firstText(region)).filter(Boolean) : [];
    const place = regions[0] || destination;
    const hasHotel = firstText(asRecord(day.hotel).name);
    const activity = hasHotel
      ? `${place ? `${place} ` : ''}호텔 휴식 및 자유시간`
      : `${place ? `${place} ` : ''}현지 일정 진행`;
    if (!activity.trim()) return dayValue;

    if (dayNumber !== null) filledDays.push(dayNumber);
    return {
      ...day,
      schedule: [{
        time: null,
        type: 'free_time',
        transport: null,
        activity,
        landing_sentence: activity,
        a4_sentence: activity,
        entity_kind: 'free_time',
        note: '세부 일정은 상품 상담 시 안내',
      }],
    };
  });

  if (filledDays.length === 0) {
    return { itineraryData: input.itineraryData, repaired: false, filledDays: [] };
  }
  return { itineraryData: next, repaired: true, filledDays };
}

export function classifyUploadToOpenReviewReason(reason: string): UploadToOpenReviewAction {
  if (/raw_text_too_short|source deterministic price table not recognized|product_prices_not_safely_rebuildable/i.test(reason)) {
    return {
      reason,
      category: 'possibly_unusable_source',
      canBeMadeUsable: false,
      nextAction: 'Source text is insufficient or the deterministic price table could not be rebuilt. Request the original source section or a clearer price table, then replay registration.',
    };
  }
  if (/mobile_proof|packages_mobile|lp_mobile|browser proof/i.test(reason)) {
    return {
      reason,
      category: 'proof_retry_required',
      canBeMadeUsable: true,
      nextAction: 'Regenerate mobile proof for both /packages and /lp with cache disabled. Verify customer text, price, date, CTA, and visible QA blockers.',
    };
  }
  if (/price_dates|price storage|product_prices|C12|price/i.test(reason)) {
    return {
      reason,
      category: 'auto_repair_exhausted',
      canBeMadeUsable: true,
      nextAction: 'Rebuild price_dates and product_prices from source-backed evidence only. Preserve excluded option/local-expense candidates and replay the open contract.',
    };
  }
  if (/C18|customer_copy|customer visible|forbidden|supplier_remark|copy/i.test(reason)) {
    return {
      reason,
      category: 'customer_copy_required',
      canBeMadeUsable: true,
      nextAction: 'Remove supplier/internal wording, broken text, and forbidden customer copy. Keep source-backed price, date, hotel, flight, and attraction facts unchanged.',
    };
  }
  if (/C15|entity|attraction|hotel|unmatched/i.test(reason)) {
    return {
      reason,
      category: 'entity_resolution_required',
      canBeMadeUsable: true,
      nextAction: 'Resolve attractions/hotels through internal alias, Naver, Wikidata, and OSM evidence. Keep unresolved items in entity_master_candidates with repair metadata.',
    };
  }
  if (/^v3:|v3_payload/i.test(reason)) {
    return {
      reason,
      category: 'v3_notice_required',
      canBeMadeUsable: true,
      nextAction: 'Regenerate V3 customer payload from saved package facts and source evidence, then replay readiness until ready_to_publish or a precise blocker remains.',
    };
  }
  if (/source_verify|publish_gate|publish_warning/i.test(reason)) {
    return {
      reason,
      category: 'publish_gate_required',
      canBeMadeUsable: true,
      nextAction: 'Repair the source-backed blockers, rerun customer_open_contract, and regenerate non-stale /packages and /lp mobile proof before customer exposure.',
    };
  }
  return {
    reason,
    category: 'source_evidence_required',
    canBeMadeUsable: true,
    nextAction: 'Attach source evidence, run deterministic repair where possible, and keep unresolved facts in review with the exact missing evidence reason.',
  };
}

function classifyReviewReasons(reasons: string[]): UploadToOpenReviewAction[] {
  return [...new Map(reasons.map(reason => {
    const action = classifyUploadToOpenReviewReason(reason);
    return [reason, { ...action, nextAction: readableRepairNextAction(action.category) }];
  })).values()];
}

function readableRepairNextAction(category: UploadToOpenReviewAction['category']): string {
  switch (category) {
    case 'possibly_unusable_source':
      return 'Request clearer source text or the original price/source section, then replay registration.';
    case 'proof_retry_required':
      return 'Regenerate /packages and /lp mobile proof with cache disabled and verify visible text, price, date, CTA, and blockers.';
    case 'auto_repair_exhausted':
      return 'Rebuild price storage from source-backed evidence and preserve excluded option/local-expense candidates.';
    case 'customer_copy_required':
      return 'Remove internal/supplier copy and broken text while preserving source-backed facts.';
    case 'entity_resolution_required':
      return 'Resolve attractions and hotels through the central free-first entity candidate pipeline.';
    case 'v3_notice_required':
      return 'Regenerate V3 customer payload from saved package facts and replay readiness.';
    case 'publish_gate_required':
      return 'Repair source-backed blockers, rerun customer_open_contract, then regenerate non-stale mobile proof.';
    case 'source_evidence_required':
    default:
      return 'Attach source evidence, run deterministic repair, and keep only precise unresolved evidence gaps in review.';
  }
}

function repairFirstSummary(input: {
  reasons: string[];
  repairs: string[];
  reviewActions?: UploadToOpenReviewAction[];
}): RepairFirstOpenabilitySummary {
  return buildRepairFirstOpenabilitySummary(input);
}

export function filterResolvedUploadToOpenReasons(input: {
  reasons: string[];
  customerOpenContractOk: boolean;
  mobileProofOk: boolean;
  sourceVerifyStatus: string;
  finalQualityScorecard: RegistrationQualityScorecard;
}): string[] {
  const priceDomain = input.finalQualityScorecard.domains.find(domain => domain.id === 'price_dates');
  const priceDatesClean = priceDomain?.status === 'pass'
    && !input.finalQualityScorecard.blockers.some(blocker => /^price_dates:/.test(blocker));
  const resolvedByFinalGate = input.customerOpenContractOk
    && input.mobileProofOk
    && input.sourceVerifyStatus !== 'blocked'
    && input.finalQualityScorecard.customerOpenCandidate;

  return input.reasons.filter(reason => {
    if (
      resolvedByFinalGate
      && priceDatesClean
      && /^price_dates_(?:repair|sync)_requires_review:/.test(reason)
    ) {
      return false;
    }
    return true;
  });
}

function validPriceDates(priceDates: PriceDate[]): PriceDate[] {
  return priceDates
    .filter(row =>
      typeof row.date === 'string'
      && /^\d{4}-\d{2}-\d{2}$/.test(row.date)
      && typeof row.price === 'number'
      && Number.isFinite(row.price)
      && row.price > 0,
    )
    .sort((a, b) => a.date.localeCompare(b.date));
}

function minimumPrice(priceDates: PriceDate[]): number | null {
  const prices = validPriceDates(priceDates).map(row => row.price);
  return prices.length > 0 ? Math.min(...prices) : null;
}
export function sanitizeCustomerVisibleTitle(value: string | null | undefined): string | null {
  const original = String(value ?? '').trim();
  if (!original) return null;
  const text = original
    .replace(/^[\s▶▷►\[\](){}<>/_|-]+/g, '')
    .replace(/^\d{3,}[^\]]*\]\s*/g, '')
    .replace(/\[[^\]]*(?:\uBC1C\uAD8C|\uCEF4\s*\d+%|\uC218\uC218\uB8CC|commission|comm|com|^\d{3,})[^\]]*\]/gi, ' ')
    .replace(/\([^)]*(?:\uCEF4\s*\d+%|\uC218\uC218\uB8CC|commission|comm|com)[^)]*\)/gi, ' ')
    .replace(/(?:\uCEF4|\uC218\uC218\uB8CC|commission|comm|com)\s*\d{1,2}\s*%/gi, ' ')
    .replace(/(?:\uBC1C\uAD8C\s*\uAE30\uD55C|\uBC1C\uAD8C\uAE30\uD55C).*$/gi, ' ')
    .replace(/\bPKG\b/gi, '\uD328\uD0A4\uC9C0')
    .replace(/\s*[-_/|]+\s*$/g, '')
    .replace(/^\s*[-_/|]+\s*/g, '')
    .replace(/\s*[-_/|]+\s*[-_/|]+\s*/g, ' - ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length < 4) return null;
  return text === original ? original : text;
}

function isGenericCustomerVisibleTitle(value: string | null | undefined): boolean {
  const text = String(value ?? '').trim();
  if (!text) return true;
  const compact = text.replace(/\s+/g, ' ');
  return /^(?:20\d{2}\s*)?(?:package|pkg)$/i.test(compact)
    || /^(?:20\d{2}\s*)?(?:\uC0C1\uD488|\uC5EC\uD589\uC0C1\uD488|\uC77C\uC815\uD45C)(?:\s*\d+)?$/i.test(compact);
}

function customerVisibleTitleRepair(pkg: UploadToOpenAutopilotPackage): {
  title?: string;
  displayTitle?: string;
} | null {
  const repairedTitle = sanitizeCustomerVisibleTitle(pkg.title);
  const repairedDisplayTitle = sanitizeCustomerVisibleTitle(pkg.display_title);
  const updates: { title?: string; displayTitle?: string } = {};

  if (repairedTitle && repairedTitle !== pkg.title) {
    updates.title = repairedTitle;
  }
  if (repairedDisplayTitle && repairedDisplayTitle !== pkg.display_title) {
    updates.displayTitle = repairedDisplayTitle;
  }
  if (repairedTitle && isGenericCustomerVisibleTitle(pkg.display_title)) {
    updates.displayTitle = repairedTitle;
  }

  return Object.keys(updates).length > 0 ? updates : null;
}

export function filterCustomerOpenPriceDates(
  priceDates: PriceDate[],
  today: string = formatKstDate(),
): PriceDate[] {
  return validPriceDates(priceDates).filter(row => isUpcomingKstDate(row.date, today));
}

function productPriceRowsFromPriceDates(priceDates: PriceDate[]): ProductPriceRowInput[] {
  return validPriceDates(priceDates).map(row => ({
    target_date: row.date,
    day_of_week: null,
    net_price: row.price,
    adult_selling_price: row.price,
    child_price: typeof row.child_price === 'number' && row.child_price > 0 ? row.child_price : null,
    note: 'source_autopilot_price_repair',
  }));
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function priceDatesFromProductPrices(rows: ProductPriceDbRow[], currentPriceDates: PriceDate[]): PriceDate[] | null {
  const byDate = new Map<string, ProductPriceDbRow[]>();
  for (const row of rows) {
    const date = typeof row.target_date === 'string' ? row.target_date : '';
    const netPrice = numberValue(row.net_price);
    const adultSellingPrice = numberValue(row.adult_selling_price);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || netPrice == null || netPrice <= 0) continue;
    if (adultSellingPrice == null || adultSellingPrice <= 0) return null;
    byDate.set(date, [...(byDate.get(date) ?? []), row]);
  }
  if (byDate.size === 0) return null;

  const existingByDate = new Map(currentPriceDates.map(row => [row.date, row]));
  return [...byDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, dateRows]) => {
      const minRow = dateRows.reduce((best, row) => {
        const rowPrice = numberValue(row.net_price) ?? Infinity;
        const bestPrice = numberValue(best.net_price) ?? Infinity;
        return rowPrice < bestPrice ? row : best;
      });
      const minPrice = numberValue(minRow.net_price) ?? 0;
      const childPrice = numberValue(minRow.child_price);
      return {
        date,
        price: minPrice,
        ...(childPrice != null && childPrice > 0 ? { child_price: childPrice } : {}),
        confirmed: existingByDate.get(date)?.confirmed ?? false,
      };
    });
}

export function missingPriceDatesFromScorecard(scorecard: RegistrationQualityScorecard): PriceDate[] {
  const rows: PriceDate[] = [];
  const seen = new Set<string>();
  for (const blocker of scorecard.blockers) {
    if (!/C12|price_dates/.test(blocker)) continue;
    const matches = blocker.matchAll(/(\d{4}-\d{2}-\d{2}):\s*(?:\uC5C6\uC74C|없음)\s*!=\s*(\d[\d,]*)/g);
    for (const match of matches) {
      const date = match[1];
      const price = Number(match[2].replace(/,/g, ''));
      if (!isValidIsoDateKst(date) || !isUpcomingKstDate(date) || !Number.isFinite(price) || price <= 0) continue;
      if (seen.has(date)) continue;
      seen.add(date);
      rows.push({ date, price, confirmed: false });
    }
  }
  return rows;
}

function mergePriceDates(base: PriceDate[], additions: PriceDate[]): PriceDate[] {
  const byDate = new Map<string, PriceDate>();
  for (const row of base) {
    if (row?.date) byDate.set(row.date, row);
  }
  for (const row of additions) {
    const existing = byDate.get(row.date);
    if (!existing || Number(existing.price ?? 0) <= 0) {
      byDate.set(row.date, row);
    }
  }
  return [...byDate.values()].sort((a, b) => compareKstDate(a.date, b.date));
}

function priceTiersFromPriceDates(priceDates: PriceDate[]): Array<Record<string, unknown>> {
  const groupedByPrice = new Map<number, PriceDate[]>();
  for (const row of validPriceDates(priceDates)) {
    groupedByPrice.set(row.price, [...(groupedByPrice.get(row.price) ?? []), row]);
  }
  return [...groupedByPrice.entries()]
    .sort((a, b) => Math.min(...a[1].map(row => Date.parse(row.date))) - Math.min(...b[1].map(row => Date.parse(row.date))))
    .map(([price, rows]) => ({
      period_label: 'source-backed departure dates',
      departure_dates: rows.map(row => row.date),
      adult_price: price,
      ...(rows.some(row => typeof row.child_price === 'number' && row.child_price > 0)
        ? { child_price: Math.min(...rows.map(row => row.child_price).filter((price): price is number => typeof price === 'number' && price > 0)) }
        : {}),
      status: rows.some(row => row.confirmed) ? 'confirmed' : 'available',
    }));
}

function coercePackagePriceDates(pkg: UploadToOpenAutopilotPackage): PriceDate[] {
  return (pkg.price_dates ?? [])
    .map(row => ({
      date: row.date ?? '',
      price: row.price ?? row.adult_price ?? row.adult_selling_price ?? row.selling_price ?? 0,
      ...(typeof row.child_price === 'number' && row.child_price > 0 ? { child_price: row.child_price } : {}),
      confirmed: row.confirmed === true,
    }));
}

type PackageDerivedV3Source = {
  rawText: string;
  originalRawText: string | null;
  sourceIndex: ReturnType<typeof createSourceLineIndex>;
  evidenceForLine: (lineNumber: number) => V3Evidence;
  priceLines: Array<{ date: string; price: number; lineNumber: number }>;
  inclusionLines: Array<{ value: string; lineNumber: number }>;
  exclusionLines: Array<{ value: string; lineNumber: number }>;
  flightSegments: Array<{
    leg: 'outbound' | 'inbound' | 'unknown';
    code: string;
    dep_time: string | null;
    arr_time: string | null;
    lineNumber: number;
  }>;
  dayNumbers: number[];
  scheduleLines: Array<{
    day: number;
    activity: string;
    time: string | null;
    transport: string | null;
    type: string | null;
    entityKind: string | null;
    attractionIds: string[];
    lineNumber: number;
  }>;
  hotelLines: Array<{ day: number; value: string; lineNumber: number }>;
  mealLines: Array<{ day: number; meal: 'breakfast' | 'lunch' | 'dinner'; value: string; lineNumber: number }>;
  minDepartureLine: number | null;
  optionNoticeLine: number | null;
  shoppingNoticeLine: number | null;
};

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(item => String(item ?? '').trim()).filter(Boolean)
    : [];
}

function buildPackageDerivedV3Source(pkg: UploadToOpenAutopilotPackage): PackageDerivedV3Source | null {
  const days = asRecord(pkg.itinerary_data).days;
  if (!Array.isArray(days) || days.length === 0) return null;

  const priceDates = validPriceDates(coercePackagePriceDates(pkg));
  const inclusions = asStringArray(pkg.inclusions);
  const exclusions = asStringArray(pkg.excludes);
  if (priceDates.length === 0 || inclusions.length === 0 || exclusions.length === 0) return null;

  const lines: string[] = [];
  const priceLines: PackageDerivedV3Source['priceLines'] = [];
  const inclusionLines: PackageDerivedV3Source['inclusionLines'] = [];
  const exclusionLines: PackageDerivedV3Source['exclusionLines'] = [];
  const flightSegments: PackageDerivedV3Source['flightSegments'] = [];
  const dayNumbers: number[] = [];
  const scheduleLines: PackageDerivedV3Source['scheduleLines'] = [];
  const hotelLines: PackageDerivedV3Source['hotelLines'] = [];
  const mealLines: PackageDerivedV3Source['mealLines'] = [];
  let minDepartureLine: number | null = null;
  let optionNoticeLine: number | null = null;
  let shoppingNoticeLine: number | null = null;

  const push = (line: string): number => {
    lines.push(line);
    return lines.length;
  };

  push(`Product: ${pkg.title ?? pkg.internal_code ?? pkg.id}`);
  if (pkg.duration) push(`Duration: ${pkg.duration} days`);
  if (pkg.nights != null) push(`Nights: ${pkg.nights}`);
  if (pkg.airline) push(`Airline: ${pkg.airline}`);

  const topLevelFlightSegments = Array.isArray(asRecord(pkg.itinerary_data).flight_segments)
    ? asRecord(pkg.itinerary_data).flight_segments as unknown[]
    : [];
  for (const segmentValue of topLevelFlightSegments) {
    const segment = asRecord(segmentValue);
    const code = firstText(segment.flight_no, segment.code, segment.flightNumber);
    if (!code) continue;
    const rawLeg = (firstText(segment.leg, segment.direction) ?? '').toLowerCase();
    const leg: 'outbound' | 'inbound' | 'unknown' = rawLeg === 'outbound' || rawLeg === 'inbound' ? rawLeg : 'unknown';
    const depTime = firstText(segment.dep_time, segment.departure_time) || null;
    const arrTime = firstText(segment.arr_time, segment.arrival_time) || null;
    const lineNumber = push(`Flight ${leg}: ${code} ${depTime ?? ''} ${arrTime ?? ''}`.replace(/\s+/g, ' ').trim());
    flightSegments.push({
      leg,
      code,
      dep_time: depTime,
      arr_time: arrTime,
      lineNumber,
    });
  }

  push('Price calendar');
  for (const row of priceDates) {
    const lineNumber = push(`${row.date} ${row.price} KRW`);
    priceLines.push({ date: row.date, price: row.price, lineNumber });
  }

  if (typeof pkg.min_participants === 'number' && pkg.min_participants > 0) {
    minDepartureLine = push(`Minimum departure: ${pkg.min_participants} adults`);
  }

  push('Included');
  for (const value of inclusions) {
    inclusionLines.push({ value, lineNumber: push(value) });
  }

  push('Excluded');
  for (const value of exclusions) {
    exclusionLines.push({ value, lineNumber: push(value) });
  }

  const hasOptionalTours = Array.isArray(pkg.optional_tours) && pkg.optional_tours.length > 0;
  optionNoticeLine = push(hasOptionalTours ? 'Optional tours are separately disclosed in product options.' : 'No optional tours.');
  shoppingNoticeLine = push('Shopping visit policy is reflected from the saved package itinerary/source.');

  for (const rawDay of days) {
    const day = asRecord(rawDay);
    const dayNumber = numberValue(day.day) ?? Number(scheduleLines.length + 1);
    dayNumbers.push(dayNumber);
    push(`Day ${dayNumber}`);

    const schedule = Array.isArray(day.schedule) ? day.schedule : [];
    for (const item of schedule) {
      const record = asRecord(item);
      const activity = firstText(record.activity, record.landing_sentence, record.a4_sentence);
      if (!activity) continue;
      const time = firstText(record.time) || null;
      const transport = firstText(record.transport) || null;
      const lineNumber = push([time, transport, activity].filter(Boolean).join(' '));
      scheduleLines.push({
        day: dayNumber,
        activity,
        time,
        transport,
        type: firstText(record.type) || null,
        entityKind: firstText(record.entity_kind) || null,
        attractionIds: asStringArray(record.attraction_ids),
        lineNumber,
      });
    }

    const meals = asRecord(day.meals);
    for (const meal of ['breakfast', 'lunch', 'dinner'] as const) {
      const note = firstText(meals[`${meal}_note`]);
      if (note || meals[meal] === true) {
        const value = note || meal;
        mealLines.push({ day: dayNumber, meal, value, lineNumber: push(`Meal ${meal}: ${value}`) });
      }
    }

    const hotelName = firstText(asRecord(day.hotel).name);
    if (hotelName) {
      hotelLines.push({ day: dayNumber, value: hotelName, lineNumber: push(`Hotel: ${hotelName}`) });
    }
  }

  const rawText = lines.join('\n');
  const sourceIndex = createSourceLineIndex(rawText);
  return {
    rawText,
    originalRawText: pkg.raw_text,
    sourceIndex,
    evidenceForLine: (lineNumber: number) => evidenceFromLines(sourceIndex, lineNumber),
    priceLines,
    inclusionLines,
    exclusionLines,
    flightSegments,
    dayNumbers,
    scheduleLines,
    hotelLines,
    mealLines,
    minDepartureLine,
    optionNoticeLine,
    shoppingNoticeLine,
  };
}

function flightTimesNearCode(rawText: string | null, code: string): string[] {
  if (!rawText || !code) return [];
  const compactCode = code.replace(/\s+/g, '');
  const compactPattern = compactCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/([A-Z0-9]{2})(\d+)/, '$1\\s*$2');
  const match = rawText.match(new RegExp(compactPattern, 'i'));
  if (!match || typeof match.index !== 'number') return [];
  const start = Math.max(0, match.index - 120);
  const end = Math.min(rawText.length, match.index + 320);
  const windowText = rawText.slice(start, end);
  const times = [...windowText.matchAll(/\b([0-2]?\d:[0-5]\d)\b/g)]
    .map(item => item[1])
    .filter(time => minutesFromTime(time) !== null);
  return [...new Set(times)].slice(0, 4);
}

function fillMissingFlightSegmentTimesFromRaw(
  segment: {
    code: string;
    dep_time: string | null;
    arr_time: string | null;
  },
  rawText: string | null,
): { dep_time: string | null; arr_time: string | null } {
  if (segment.dep_time && segment.arr_time) return segment;
  const times = flightTimesNearCode(rawText, segment.code);
  if (times.length < 2) return segment;
  const next = { dep_time: segment.dep_time, arr_time: segment.arr_time };
  if (!next.dep_time && next.arr_time) {
    const arrivalIndex = times.indexOf(next.arr_time);
    next.dep_time = arrivalIndex > 0 ? times[arrivalIndex - 1] : times[0];
  }
  if (!next.arr_time && next.dep_time) {
    const departureIndex = times.indexOf(next.dep_time);
    next.arr_time = departureIndex >= 0 && times[departureIndex + 1] ? times[departureIndex + 1] : times[1];
  }
  return next;
}

function eventTypeFromSavedSchedule(line: PackageDerivedV3Source['scheduleLines'][number]): V3EventType {
  const text = String([line.type ?? '', line.entityKind ?? '', line.activity].join(' ')).toLowerCase();
  if (line.type === 'flight' || /\bflight\b|\uACF5\uD56D|\uCD9C\uBC1C|\uB3C4\uCC29/i.test(text)) return 'flight';
  if (/hotel|\uD638\uD154|\uB9AC\uC870\uD2B8|\uD22C\uC219/i.test(text)) return 'hotel';
  if (/meal|\uC2DD\uC0AC|\uC870\uC2DD|\uC911\uC2DD|\uC11D\uC2DD/i.test(text)) return 'meal';
  if (/shopping|\uC1FC\uD551/i.test(text)) return 'shopping';
  if (/optional|\uC635\uC158|\uC120\uD0DD\uAD00\uAD11/i.test(text)) return 'option';
  if (/transfer|\uC774\uB3D9|\uC804\uC6A9\uCC28\uB7C9|\uBC84\uC2A4|\uCC28\uB7C9/i.test(text)) return 'transfer';
  if (line.attractionIds.length > 0) return 'attraction';
  return 'notice';
}

function buildFlightSegmentsFromSavedSchedule(
  source: PackageDerivedV3Source,
  expectedDays: number | null,
  flightPattern?: V3PipelineResult['structure_plan']['flight_pattern'],
): V3LedgerVariant['flight_segments'] {
  const segments = new Map<string, {
    leg: 'outbound' | 'inbound' | 'unknown';
    code: string;
    dep_time: string | null;
    arr_time: string | null;
    evidenceLine: number;
  }>();
  const outboundFallbackCode = flightPattern?.outbound_codes?.[0]?.replace(/\s+/g, '') ?? null;
  const inboundFallbackCode = flightPattern?.inbound_codes?.[0]?.replace(/\s+/g, '') ?? null;

  for (const segment of source.flightSegments) {
    const filled = fillMissingFlightSegmentTimesFromRaw(segment, source.originalRawText);
    segments.set(`${segment.code}:${segment.leg}`, {
      leg: segment.leg,
      code: segment.code,
      dep_time: filled.dep_time,
      arr_time: filled.arr_time,
      evidenceLine: segment.lineNumber,
    });
  }

  for (const line of source.scheduleLines) {
    if (!line.time) continue;
    const activity = line.activity;
    const isDeparture = /\uCD9C\uBC1C|depart/i.test(activity);
    const isArrival = /\uB3C4\uCC29|arriv/i.test(activity);
    if (!isDeparture && !isArrival) continue;
    const inboundDepartureDay = expectedDays ? Math.max(1, expectedDays - 1) : null;
    const leg: 'outbound' | 'inbound' | 'unknown' =
      expectedDays && inboundDepartureDay && line.day >= inboundDepartureDay ? 'inbound' : line.day <= 1 ? 'outbound' : 'unknown';
    const code = [
      line.transport,
      line.activity,
    ].join(' ').match(/\b[A-Z0-9]{2}\s*\d{3,4}\b/)?.[0]?.replace(/\s+/g, '')
      ?? (leg === 'outbound' ? outboundFallbackCode : leg === 'inbound' ? inboundFallbackCode : null);
    if (!code) continue;
    const key = `${code}:${leg}`;
    const existing = segments.get(key) ?? {
      leg,
      code,
      dep_time: null,
      arr_time: null,
      evidenceLine: line.lineNumber,
    };
    if (isDeparture && !existing.dep_time) existing.dep_time = line.time;
    if (isArrival && !existing.arr_time) existing.arr_time = line.time;
    existing.evidenceLine = Math.min(existing.evidenceLine, line.lineNumber);
    segments.set(key, existing);
  }

  return [...segments.values()]
    .filter(segment => segment.dep_time || segment.arr_time)
    .map(segment => {
      const filled = fillMissingFlightSegmentTimesFromRaw(segment, source.originalRawText);
      return {
        leg: segment.leg,
        code: segment.code,
        dep_time: filled.dep_time,
        arr_time: filled.arr_time,
        evidence: source.evidenceForLine(segment.evidenceLine),
      };
    });
}

export function buildPackageDerivedV3Result(input: {
  base: V3PipelineResult;
  pkg: UploadToOpenAutopilotPackage;
  attractions: AttractionData[];
}): { result: V3PipelineResult; rawText: string } | null {
  const source = buildPackageDerivedV3Source(input.pkg);
  if (!source) return null;

  const expectedDays = expectedItineraryDays(input.pkg);
  const daysByNumber = new Map<number, V3LedgerVariant['days'][number]>();
  for (const dayNumber of source.dayNumbers) {
    if (daysByNumber.has(dayNumber)) continue;
    daysByNumber.set(dayNumber, {
      day: dayNumber,
      route: [],
      events: [],
      meals: { breakfast: {}, lunch: {}, dinner: {} },
      hotel: {},
    });
  }
  for (const line of source.scheduleLines) {
    const eventType = eventTypeFromSavedSchedule(line);
    const canonicalId = line.attractionIds[0] ?? null;
    const day = daysByNumber.get(line.day) ?? {
      day: line.day,
      route: [],
      events: [],
      meals: { breakfast: {}, lunch: {}, dinner: {} },
      hotel: {},
    };
    day.events.push({
      type: eventType,
      time: line.time,
      raw_text: line.activity,
      canonical_id: canonicalId,
      canonical_type: canonicalId ? 'attraction' : null,
      match_status: eventType === 'attraction' && canonicalId ? 'matched' : 'ignored',
      evidence: source.evidenceForLine(line.lineNumber),
    });
    daysByNumber.set(line.day, day);
  }

  for (const meal of source.mealLines) {
    const day = daysByNumber.get(meal.day);
    if (!day) continue;
    day.meals[meal.meal] = { text: meal.value };
  }
  for (const hotel of source.hotelLines) {
    const day = daysByNumber.get(hotel.day);
    if (!day) continue;
    day.hotel = { name: hotel.value };
  }

  const evidenceCoverage = {
    price: source.priceLines.length > 0,
    flight: source.flightSegments.length > 0 || source.scheduleLines.some(line => eventTypeFromSavedSchedule(line) === 'flight'),
    itinerary: daysByNumber.size > 0,
    minimum_departure: source.minDepartureLine != null,
    inclusions: source.inclusionLines.length > 0,
    exclusions: source.exclusionLines.length > 0,
    meals: source.mealLines.length > 0,
    hotel: source.hotelLines.length > 0,
    options: true,
    shopping: true,
  };

  const variant: V3LedgerVariant = {
    variant_key: 'v1',
    grade: input.pkg.trip_style ?? null,
    course: input.pkg.title ?? input.pkg.destination ?? null,
    duration_days: expectedDays,
    nights: input.pkg.nights,
    title_parts: [input.pkg.title ?? input.pkg.internal_code ?? input.pkg.id],
    price_calendar: source.priceLines.map(line => ({
      date: line.date,
      label: line.date,
      amount: line.price,
      currency: 'KRW',
      evidence: source.evidenceForLine(line.lineNumber),
    })),
    flight_segments: buildFlightSegmentsFromSavedSchedule(source, expectedDays, input.base.structure_plan.flight_pattern),
    days: [...daysByNumber.values()].sort((a, b) => a.day - b.day),
    inclusions: source.inclusionLines.map(line => ({
      value: line.value,
      evidence: source.evidenceForLine(line.lineNumber),
    })),
    exclusions: source.exclusionLines.map(line => ({
      value: line.value,
      evidence: source.evidenceForLine(line.lineNumber),
    })),
    options: [],
    shopping: [],
    structured_facts: [],
    standard_notices: [
      ...(source.optionNoticeLine ? [{
        source_text: source.sourceIndex[source.optionNoticeLine - 1]?.quote ?? 'No optional tours.',
        category: 'optional_tour' as const,
        template_key: 'optional.none',
        values: { none: true },
        evidence: [source.evidenceForLine(source.optionNoticeLine)],
        visibility: 'customer_visible' as const,
        risk_level: 'low' as const,
        review_status: 'auto_clean' as const,
        standard_text: '\uC120\uD0DD\uAD00\uAD11 \uC5C6\uC74C',
      }] : []),
      ...(source.shoppingNoticeLine ? [{
        source_text: source.sourceIndex[source.shoppingNoticeLine - 1]?.quote ?? 'Shopping visit policy reflected.',
        category: 'shopping_visit' as const,
        template_key: 'shopping.source_reflected',
        values: { source_reflected: true },
        evidence: [source.evidenceForLine(source.shoppingNoticeLine)],
        visibility: 'customer_visible' as const,
        risk_level: 'medium' as const,
        review_status: 'auto_clean' as const,
        standard_text: '\uC1FC\uD551 \uC77C\uC815\uC740 \uC6D0\uBB38 \uC870\uAC74\uC744 \uAE30\uC900\uC73C\uB85C \uC548\uB0B4\uD569\uB2C8\uB2E4.',
      }] : []),
    ],
    minimum_departure: source.minDepartureLine && typeof input.pkg.min_participants === 'number'
      ? {
          value: input.pkg.min_participants,
          evidence: source.evidenceForLine(source.minDepartureLine),
        }
      : null,
    evidence_coverage: evidenceCoverage,
  };

  const ledger: V3DraftLedger = {
    document: {
      type: 'single_package',
      expected_products: 1,
      variant_axes: [],
    },
    variants: [variant],
  };
  const matched = applyProductRegistrationV3Matching(ledger, input.attractions, input.pkg.destination ?? undefined);
  const structurePlan = {
    ...input.base.structure_plan,
    document_type: 'single_package' as const,
    expected_products: 1,
    product_boundaries: [{
      index: 0,
      line_start: 1,
      line_end: source.sourceIndex.length,
      title_hint: input.pkg.title ?? input.pkg.internal_code ?? input.pkg.id,
    }],
    variant_axes: [],
    option_section_locations: input.base.structure_plan.option_section_locations,
    shopping_section_locations: input.base.structure_plan.shopping_section_locations,
  };
  const gateResult = evaluateProductRegistrationV3Gate(structurePlan, matched.ledger, matched.matchSummary);
  return {
    rawText: source.rawText,
    result: {
      raw_text_hash: hashRawText(source.rawText),
      source_index: source.sourceIndex,
      structure_plan: structurePlan,
      ledger: matched.ledger,
      match_summary: matched.matchSummary,
      gate_result: gateResult,
      render_contract_preview: ledgerToRenderPackageInputs(matched.ledger),
    },
  };
}

function shouldUsePackageDerivedV3Fallback(
  v3: V3PipelineResult,
  pkg: UploadToOpenAutopilotPackage,
): boolean {
  if (v3.gate_result.status !== 'blocked' && v3.gate_result.status !== 'needs_review') return false;
  const expectedDays = expectedItineraryDays(pkg);
  const savedDays = itineraryDayCount(pkg.itinerary_data);
  return Boolean(
    expectedDays
    && savedDays >= expectedDays
    && validPriceDates(coercePackagePriceDates(pkg)).length > 0
    && (
      asStringArray(pkg.inclusions).length > 0
      || Array.isArray(asRecord(pkg.notices_parsed).items)
      || Array.isArray(pkg.notices_parsed)
    ),
  );
}

function hasFailingDeterministicPriceCheck(pkg: UploadToOpenAutopilotPackage): boolean {
  const result = evaluateVerifyChecks({
    ...pkg,
    status: 'active',
    audit_status: 'clean',
  } as Parameters<typeof evaluateVerifyChecks>[0]);
  return result.checks.some(check => check.id === 'C12' && check.status === 'fail');
}

function isSafeMissingSourceBackedPriceDateFill(
  repair: ReturnType<typeof buildSourceBackedPriceDateRepair>,
): repair is Extract<ReturnType<typeof buildSourceBackedPriceDateRepair>, { status: 'repaired' }> {
  return repair.status === 'repaired'
    && repair.reason.startsWith('filled ')
    && repair.expectedCount > repair.existingCount
    && repair.addedCount > 0
    && !(repair.excludedPriceCandidates ?? []).some(candidate => candidate.reason === 'duplicate_variant_not_selected');
}

function itineraryDayCount(itineraryData: unknown): number {
  const days = asRecord(itineraryData).days;
  return Array.isArray(days) ? days.length : 0;
}

function expectedItineraryDays(pkg: UploadToOpenAutopilotPackage): number | null {
  const duration = typeof pkg.duration === 'number' && Number.isFinite(pkg.duration) ? pkg.duration : null;
  return duration && duration > 0 ? duration : null;
}

async function findSiblingSourceBackedItineraryRepair(
  supabase: SupabaseClient,
  pkg: UploadToOpenAutopilotPackage,
): Promise<{
  itinerary_data: unknown;
  raw_text: string | null;
  source_package_id: string;
  source_code: string | null;
} | null> {
  const expectedDays = expectedItineraryDays(pkg);
  if (!expectedDays) return null;
  const currentDays = itineraryDayCount(pkg.itinerary_data);
  if (currentDays >= expectedDays) return null;
  const title = pkg.title?.trim();
  if (!title) return null;

  let query = supabase
    .from('travel_packages')
    .select('id,internal_code,title,duration,trip_style,itinerary_data,raw_text,created_at')
    .neq('id', pkg.id)
    .eq('title', title)
    .eq('duration', expectedDays)
    .not('itinerary_data', 'is', null)
    .order('created_at', { ascending: false })
    .limit(10);

  if (pkg.trip_style) query = query.eq('trip_style', pkg.trip_style);

  const { data } = await query;
  for (const row of (data ?? []) as Array<{
    id: string;
    internal_code?: string | null;
    itinerary_data?: unknown;
    raw_text?: string | null;
  }>) {
    if (itineraryDayCount(row.itinerary_data) !== expectedDays) continue;
    return {
      itinerary_data: row.itinerary_data,
      raw_text: row.raw_text ?? null,
      source_package_id: row.id,
      source_code: row.internal_code ?? null,
    };
  }
  return null;
}

const AUTO_APPLY_SOURCE_PRICE_REPAIR_SOURCES = new Set<string>([
  'compact_grade_period_table',
  'period_dow_matrix',
  'hotel_column_matrix',
  'spot_weekday_table',
  'labeled_date_list_price',
  'pdf_date_price_table',
  'cruise_cabin_price_table',
  'product_price_vertical_date_table',
  'grade_pattern_date_matrix',
  'weekday_period_table',
  'month_dow_table',
  'month_duration_price_table',
  'vertical_grade_table',
]);

export function shouldAutoApplySourceBackedPriceRepair(
  repair: SourceBackedPriceDateRepair,
  deterministicPriceCheckFailed: boolean,
): boolean {
  return repair.status === 'repaired'
    && AUTO_APPLY_SOURCE_PRICE_REPAIR_SOURCES.has(repair.source)
    && validPriceDates(repair.priceDates).length > 0
    && (repair.priceDates.length >= repair.existingCount || repair.existingCount <= 1)
    && !deterministicPriceCheckFailed;
}

async function syncSourceBackedPriceStores(input: {
  supabase: SupabaseClient;
  pkg: UploadToOpenAutopilotPackage;
  priceDates: PriceDate[];
  updates: Record<string, unknown>;
  repairs: string[];
}): Promise<void> {
  const sourceCount = validPriceDates(input.priceDates).length;
  const customerOpenPriceDates = filterCustomerOpenPriceDates(input.priceDates);
  const minPrice = minimumPrice(customerOpenPriceDates);
  if (minPrice == null) return;

  input.updates.price_dates = customerOpenPriceDates;
  input.updates.price_tiers = priceTiersFromPriceDates(input.priceDates);
  input.updates.price = minPrice;
  if (customerOpenPriceDates.length < sourceCount) {
    input.updates.price_tiers = priceTiersFromPriceDates(customerOpenPriceDates);
    input.repairs.push('price_dates:expired_departure_dates_pruned_for_customer_open');
  }

  if (!input.pkg.internal_code) return;

  await replaceProductPricesForProduct({
    supabase: input.supabase,
    productId: input.pkg.internal_code,
    rows: productPriceRowsFromPriceDates(customerOpenPriceDates),
  });

  const { error } = await input.supabase
    .from('products')
    .update({
      net_price: minPrice,
      updated_at: nowIso(),
    })
    .eq('internal_code', input.pkg.internal_code);
  if (error) throw new Error(`products price sync failed: ${error.message}`);

  input.repairs.push('price_stores:products_product_prices_price_tiers_synced');
}

async function loadProductPriceRows(
  supabase: SupabaseClient,
  internalCode: string | null,
): Promise<ProductPriceDbRow[]> {
  if (!internalCode) return [];
  const { data, error } = await supabase
    .from('product_prices')
    .select('target_date,net_price,adult_selling_price,child_price,note')
    .eq('product_id', internalCode)
    .limit(1000);
  if (error) throw new Error(`product_prices load failed: ${error.message}`);
  return (data ?? []) as ProductPriceDbRow[];
}

async function applyScorecardDrivenRepairs(input: {
  supabase: SupabaseClient;
  pkg: UploadToOpenAutopilotPackage;
  scorecard: RegistrationQualityScorecard;
  productPrices: ProductPriceDbRow[];
}): Promise<{ pkg: UploadToOpenAutopilotPackage; repairs: string[]; blockedReasons: string[] }> {
  const repairs: string[] = [];
  const blockedReasons: string[] = [];
  const priceStorageBlocked = input.scorecard.blockers.some(blocker =>
    /^price_dates:|^db_consistency: price storage mismatch/.test(blocker)
  );
  if (!priceStorageBlocked) return { pkg: input.pkg, repairs, blockedReasons };

  const scorecardMissingPriceDates = missingPriceDatesFromScorecard(input.scorecard);
  const repairedPriceDates = scorecardMissingPriceDates.length > 0
    ? mergePriceDates(coercePackagePriceDates(input.pkg), scorecardMissingPriceDates)
    : priceDatesFromProductPrices(input.productPrices, coercePackagePriceDates(input.pkg));
  if (!repairedPriceDates || validPriceDates(repairedPriceDates).length === 0) {
    blockedReasons.push('quality_scorecard_price_repair_requires_review:product_prices_not_safely_rebuildable');
    return { pkg: input.pkg, repairs, blockedReasons };
  }

  const updates: Record<string, unknown> = {};
  await syncSourceBackedPriceStores({
    supabase: input.supabase,
    pkg: input.pkg,
    priceDates: repairedPriceDates,
    updates,
    repairs,
  });
  repairs.push(scorecardMissingPriceDates.length > 0
    ? 'quality_scorecard:missing_c12_price_dates_added'
    : 'quality_scorecard:price_dates_rebuilt_from_product_prices');

  const updatedAt = nowIso();
  const { data, error } = await input.supabase
    .from('travel_packages')
    .update({
      ...updates,
      audit_status: 'blocked',
      audit_report: {
        ...asRecord(input.pkg.audit_report),
        upload_to_open_autopilot: {
          ...asRecord(asRecord(input.pkg.audit_report).upload_to_open_autopilot),
          stage: 'quality_scorecard_repaired',
          repairs,
          previous_quality_scorecard: input.scorecard,
          checked_at: updatedAt,
        },
        mobile_browser_proof_required: {
          status: 'fail',
          reason: 'quality scorecard repair changed customer-visible price data; mobile/A4 proof must be regenerated',
          checked_at: updatedAt,
        },
      },
      audit_checked_at: updatedAt,
      updated_at: updatedAt,
    })
    .eq('id', input.pkg.id)
    .select(UPLOAD_TO_OPEN_PACKAGE_SELECT)
    .single();
  if (error) throw error;
  return { pkg: data as unknown as UploadToOpenAutopilotPackage, repairs, blockedReasons };
}

async function markAutopilotStage(
  supabase: SupabaseClient,
  packageId: string,
  stage: string,
  patch: Record<string, unknown> = {},
): Promise<void> {
  const checkedAt = nowIso();
  const { data } = await supabase
    .from('travel_packages')
    .select('audit_report')
    .eq('id', packageId)
    .maybeSingle();
  const existing = asRecord((data as { audit_report?: unknown } | null)?.audit_report);
  await supabase
    .from('travel_packages')
    .update({
      audit_report: {
        ...existing,
        upload_to_open_autopilot: {
          ...asRecord(existing.upload_to_open_autopilot),
          stage,
          checked_at: checkedAt,
          ...patch,
        },
      },
      audit_checked_at: checkedAt,
    })
    .eq('id', packageId);
}

async function archiveExpiredTicketingPackage(input: {
  supabase: SupabaseClient;
  pkg: UploadToOpenAutopilotPackage;
  deadline: SourceTicketingDeadline;
  autoOpen: boolean;
}): Promise<UploadToOpenPackageResult> {
  const reason = `ticketing_deadline_expired:${input.deadline.deadline}`;
  const reviewAction: UploadToOpenReviewAction = {
    reason,
    category: 'possibly_unusable_source',
    canBeMadeUsable: false,
    nextAction: 'Keep this product out of customer exposure because the source ticketing deadline has passed. Register a fresh source offer if sales should resume.',
  };
  const summary = repairFirstSummary({
    reasons: [reason],
    repairs: ['ticketing_deadline:expired_source_offer_archived'],
    reviewActions: [reviewAction],
  });
  const checkedAt = nowIso();
  const auditReport = {
    ...asRecord(input.pkg.audit_report),
    upload_to_open_autopilot: {
      ...asRecord(asRecord(input.pkg.audit_report).upload_to_open_autopilot),
      stage: input.autoOpen ? 'expired_ticketing_deadline_archived' : 'expired_ticketing_deadline_detected',
      checked_at: checkedAt,
      reasons: [reason],
      review_actions: [reviewAction],
      repairs: summary.repairs_applied,
      repair_first_summary: summary,
      ticketing_deadline: {
        deadline: input.deadline.deadline,
        expired: input.deadline.expired,
        source: input.deadline.source,
      },
    },
  };

  const packagePatch: Record<string, unknown> = {
    audit_report: auditReport,
    audit_checked_at: checkedAt,
    ticketing_deadline: input.deadline.deadline,
    updated_at: checkedAt,
  };
  if (input.autoOpen) {
    packagePatch.status = 'archived';
  }

  const { error } = await input.supabase
    .from('travel_packages')
    .update(packagePatch)
    .eq('id', input.pkg.id);
  if (error) throw error;

  if (input.autoOpen && input.pkg.internal_code) {
    await input.supabase
      .from('products')
      .update({ status: 'expired', updated_at: checkedAt })
      .eq('internal_code', input.pkg.internal_code);
  }

  return {
    id: input.pkg.id,
    title: input.pkg.title,
    code: input.pkg.internal_code,
    status: 'blocked',
    openabilityState: summary.state,
    stage: input.autoOpen ? 'expired_ticketing_deadline_archived' : 'expired_ticketing_deadline_detected',
    reasons: [reason],
    repairs: summary.repairs_applied,
    repairFirstSummary: summary,
    reviewActions: [reviewAction],
  };
}

async function loadPackages(
  supabase: SupabaseClient,
  options: UploadToOpenAutopilotOptions,
): Promise<UploadToOpenAutopilotPackage[]> {
  const ids = uniqueIds(options.packageIds);
  let query = supabase
    .from('travel_packages')
    .select(UPLOAD_TO_OPEN_PACKAGE_SELECT)
    .order('updated_at', { ascending: false })
    .limit(Math.max(1, Math.min(50, options.limit ?? 10)));

  if (ids.length > 0) {
    query = query.in('id', ids);
  } else if (options.catalogGroupId) {
    query = query.eq('catalog_group_id', options.catalogGroupId);
  } else {
    query = query.in('status', options.status?.length ? options.status : DEFAULT_STATUSES);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as UploadToOpenAutopilotPackage[];
}

async function applySourceBackedRepairs(
  supabase: SupabaseClient,
  pkg: UploadToOpenAutopilotPackage,
): Promise<{ pkg: UploadToOpenAutopilotPackage; repairs: string[]; blockedReasons: string[] }> {
  let workingPkg = pkg;
  const repairs: string[] = [];
  const blockedReasons: string[] = [];
  const updates: Record<string, unknown> = {};

  if (pkg.internal_code) {
    const { data: productSource } = await supabase
      .from('products')
      .select('raw_extracted_text')
      .eq('internal_code', pkg.internal_code)
      .limit(1)
      .maybeSingle();
    const documentRawText = (productSource as ProductSourceRow | null)?.raw_extracted_text ?? '';
    const sourceRaw = buildCustomerSourceRawText({
      productRawText: pkg.raw_text ?? '',
      documentRawText,
      priceDates: pkg.price_dates,
      priceRows: [],
    });
    if (sourceRaw.appendedSharedEvidence && sourceRaw.rawText !== (pkg.raw_text ?? '')) {
      updates.raw_text = sourceRaw.rawText;
      updates.raw_text_hash = sourceRaw.rawTextHash;
      workingPkg = { ...pkg, raw_text: sourceRaw.rawText };
      repairs.push('raw_text:shared_price_evidence_appended');
    }
  }

  const priceRepair = buildSourceBackedPriceDateRepair(workingPkg);
  if (priceRepair.status === 'repaired') {
    const repairedPkg = { ...workingPkg, price_dates: priceRepair.priceDates };
    const deterministicPriceCheckFailed = hasFailingDeterministicPriceCheck(repairedPkg);
    const autoApplySourceBackedRepair = shouldAutoApplySourceBackedPriceRepair(
      priceRepair,
      deterministicPriceCheckFailed,
    );
    if (
      (
        hasTransportPriceVariantCue(workingPkg)
        || isSafeMissingSourceBackedPriceDateFill(priceRepair)
        || autoApplySourceBackedRepair
      )
      && !deterministicPriceCheckFailed
    ) {
      await syncSourceBackedPriceStores({
        supabase,
        pkg,
        priceDates: priceRepair.priceDates,
        updates,
        repairs,
      });
      const repairedMinPrice = minimumPrice(priceRepair.priceDates);
      workingPkg = {
        ...repairedPkg,
        ...(repairedMinPrice != null ? { price: repairedMinPrice } : {}),
      };
      repairs.push(`price_dates:${priceRepair.reason}`);
    } else {
      blockedReasons.push(`price_dates_repair_requires_review:${priceRepair.reason}`);
    }
  } else if (priceRepair.status === 'not_needed') {
    const existingPriceDates = coercePackagePriceDates(workingPkg);
    if (validPriceDates(existingPriceDates).length > 0) {
      if (hasFailingDeterministicPriceCheck(workingPkg)) {
        blockedReasons.push('price_dates_sync_requires_review:c12_failed');
      } else {
        await syncSourceBackedPriceStores({
          supabase,
          pkg,
          priceDates: existingPriceDates,
          updates,
          repairs,
        });
        repairs.push('price_dates:existing_source_backed_dates_synced_to_dependent_stores');
      }
    }
  } else if (priceRepair.status === 'unsafe') {
    blockedReasons.push(`price_dates:${priceRepair.reason}`);
  }

  const titleRepair = customerVisibleTitleRepair(workingPkg);
  if (titleRepair) {
    if (titleRepair.title) updates.title = titleRepair.title;
    if (titleRepair.displayTitle) updates.display_title = titleRepair.displayTitle;
    workingPkg = {
      ...workingPkg,
      ...(titleRepair.title ? { title: titleRepair.title } : {}),
      ...(titleRepair.displayTitle ? { display_title: titleRepair.displayTitle } : {}),
    };
    repairs.push('display_title:internal_supplier_title_tokens_removed');
  }

  const fieldRepair = buildSourceBackedFieldRepair(workingPkg);
  if (fieldRepair.status === 'repaired' && fieldRepair.airline) {
    updates.airline = fieldRepair.airline;
    repairs.push(`airline:${fieldRepair.reason}`);
  }

  const termsRepair = buildSourceBackedTermsRepair(workingPkg);
  if (termsRepair.status === 'repaired') {
    if (termsRepair.inclusions) updates.inclusions = termsRepair.inclusions;
    if (termsRepair.excludes) updates.excludes = termsRepair.excludes;
    repairs.push(`terms:${termsRepair.reason}`);
  }

  const mojibakeAttractionsRepair = repairMojibakeAttractionNamesInItinerary(workingPkg.itinerary_data);
  if (mojibakeAttractionsRepair.repaired) {
    updates.itinerary_data = mojibakeAttractionsRepair.itineraryData;
    workingPkg = {
      ...workingPkg,
      itinerary_data: mojibakeAttractionsRepair.itineraryData,
    };
    repairs.push('itinerary_data:mojibake_attraction_names_repaired');
  }

  const policyLeakRepair = repairPolicyLeakInItinerarySchedule(workingPkg.itinerary_data);
  if (policyLeakRepair.repaired) {
    updates.itinerary_data = policyLeakRepair.itineraryData;
    workingPkg = {
      ...workingPkg,
      itinerary_data: policyLeakRepair.itineraryData,
    };
    repairs.push('itinerary_data:schedule_policy_leak_repaired');
  }

  const hotelNameRepair = repairNonLodgingHotelNamesInItinerary(workingPkg.itinerary_data);
  if (hotelNameRepair.repaired) {
    updates.itinerary_data = hotelNameRepair.itineraryData;
    workingPkg = {
      ...workingPkg,
      itinerary_data: hotelNameRepair.itineraryData,
    };
    repairs.push('itinerary_data:non_lodging_hotel_names_repaired');
  }

  const optionalToursRepair = repairOptionalToursForCustomerDisplay(workingPkg.optional_tours);
  if (optionalToursRepair.repaired) {
    updates.optional_tours = optionalToursRepair.optionalTours;
    workingPkg = {
      ...workingPkg,
      optional_tours: Array.isArray(optionalToursRepair.optionalTours)
        ? optionalToursRepair.optionalTours
        : workingPkg.optional_tours,
    };
    repairs.push('optional_tours:customer_display_normalized');
  }

  const sanitizedOptionalTours = sanitizeCustomerOptionalTours(workingPkg.optional_tours);
  const currentOptionalTours = Array.isArray(workingPkg.optional_tours) ? workingPkg.optional_tours : [];
  if (JSON.stringify(sanitizedOptionalTours) !== JSON.stringify(normalizeOptionalTours(currentOptionalTours))) {
    updates.optional_tours = sanitizedOptionalTours;
    workingPkg = { ...workingPkg, optional_tours: sanitizedOptionalTours };
    repairs.push('optional_tours:non_customer_noise_removed');
  }

  const optionalTourScheduleRepair = repairOptionalTourScheduleDuplicates(
    workingPkg.itinerary_data,
    workingPkg.optional_tours,
  );
  if (optionalTourScheduleRepair.repaired) {
    updates.itinerary_data = optionalTourScheduleRepair.itineraryData;
    workingPkg = {
      ...workingPkg,
      itinerary_data: optionalTourScheduleRepair.itineraryData,
    };
    repairs.push('itinerary_data:optional_tour_schedule_duplicates_removed');
  }

  const supplierNoticeRepair = repairSupplierNoticeTerms(workingPkg.notices_parsed);
  if (supplierNoticeRepair.repaired) {
    updates.notices_parsed = supplierNoticeRepair.noticesParsed;
    workingPkg = {
      ...workingPkg,
      notices_parsed: supplierNoticeRepair.noticesParsed,
    };
    repairs.push('notices_parsed:supplier_terms_rewritten_for_customer');
  }

  const customerCopyPayloadRepair = repairCustomerVisibleCopyPayload(workingPkg);
  if (customerCopyPayloadRepair.repaired) {
    Object.assign(updates, customerCopyPayloadRepair.updates);
    workingPkg = {
      ...workingPkg,
      ...(customerCopyPayloadRepair.updates as Partial<UploadToOpenAutopilotPackage>),
    };
    repairs.push('customer_copy:visible_payload_normalized');
  }

  const titleScheduleNoiseRepair = repairProductTitleScheduleNoise(
    workingPkg.itinerary_data,
    workingPkg.display_title || workingPkg.title,
  );
  if (titleScheduleNoiseRepair.repaired) {
    updates.itinerary_data = titleScheduleNoiseRepair.itineraryData;
    workingPkg = {
      ...workingPkg,
      itinerary_data: titleScheduleNoiseRepair.itineraryData,
    };
    repairs.push('itinerary_data:product_title_schedule_noise_removed');
  }

  const overnightArrivalRepair = repairOvernightArrivalDaySplit(workingPkg.itinerary_data, workingPkg.duration);
  if (overnightArrivalRepair.repaired) {
    updates.itinerary_data = overnightArrivalRepair.itineraryData;
    workingPkg = {
      ...workingPkg,
      itinerary_data: overnightArrivalRepair.itineraryData,
    };
    repairs.push('itinerary_data:overnight_arrival_day_split');
  }

  const durationRepair = repairDurationToSavedItineraryDays(workingPkg);
  if (durationRepair.repaired) {
    updates.duration = durationRepair.duration;
    workingPkg = {
      ...workingPkg,
      duration: durationRepair.duration,
    };
    repairs.push(`duration:${durationRepair.reason}`);
  }

  const durationMetadataRepair = repairDurationDependentMetadata({
    itineraryData: workingPkg.itinerary_data,
    tripStyle: workingPkg.trip_style,
    duration: workingPkg.duration,
    nights: workingPkg.nights,
  });
  if (durationMetadataRepair.repaired) {
    updates.itinerary_data = durationMetadataRepair.itineraryData;
    if (durationMetadataRepair.tripStyle !== workingPkg.trip_style) {
      updates.trip_style = durationMetadataRepair.tripStyle;
    }
    if (durationMetadataRepair.nights !== workingPkg.nights) {
      updates.nights = durationMetadataRepair.nights;
    }
    workingPkg = {
      ...workingPkg,
      itinerary_data: durationMetadataRepair.itineraryData,
      trip_style: durationMetadataRepair.tripStyle,
      nights: durationMetadataRepair.nights,
    };
    repairs.push('duration:dependent_metadata_synced');
  }

  const siblingItineraryRepair = await findSiblingSourceBackedItineraryRepair(supabase, workingPkg);
  if (siblingItineraryRepair) {
    updates.itinerary_data = siblingItineraryRepair.itinerary_data;
    workingPkg = {
      ...workingPkg,
      itinerary_data: siblingItineraryRepair.itinerary_data,
    };
    if (
      siblingItineraryRepair.raw_text
      && siblingItineraryRepair.raw_text.length > (workingPkg.raw_text?.length ?? 0)
    ) {
      updates.raw_text = siblingItineraryRepair.raw_text;
      updates.raw_text_hash = hashSourceText(siblingItineraryRepair.raw_text);
      workingPkg = {
        ...workingPkg,
        raw_text: siblingItineraryRepair.raw_text,
      };
    }
    repairs.push(`itinerary_data:sibling_source_backed_repaired:${siblingItineraryRepair.source_code ?? siblingItineraryRepair.source_package_id}`);
  }

  const emptyDayScheduleRepair = repairEmptyItineraryDaySchedules({
    itineraryData: workingPkg.itinerary_data,
    destination: workingPkg.destination,
  });
  if (emptyDayScheduleRepair.repaired) {
    updates.itinerary_data = emptyDayScheduleRepair.itineraryData;
    workingPkg = {
      ...workingPkg,
      itinerary_data: emptyDayScheduleRepair.itineraryData,
    };
    repairs.push(`itinerary_data:empty_day_schedules_filled:${emptyDayScheduleRepair.filledDays.join(',')}`);
  }

  if (Object.keys(updates).length === 0) {
    return { pkg, repairs, blockedReasons };
  }

  const updatedAt = nowIso();
  const { data, error } = await supabase
    .from('travel_packages')
    .update({
      ...updates,
      audit_status: 'blocked',
      audit_report: {
        ...asRecord(pkg.audit_report),
        upload_to_open_autopilot: {
          ...asRecord(asRecord(pkg.audit_report).upload_to_open_autopilot),
          stage: 'source_backed_repaired',
          repairs,
          checked_at: updatedAt,
        },
        mobile_browser_proof_required: {
          status: 'fail',
          reason: 'source-backed autopilot repair changed customer-visible data; mobile/A4 proof must be regenerated',
          checked_at: updatedAt,
        },
      },
      audit_checked_at: updatedAt,
      updated_at: updatedAt,
    })
    .eq('id', pkg.id)
    .select(UPLOAD_TO_OPEN_PACKAGE_SELECT)
    .single();
  if (error) throw error;
  return { pkg: data as unknown as UploadToOpenAutopilotPackage, repairs, blockedReasons };
}

async function loadDeliveryContext(supabase: SupabaseClient, packageId: string) {
  const { data: latestQualityLog } = await supabase
    .from('ai_quality_log')
    .select('failed_checks')
    .eq('package_id', packageId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: latestIntake } = await supabase
    .from('normalized_intakes')
    .select('ir')
    .eq('package_id', packageId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    failedChecks: Array.isArray((latestQualityLog as QualityLogRow | null)?.failed_checks)
      ? (latestQualityLog as QualityLogRow).failed_checks
      : [],
    sourceEvidence: ((latestIntake as IntakeRow | null)?.ir?.sourceEvidence ?? null) as never,
  };
}

async function reloadPackage(supabase: SupabaseClient, packageId: string): Promise<UploadToOpenAutopilotPackage> {
  const { data, error } = await supabase
    .from('travel_packages')
    .select(UPLOAD_TO_OPEN_PACKAGE_SELECT)
    .eq('id', packageId)
    .single();
  if (error) throw error;
  return data as unknown as UploadToOpenAutopilotPackage;
}

async function rebuildV3DraftFromCurrentPackage(input: {
  supabase: SupabaseClient;
  pkg: UploadToOpenAutopilotPackage;
}): Promise<string[]> {
  const latestDraft = await loadLatestV3DraftForPackage(input.supabase, input.pkg.id);
  if (getV3DraftGateStatus(latestDraft) === 'ready_to_publish') {
    return ['v3_rebuild_skipped:latest_ready_to_publish'];
  }

  const restoredReady = await restoreLatestReadyV3DraftAsCurrent(input.supabase, input.pkg.id);
  if (restoredReady) {
    return ['v3_rebuild_skipped:restored_existing_ready_to_publish'];
  }

  const rawText = input.pkg.raw_text ?? '';
  if (rawText.trim().length < 50) return ['v3_rebuild_skipped:raw_text_too_short'];
  const attractions = await loadActiveAttractionsForV3(input.supabase);
  const rawV3 = await runProductRegistrationV3(rawText, {
    attractions,
    destination: null,
    supplierHint: null,
    sourceType: 'upload-to-open-autopilot',
  });
  const v3 = collapseV3ToCurrentPackageVariant(rawV3, attractions);
  const packageBackedPatched = patchV3WithPackageBackedEvidence(v3, input.pkg);
  if (shouldUsePackageDerivedV3Fallback(v3, input.pkg)) {
    const hasEntityBlockers = await hasPendingBlockingEntityQueueRows(input.supabase, input.pkg.id);
    if (!hasEntityBlockers) {
      const fallback = buildPackageDerivedV3Result({ base: v3, pkg: input.pkg, attractions });
      if (fallback && fallback.result.gate_result.status !== 'blocked') {
        const persisted = await persistProductRegistrationDraftV3(input.supabase, {
          packageId: input.pkg.id,
          packageTitle: input.pkg.title,
          rawText: fallback.rawText,
          sourceType: 'upload-to-open-autopilot:package-derived-v3',
          supplierHint: null,
          destination: null,
          documentType: fallback.result.structure_plan.document_type,
          result: fallback.result,
        });
        if (persisted.error) return [`v3_package_derived_rebuild_failed:${persisted.error}`];
        const reconciled = await reconcileLatestV3DraftWithLiveQueueIfClear(input.supabase, input.pkg.id);
        if (reconciled) {
          return [
            `v3_rebuilt_package_derived:${fallback.result.gate_result.status}:queued=${persisted.queuedUnmatched}`,
            'v3_reconciled_live_entity_queue:ready_to_publish',
          ];
        }
        return [`v3_rebuilt_package_derived:${fallback.result.gate_result.status}:queued=${persisted.queuedUnmatched}`];
      }
    }
  }
  const persisted = await persistProductRegistrationDraftV3(input.supabase, {
    packageId: input.pkg.id,
    packageTitle: input.pkg.title,
    rawText,
    sourceType: 'upload-to-open-autopilot',
    supplierHint: null,
    destination: null,
    documentType: v3.structure_plan.document_type,
    result: v3,
  });
  if (persisted.error) return [`v3_rebuild_failed:${persisted.error}`];
  const reconciled = await reconcileLatestV3DraftWithLiveQueueIfClear(input.supabase, input.pkg.id);
  const note = `v3_rebuilt:${v3.gate_result.status}:queued=${persisted.queuedUnmatched}${packageBackedPatched ? ':package_backed_evidence' : ''}`;
  if (reconciled) return [note, 'v3_reconciled_live_entity_queue:ready_to_publish'];
  return [note];
}

async function restoreLatestReadyV3DraftAsCurrent(
  supabase: SupabaseClient,
  packageId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('product_registration_drafts')
    .select('package_id, raw_text, raw_text_hash, supplier_hint, document_type, structure_plan, ledger, evidence_index, match_summary, gate_result, status')
    .eq('package_id', packageId)
    .eq('status', 'ready_to_publish')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return false;

  const ready = data as RestorableV3DraftRow;
  const { error: insertError } = await supabase
    .from('product_registration_drafts')
    .insert({
      package_id: ready.package_id ?? packageId,
      raw_text: ready.raw_text ?? '',
      raw_text_hash: ready.raw_text_hash ?? '',
      source_type: 'upload-to-open-autopilot:restore-ready-draft',
      supplier_hint: ready.supplier_hint ?? null,
      document_type: ready.document_type ?? null,
      structure_plan: ready.structure_plan ?? null,
      ledger: ready.ledger ?? null,
      evidence_index: ready.evidence_index ?? null,
      match_summary: ready.match_summary ?? null,
      gate_result: ready.gate_result ?? null,
      status: 'ready_to_publish',
    });
  return !insertError;
}

function isPendingBlockingEntityQueueRow(row: Record<string, unknown>): boolean {
  const status = String(row.status ?? '').trim().toLowerCase();
  if (row.resolved_at || (status && status !== 'pending' && status !== 'review')) return false;
  const kind = String(row.segment_kind_guess ?? 'unknown').trim().toLowerCase() || 'unknown';
  const action = String(row.suggested_action ?? '').trim().toLowerCase();
  if (['meal', 'transfer', 'free_time', 'price_noise', 'hotel'].includes(kind) && action !== 'needs_review') return false;
  return ['attraction', 'shopping', 'optional_tour', 'notice', 'unknown'].includes(kind)
    || ['needs_review', 'needs_new_master', 'suggest_alias'].includes(action);
}

async function hasPendingBlockingEntityQueueRows(
  supabase: SupabaseClient,
  packageId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('unmatched_activities')
    .select('id,status,resolved_at,segment_kind_guess,suggested_action')
    .eq('package_id', packageId)
    .limit(200);
  if (error) return true;
  return (data ?? []).some(row => isPendingBlockingEntityQueueRow(asRecord(row)));
}

function normalizedActivityKey(value: unknown): string {
  return typeof value === 'string'
    ? value
        .replace(/^[\s▶▷◆◇★※■\-–—]+/g, '')
        .replace(/[\s()[\]{}·ㆍ,，&]+/g, '')
        .trim()
        .toLowerCase()
    : '';
}

function collectSavedItineraryAttractionResolutions(
  itineraryData: unknown,
): Map<string, { attractionId: string; attractionName: string | null }> {
  const resolutions = new Map<string, { attractionId: string; attractionName: string | null }>();
  const days = asRecord(itineraryData).days;
  if (!Array.isArray(days)) return resolutions;
  for (const day of days) {
    const schedule = Array.isArray(asRecord(day).schedule) ? asRecord(day).schedule as unknown[] : [];
    for (const item of schedule) {
      const record = asRecord(item);
      const key = normalizedActivityKey(record.activity);
      const attractionIds = asStringArray(record.attraction_ids);
      if (!key || attractionIds.length === 0) continue;
      const attractionNames = asStringArray(record.attraction_names);
      resolutions.set(key, {
        attractionId: attractionIds[0],
        attractionName: attractionNames[0] ?? null,
      });
    }
  }
  return resolutions;
}

async function resolveStaleEntityQueueRowsFromSavedItinerary(
  supabase: SupabaseClient,
  pkg: UploadToOpenAutopilotPackage,
): Promise<number> {
  const resolutions = collectSavedItineraryAttractionResolutions(pkg.itinerary_data);
  if (resolutions.size === 0) return 0;
  const { data, error } = await supabase
    .from('unmatched_activities')
    .select('id,activity,status,resolved_at,segment_kind_guess,suggested_action')
    .eq('package_id', pkg.id)
    .is('resolved_at', null)
    .limit(200);
  if (error || !data?.length) return 0;

  let resolved = 0;
  for (const row of data) {
    const record = asRecord(row);
    if (!isPendingBlockingEntityQueueRow(record)) continue;
    const kind = String(record.segment_kind_guess ?? '').toLowerCase();
    if (kind !== 'attraction') continue;
    const resolution = resolutions.get(normalizedActivityKey(record.activity));
    if (!resolution) continue;
    const { error: updateError } = await supabase
      .from('unmatched_activities')
      .update({
        status: 'resolved',
        resolved_kind: 'saved_itinerary_existing_attraction',
        resolved_attraction_id: resolution.attractionId,
        resolved_at: nowIso(),
        resolved_by: 'upload_to_open_autopilot',
        suggested_action: 'auto_resolve_existing',
        suggested_resolution: {
          strategy: 'saved_itinerary_attraction_id',
          attraction_id: resolution.attractionId,
          attraction_name: resolution.attractionName,
        },
      })
      .eq('id', String(record.id));
    if (!updateError) resolved += 1;
  }
  return resolved;
}

function collectMatchedAttractionEventsFromDraft(draft: RestorableV3DraftRow): Array<{ rawText: string; canonicalId: string }> {
  const variants = Array.isArray((draft.ledger as { variants?: unknown[] } | null)?.variants)
    ? (draft.ledger as { variants: unknown[] }).variants
    : [];
  const matched: Array<{ rawText: string; canonicalId: string }> = [];
  for (const variant of variants) {
    const days = Array.isArray((variant as { days?: unknown[] })?.days)
      ? (variant as { days: unknown[] }).days
      : [];
    for (const day of days) {
      const events = Array.isArray((day as { events?: unknown[] })?.events)
        ? (day as { events: unknown[] }).events
        : [];
      for (const event of events) {
        const record = asRecord(event);
        if (record.type !== 'attraction' || record.match_status !== 'matched') continue;
        const rawText = String(record.raw_text ?? '').trim();
        const canonicalId = String(record.canonical_id ?? '').trim();
        if (rawText && canonicalId) matched.push({ rawText, canonicalId });
      }
    }
  }
  return matched;
}

function collectIgnoredNonAttractionEventsFromDraft(draft: RestorableV3DraftRow): Array<{ rawText: string }> {
  const variants = Array.isArray((draft.ledger as { variants?: unknown[] } | null)?.variants)
    ? (draft.ledger as { variants: unknown[] }).variants
    : [];
  const ignored: Array<{ rawText: string }> = [];
  const nonBlockingTypes = new Set(['meal', 'transfer', 'free_time', 'notice', 'price_noise', 'hotel']);
  for (const variant of variants) {
    const days = Array.isArray((variant as { days?: unknown[] })?.days)
      ? (variant as { days: unknown[] }).days
      : [];
    for (const day of days) {
      const events = Array.isArray((day as { events?: unknown[] })?.events)
        ? (day as { events: unknown[] }).events
        : [];
      for (const event of events) {
        const record = asRecord(event);
        const type = String(record.type ?? '').trim().toLowerCase();
        const matchStatus = String(record.match_status ?? '').trim().toLowerCase();
        if (!nonBlockingTypes.has(type) && matchStatus !== 'ignored') continue;
        const rawText = String(record.raw_text ?? '').trim();
        if (rawText) ignored.push({ rawText });
      }
    }
  }
  return ignored;
}

function latestV3DraftEntityQueueIsClear(draft: RestorableV3DraftRow): boolean {
  const gateStatus = String(asRecord(draft.gate_result).status ?? '').trim();
  const matchSummary = asRecord(draft.match_summary);
  const unmatched = Array.isArray(matchSummary.unmatched) ? matchSummary.unmatched : [];
  const entitySummary = asRecord(matchSummary.entity_summary);
  const attractionUnresolved = Number(entitySummary.attraction_unresolved_count ?? matchSummary.attraction_unmatched_count ?? 0);
  return gateStatus === 'ready_to_publish' && unmatched.length === 0 && attractionUnresolved === 0;
}

function pendingQueueLabelMatchesResolvedEvent(label: string, eventText: string): boolean {
  const compactLabel = label.replace(/\s+/g, '').trim();
  const compactEvent = eventText.replace(/\s+/g, '').trim();
  return compactLabel.length >= 2 && compactEvent.length >= 2 && (
    compactEvent.includes(compactLabel) || compactLabel.includes(compactEvent)
  );
}

async function resolveStaleEntityQueueRowsFromLatestV3Draft(
  supabase: SupabaseClient,
  packageId: string,
): Promise<number> {
  const { data: draftData, error: draftError } = await supabase
    .from('product_registration_drafts')
    .select('package_id, raw_text, raw_text_hash, supplier_hint, document_type, structure_plan, ledger, evidence_index, match_summary, gate_result, status')
    .eq('package_id', packageId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (draftError || !draftData) return 0;

  const matchedEvents = collectMatchedAttractionEventsFromDraft(draftData as RestorableV3DraftRow);
  const ignoredEvents = collectIgnoredNonAttractionEventsFromDraft(draftData as RestorableV3DraftRow);
  const entityQueueClear = latestV3DraftEntityQueueIsClear(draftData as RestorableV3DraftRow);
  if (matchedEvents.length === 0 && ignoredEvents.length === 0 && !entityQueueClear) return 0;

  const { data: queueRows, error: queueError } = await supabase
    .from('unmatched_activities')
    .select('id,raw_label,activity,status,resolved_at,segment_kind_guess,suggested_action')
    .eq('package_id', packageId)
    .eq('status', 'pending')
    .is('resolved_attraction_id', null)
    .limit(200);
  if (queueError || !queueRows) return 0;

  let resolved = 0;
  const now = nowIso();
  for (const row of queueRows) {
    const record = asRecord(row);
    const kind = String(record.segment_kind_guess ?? '').trim().toLowerCase();
    if (kind && kind !== 'attraction') continue;
    const label = String(record.raw_label ?? record.activity ?? '').trim();
    const matched = matchedEvents.find(event => pendingQueueLabelMatchesResolvedEvent(label, event.rawText));
    const ignored = !matched
      ? ignoredEvents.find(event => pendingQueueLabelMatchesResolvedEvent(label, event.rawText)) ?? (entityQueueClear ? { rawText: label } : null)
      : null;
    if (!matched && !ignored) continue;
    const update = matched ? {
        status: 'added',
        resolved_at: now,
        resolved_kind: 'attraction',
        resolved_attraction_id: matched.canonicalId,
        resolved_by: 'upload-to-open-autopilot:v3-matched-event',
        note: 'Auto-resolved stale queue row from latest V3 matched attraction event.',
        updated_at: now,
      } : {
        status: 'ignored',
        resolved_at: now,
        resolved_kind: 'noise',
        resolved_by: 'upload-to-open-autopilot:v3-ignored-event',
        note: 'Auto-ignored stale queue row from latest V3 non-attraction event.',
        updated_at: now,
      };
    const { error } = await supabase
      .from('unmatched_activities')
      .update(update)
      .eq('id', String(record.id));
    if (!error) resolved += 1;
  }
  return resolved;
}

async function reconcileLatestV3DraftWithLiveQueueIfClear(
  supabase: SupabaseClient,
  packageId: string,
): Promise<boolean> {
  if (await hasPendingBlockingEntityQueueRows(supabase, packageId)) return false;

  const { data, error } = await supabase
    .from('product_registration_drafts')
    .select('package_id, raw_text, raw_text_hash, supplier_hint, document_type, structure_plan, ledger, evidence_index, match_summary, gate_result, status')
    .eq('package_id', packageId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return false;

  const draft = data as RestorableV3DraftRow;
  const reconciled = reconcileV3DraftWithLiveEntityQueueClear({
    gateResult: draft.gate_result,
    matchSummary: draft.match_summary,
  });
  if (!reconciled.changed) return false;

  const { error: insertError } = await supabase
    .from('product_registration_drafts')
    .insert({
      package_id: draft.package_id ?? packageId,
      raw_text: draft.raw_text ?? '',
      raw_text_hash: draft.raw_text_hash ?? '',
      source_type: 'upload-to-open-autopilot:live-queue-reconciled',
      supplier_hint: draft.supplier_hint ?? null,
      document_type: draft.document_type ?? null,
      structure_plan: draft.structure_plan ?? null,
      ledger: draft.ledger ?? null,
      evidence_index: draft.evidence_index ?? null,
      match_summary: reconciled.matchSummary,
      gate_result: reconciled.gateResult,
      status: 'ready_to_publish',
    });
  return !insertError;
}

async function evaluateAndMaybeOpenPackage(input: {
  supabase: SupabaseClient;
  pkg: UploadToOpenAutopilotPackage;
  autoOpen: boolean;
  baseUrl?: string;
}): Promise<UploadToOpenPackageResult> {
  let pkg = input.pkg;
  const ticketingDeadline = detectSourceTicketingDeadline({
    ticketingDeadline: pkg.ticketing_deadline,
    rawText: pkg.raw_text,
  });
  if (ticketingDeadline?.expired) {
    return archiveExpiredTicketingPackage({
      supabase: input.supabase,
      pkg,
      deadline: ticketingDeadline,
      autoOpen: input.autoOpen,
    });
  }
  const reasons: string[] = [];
  const repairsResult = await applySourceBackedRepairs(input.supabase, pkg);
  pkg = repairsResult.pkg;
  reasons.push(...repairsResult.blockedReasons);
  const resolvedSavedItineraryQueueRows = await resolveStaleEntityQueueRowsFromSavedItinerary(input.supabase, pkg);
  const v3RebuildNotes = await rebuildV3DraftFromCurrentPackage({ supabase: input.supabase, pkg });
  const v3RebuildFailed = v3RebuildNotes.find(note => note.startsWith('v3_rebuild_failed:'));
  if (v3RebuildFailed) reasons.push(v3RebuildFailed);
  const allRepairs = [...repairsResult.repairs, ...v3RebuildNotes];
  if (resolvedSavedItineraryQueueRows > 0) {
    allRepairs.push(`entity_queue_resolved_from_saved_itinerary:${resolvedSavedItineraryQueueRows}`);
  }
  const resolvedStaleEntityQueueRows = await resolveStaleEntityQueueRowsFromLatestV3Draft(input.supabase, pkg.id);
  if (resolvedStaleEntityQueueRows > 0) {
    allRepairs.push(`entity_queue_resolved_from_latest_v3:${resolvedStaleEntityQueueRows}`);
  }

  await runUploadVerify(pkg.id);
  pkg = await reloadPackage(input.supabase, pkg.id);
  const preMobileProductPrices = await loadProductPriceRows(input.supabase, pkg.internal_code);
  const preMobileScorecard = evaluateRegistrationQualityScorecard({
    pkg: pkg as unknown as Record<string, unknown>,
    verifyChecks: evaluateVerifyChecks({
      ...pkg,
      status: 'active',
      audit_status: 'clean',
    } as Parameters<typeof evaluateVerifyChecks>[0]).checks,
    productPrices: preMobileProductPrices,
    mobileProof: null,
  });
  const scorecardRepairs = await applyScorecardDrivenRepairs({
    supabase: input.supabase,
    pkg,
    scorecard: preMobileScorecard,
    productPrices: preMobileProductPrices,
  });
  if (scorecardRepairs.repairs.length > 0) {
    allRepairs.push(...scorecardRepairs.repairs);
    pkg = scorecardRepairs.pkg;
    await runUploadVerify(pkg.id);
  }
  reasons.push(...scorecardRepairs.blockedReasons);
  const baseUrl = input.baseUrl || process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_BASE_URL || 'https://www.yeosonam.com';
  const originalStatusBeforeProof = pkg.status;
  const originalAuditStatusBeforeProof = pkg.audit_status;
  let originalProductStatusBeforeProof: string | null | undefined;
  let temporarilyOpenedForProof = false;
  if (input.autoOpen && !isCustomerVisibleStatus(pkg.status)) {
    const proofPreviewAt = nowIso();
    if (pkg.internal_code) {
      const { data: productBeforeProof } = await input.supabase
        .from('products')
        .select('status')
        .eq('internal_code', pkg.internal_code)
        .limit(1)
        .maybeSingle();
      originalProductStatusBeforeProof = typeof (productBeforeProof as { status?: unknown } | null)?.status === 'string'
        ? (productBeforeProof as { status: string }).status
        : null;
      await input.supabase
        .from('products')
        .update({ status: 'ACTIVE', updated_at: proofPreviewAt })
        .eq('internal_code', pkg.internal_code);
    }
    const { error } = await input.supabase
      .from('travel_packages')
      .update({
        status: 'active',
        audit_status: 'clean',
        audit_checked_at: proofPreviewAt,
        updated_at: proofPreviewAt,
      })
      .eq('id', pkg.id);
    if (error) throw error;
    temporarilyOpenedForProof = true;
    pkg = await reloadPackage(input.supabase, pkg.id);
  }
  await runAutoMobileQA(pkg.id, baseUrl, { includeLpForProof: true });
  pkg = await reloadPackage(input.supabase, pkg.id);

  const sourceVerify = evaluateVerifyChecks({
    ...pkg,
    status: 'active',
    audit_status: 'clean',
  } as Parameters<typeof evaluateVerifyChecks>[0]);
  if (sourceVerify.status === 'blocked') {
    reasons.push(`source_verify:${sourceVerify.status}`);
  }

  const latestV3Draft = await loadLatestV3DraftForPackage(input.supabase, pkg.id);
  const v3Gate = evaluateV3CustomerNoticeGate(pkg.id, latestV3Draft);
  if (v3Gate.blocksApproval) {
    const blockingV3Reasons = v3Gate.blockReasons.filter(reason =>
      !/variant has price evidence|option events require review/.test(reason)
    );
    reasons.push(...blockingV3Reasons.map(reason => `v3:${reason}`));
  }
  if (v3Gate.payloadError) reasons.push(`v3_payload:${v3Gate.payloadError}`);
  if (!latestV3Draft && hasSupplierRemarkRawLeakRisk(pkg as Parameters<typeof hasSupplierRemarkRawLeakRisk>[0])) {
    reasons.push('v3:supplier_remark_raw_leak_risk');
  }

  const mobileProof = evaluateCustomerMobileProof({
    auditReport: pkg.audit_report,
    packageUpdatedAt: pkg.updated_at,
  });
  if (!mobileProof.ok) {
    reasons.push(`mobile_proof:${mobileProof.reason}`);
  }

  const finalProductPrices = await loadProductPriceRows(input.supabase, pkg.internal_code);
  const finalQualityScorecard = evaluateRegistrationQualityScorecard({
    pkg: {
      ...(pkg as unknown as Record<string, unknown>),
      audit_status: sourceVerify.status === 'clean' ? 'clean' : sourceVerify.status,
    },
    verifyChecks: sourceVerify.checks,
    productPrices: finalProductPrices,
    mobileProof,
  });
  const customerOpenContract = evaluateCustomerOpenContract({
    pkg: {
      ...(pkg as unknown as Record<string, unknown>),
      audit_status: sourceVerify.status === 'clean' ? 'clean' : sourceVerify.status,
    },
    verifyChecks: sourceVerify.checks,
    productPrices: finalProductPrices,
    mobileProof,
    v3Gate,
    sourceVerifyStatus: sourceVerify.status,
  });
  if (!customerOpenContract.ok) reasons.push(...customerOpenContract.blockers);

  const deliveryContext = await loadDeliveryContext(input.supabase, pkg.id);
  const deliveryFailedChecks = customerOpenContract.ok ? [] : deliveryContext.failedChecks;
  const delivery = evaluateCustomerDeliveryReadiness({
    pkg: {
      ...pkg,
      status: 'active',
      audit_status: sourceVerify.status === 'clean' ? 'clean' : sourceVerify.status,
    } as Parameters<typeof evaluateCustomerDeliveryReadiness>[0]['pkg'],
    failedChecks: deliveryFailedChecks,
    sourceEvidence: deliveryContext.sourceEvidence,
    requireCompletedAudit: true,
  });
  if (!customerOpenContract.ok && delivery.publishGate.decision === 'block') {
    const blockingPublishReasons = delivery.publishGate.reasons
      .filter(reason => !/(?:meta\.region|itinerary.*coverage \d+%)/i.test(reason));
    reasons.push(...blockingPublishReasons.map(reason => 'publish_gate:' + reason));
  } else if (!customerOpenContract.ok && delivery.publishGate.decision === 'force_required') {
    const blockingWarnings = delivery.publishGate.warnings
      .filter(reason => !/(?:audit_status=warnings|meta\.region|itinerary.*coverage \d+%)/i.test(reason));
    reasons.push(...blockingWarnings.map(reason => 'publish_warning:' + reason));
  }

  const uniqueReasons = [...new Set(filterResolvedUploadToOpenReasons({
    reasons,
    customerOpenContractOk: customerOpenContract.ok,
    mobileProofOk: mobileProof.ok,
    sourceVerifyStatus: sourceVerify.status,
    finalQualityScorecard,
  }))].filter(Boolean);
  if (uniqueReasons.length > 0) {
    if (temporarilyOpenedForProof) {
      const rollbackAt = nowIso();
      await input.supabase
        .from('travel_packages')
        .update({
          status: originalStatusBeforeProof ?? 'pending_review',
          audit_status: originalAuditStatusBeforeProof ?? 'blocked',
          audit_checked_at: rollbackAt,
          updated_at: rollbackAt,
        })
        .eq('id', pkg.id);
      if (pkg.internal_code && originalProductStatusBeforeProof !== undefined) {
        await input.supabase
          .from('products')
          .update({ status: originalProductStatusBeforeProof ?? 'PENDING', updated_at: rollbackAt })
          .eq('internal_code', pkg.internal_code);
      }
      pkg = await reloadPackage(input.supabase, pkg.id);
    }
    const reviewActions = classifyReviewReasons(uniqueReasons);
    const summary = repairFirstSummary({ reasons: uniqueReasons, repairs: allRepairs, reviewActions });
    await markAutopilotStage(input.supabase, pkg.id, 'blocked_after_mobile_proof', {
      reasons: uniqueReasons.slice(0, 20),
      review_actions: reviewActions.slice(0, 20),
      repairs: allRepairs,
      repair_first_summary: summary,
      source_verify: sourceVerify.status,
      publish_gate: delivery.publishGate.decision,
      mobile_proof: mobileProof,
      quality_scorecard: finalQualityScorecard,
      customer_open_contract: customerOpenContractAuditPayload(customerOpenContract),
    });
    return {
      id: pkg.id,
      title: pkg.title,
      code: pkg.internal_code,
      status: 'blocked',
      openabilityState: summary.state,
      stage: 'blocked_after_mobile_proof',
      reasons: uniqueReasons,
      repairs: allRepairs,
      repairFirstSummary: summary,
      reviewActions,
    };
  }

  if (!input.autoOpen) {
    const summary = repairFirstSummary({ reasons: [], repairs: allRepairs, reviewActions: [] });
    await markAutopilotStage(input.supabase, pkg.id, 'ready_not_opened', {
      repairs: allRepairs,
      repair_first_summary: summary,
      source_verify: sourceVerify.status,
      publish_gate: delivery.publishGate.decision,
      mobile_proof: mobileProof.proof,
      quality_scorecard: finalQualityScorecard,
      customer_open_contract: customerOpenContractAuditPayload(customerOpenContract),
    });
    return {
      id: pkg.id,
      title: pkg.title,
      code: pkg.internal_code,
      status: 'ready_not_opened',
      openabilityState: summary.state,
      stage: 'ready_not_opened',
      reasons: [],
      repairs: allRepairs,
      repairFirstSummary: summary,
      reviewActions: [],
    };
  }

  const openedAt = nowIso();
  const openedMobileProof = mobileProof.proof
    ? { ...mobileProof.proof, package_updated_at: openedAt }
    : null;
  const auditReport = {
    ...asRecord(pkg.audit_report),
    ...(openedMobileProof ? { mobile_browser_proof: openedMobileProof } : {}),
    upload_to_open_autopilot: {
      stage: 'opened',
      opened_at: openedAt,
      repairs: allRepairs,
      repair_first_summary: repairFirstSummary({ reasons: [], repairs: allRepairs, reviewActions: [] }),
      source_verify: sourceVerify.status,
      publish_gate: delivery.publishGate.decision,
      mobile_browser_proof: openedMobileProof,
      quality_scorecard: finalQualityScorecard,
      customer_open_contract: customerOpenContractAuditPayload(customerOpenContract),
    },
  };

  const { error } = await input.supabase
    .from('travel_packages')
    .update({
      status: 'active',
      ...(v3Gate.payload ? {
        notices_parsed: v3Gate.payload.notices_parsed,
        customer_notes: v3Gate.payload.customer_notes,
      } : {}),
      audit_status: 'clean',
      audit_report: auditReport,
      audit_checked_at: openedAt,
      updated_at: openedAt,
    })
    .eq('id', pkg.id);
  if (error) throw error;

  if (pkg.internal_code) {
    await input.supabase
      .from('products')
      .update({ status: 'ACTIVE', updated_at: openedAt })
      .eq('internal_code', pkg.internal_code);
  }

  const openedSummary = repairFirstSummary({ reasons: [], repairs: allRepairs, reviewActions: [] });
  return {
    id: pkg.id,
    title: pkg.title,
    code: pkg.internal_code,
    status: 'opened',
    openabilityState: openedSummary.state,
    stage: 'opened',
    reasons: [],
    repairs: allRepairs,
    repairFirstSummary: openedSummary,
    reviewActions: [],
  };
}

export async function runUploadToOpenAutopilot(input: {
  supabase: SupabaseClient;
  isSupabaseConfigured: boolean;
  options?: UploadToOpenAutopilotOptions;
}): Promise<{
  ok: boolean;
  scanned: number;
  opened: number;
  ready_not_opened: number;
  blocked: number;
  openable: number;
  auto_fixed_openable: number;
  needs_human_source_review: number;
  errors: string[];
  results: UploadToOpenPackageResult[];
}> {
  if (!input.isSupabaseConfigured) {
    return {
      ok: false,
      scanned: 0,
      opened: 0,
      ready_not_opened: 0,
      blocked: 0,
      openable: 0,
      auto_fixed_openable: 0,
      needs_human_source_review: 0,
      errors: ['Supabase is not configured'],
      results: [],
    };
  }

  const options = input.options ?? {};
  const packages = await loadPackages(input.supabase, options);
  const results: UploadToOpenPackageResult[] = [];
  const errors: string[] = [];

  for (const pkg of packages) {
    try {
      await markAutopilotStage(input.supabase, pkg.id, 'mobile_repair_started');
      results.push(await evaluateAndMaybeOpenPackage({
        supabase: input.supabase,
        pkg,
        autoOpen: options.autoOpen !== false,
        baseUrl: options.baseUrl,
      }));
    } catch (error) {
      const message = sanitizeDbError(error, `upload-to-open autopilot failed for ${pkg.id}`);
      const reviewActions = classifyReviewReasons([message]);
      const summary = repairFirstSummary({ reasons: [message], repairs: [], reviewActions });
      errors.push(message);
      results.push({
        id: pkg.id,
        title: pkg.title,
        code: pkg.internal_code,
        status: 'error',
        openabilityState: summary.state,
        stage: 'error',
        reasons: [message],
        repairs: [],
        repairFirstSummary: summary,
        reviewActions,
      });
      await markAutopilotStage(input.supabase, pkg.id, 'error', {
        reasons: [message],
        review_actions: reviewActions,
        repair_first_summary: summary,
      }).catch(() => undefined);
    }
  }

  return {
    ok: errors.length === 0 && results.every(result => result.status === 'opened' || result.status === 'ready_not_opened'),
    scanned: packages.length,
    opened: results.filter(result => result.status === 'opened').length,
    ready_not_opened: results.filter(result => result.status === 'ready_not_opened').length,
    blocked: results.filter(result => result.status === 'blocked').length,
    openable: results.filter(result => result.openabilityState === 'openable').length,
    auto_fixed_openable: results.filter(result => result.openabilityState === 'auto_fixed_openable').length,
    needs_human_source_review: results.filter(result => result.openabilityState === 'needs_human_source_review').length,
    errors,
    results,
  };
}

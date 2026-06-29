import type { SupabaseClient } from '@supabase/supabase-js';

import type { AttractionData } from '@/lib/attraction-matcher';
import { runAutoMobileQA } from '@/lib/auto-mobile-qa';
import { evaluateCustomerDeliveryReadiness } from '@/lib/customer-delivery-check';
import { evaluateCustomerMobileProof } from '@/lib/customer-mobile-proof';
import { isCustomerOptionalTourCandidate } from '@/lib/customer-option-classifier';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { normalizeOptionalTours } from '@/lib/package-acl';
import type { PriceDate } from '@/lib/price-dates';
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
  persistProductRegistrationDraftV3,
  runProductRegistrationV3,
} from '@/lib/product-registration-v3';
import type { V3Evidence, V3PipelineResult } from '@/lib/product-registration-v3';
import type { V3LedgerVariant } from '@/lib/product-registration-v3/types';
import { buildSourceBackedFieldRepair } from '@/lib/source-package-field-repair';
import {
  buildSourceBackedPriceDateRepair,
  hasTransportPriceVariantCue,
  type SourceBackedPriceDateRepair,
} from '@/lib/source-price-date-repair';
import { buildSourceBackedTermsRepair } from '@/lib/source-terms-repair';
import { runUploadVerify, evaluateVerifyChecks } from '@/lib/upload-verify';
import type { ProductPriceRowInput } from '@/lib/upload-validator';
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
  min_participants?: number | null;
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

export function classifyUploadToOpenReviewReason(reason: string): UploadToOpenReviewAction {
  if (/raw_text_too_short|source deterministic price table not recognized|product_prices_not_safely_rebuildable/i.test(reason)) {
    return {
      reason,
      category: 'possibly_unusable_source',
      canBeMadeUsable: false,
      nextAction: '원문 텍스트 또는 가격표 근거가 부족합니다. 원문을 보강하거나 해당 상품은 세이브/보류로 정리합니다.',
    };
  }
  if (/mobile_proof|packages_mobile|lp_mobile|browser proof/i.test(reason)) {
    return {
      reason,
      category: 'proof_retry_required',
      canBeMadeUsable: true,
      nextAction: '비공개 proof 헤더로 /packages와 /lp를 다시 렌더링하고 깨진 화면/CTA를 자동 QA로 재검사합니다.',
    };
  }
  if (/price_dates|price storage|product_prices|C12|가격/i.test(reason)) {
    return {
      reason,
      category: 'auto_repair_exhausted',
      canBeMadeUsable: true,
      nextAction: '원문 가격표 또는 저장된 product_prices를 기준으로 가격 저장소를 재동기화하고 재점수화합니다.',
    };
  }
  if (/C18|customer_copy|customer visible|forbidden|supplier_remark|금지|문구/i.test(reason)) {
    return {
      reason,
      category: 'customer_copy_required',
      canBeMadeUsable: true,
      nextAction: '고객 금지문구와 내부 지시문만 제거하고 가격/일정/호텔 같은 핵심값은 보존한 뒤 재검증합니다.',
    };
  }
  if (/C15|entity|attraction|hotel|unmatched|관광지|호텔/i.test(reason)) {
    return {
      reason,
      category: 'entity_resolution_required',
      canBeMadeUsable: true,
      nextAction: '내부 alias, Naver, Wikidata, OSM 증거로 entity_master_candidates를 재분류하고 다시 상품에 연결합니다.',
    };
  }
  if (/^v3:|v3_payload/i.test(reason)) {
    return {
      reason,
      category: 'v3_notice_required',
      canBeMadeUsable: true,
      nextAction: 'V3 고객 고지/약관 초안을 원문 근거 기준으로 재생성하고 ready_to_publish 초안으로 승격합니다.',
    };
  }
  if (/source_verify|publish_gate|publish_warning/i.test(reason)) {
    return {
      reason,
      category: 'publish_gate_required',
      canBeMadeUsable: true,
      nextAction: '공개 게이트의 남은 원문 대조 실패를 자동수정 가능한 필드별로 분해한 뒤 재검증합니다.',
    };
  }
  return {
    reason,
    category: 'source_evidence_required',
    canBeMadeUsable: true,
    nextAction: '원문 근거와 저장값 차이를 확인해 deterministic repair 후보로 승격합니다.',
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
      return '원문 텍스트 또는 가격표 근거가 부족합니다. 원문을 보강하거나 해당 상품은 세이브/보류로 정리합니다.';
    case 'proof_retry_required':
      return '비공개 proof 헤더로 /packages와 /lp를 다시 렌더링하고 깨진 화면/CTA를 자동 QA로 재검사합니다.';
    case 'auto_repair_exhausted':
      return '원문 가격표 또는 저장된 product_prices를 기준으로 가격 저장소를 재동기화하고 재점수화합니다.';
    case 'customer_copy_required':
      return '고객 금지문구와 내부 지시문만 제거하고 가격/일정/호텔 같은 핵심값은 보존한 뒤 재검증합니다.';
    case 'entity_resolution_required':
      return '내부 alias, Naver, Wikidata, OSM 증거로 entity_master_candidates를 재분류하고 다시 상품에 연결합니다.';
    case 'v3_notice_required':
      return 'V3 고객 고지/약관 초안을 원문 근거 기준으로 재생성하고 ready_to_publish 초안으로 승격합니다.';
    case 'publish_gate_required':
      return '공개 게이트의 남은 원문 대조 실패를 자동수정 가능한 필드별로 분해한 뒤 재검증합니다.';
    case 'source_evidence_required':
    default:
      return '원문 근거와 저장값 차이를 확인해 deterministic repair 후보로 승격합니다.';
  }
}

function repairFirstSummary(input: {
  reasons: string[];
  repairs: string[];
  reviewActions?: UploadToOpenReviewAction[];
}): RepairFirstOpenabilitySummary {
  return buildRepairFirstOpenabilitySummary(input);
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

function productPriceRowsFromPriceDates(priceDates: PriceDate[]): ProductPriceRowInput[] {
  return validPriceDates(priceDates).map(row => ({
    target_date: row.date,
    day_of_week: null,
    net_price: row.price,
    adult_selling_price: row.price,
    child_price: typeof row.child_price === 'number' && row.child_price > 0 ? row.child_price : null,
    note: 'source-backed autopilot price repair',
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

function hasFailingDeterministicPriceCheck(pkg: UploadToOpenAutopilotPackage): boolean {
  const result = evaluateVerifyChecks({
    ...pkg,
    status: 'active',
    audit_status: 'clean',
  } as Parameters<typeof evaluateVerifyChecks>[0]);
  return result.checks.some(check => check.id === 'C12' && check.status === 'fail');
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
  const minPrice = minimumPrice(input.priceDates);
  if (minPrice == null) return;

  input.updates.price_dates = validPriceDates(input.priceDates);
  input.updates.price_tiers = priceTiersFromPriceDates(input.priceDates);
  input.updates.price = minPrice;

  if (!input.pkg.internal_code) return;

  await replaceProductPricesForProduct({
    supabase: input.supabase,
    productId: input.pkg.internal_code,
    rows: productPriceRowsFromPriceDates(input.priceDates),
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

  const repairedPriceDates = priceDatesFromProductPrices(input.productPrices, coercePackagePriceDates(input.pkg));
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
  repairs.push('quality_scorecard:price_dates_rebuilt_from_product_prices');

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
    if ((hasTransportPriceVariantCue(workingPkg) || autoApplySourceBackedRepair) && !deterministicPriceCheckFailed) {
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

  const sanitizedOptionalTours = sanitizeCustomerOptionalTours(workingPkg.optional_tours);
  const currentOptionalTours = Array.isArray(workingPkg.optional_tours) ? workingPkg.optional_tours : [];
  if (JSON.stringify(sanitizedOptionalTours) !== JSON.stringify(normalizeOptionalTours(currentOptionalTours))) {
    updates.optional_tours = sanitizedOptionalTours;
    workingPkg = { ...workingPkg, optional_tours: sanitizedOptionalTours };
    repairs.push('optional_tours:non_customer_noise_removed');
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
  return [`v3_rebuilt:${v3.gate_result.status}:queued=${persisted.queuedUnmatched}${packageBackedPatched ? ':package_backed_evidence' : ''}`];
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

async function evaluateAndMaybeOpenPackage(input: {
  supabase: SupabaseClient;
  pkg: UploadToOpenAutopilotPackage;
  autoOpen: boolean;
}): Promise<UploadToOpenPackageResult> {
  let pkg = input.pkg;
  const reasons: string[] = [];
  const repairsResult = await applySourceBackedRepairs(input.supabase, pkg);
  pkg = repairsResult.pkg;
  reasons.push(...repairsResult.blockedReasons);
  const v3RebuildNotes = await rebuildV3DraftFromCurrentPackage({ supabase: input.supabase, pkg });
  const v3RebuildFailed = v3RebuildNotes.find(note => note.startsWith('v3_rebuild_failed:'));
  if (v3RebuildFailed) reasons.push(v3RebuildFailed);
  const allRepairs = [...repairsResult.repairs, ...v3RebuildNotes];

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
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_BASE_URL || 'https://www.yeosonam.com';
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
  const delivery = evaluateCustomerDeliveryReadiness({
    pkg: {
      ...pkg,
      status: 'active',
      audit_status: sourceVerify.status === 'clean' ? 'clean' : sourceVerify.status,
    } as Parameters<typeof evaluateCustomerDeliveryReadiness>[0]['pkg'],
    failedChecks: deliveryContext.failedChecks,
    sourceEvidence: deliveryContext.sourceEvidence,
    requireCompletedAudit: true,
  });
  if (delivery.publishGate.decision === 'block') {
    const blockingPublishReasons = delivery.publishGate.reasons
      .filter(reason => !/meta\.region|원문 근거 coverage \d+%/.test(reason));
    reasons.push(...blockingPublishReasons.map(reason => `publish_gate:${reason}`));
  } else if (delivery.publishGate.decision === 'force_required') {
    const blockingWarnings = delivery.publishGate.warnings
      .filter(reason => !/audit_status=warnings|meta\.region|원문 근거 coverage \d+%/.test(reason));
    reasons.push(...blockingWarnings.map(reason => `publish_warning:${reason}`));
  }

  const uniqueReasons = [...new Set(reasons)].filter(Boolean);
  if (uniqueReasons.length > 0) {
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

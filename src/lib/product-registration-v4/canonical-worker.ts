import type { SupabaseClient } from '@supabase/supabase-js';

import {
  buildProductRegistrationV3Ledger,
  createSourceLineIndex,
  evaluateProductRegistrationV3Gate,
  ledgerToRenderPackageInputs,
  planProductRegistrationV3,
  runProductRegistrationV3,
} from '@/lib/product-registration-v3';
import type { AttractionData } from '@/lib/attraction-matcher';
import {
  applyLLMSplit,
  detectEvidenceBoundCatalogBoundariesWithLLM,
  shouldTryEvidenceAiCatalogSplit,
  splitCatalogByItineraryHeaders,
  type CatalogSplitResult,
  type CatalogSegmentationProfileHints,
} from '@/lib/parser/catalog-pre-split';
import { buildSupplierRawDeterministicItinerary } from '@/lib/supplier-raw-deterministic-facts';
import { extractHeroContextL1 } from '@/lib/parser/llm/section-extractors';
import { commitCanonicalRevisionAtomic } from '@/lib/product-registration-authority/repository';
import { describeRegistrationError, registrationErrorCode } from '@/lib/product-registration-authority/errors';
import { buildProductRegistrationV6DomainProjection } from '@/lib/product-registration-v6/domain-projections';
import { getProductRegistrationV6RuntimeConfig } from '@/lib/product-registration-v6/runtime-config';
import { partitionProductSectionsBySalePrice } from '@/lib/product-registration-v6/source-sale-price-disposition';
import {
  buildCriticalFactEvidenceAnchors,
  normalizeCriticalFactProviderAnswer,
  verifyCriticalPriceCandidates,
  type CriticalPriceCandidate,
} from '@/lib/product-registration-v6/critical-fact-consensus';
import {
  parseProductSourceDepartureYearContext,
  resolveProductSourceDepartureYearEvidence,
  resolveProductSourceDepartureYearEvidenceAtReference,
  type ProductSourceDepartureYearContext,
} from '@/lib/product-registration/source-departure-year-context';
import { extractSourceTicketingCondition } from '@/lib/product-registration/ticketing-deadline';
import {
  parseTrustedDepartureDatesFromFilename,
  parseTrustedDepartureMonthWindowFromFilename,
  parseTrustedSingleProductTravelPeriodStart,
} from '@/lib/product-registration/source-departure-date-context';
import { extractSourceWonAmounts, sourceWonEvidenceContainsAmount } from '@/lib/parser/deterministic/price-ir';
import {
  applyFutureDeparturePolicyToPriceCalendar,
  assertProductDepartureReferenceDate,
  resolveExplicitSourceDepartureWindow,
  PRODUCT_SOURCE_DEPARTURE_DATE_POLICY_VERSION,
  PRODUCT_SOURCE_DEPARTURE_TIMEZONE,
  type ProductDepartureCalendarPolicyResult,
  type ProductSourceDepartureDateAuthority,
} from '@/lib/product-registration/future-departure-date-policy';

import { flattenTableText, getDocumentIRValidationErrors, sha256Hex } from './document-ir';
import { evaluateCanonicalCompleteness, type CanonicalCompleteness } from './completeness';
import { getProductRegistrationV4Job, transitionProductRegistrationV4Job } from './jobs';
import {
  buildProductRegistrationV5Revision,
  stableJson,
} from './revision';
import { buildV3V5CriticalDiff } from './shadow-diff';
import type { DocumentIR, DocumentIrTable, ProductRegistrationV4JobRecord } from './types';
import { buildDocumentIrTableItineraries } from './table-grid-itinerary';
import {
  buildDocumentIrTableCommercialTermCandidates,
  buildDocumentIrTableCommercialTerms,
  buildDocumentIrTableCommercialTermsByDuration,
  documentIrTableDurationDays,
  type DocumentIrTableCommercialTerms,
} from './table-grid-commercial-terms';
import {
  buildDocumentIrTablePriceCalendars,
  type DocumentIrTablePriceCalendar,
} from './table-grid-price-calendar';
import { attachSharedDocumentContext, inferSharedDocumentContext } from './document-context';

export const PRODUCT_REGISTRATION_V4_NORMALIZATION_VERSION = 'v6-canonical-2026-08-17.57';

export type CanonicalSegmentationSource =
  | 'catalog-pre-split'
  | 'evidence-ai-pre-split'
  | 'document-ir-table-products'
  | 'single-document';

export type CriticalPriceFactOverride = {
  sectionIndex: number;
  decisionId: string;
  candidateHash: string;
  policyVersion: string;
  candidates: CriticalPriceCandidate[];
};

export function parseCriticalPriceFactOverrides(value: unknown): CriticalPriceFactOverride[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    const sectionIndex = Number(row.sectionIndex);
    const decisionId = typeof row.decisionId === 'string' ? row.decisionId : '';
    const candidateHash = typeof row.candidateHash === 'string' ? row.candidateHash : '';
    const policyVersion = typeof row.policyVersion === 'string' ? row.policyVersion : '';
    const normalized = normalizeCriticalFactProviderAnswer({ status: 'resolved', candidates: row.candidates });
    if (!Number.isInteger(sectionIndex) || sectionIndex < 0 || !decisionId
      || !/^[0-9a-f]{64}$/u.test(candidateHash) || !policyVersion || !normalized) return [];
    return [{ sectionIndex, decisionId, candidateHash, policyVersion, candidates: normalized.candidates }];
  });
}

function isoDateWeekday(value: string | null): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month! - 1
    || date.getUTCDate() !== day
  ) return null;
  return date.getUTCDay();
}

type V3Variant = Awaited<ReturnType<typeof runProductRegistrationV3>>['ledger']['variants'][number];

type SourceLodgingAlternative = {
  customerText: string;
  evidence: {
    line_start: number;
    line_end: number;
    char_start: number;
    char_end: number;
    quote: string;
    quote_hash: string;
    extraction_method: 'text_line';
  };
};

function sourceLinesWithOffsets(rawText: string): Array<{
  text: string;
  lineNumber: number;
  charStart: number;
  charEnd: number;
}> {
  let cursor = 0;
  return rawText.split(/\r?\n/u).map((rawLine, index) => {
    const text = rawLine.normalize('NFKC').replace(/\s+/g, ' ').trim();
    const charStart = cursor;
    const charEnd = cursor + rawLine.length;
    cursor = charEnd + 1;
    return { text, lineNumber: index + 1, charStart, charEnd };
  });
}

/**
 * Reads an explicit hotel pool from the commercial header.  A source such as
 * "A 리조트 또는 / B 리조트 또는 동급 기준" is one product with alternative
 * lodging, not two hotels invented by the renderer.  We intentionally require
 * an alternative/unconfirmed marker so unrelated itinerary hotel sentences do
 * not become a package-wide lodging promise.
 */
export function extractSourceLodgingAlternative(rawText: string): SourceLodgingAlternative | null {
  const lines = sourceLinesWithOffsets(rawText);
  const commercialEnd = lines.findIndex(line => /^(?:포\s*함|불\s*포\s*함|일\s*정\s*표|여행\s*일정)$/u.test(line.text));
  const headerLines = lines.slice(0, commercialEnd >= 0 ? commercialEnd : Math.min(lines.length, 45));
  const candidates = headerLines.filter(line => (
    /(?:호텔|리조트|풀\s*빌라|숙소|동급)/u.test(line.text)
    && !/^(?:호\s*텔|HOTEL)$/iu.test(line.text)
    && !/(?:체크\s*인|체크\s*아웃|CHECK[- ]?IN|CHECK[- ]?OUT|이동|투숙|휴식|조식|가이드\s*미팅)/iu.test(line.text)
    && !/(?:국제선\s*항공\s*요금|현지\s*행사비|여행자\s*보험|관광지\s*입장료|기사\s*\/\s*가이드)/u.test(line.text)
    && !/^▶/u.test(line.text)
    && !/^HOTEL\s*:/iu.test(line.text)
  )).slice(0, 4);
  if (candidates.length === 0) return null;
  const quote = candidates.map(line => line.text).join('\n');
  const joined = candidates.map(line => line.text).join(' ').replace(/\s+/g, ' ').trim();
  if (!/(?:또는|동급|미정|예정)/u.test(joined)) return null;
  const customerText = joined
    .replace(/(?:또는\s*){2,}/gu, '또는 ')
    .replace(/동급\s*기준/gu, '동급 예정')
    .replace(/\s+/g, ' ')
    .trim();
  return {
    customerText,
    evidence: {
      line_start: candidates[0]!.lineNumber,
      line_end: candidates.at(-1)!.lineNumber,
      char_start: candidates[0]!.charStart,
      char_end: candidates.at(-1)!.charEnd,
      quote,
      quote_hash: sha256Hex(quote),
      extraction_method: 'text_line',
    },
  };
}

function isGenericLodgingValue(value: unknown): boolean {
  const text = typeof value === 'string' ? value.trim() : '';
  return /^(?:해당\s*(?:숙소|호텔)|숙소\s*미정|호텔\s*미정|미정|추후\s*확정)$/iu.test(text);
}

function applySourceLodgingAlternative(rawText: string, variants: V3Variant[]): void {
  const source = extractSourceLodgingAlternative(rawText);
  if (!source) return;
  for (const variant of variants) {
    for (const day of variant.days) {
      const raw = day.hotel?.raw_text ?? day.hotel?.name;
      if (!isGenericLodgingValue(raw)) continue;
      day.hotel = {
        ...day.hotel,
        raw_text: source.customerText,
        name: source.customerText,
        evidence: source.evidence,
      };
    }
    variant.evidence_coverage.hotel = variant.days.some(day => Boolean(day.hotel?.raw_text ?? day.hotel?.name));
  }
}

function sourceDateTokens(isoDate: string): RegExp[] {
  const match = isoDate.match(/^\d{4}-(\d{2})-(\d{2})$/u);
  if (!match) return [];
  const month = Number(match[1]);
  const day = Number(match[2]);
  return [
    new RegExp(`(?:^|[^0-9])0?${month}\\s*[./-]\\s*0?${day}(?:[^0-9]|$)`, 'u'),
    new RegExp(`0?${month}\\s*월\\s*0?${day}\\s*일?`, 'u'),
  ];
}

/** A price row is confirmed only when its own date is inside a source confirmation block. */
export function isSourceDepartureDateConfirmed(rawText: string, isoDate: string | null): boolean {
  if (!isoDate) return false;
  const tokens = sourceDateTokens(isoDate);
  if (tokens.length === 0) return false;
  const lines = rawText.split(/\r?\n/u).map(line => line.normalize('NFKC').replace(/\s+/g, ' ').trim());
  for (let index = 0; index < lines.length; index += 1) {
    if (!/(?:출발\s*확정|출확|확정\s*출발)/u.test(lines[index]!)) continue;
    const window = lines.slice(index, index + 4).join(' ');
    if (tokens.some(token => token.test(window))) return true;
  }
  return false;
}

function applyVerifiedCriticalPriceOverride(input: {
  section: CanonicalSection;
  variants: V3Variant[];
  override: CriticalPriceFactOverride | null;
}): { applied: boolean; decisionId: string | null; candidateHash: string | null; policyVersion: string | null } {
  if (!input.override || input.override.sectionIndex !== input.section.index || input.variants.length !== 1) {
    return { applied: false, decisionId: null, candidateHash: null, policyVersion: null };
  }
  const hasScopedPrice = input.variants.some(variant => variant.price_calendar.some(price => (
    Boolean(price.date)
    || Boolean(price.date_range?.start && price.date_range?.end)
    || price.weekday != null
  )));
  if (hasScopedPrice) return { applied: false, decisionId: null, candidateHash: null, policyVersion: null };

  const normalized = normalizeCriticalFactProviderAnswer({ status: 'resolved', candidates: input.override.candidates });
  if (!normalized) throw new Error('CRITICAL_FACT_OVERRIDE_SCHEMA_INVALID');
  const anchors = buildCriticalFactEvidenceAnchors(input.section.rawText, input.section.index);
  const verification = verifyCriticalPriceCandidates({
    candidates: normalized.candidates,
    anchors,
    sectionIndex: input.section.index,
  });
  if (!verification.valid) {
    throw new Error(`CRITICAL_FACT_OVERRIDE_REPLAY_FAILED:${verification.errors.join(',')}`);
  }
  const anchorById = new Map(anchors.map(anchor => [anchor.id, anchor]));
  input.variants[0]!.price_calendar = normalized.candidates.map(candidate => {
    const selected = candidate.evidenceAnchorIds
      .map(id => anchorById.get(id))
      .filter((anchor): anchor is NonNullable<typeof anchor> => Boolean(anchor));
    const quote = selected.map(anchor => anchor.quote).join('\n');
    return {
      date: candidate.date,
      date_range: candidate.dateRange,
      weekday: candidate.weekday,
      label: candidate.variantLabel ?? '독립 AI 합의 후 원문 재검증',
      amount: candidate.amount,
      currency: candidate.currency,
      list_price: null,
      min_travelers: candidate.minTravelers,
      max_travelers: candidate.maxTravelers,
      price_relation: 'standard_sale' as const,
      evidence: {
        line_start: Math.min(...selected.map(anchor => anchor.lineStart)),
        line_end: Math.max(...selected.map(anchor => anchor.lineEnd)),
        char_start: 0,
        char_end: quote.length,
        quote,
        quote_hash: sha256Hex(quote),
        extraction_method: 'text_line' as const,
      },
    };
  });
  input.variants[0]!.evidence_coverage.price = true;
  return {
    applied: true,
    decisionId: input.override.decisionId,
    candidateHash: input.override.candidateHash,
    policyVersion: input.override.policyVersion,
  };
}

function selectLocalVariantForTableFacts(input: {
  variants: V3Variant[];
  sectionRawText: string;
  durationDays: number;
}): V3Variant | null {
  if (input.variants.length === 1) return input.variants[0] ?? null;
  const local = (input.sectionRawText.split(/\n\s*---\s*\n/u).at(-1) ?? input.sectionRawText)
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
  const heading = local.slice(0, 1_000);
  const scored = input.variants.map((variant, index) => {
    const values = [variant.course, ...variant.title_parts]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map(value => value.normalize('NFKC').replace(/\s+/g, ' ').trim());
    let score = variant.duration_days === input.durationDays ? 80 : 0;
    if (variant.days.length === input.durationDays) score += 60;
    for (const value of values) {
      if (heading.includes(value)) score += Math.min(160, 40 + value.length);
      if (value.includes(`${input.durationDays}\uC77C`)) score += 20;
    }
    return { variant, index, score };
  }).sort((left, right) => right.score - left.score || left.index - right.index);
  const best = scored[0];
  if (!best || best.score <= 0) return null;
  if (best.score === scored[1]?.score) return null;
  return best.variant;
}

export function reconcileCatalogPreSplitLocalVariant(input: {
  variants: V3Variant[];
  sectionRawText: string;
  durationDays: number | null;
}): V3Variant[] {
  if (input.durationDays == null || input.variants.length <= 1) return input.variants;
  const selected = selectLocalVariantForTableFacts({
    variants: input.variants,
    sectionRawText: input.sectionRawText,
    durationDays: input.durationDays,
  });
  if (!selected) return input.variants;
  if (selected.price_calendar.length === 0) {
    const sourcePriceCandidates = input.variants.filter(variant => (
      variant !== selected
      && variant.duration_days === input.durationDays
      && variant.price_calendar.length > 0
      && variant.price_calendar.every(price => !/(?:예약금|계약금|deposit)/iu.test(price.evidence.quote))
    ));
    // A shared prefix may carry the one duration-specific price table while
    // the local itinerary heading carries the customer product identity. Only
    // replay that price when there is exactly one non-deposit candidate; a
    // grade/hotel ambiguity must remain blocked.
    if (sourcePriceCandidates.length === 1) {
      selected.price_calendar = sourcePriceCandidates[0]!.price_calendar;
      selected.evidence_coverage.price = true;
    }
  }
  return [selected];
}

function selectTablePriceCalendar(input: {
  calendars: DocumentIrTablePriceCalendar[];
  durationDays: number;
  sectionRawText: string;
}): DocumentIrTablePriceCalendar | null {
  const allDurationMatches = input.calendars.filter(candidate => candidate.durationDays === input.durationDays);
  const localText = localSectionText(input.sectionRawText).normalize('NFKC');
  const localTransportCodes = new Set([
    ...[...localText.toUpperCase().matchAll(/\[\s*([A-Z0-9]{2})\s*(?:[-\]])/gu)].map(match => match[1]!),
    ...[...localText.toUpperCase().matchAll(/(?:^|[^A-Z0-9])([A-Z0-9]{2})\s*[- ]?\s*\d{2,4}(?:[^0-9]|$)/gu)].map(match => match[1]!),
  ]);
  const sourcedTransportCodes = new Set(allDurationMatches
    .map(candidate => candidate.transportCode)
    .filter((value): value is string => Boolean(value)));
  const exactTransportMatches = localTransportCodes.size === 1
    ? allDurationMatches.filter(candidate => candidate.transportCode === [...localTransportCodes][0])
    : [];
  // A table with multiple airline axes is not a generic price pool. Select a
  // proven local carrier or keep the product blocked.
  if (sourcedTransportCodes.size > 1 && exactTransportMatches.length === 0) return null;
  const durationMatches = exactTransportMatches.length > 0 ? exactTransportMatches : allDurationMatches;
  if (durationMatches.length === 1) return durationMatches[0] ?? null;
  if (durationMatches.length === 0) return null;
  const title = normalizeProductAxisLabel((
    explicitLocalProductTitle(localText)
    ?? localText.split(/\r?\n/u)[0]
    ?? localText
  ))
    .replace(/\s+/gu, '')
    .replace(/\uD06C\uB8E8\uC988\uC219\uBC15/gu, '\uD06C\uB8E8\uC9881\uBC15');
  const localHeading = normalizeProductAxisLabel(localText).slice(0, 500);
  const labeled = durationMatches.flatMap(candidate => {
    const label = normalizeProductAxisLabel(candidate.gradeLabel);
    if (!label) return [];
    const specific = label
      .replace(/(?:노팁|노옵션|노쇼핑|노팁노옵션|노팁노쇼핑|노노)/gu, '')
      .replace(/[^0-9A-Za-z가-힣]/gu, '');
    const allTokens = label
      .split(/(?:노팁노옵션|노팁노쇼핑|노팁|노옵션|노쇼핑|노노)/gu)
      .map(value => value.replace(/[^0-9A-Za-z가-힣]/gu, ''))
      .filter(Boolean);
    const titleHasAllTokens = allTokens.length > 0 && allTokens.every(token => title.includes(token));
    const score = specific && title.includes(specific)
      ? 500 + specific.length
      : titleHasAllTokens
        ? 400 + allTokens.join('').length
        : title.includes(label)
          ? 100 + label.length
          : localHeading.includes(label)
            ? 10 + label.length
            : 0;
    return score > 0 ? [{ candidate, score }] : [];
  }).sort((left, right) => right.score - left.score || String(right.candidate.gradeLabel).length - String(left.candidate.gradeLabel).length);
  if (labeled.length === 0 || labeled[0]!.score === labeled[1]?.score) return null;
  return labeled[0]!.candidate;
}

function normalizeProductAxisLabel(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\s+/gu, '')
    .toLocaleLowerCase('ko-KR')
    .replace(/高품격/gu, '고품격')
    .replace(/luxury/gu, '럭셔리');
}

type ScopedCommercialCandidate = {
  terms: DocumentIrTableCommercialTerms;
  table: DocumentIrTable;
  durationDays: number | null;
  customerVariant: V3Variant | null;
};

function commercialTablePrimaryAxis(table: DocumentIrTable): string {
  const ordered = [...table.cells]
    .filter(cell => cell.text.trim().length > 0)
    .sort((left, right) => left.row - right.row || left.column - right.column);
  const firstRow = ordered[0]?.row;
  if (firstRow == null) return '';
  return normalizeProductAxisLabel(
    ordered.filter(cell => cell.row === firstRow).map(cell => cell.text).join(' '),
  );
}

export function selectScopedCommercialCandidate(
  variant: V3Variant,
  candidates: ScopedCommercialCandidate[],
): ScopedCommercialCandidate | null {
  if (candidates.length <= 1) return candidates[0] ?? null;
  const grade = normalizeProductAxisLabel(variant.grade);
  if (!grade) return null;
  const scored = candidates.map(candidate => {
    const primary = commercialTablePrimaryAxis(candidate.table);
    const gradeScore = primary === grade
      ? 1_000
      : primary.startsWith(grade) || grade.startsWith(primary)
        ? 800 + Math.min(primary.length, grade.length)
        : primary.includes(grade) || grade.includes(primary)
          ? 500 + Math.min(primary.length, grade.length)
          : 0;
    const durationScore = variant.duration_days != null && candidate.durationDays != null
      ? variant.duration_days === candidate.durationDays ? 200 : -200
      : 0;
    return { candidate, gradeScore, score: gradeScore + durationScore };
  }).sort((left, right) => right.score - left.score || left.candidate.terms.tableId.localeCompare(right.candidate.terms.tableId));
  if (scored[0]?.gradeScore == null || scored[0].gradeScore < 500 || scored[0].score === scored[1]?.score) return null;
  return scored[0].candidate;
}

function variantMatchesProductAxis(variant: V3Variant, calendar: DocumentIrTablePriceCalendar): boolean {
  if (!calendar.gradeLabel) return false;
  const label = normalizeProductAxisLabel(calendar.gradeLabel);
  const values = [variant.grade, variant.course, ...variant.title_parts]
    .map(normalizeProductAxisLabel)
    .filter(Boolean);
  const gradeMatches = values.some(value => value.includes(label) || label.includes(value));
  if (!calendar.transportCode) return gradeMatches;
  const transport = normalizeProductAxisLabel(calendar.transportCode);
  return gradeMatches && values.some(value => value.includes(transport));
}

function applyItineraryToVariant(variant: V3Variant, itinerary: ReturnType<typeof buildDocumentIrTableItineraries>[number]): V3Variant {
  return {
    ...variant,
    duration_days: itinerary.days.length,
    nights: itinerary.days.filter(day => (
      typeof day.hotel.raw_text === 'string' && day.hotel.raw_text.trim().length > 0
    )).length,
    days: itinerary.days,
    flight_segments: itinerary.flightSegments,
    evidence_coverage: {
      ...variant.evidence_coverage,
      itinerary: true,
      flight: itinerary.flightSegments.length > 0,
      hotel: itinerary.days.some(day => Boolean(day.hotel.raw_text)),
      meals: itinerary.days.some(day => (
        Boolean(day.meals.breakfast.raw_text || day.meals.lunch.raw_text || day.meals.dinner.raw_text)
      )),
    },
  };
}

function itineraryIdentity(itinerary: ReturnType<typeof buildDocumentIrTableItineraries>[number]): string {
  const flights = itinerary.flightSegments.map(segment => segment.code.replace(/\s+/gu, '').toUpperCase()).sort();
  const hotels = itinerary.days.flatMap(day => {
    const raw = typeof day.hotel.raw_text === 'string' ? day.hotel.raw_text : '';
    return raw ? [raw.normalize('NFKC').replace(/\s+/gu, '').toLocaleLowerCase('ko-KR')] : [];
  }).sort();
  return stableJson({ durationDays: itinerary.days.length, flights, hotels });
}

function applySameOfferItineraryChoices(input: {
  variants: V3Variant[];
  itineraries: ReturnType<typeof buildDocumentIrTableItineraries>;
  sectionRawText: string;
}): { applied: boolean; variants: V3Variant[] } {
  if (input.variants.length !== 1 || input.itineraries.length < 2) {
    return { applied: false, variants: input.variants };
  }
  const choiceSignal = /(?:일정\s*[1-9]|코스\s*[1-9]|\bOR\b|또는|택\s*1)/iu.test(input.sectionRawText);
  const identities = new Set(input.itineraries.map(itineraryIdentity));
  if (!choiceSignal || identities.size !== 1) return { applied: false, variants: input.variants };
  const variant = applyItineraryToVariant(input.variants[0]!, input.itineraries[0]!);
  variant.itinerary_choices = input.itineraries.map((itinerary, index) => ({
    label: `일정 ${index + 1}`,
    table_id: itinerary.tableId,
    days: itinerary.days,
    flight_segments: itinerary.flightSegments,
  }));
  return { applied: true, variants: [variant] };
}

function expandExplicitTableProductAxes(input: {
  variants: V3Variant[];
  calendars: DocumentIrTablePriceCalendar[];
  itineraries: ReturnType<typeof buildDocumentIrTableItineraries>;
}): { applied: boolean; variants: V3Variant[] } {
  const axes = input.calendars.filter(calendar => calendar.prices.length > 0);
  if (axes.some(calendar => !calendar.productLabelKind)) {
    return { applied: false, variants: input.variants };
  }
  const distinctDurations = new Set(axes.map(calendar => calendar.durationDays));
  const labeledAxes = axes.filter(calendar => Boolean(calendar.gradeLabel));
  if (axes.length <= 1 || (distinctDurations.size <= 1 && labeledAxes.length <= 1)) {
    return { applied: false, variants: input.variants };
  }
  const expanded: V3Variant[] = [];
  for (const [axisIndex, calendar] of axes.entries()) {
    const labelMatches = input.variants.filter(variant => variantMatchesProductAxis(variant, calendar));
    const durationMatches = input.variants.filter(variant => variant.duration_days === calendar.durationDays);
    const exactAxisMatches = labelMatches.filter(variant => variant.duration_days === calendar.durationDays);
    const base = exactAxisMatches.length === 1
      ? exactAxisMatches[0]
      : durationMatches.length === 1
        ? durationMatches[0]
        : labelMatches.length === 1
          ? labelMatches[0]
        : input.variants.length === 1
          ? input.variants[0]
          : null;
    if (!base) return { applied: false, variants: input.variants };
    const itineraryMatches = input.itineraries.filter(itinerary => itinerary.days.length === calendar.durationDays);
    if (input.itineraries.length > 1 && itineraryMatches.length !== 1) {
      return { applied: false, variants: input.variants };
    }
    const axisLabel = [calendar.transportCode, calendar.gradeLabel?.trim()]
      .filter(Boolean)
      .join(' ') || `${calendar.durationDays}\uC77C`;
    const titleParts = [...new Set([
      ...base.title_parts,
      ...(calendar.transportCode ? [calendar.transportCode] : []),
      ...(calendar.gradeLabel ? [calendar.gradeLabel] : []),
      `${calendar.durationDays}\uC77C`,
    ])];
    let variant: V3Variant = {
      ...base,
      variant_key: `${base.variant_key}-table-axis-${axisIndex + 1}`,
      grade: calendar.gradeLabel ?? base.grade,
      course: base.course ? `${base.course} ${axisLabel}` : axisLabel,
      duration_days: calendar.durationDays,
      title_parts: titleParts,
      price_calendar: calendar.prices,
      evidence_coverage: {
        ...base.evidence_coverage,
        price: true,
      },
    };
    const itinerary = itineraryMatches[0]
      ?? (input.itineraries.length === 1 && input.itineraries[0]!.days.length === calendar.durationDays
        ? input.itineraries[0]
        : null);
    if (itinerary) variant = applyItineraryToVariant(variant, itinerary);
    expanded.push(variant);
  }
  return { applied: expanded.length === axes.length, variants: expanded };
}

type PassengerPriceClassification = {
  passengerType: 'adult' | 'child' | 'infant';
  occupancyType: 'with_bed' | 'without_bed' | null;
};

function classifyPassengerPriceLabel(label: string): PassengerPriceClassification | null {
  const compact = label.normalize('NFKC').toLowerCase().replace(/\s+/gu, '');
  if (/(?:유아|영아|infant)/iu.test(compact)) {
    return { passengerType: 'infant', occupancyType: null };
  }
  if (/(?:아동|소아|child)/iu.test(compact)) {
    if (/(?:노베드|베드없|withoutbed)/iu.test(compact)) {
      return { passengerType: 'child', occupancyType: 'without_bed' };
    }
    if (/(?:엑베|엑스트라베드|베드적용|withbed|extrabed)/iu.test(compact)) {
      return { passengerType: 'child', occupancyType: 'with_bed' };
    }
    return { passengerType: 'child', occupancyType: null };
  }
  if (/(?:성인|adult)/iu.test(compact)) {
    return { passengerType: 'adult', occupancyType: null };
  }
  return null;
}

function passengerPriceScopeKey(price: V3Variant['price_calendar'][number]): string | null {
  const dateRange = price.date_range;
  const scope = price.date
    ? `date:${price.date}`
    : dateRange?.start && dateRange.end
      ? `range:${dateRange.start}:${dateRange.end}:weekday:${price.weekday ?? ''}`
      : Number.isInteger(price.weekday)
        ? `weekday:${price.weekday}`
        : null;
  if (!scope) return null;
  return [
    scope,
    price.currency,
    price.min_travelers ?? '',
    price.max_travelers ?? '',
    price.price_relation ?? '',
  ].join('|');
}

export function consolidatePassengerPriceRows(variants: V3Variant[]): void {
  for (const variant of variants) {
    const groups = new Map<string, Array<{ index: number; classification: PassengerPriceClassification }>>();
    variant.price_calendar.forEach((price, index) => {
      const scopeKey = passengerPriceScopeKey(price);
      const classification = classifyPassengerPriceLabel(price.label ?? '');
      if (!scopeKey || !classification) return;
      const rows = groups.get(scopeKey) ?? [];
      rows.push({ index, classification });
      groups.set(scopeKey, rows);
    });

    const removeIndexes = new Set<number>();
    for (const rows of groups.values()) {
      if (rows.length < 2) continue;
      const adults = rows.filter(row => row.classification.passengerType === 'adult');
      const dependents = rows.filter(row => row.classification.passengerType !== 'adult');
      if (adults.length !== 1 || dependents.length === 0 || adults.length + dependents.length !== rows.length) continue;

      const dependentTierAmounts = new Map<string, number>();
      let ambiguous = false;
      for (const row of dependents) {
        const price = variant.price_calendar[row.index]!;
        const tierKey = `${row.classification.passengerType}:${row.classification.occupancyType ?? 'unspecified'}`;
        const previous = dependentTierAmounts.get(tierKey);
        if (previous != null && previous !== price.amount) {
          ambiguous = true;
          break;
        }
        dependentTierAmounts.set(tierKey, price.amount);
      }
      if (ambiguous) continue;

      const adultPrice = variant.price_calendar[adults[0]!.index]!;
      const existing = adultPrice.passenger_prices ?? [];
      const additions = dependents.map(row => {
        const price = variant.price_calendar[row.index]!;
        return {
          passenger_type: row.classification.passengerType as 'child' | 'infant',
          occupancy_type: row.classification.occupancyType,
          label: price.label,
          amount: price.amount,
          currency: price.currency,
          evidence: price.evidence,
        };
      });
      adultPrice.passenger_prices = [...existing, ...additions].filter((passengerPrice, index, all) => (
        all.findIndex(candidate => (
          candidate.passenger_type === passengerPrice.passenger_type
          && candidate.occupancy_type === passengerPrice.occupancy_type
          && candidate.amount === passengerPrice.amount
          && candidate.currency === passengerPrice.currency
        )) === index
      ));
      for (const row of dependents) removeIndexes.add(row.index);
    }

    if (removeIndexes.size > 0) {
      variant.price_calendar = variant.price_calendar.filter((_, index) => !removeIndexes.has(index));
    }
  }
}

function applyPassengerPriceDefaults(variants: V3Variant[]): void {
  for (const variant of variants) {
    for (const price of variant.price_calendar) {
      const explicitPassengerPrices = price.passenger_prices ?? [];
      const explicitChildPrices = explicitPassengerPrices.filter(candidate => candidate.passenger_type === 'child');
      const explicitInfantPrices = explicitPassengerPrices.filter(candidate => candidate.passenger_type === 'infant');
      if (explicitChildPrices.length === 1) {
        price.child_amount = explicitChildPrices[0]!.amount;
        price.child_price_basis = 'source';
      } else if (explicitChildPrices.length > 1) {
        price.child_amount = null;
        price.child_price_basis = undefined;
      } else if (!Number.isFinite(price.child_amount) || Number(price.child_amount) <= 0) {
        price.child_amount = price.amount;
        price.child_price_basis = 'same_as_adult_policy';
      } else {
        price.child_price_basis = 'source';
      }
      if (explicitInfantPrices.length === 1) {
        price.infant_amount = explicitInfantPrices[0]!.amount;
        price.infant_price_state = 'source';
      } else if (Number.isFinite(price.infant_amount) && Number(price.infant_amount) >= 0) {
        price.infant_price_state = 'source';
      } else {
        price.infant_amount = null;
        price.infant_price_state = 'consultation_required';
      }
    }
  }
}

function localDurationDays(rawText: string): number | null {
  const local = localSectionText(rawText).normalize('NFKC').slice(0, 1_000);
  const full = local.match(/\d{1,2}\s*\uBC15\s*(\d{1,2})\s*\uC77C/u);
  const direct = local.match(/(?:^|\D)(\d{1,2})\s*\uC77C(?:\D|$)/u);
  const value = Number(full?.[1] ?? direct?.[1]);
  return Number.isInteger(value) && value >= 2 && value <= 31 ? value : null;
}

function bindSingleProductPricesToTrustedFilenameDates(input: {
  variants: V3Variant[];
  dates: string[];
  sourceLabel?: string;
}): { applied: boolean; dates: string[]; amount: number | null; amounts: number[] } {
  if (input.variants.length !== 1 || input.dates.length === 0) {
    return { applied: false, dates: [], amount: null, amounts: [] };
  }
  const variant = input.variants[0]!;
  if (variant.price_calendar.length === 0) return { applied: false, dates: [], amount: null, amounts: [] };
  const hasExistingScope = variant.price_calendar.some(price => (
    Boolean(price.date)
    || Boolean(price.date_range?.start && price.date_range?.end)
    || price.weekday != null
  ));
  if (hasExistingScope) return { applied: false, dates: [], amount: null, amounts: [] };
  const amounts = [...new Set(variant.price_calendar.map(price => price.amount).filter(amount => Number.isFinite(amount) && amount > 0))];
  const currencies = [...new Set(variant.price_calendar.map(price => price.currency).filter(Boolean))];
  const amountIsReplayedFromEvidence = variant.price_calendar.every(price => {
    return sourceWonEvidenceContainsAmount(price.evidence.quote, price.amount);
  });
  if (amounts.length === 0 || currencies.length !== 1 || !amountIsReplayedFromEvidence) {
    return { applied: false, dates: [], amount: null, amounts: [] };
  }
  const sources = [...variant.price_calendar];
  variant.price_calendar = input.dates.flatMap(date => sources.map(source => ({
      ...source,
      date,
      date_range: null,
      weekday: null,
      label: `${source.label} [${input.sourceLabel ?? '파일명 출발일'} ${date}]`,
    })))
    .sort((left, right) => (
      (left.date ?? '').localeCompare(right.date ?? '')
      || (left.min_travelers ?? 0) - (right.min_travelers ?? 0)
      || left.amount - right.amount
    ));
  variant.evidence_coverage.price = true;
  return {
    applied: true,
    dates: input.dates,
    amount: amounts.length === 1 ? amounts[0]! : null,
    amounts: [...amounts].sort((left, right) => left - right),
  };
}

function seedSingleProductTitleSalePrice(input: {
  variants: V3Variant[];
  titleHint: string | null;
  hasTrustedFilenameDates: boolean;
}): { applied: boolean; amount: number | null; sourceToken: string | null } {
  if (input.variants.length !== 1 || !input.hasTrustedFilenameDates || !input.titleHint) {
    return { applied: false, amount: null, sourceToken: null };
  }
  const variant = input.variants[0]!;
  if (variant.price_calendar.length > 0) return { applied: false, amount: null, sourceToken: null };
  const candidates = extractSourceWonAmounts(input.titleHint, {
    allowBareSaleShorthand: true,
    minAmount: 100_000,
    maxAmount: 50_000_000,
  }).filter(candidate => candidate.notation === 'bare_sale_shorthand');
  if (candidates.length !== 1 || !/(?:특가|판매\s*가|상품\s*가|할인\s*가)/u.test(input.titleHint)) {
    return { applied: false, amount: null, sourceToken: null };
  }
  const candidate = candidates[0]!;
  variant.price_calendar = [{
    date: null,
    date_range: null,
    weekday: null,
    label: `${input.titleHint} [원문 제목 판매가]`,
    amount: candidate.amount,
    currency: 'KRW',
    list_price: null,
    price_relation: 'standard_sale',
    evidence: {
      line_start: 1,
      line_end: 1,
      char_start: 0,
      char_end: input.titleHint.length,
      quote: input.titleHint,
      source_amount_scale: candidate.sourceAmountScale === 1000 ? 1000 : undefined,
    },
  }];
  variant.evidence_coverage.price = true;
  return { applied: true, amount: candidate.amount, sourceToken: candidate.raw };
}

function sourceYearEvidence(input: Pick<DocumentIR, 'text' | 'filename'> & {
  uploadEnvelope?: ProductSourceDepartureYearContext | null;
  referenceDate?: string | null;
  rollingInferenceEligible?: boolean;
}): {
  validated: boolean;
  year: number | null;
  source: ProductSourceDepartureDateAuthority;
  authority?: ProductSourceDepartureYearContext['authority'];
  contextVersion?: ProductSourceDepartureYearContext['version'];
  referenceDate?: string;
  timezone?: typeof PRODUCT_SOURCE_DEPARTURE_TIMEZONE;
  policyVersion?: typeof PRODUCT_SOURCE_DEPARTURE_DATE_POLICY_VERSION;
} {
  const sourceEvidence = input.referenceDate
    ? resolveProductSourceDepartureYearEvidenceAtReference({
        text: input.text,
        filename: input.filename,
        referenceDate: input.referenceDate,
      })
    : resolveProductSourceDepartureYearEvidence({
        text: input.text,
        filename: input.filename,
      });
  if (sourceEvidence.validated) return sourceEvidence;
  if (sourceEvidence.source === 'conflicting') return sourceEvidence;
  if (input.uploadEnvelope) {
    return {
      validated: true,
      year: input.uploadEnvelope.year,
      source: 'upload_envelope',
      authority: input.uploadEnvelope.authority,
      contextVersion: input.uploadEnvelope.version,
    };
  }
  if (input.rollingInferenceEligible && input.referenceDate) {
    return {
      validated: true,
      year: Number(input.referenceDate.slice(0, 4)),
      source: 'nearest_future_policy',
      referenceDate: input.referenceDate,
      timezone: PRODUCT_SOURCE_DEPARTURE_TIMEZONE,
      policyVersion: PRODUCT_SOURCE_DEPARTURE_DATE_POLICY_VERSION,
    };
  }
  return { validated: false, year: null, source: 'missing' };
}

function sourceFilenameEvidence(documentIr: DocumentIR): string {
  const memberFilenames = documentIr.assets.flatMap(asset => {
    const values = asset.kind === 'manifest' && Array.isArray(asset.metadata?.memberFilenames)
      ? asset.metadata.memberFilenames
      : [];
    return values.filter((value): value is string => typeof value === 'string');
  });
  return [documentIr.filename, ...memberFilenames].join('\n');
}

export function canonicalNormalizationJobStatus(input: {
  normalizationStatus: CanonicalNormalization['status'];
  workflowEnabled: boolean;
}): ProductRegistrationV4JobRecord['status'] {
  if (input.normalizationStatus === 'complete') return 'processing';
  return input.workflowEnabled ? 'processing' : 'failed';
}

export type CanonicalNormalizationExecutionMode = 'revision_commit' | 'analysis_only';

export type CanonicalNormalizationExecutionPolicy = {
  mode: CanonicalNormalizationExecutionMode;
  persistNormalization: true;
  commitRevisions: boolean;
  createSnapshots: false;
  changePublicationPointer: false;
  customerPublicationAuthority: false;
};

/**
 * One explicit policy controls every write beyond the normalization ledger.
 * The analysis pass can therefore be reused by recovery workers without
 * accidentally minting a product revision or customer publication state.
 */
export function canonicalNormalizationExecutionPolicy(
  mode: CanonicalNormalizationExecutionMode = 'revision_commit',
): CanonicalNormalizationExecutionPolicy {
  return {
    mode,
    persistNormalization: true,
    commitRevisions: mode === 'revision_commit',
    createSnapshots: false,
    changePublicationPointer: false,
    customerPublicationAuthority: false,
  };
}

export type CanonicalSection = {
  index: number;
  sectionKey: string;
  titleHint: string | null;
  rawText: string;
  rawTextHash: string;
  sourceNodeIds: string[];
  evidence: Array<{
    nodeId: string;
    quoteHash: string;
    quote: string;
    sourceDocumentId?: string;
    extractionId?: string;
    sourceHash?: string;
  }>;
};

export type CanonicalNormalization = {
  version: typeof PRODUCT_REGISTRATION_V4_NORMALIZATION_VERSION;
  sourceDocumentId: string;
  extractionId: string;
  rawTextHash: string;
  sections: CanonicalSection[];
  canonicalPayload: {
    sections: Array<Record<string, unknown>>;
    lineage?: {
      attractionMasterHash: string | null;
    };
  };
  lineage: {
    attractionMasterHash: string | null;
  };
  qualityDiagnostics: {
    sectionCount: number;
    normalizedSectionCount: number;
    blockedSectionCount: number;
    segmentationSource: CanonicalSegmentationSource;
    gateStatuses: string[];
    completeness: {
      confirmedCount: number;
      pendingSupplierCount: number;
      conflictingCount: number;
      unavailableCount: number;
      publicReadySectionCount: number;
      verifiedSectionCount: number;
      degradedSectionCount: number;
      blockedSectionCount: number;
      degradedReasons: string[];
      blockers: string[];
      fields: CanonicalCompleteness['fields'];
    };
    departureDatePolicy: {
      referenceDate: string | null;
      policyVersion: string | null;
      inferredDateCount: number;
      explicitDateCount: number;
      excludedPastDateCount: number;
      futureDepartureCount: number;
      pastOnlySectionIndexes: number[];
      blockers: string[];
    };
  };
  status: 'complete' | 'needs_review';
};

type BoundSectionIdentity = {
  title?: string | null;
  internalCode?: string | null;
};

const IDENTITY_STOP_WORDS = new Set([
  '상품', '여행', '패키지', '출발', '도착', '일정', '특가', '성인', '기준',
]);

function normalizeIdentityText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('ko-KR')
    .replace(/[^0-9a-z가-힣]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function localSectionText(rawText: string): string {
  const chunks = rawText.split(/\n\s*---\s*\n/g);
  return chunks[chunks.length - 1] ?? rawText;
}

function isolateCatalogCustomerFactsToLocalSection(variants: V3Variant[], sectionRawText: string): void {
  const local = localSectionText(sectionRawText).normalize('NFKC');
  const evidenceIsLocal = (evidence: Array<{ quote?: string }> | undefined): boolean => (
    Array.isArray(evidence)
    && evidence.some(item => {
      const quote = typeof item?.quote === 'string' ? item.quote.normalize('NFKC').trim() : '';
      return quote.length >= 2 && local.includes(quote);
    })
  );
  for (const variant of variants) {
    // Shared price cards are intentionally available to every local product,
    // but their grade-specific footers are not. Keep only customer-facing
    // notices/facts whose source quote is present in this product body (or in
    // an explicitly attached common-document block, which is part of local).
    variant.standard_notices = variant.standard_notices.filter(notice => evidenceIsLocal(notice.evidence));
    variant.structured_facts = variant.structured_facts.filter(fact => evidenceIsLocal(fact.evidence));
  }
}

function identityTokens(value: string): string[] {
  return [...new Set(normalizeIdentityText(value)
    .split(' ')
    .filter(token => token.length >= 2 && !IDENTITY_STOP_WORDS.has(token)))];
}

function durationToken(value: string): string | null {
  const match = value.match(/(\d+)\s*박\s*(\d+)\s*일/);
  return match ? `${match[1]}박${match[2]}일` : null;
}

function flightTokens(value: string): string[] {
  return [...new Set((value.toUpperCase().match(/\b[A-Z0-9]{2}\s*\d{3,4}\b/g) ?? [])
    .map(token => token.replace(/\s+/g, '')))];
}

export function selectCanonicalSectionForIdentity(
  sections: CanonicalSection[],
  identity: BoundSectionIdentity,
): CanonicalSection | null {
  if (sections.length === 1) return sections[0] ?? null;
  const targetTitle = identity.title?.trim() ?? '';
  const targetCode = identity.internalCode?.trim() ?? '';
  if (!targetTitle && !targetCode) return null;
  const normalizedTitle = normalizeIdentityText(targetTitle);
  const normalizedCode = normalizeIdentityText(targetCode);
  const tokens = identityTokens(targetTitle);
  const targetDuration = durationToken(targetTitle);
  const targetFlights = flightTokens(targetTitle);

  const scored = sections.map(section => {
    const localRaw = localSectionText(section.rawText);
    const local = normalizeIdentityText(localRaw);
    const whole = normalizeIdentityText(section.rawText);
    const hint = normalizeIdentityText(section.titleHint ?? '');
    const localDuration = durationToken(localRaw);
    const localFlights = flightTokens(localRaw);
    const localMatches = tokens.filter(token => local.includes(token));
    const wholeMatches = tokens.filter(token => whole.includes(token));
    const localCoverage = tokens.length > 0 ? localMatches.length / tokens.length : 0;
    let score = 0;
    let strong = false;

    if (normalizedCode && local.includes(normalizedCode)) {
      score += 1_200;
      strong = true;
    }
    if (normalizedTitle && local.includes(normalizedTitle)) {
      score += 1_000;
      strong = true;
    }
    if (normalizedTitle && hint.includes(normalizedTitle)) {
      score += 700;
      strong = true;
    }
    if (targetDuration && localDuration === targetDuration) score += 140;
    else if (targetDuration && localDuration && localDuration !== targetDuration) score -= 180;
    const matchedFlights = targetFlights.filter(token => localFlights.includes(token)).length;
    if (matchedFlights > 0) score += matchedFlights * 90;
    score += localMatches.reduce((sum, token) => sum + Math.min(24, token.length * 4), 0);
    score += Math.max(0, wholeMatches.length - localMatches.length) * 2;
    if (localCoverage >= 0.7) score += 100;

    return { section, score, strong, localCoverage };
  }).sort((left, right) => right.score - left.score || left.section.index - right.section.index);

  const best = scored[0];
  const runnerUp = scored[1];
  if (!best || best.score <= 0) return null;
  const margin = best.score - (runnerUp?.score ?? 0);
  if (best.strong && margin >= 1) return best.section;
  if (best.localCoverage >= 0.7 && margin >= 20) return best.section;
  if (targetDuration && best.localCoverage >= 0.4 && margin >= 40) return best.section;
  return null;
}

export function sliceCanonicalNormalizationForRevisionSections(
  normalization: CanonicalNormalization,
  sectionIndexes: number[],
): CanonicalNormalization {
  const uniqueIndexes = [...new Set(sectionIndexes)];
  const sections = uniqueIndexes.map(index => normalization.sections[index]).filter(Boolean) as CanonicalSection[];
  const payloadSections = uniqueIndexes
    .map(index => normalization.canonicalPayload.sections[index])
    .filter(Boolean) as Array<Record<string, unknown>>;
  if (sections.length !== uniqueIndexes.length || payloadSections.length !== uniqueIndexes.length) {
    throw new Error('REGISTRATION_REVISION_SECTION_INDEX_INVALID');
  }
  return {
    ...normalization,
    rawTextHash: sections.length === 1 ? sections[0]!.rawTextHash : normalization.rawTextHash,
    sections,
    canonicalPayload: {
      ...normalization.canonicalPayload,
      sections: payloadSections,
    },
    qualityDiagnostics: {
      ...normalization.qualityDiagnostics,
      sectionCount: sections.length,
      normalizedSectionCount: payloadSections.filter(section => !section.error).length,
      blockedSectionCount: payloadSections.filter(section => Boolean(section.error)).length,
      gateStatuses: uniqueIndexes.map(index => normalization.qualityDiagnostics.gateStatuses[index] ?? 'unknown'),
    },
  };
}

export type CanonicalRevisionSlice = {
  section: CanonicalSection;
  sectionIndex: number;
  variantKey: string | null;
  productKeySuffix: string;
  canonicalPayload: CanonicalNormalization['canonicalPayload'];
};

/**
 * A customer product is one canonical variant, not one source section.
 * Supplier tables commonly encode a cross product such as
 * `품격/고품격 × 3박5일/4박6일` inside a single physical section. Persisting
 * that section as one revision makes the public projection ambiguous and used
 * to fail later with REVISION_VARIANT_CARDINALITY_UNSUPPORTED.
 */
export function buildCanonicalRevisionSlices(
  normalization: CanonicalNormalization,
  sourceSections: CanonicalSection[],
): CanonicalRevisionSlice[] {
  return sourceSections.flatMap(section => {
    const payloadSection = normalization.canonicalPayload.sections[section.index];
    if (!payloadSection) throw new Error('REGISTRATION_REVISION_SECTION_INDEX_INVALID');
    const v3 = payloadSection.v3 && typeof payloadSection.v3 === 'object' && !Array.isArray(payloadSection.v3)
      ? payloadSection.v3 as Record<string, unknown>
      : null;
    const ledger = v3?.ledger && typeof v3.ledger === 'object' && !Array.isArray(v3.ledger)
      ? v3.ledger as Record<string, unknown>
      : null;
    const variants = Array.isArray(ledger?.variants) ? ledger.variants : [];
    if (variants.length <= 1) {
      return [{
        section,
        sectionIndex: section.index,
        variantKey: typeof (variants[0] as Record<string, unknown> | undefined)?.variant_key === 'string'
          ? String((variants[0] as Record<string, unknown>).variant_key)
          : null,
        productKeySuffix: '',
        canonicalPayload: {
          sections: [payloadSection],
          lineage: normalization.canonicalPayload.lineage,
        },
      }];
    }
    return variants.map((rawVariant, variantIndex) => {
      const variant = rawVariant && typeof rawVariant === 'object' && !Array.isArray(rawVariant)
        ? rawVariant as Record<string, unknown>
        : {};
      const variantKey = typeof variant.variant_key === 'string' && variant.variant_key.trim()
        ? variant.variant_key.trim()
        : `variant-${variantIndex + 1}`;
      const slicedSection = {
        ...payloadSection,
        revisionVariant: {
          sourceVariantCount: variants.length,
          sourceVariantIndex: variantIndex,
          variantKey,
        },
        v3: {
          ...v3,
          ledger: {
            ...ledger,
            document: {
              ...(ledger?.document && typeof ledger.document === 'object' && !Array.isArray(ledger.document)
                ? ledger.document as Record<string, unknown>
                : {}),
              expected_products: 1,
            },
            variants: [variant],
          },
        },
      };
      return {
        section,
        sectionIndex: section.index,
        variantKey,
        productKeySuffix: `:variant:${sha256Hex(variantKey).slice(0, 16)}`,
        canonicalPayload: {
          sections: [slicedSection],
          lineage: normalization.canonicalPayload.lineage,
        },
      };
    });
  });
}

async function loadActiveAttractions(supabase: SupabaseClient): Promise<AttractionData[]> {
  const rows: AttractionData[] = [];
  const pageSize = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('attractions')
      .select('id, name, country, region, aliases, mrt_gid, is_active, customer_publishable')
      .eq('is_active', true)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`ATTRACTION_MASTER_UNAVAILABLE:${error.message}`);
    const page = (data ?? []) as unknown as AttractionData[];
    rows.push(...page);
    if (page.length < pageSize) break;
    from += pageSize;
  }
  if (rows.length === 0) throw new Error('ATTRACTION_MASTER_EMPTY');
  return rows;
}

function normalizeRawText(value: string): string {
  return value.replace(/\r\n?/g, '\n').trim();
}

function attractionMasterSnapshotHash(attractions: AttractionData[] | undefined): string | null {
  if (!attractions) return null;
  const snapshot = attractions
    .map(attraction => ({
      id: attraction.id,
      name: attraction.name,
      country: attraction.country ?? null,
      region: attraction.region ?? null,
      aliases: [...(attraction.aliases ?? [])].sort(),
      mrt_gid: attraction.mrt_gid ?? null,
      is_active: attraction.is_active ?? null,
      customer_publishable: attraction.customer_publishable ?? null,
    }))
    .sort((left, right) => String(left.id ?? '').localeCompare(String(right.id ?? '')));
  return sha256Hex(stableJson(snapshot));
}

function firstTitleHint(rawText: string): string | null {
  const lines = rawText.split('\n').map(line => line.trim()).filter(Boolean);
  const candidate = lines.find(line => {
    if (line.length < 3 || line.length > 180) return false;
    if (/^(?:DAY|DAY\s*\d+|\d+\s*일자|제\s*\d+\s*일)$/i.test(line)) return false;
    if (/^(?:출발|판매가|요금|가격|포함|불포함|주의|공지)\s*[:：]?$/u.test(line)) return false;
    return /[\p{L}\p{N}]/u.test(line);
  });
  return candidate ? candidate.slice(0, 240) : null;
}

function firstTitleHintV2(rawText: string): string | null {
  const lines = rawText.split('\n').map(line => line.trim()).filter(Boolean);
  const candidates = lines.filter(line => {
    if (line.length < 3 || line.length > 180) return false;
    if (/^(?:DAY|DAY\s*\d+|제?\s*\d+\s*일차?|\d+\s*일차?)$/i.test(line)) return false;
    if (/^(?:출발일|상품가|요금|요금표|기간|제외일자|포함내역|불포함내역|안내사항|일정|일자|지역|교통편|시간|식사|최소출발인원|상품명)\s*[:：]?$/u.test(line)) return false;
    if (/^#\s*[^\s#]+(?:\s+#\s*[^\s#]+)*$/u.test(line)) return false;
    return /[\p{L}\p{N}]/u.test(line);
  });
  if (candidates.length === 0) return null;
  const titleKeywords = /(골프|패키지|특가|투어|여행|리조트|크루즈|자유일정|스팟|노팁|노옵션|다색|무제한|출발)/u;
  const scored = candidates.map((line, index) => {
    let score = 0;
    if (titleKeywords.test(line)) score += 10;
    if (/\d+\s*박\s*\d+\s*일|\d+\s*일/u.test(line)) score += 3;
    if (/[!！]/u.test(line)) score += 1;
    if (/^(?:PUS|ICN|BKK|NRT|KIX|BX\d+|LJ\d+|KE\d+|TW\d+|VN\d+|7C\d+)\b/u.test(line)) score -= 8;
    return { line, index, score };
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored[0]?.line.slice(0, 240) ?? null;
}

function explicitLocalProductTitle(rawText: string): string | null {
  const lines = rawText.split(/\r?\n/u).map(line => line.normalize('NFKC').replace(/\s+/g, ' ').trim());
  const primaryIndex = lines.findIndex((line, index) => (
    line.length >= 6
    && line.length <= 180
    && (
      /(?:\bPKG\b|PACKAGE|\uD328\uD0A4\uC9C0|\uACE8\uD504|\uC5D0\uC5B4\uD154|\uD22C\uC5B4|\uC0C1\uD488|\uD06C\uB8E8\uC988)/iu.test(line)
      || /^\s*[\[【(][A-Z0-9]{2,5}[\]】)]/u.test(line)
      || /^\s*[\[【(](?:\uC2E4\uC18D|\uD488\uACA9|\uACE0\uD488\uACA9|\uB77C\uC774\uD2B8|\uD504\uB9AC\uBBF8\uC5C4|\uB178\uC1FC\uD551|\uB178\uC635\uC158|\uB178\uD301)[\]】)]/u.test(line)
      || /^\s*[\[【(][★☆]?(?=[^\]】)]*(?:\uC2E4\uC18D|\uD488\uACA9|\uACE0\uD488\uACA9|\uD504\uB9AC\uBBF8\uC5C4|\uB178\uC1FC\uD551|\uB178\uC635\uC158|\uB178\uD301))[^\]】)]{0,60}[★☆]?[\]】)]/u.test(line)
      || /^(?:\uC2E4\uC18D|\uB178\uC635\uC158|\uD488\uACA9|\uACE0\uD488\uACA9|\uB77C\uC774\uD2B8|\uD504\uB9AC\uBBF8\uC5C4|\uB7ED\uC154\uB9AC)\s+[^\n]{2,140}\d{1,2}\s*\uC77C/iu.test(line)
      || /^(?:BX|LJ|KE|OZ|TW|RS|ZE|7C|VJ|VN|CA)\s+[\p{L}][^\n]{1,120}(?:\d{1,2}\s*\uBC15\s*)?\d{1,2}\s*\uC77C/iu.test(line)
      || (
        index <= 2
        && /[\p{L}]/u.test(line)
        && /\d{1,2}\s*\uBC15\s*\d{1,2}\s*\uC77C/u.test(line)
        && !/(?:\uD589\uC0AC\s*\uB0A0\uC9DC|\uCD9C\uBC1C\uC77C|\uC0C1\uD488\uAC00|\uD310\uB9E4\uAC00|\uD3EC\uD568|\uBD88\uD3EC\uD568)/u.test(line)
      )
    )
    && /(?:\d{1,2}\s*\uBC15\s*\d{1,2}\s*\uC77C|\d{1,2}\s*\uC77C|\uD2B9\uAC00|\uC2E4\uC18D|\uD488\uACA9|\uACE0\uD488\uACA9|\uB7ED\uC154\uB9AC)/u.test(line)
  ));
  if (primaryIndex < 0) return null;
  const primary = lines[primaryIndex]!;
  const nearbyGrade = lines
    .slice(Math.max(0, primaryIndex - 3), primaryIndex)
    .reverse()
    .find(line => /^(?:실속|품격|고품격|프리미엄|럭셔리)$/u.test(line));
  if (nearbyGrade && !primary.includes(nearbyGrade)) return `${nearbyGrade} ${primary}`.slice(0, 240);
  const previous = lines[primaryIndex - 1] ?? '';
  const canPrependPolicyBadge = previous.length >= 3
    && previous.length + primary.length + 1 <= 240
    && /^\s*[\[【(][^\]】)]*(?:\uC2E4\uC18D|\uD488\uACA9|\uACE0\uD488\uACA9|\uB178\uC1FC\uD551|\uB178\uC635\uC158|\uB178\uD301)[^\]】)]*[\]】)]\s*$/u.test(previous);
  if (canPrependPolicyBadge) return `${previous} ${primary}`.slice(0, 240);
  const canPrependDurationTitle = previous.length >= 6
    && previous.length + primary.length + 1 <= 240
    && /\d{1,2}\s*\uBC15\s*\d{1,2}\s*\uC77C/u.test(previous)
    && /(?:\uC2E4\uC18D|\uD488\uACA9|\uACE0\uD488\uACA9|\uD504\uB9AC\uBBF8\uC5C4|\uB7ED\uC154\uB9AC).*?(?:\bPKG\b|PACKAGE|\uD328\uD0A4\uC9C0)/iu.test(primary)
    && !/(?:\uCD9C\uBC1C\uB0A0\uC9DC|\uCD9C\uBC1C\uC77C|\uC0C1\uD488\uAC00|\uD310\uB9E4\uAC00|\uD3EC\uD568|\uBD88\uD3EC\uD568)/u.test(previous);
  if (canPrependDurationTitle) return `${previous} ${primary}`.slice(0, 240);
  const modifier = lines[primaryIndex + 1] ?? '';
  const canAppendModifier = modifier.length >= 3
    && primary.length + modifier.length + 1 <= 240
    && /(?:\uD06C\uB8E8\uC988\uC219\uBC15|\uB514\uB108\uD06C\uB8E8\uC988|\uB178\uD301|\uB178\uC635\uC158|\uB178\uC1FC\uD551|\uC2E4\uC18D|\uD488\uACA9|\uACE0\uD488\uACA9|\uD2B9\uAC00|\uB7ED\uC154\uB9AC|\uC138\uC774\uBE0C|\uC2A4\uD0E0\uB2E4\uB4DC|\uD504\uB9AC\uBBF8\uC5C4|\uD06C\uB77C\uC6B4)/u.test(modifier)
    && !/(?:\uCD9C\uD655|\uCD9C\uBC1C\uD655\uC815|\uCD5C\uC18C\s*\uC778\uC6D0|\uCD94\uAC00\uAE08\uC561)/u.test(modifier);
  return (canAppendModifier ? `${primary} ${modifier}` : primary).slice(0, 240);
}

function sourceEvidenceForSection(documentIr: DocumentIR, rawText: string): {
  sourceNodeIds: string[];
  evidence: CanonicalSection['evidence'];
} {
  const sourceNodeIds: string[] = [];
  const evidence: CanonicalSection['evidence'] = [];
  for (const node of documentIr.nodes) {
    const text = typeof node.text === 'string' ? normalizeRawText(node.text) : '';
    if (!text || text.length < 2 || !rawText.includes(text)) continue;
    sourceNodeIds.push(node.id);
    evidence.push({
      nodeId: node.id,
      quoteHash: sha256Hex(text),
      quote: text.slice(0, 240),
      sourceDocumentId: typeof node.attributes?.sourceDocumentId === 'string'
        ? node.attributes.sourceDocumentId
        : undefined,
      extractionId: typeof node.attributes?.extractionId === 'string'
        ? node.attributes.extractionId
        : undefined,
      sourceHash: typeof node.attributes?.sourceHash === 'string'
        ? node.attributes.sourceHash
        : undefined,
    });
  }
  return { sourceNodeIds: [...new Set(sourceNodeIds)], evidence };
}

function compactTableHeader(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, '').replace(/[:：]$/u, '');
}

function productTableItineraryHeaderRow(table: DocumentIrTable): number | null {
  for (let row = 0; row < table.rows; row += 1) {
    const values = table.cells
      .filter(cell => cell.row === row)
      .map(cell => compactTableHeader(cell.text));
    const has = (pattern: RegExp): boolean => values.some(value => pattern.test(value));
    if (
      has(/^(?:일자|날짜|일시|행사날짜)$/u)
      && has(/^(?:지역|도시명|행선지)$/u)
      && has(/^교통편?$/u)
      && has(/^시간$/u)
      && has(/^(?:일정|세부일정|상세일정|세부사항|주요행사일정|행사일정)$/u)
      && has(/^식사$/u)
    ) return row;
  }
  return null;
}

function tableHasCommercialHeader(table: DocumentIrTable, kind: 'inclusion' | 'exclusion'): boolean {
  const pattern = kind === 'inclusion'
    ? /^(?:포함|포함내역|포함사항|포함조건)$/u
    : /^(?:불포함|불포함내역|불포함사항|제외사항)$/u;
  return table.cells.some(cell => pattern.test(compactTableHeader(cell.text)));
}

function tableProductIdentity(table: DocumentIrTable, itineraryHeaderRow: number): string | null {
  const headingCells = table.cells
    .filter(cell => cell.row < Math.min(itineraryHeaderRow, 4))
    .sort((left, right) => left.row - right.row || left.column - right.column)
    .map(cell => cell.text.normalize('NFKC').replace(/\s+/gu, ' ').trim())
    .filter(Boolean)
    .filter(value => !/^(?:최소출발|객실종류|포함(?:내역|사항)?|불포함(?:내역|사항)?|선택관광|쇼핑센터|비고)$/u.test(value));
  const heading = headingCells.join(' ').trim();
  if (heading.length < 6 || heading.length > 720) return null;
  const tableText = flattenTableText(table).normalize('NFKC');
  const declaredDuration = /(?:\d{1,2}\s*박\s*)?\d{1,2}\s*일/u.test(heading)
    || /\b\d{1,2}\s*N\s*\d{1,2}\s*D\b/iu.test(heading);
  const itineraryDays = new Set([...tableText.matchAll(/(?:제\s*(\d{1,2})\s*일(?:차)?|DAY\s*(\d{1,2})|([1-9]\d?)\s*일차)/giu)]
    .map(match => Number(match[1] ?? match[2] ?? match[3]))
    .filter(value => Number.isInteger(value) && value >= 1 && value <= 31));
  if (!declaredDuration || itineraryDays.size < 2) return null;
  if (/(?:\bOR\b|또는\s*택\s*1|택\s*1|일정\s*[12]\s*(?:중|택))/iu.test(heading)) return null;

  const hotels = table.cells
    .filter(cell => cell.row > itineraryHeaderRow)
    .flatMap(cell => cell.text.split(/\r?\n/u))
    .map(line => line.normalize('NFKC').replace(/\s+/gu, '').trim())
    .filter(line => /(?:호텔|리조트|동급)/u.test(line))
    .slice(0, 4);
  const policies = [...heading.matchAll(/(?:노팁노옵션노쇼핑|노팁노옵션|노팁|노옵션|노쇼핑|실속|품격|고품격|프리미엄|럭셔리)/gu)]
    .map(match => match[0]);
  return normalizeIdentityText(JSON.stringify({ heading, hotels, policies }));
}

function documentIrProductTables(documentIr: DocumentIR): Array<{
  table: DocumentIrTable;
  identity: string;
}> {
  return documentIr.tables.flatMap(table => {
    const itineraryHeaderRow = productTableItineraryHeaderRow(table);
    if (itineraryHeaderRow == null) return [];
    if (!tableHasCommercialHeader(table, 'inclusion') || !tableHasCommercialHeader(table, 'exclusion')) return [];
    const identity = tableProductIdentity(table, itineraryHeaderRow);
    return identity ? [{ table, identity }] : [];
  });
}

function adjacentCommercialItineraryIdentity(
  commercialTable: DocumentIrTable,
  itineraryTable: DocumentIrTable,
  itineraryHeaderRow: number,
): string | null {
  const headingCells = commercialTable.cells
    .filter(cell => cell.row < Math.min(commercialTable.rows, 3))
    .sort((left, right) => left.row - right.row || left.column - right.column)
    .map(cell => cell.text.normalize('NFKC').replace(/\s+/gu, ' ').trim())
    .filter(Boolean)
    .filter(value => !/^(?:출발일자|출발일|인원|여행경비|포함(?:내역|사항)?|불포함(?:내역|사항)?|옵션|선택관광|쇼핑|비고|REMARK)$/iu.test(value));
  const heading = headingCells.join(' ').trim();
  if (heading.length < 6 || heading.length > 720) return null;
  if (!/(?:\d{1,2}\s*박\s*)?\d{1,2}\s*일/u.test(heading)) return null;
  if (/(?:\bOR\b|또는\s*택\s*1|택\s*1|일정\s*[12]\s*(?:중|택))/iu.test(heading)) return null;

  const itineraryText = flattenTableText(itineraryTable).normalize('NFKC');
  const itineraryDays = new Set([...itineraryText.matchAll(/(?:제\s*(\d{1,2})\s*일(?:차)?|DAY\s*(\d{1,2})|([1-9]\d?)\s*일차)/giu)]
    .map(match => Number(match[1] ?? match[2] ?? match[3]))
    .filter(value => Number.isInteger(value) && value >= 1 && value <= 31));
  if (itineraryDays.size < 2 || itineraryHeaderRow < 0) return null;

  const hotels = itineraryTable.cells
    .filter(cell => cell.row > itineraryHeaderRow)
    .flatMap(cell => cell.text.split(/\r?\n/u))
    .map(line => line.normalize('NFKC').replace(/\s+/gu, '').trim())
    .filter(line => /(?:호텔|리조트|동급)/u.test(line))
    .slice(0, 4);
  const policies = [...heading.matchAll(/(?:노팁노옵션노쇼핑|노팁노옵션|노팁|노옵션|노쇼핑|실속|품격|고품격|프리미엄|럭셔리)/gu)]
    .map(match => match[0]);
  return normalizeIdentityText(JSON.stringify({ heading, hotels, policies }));
}

function adjacentDocumentIrProductTableGroups(documentIr: DocumentIR): Array<{
  tables: DocumentIrTable[];
  identity: string;
}> {
  const groups: Array<{ tables: DocumentIrTable[]; identity: string }> = [];
  for (let index = 0; index < documentIr.tables.length - 1; index += 1) {
    const commercialTable = documentIr.tables[index]!;
    if (productTableItineraryHeaderRow(commercialTable) != null) continue;
    if (!tableHasCommercialHeader(commercialTable, 'inclusion')
      || !tableHasCommercialHeader(commercialTable, 'exclusion')) continue;
    const itineraryTable = documentIr.tables[index + 1]!;
    const itineraryHeaderRow = productTableItineraryHeaderRow(itineraryTable);
    if (itineraryHeaderRow == null) continue;
    const identity = adjacentCommercialItineraryIdentity(
      commercialTable,
      itineraryTable,
      itineraryHeaderRow,
    );
    if (!identity) continue;
    groups.push({ tables: [commercialTable, itineraryTable], identity });
    index += 1;
  }
  if (groups.length < 2) return [];
  return new Set(groups.map(group => group.identity)).size === groups.length ? groups : [];
}

function sharedPriceTables(documentIr: DocumentIR, productTableIds: Set<string>): DocumentIrTable[] {
  return documentIr.tables
    .filter(table => !productTableIds.has(table.id))
    .filter(table => {
      const text = flattenTableText(table).normalize('NFKC');
      const amountCount = table.cells.reduce((count, cell) => count + extractSourceWonAmounts(cell.text, {
        allowBareSaleShorthand: true,
        minAmount: 100_000,
        maxAmount: 50_000_000,
      }).length, 0);
      const hasDateScope = /(?:출\s*발\s*(?:일|날짜)|\d{1,2}\s*월|\d{1,2}\s*\/\s*\d{1,2}|[일월화수목금토](?:요일)?)/u.test(text);
      return amountCount >= 2 && hasDateScope;
    });
}

const PRICE_AXIS_SIGNAL_PATTERNS = [
  /노팁노옵션노쇼핑/gu,
  /노팁노옵션/gu,
  /노쇼핑/gu,
  /노옵션/gu,
  /노팁/gu,
  /고품격/gu,
  /프리미엄/gu,
  /럭셔리/gu,
  /실속/gu,
  /품격/gu,
  /특급/gu,
  /준특급/gu,
];

const NAMED_PRICE_GRADE_SIGNALS = ['세이브', '스탠다드', '프리미엄', '크라운'] as const;

function priceAxisSignals(value: string): Set<string> {
  const compact = value.normalize('NFKC').toLocaleLowerCase('ko-KR').replace(/\s+/gu, '');
  const signals = new Set<string>();
  for (const pattern of PRICE_AXIS_SIGNAL_PATTERNS) {
    for (const match of compact.matchAll(pattern)) signals.add(match[0]!);
  }
  for (const token of value.normalize('NFKC').toLocaleLowerCase('ko-KR').match(/[가-힣a-z]{2,}/gu) ?? []) {
    if (/^(?:출발|여행|경비|적용기간|요일|상품|패키지|일정표|포함|불포함|호텔|리조트|타워|거리|식사|관광)$/u.test(token)) continue;
    signals.add(token);
  }
  return signals;
}

function priceAxisMatchScore(candidateText: string, headerText: string): number {
  const candidateSignals = priceAxisSignals(candidateText);
  const headerSignals = priceAxisSignals(headerText);
  let score = 0;
  const normalizedCandidate = candidateText.normalize('NFKC').replace(/\s+/gu, '');
  const normalizedHeader = headerText.normalize('NFKC').replace(/\s+/gu, '');
  const candidateGrades = new Set(NAMED_PRICE_GRADE_SIGNALS.filter(signal => normalizedCandidate.includes(signal)));
  const headerGrades = new Set(NAMED_PRICE_GRADE_SIGNALS.filter(signal => normalizedHeader.includes(signal)));
  if (candidateGrades.size > 0 && headerGrades.size > 0) {
    const exactGradeMatch = [...candidateGrades].some(signal => headerGrades.has(signal));
    // Supplier price matrices commonly abbreviate a full commercial policy to
    // one stable grade label. That explicit label is stronger than policy tags
    // present only in the product body (for example 스탠다드 + 노팁/노옵션).
    score += exactGradeMatch ? 50 : -50;
  }
  const isPolicySignal = (signal: string): boolean => PRICE_AXIS_SIGNAL_PATTERNS
    .some(pattern => new RegExp(pattern.source, 'u').test(signal));
  for (const signal of new Set([...candidateSignals, ...headerSignals])) {
    const candidateHas = candidateSignals.has(signal);
    const headerHas = headerSignals.has(signal);
    if (candidateHas && headerHas) score += isPolicySignal(signal) ? 10 : 1;
    else if (isPolicySignal(signal)) score -= 6;
  }
  return score;
}

function priceColumns(table: DocumentIrTable): number[] {
  // A merged price cell is one commercial axis, even when it visually spans
  // two grid columns. Counting every covered grid column duplicates the axis
  // (for example a "세이브" column with colSpan=2) and makes an otherwise
  // deterministic grade-to-price assignment look ambiguous. Anchor a price
  // axis at the source cell's starting column instead.
  const amountCells = table.cells.filter(cell => extractSourceWonAmounts(cell.text, {
        allowBareSaleShorthand: true,
        minAmount: 100_000,
        maxAmount: 50_000_000,
      }).length > 0);
  const columns: number[] = [];
  for (const column of [...new Set(amountCells.map(cell => cell.column))].sort((left, right) => left - right)) {
    const amountCellCount = amountCells.filter(cell => cell.column === column).length;
    if (amountCellCount >= 2) columns.push(column);
  }
  return columns;
}

function priceColumnHeader(table: DocumentIrTable, column: number): string {
  const firstAmountRow = Math.min(...table.cells
    .filter(cell => cell.column <= column && column < cell.column + Math.max(1, cell.colSpan))
    .filter(cell => extractSourceWonAmounts(cell.text, {
      allowBareSaleShorthand: true,
      minAmount: 100_000,
      maxAmount: 50_000_000,
    }).length > 0)
    .map(cell => cell.row));
  if (!Number.isFinite(firstAmountRow)) return '';
  return table.cells
    .filter(cell => cell.row < firstAmountRow)
    .filter(cell => cell.column <= column && column < cell.column + Math.max(1, cell.colSpan))
    .sort((left, right) => left.row - right.row || left.column - right.column)
    .map(cell => cell.text)
    .join(' ');
}

function travelDurationDays(value: string): number | null {
  const compact = value.normalize('NFKC').replace(/\s+/gu, '').toUpperCase();
  const compactLatin = compact.match(/(?:^|[^A-Z\d])\d{1,2}N(\d{1,2})D(?:$|[^A-Z\d])/u);
  if (compactLatin?.[1]) return Number(compactLatin[1]);
  const nightsAndDays = compact.match(/(?:^|[^제\d])(\d{1,2})박(\d{1,2})일(?!차)/u);
  if (nightsAndDays?.[2]) return Number(nightsAndDays[2]);
  const daysOnly = compact.match(/(?:^|[^제\d])(\d{1,2})일(?!차)/u);
  return daysOnly?.[1] ? Number(daysOnly[1]) : null;
}

function explicitPriceRowTravelDurationDays(value: string): number | null {
  const compact = value.normalize('NFKC').replace(/\s+/gu, '').toUpperCase();
  if (/[\/.]|\d{1,2}월/u.test(compact)) return null;
  const compactLatin = compact.match(/^\d{1,2}N(\d{1,2})D$/u);
  if (compactLatin?.[1]) return Number(compactLatin[1]);
  const match = compact.match(/^(?:\d{1,2}박)?(\d{1,2})일(?:상품|일정)?$/u);
  return match?.[1] ? Number(match[1]) : null;
}

function candidateTravelDurationDays(tables: DocumentIrTable[]): number | null {
  const heading = tables
    .flatMap(table => table.cells.filter(cell => cell.row === 0))
    .sort((left, right) => left.column - right.column)
    .map(cell => cell.text)
    .join(' ');
  const headingDuration = travelDurationDays(heading);
  if (headingDuration != null) return headingDuration;

  const itineraryDays = tables
    .flatMap(table => table.cells)
    .flatMap(cell => [...cell.text.normalize('NFKC').matchAll(/(?:제\s*(\d{1,2})\s*일(?:차)?|DAY\s*(\d{1,2})|([1-9]\d?)\s*일차)/giu)])
    .map(match => Number(match[1] ?? match[2] ?? match[3]))
    .filter(value => Number.isInteger(value) && value >= 1 && value <= 31);
  return itineraryDays.length > 0 ? Math.max(...itineraryDays) : null;
}

function sharedPriceTableDurationByRow(table: DocumentIrTable): Map<number, number> {
  const allPriceColumns = priceColumns(table);
  const durationStarts = table.cells
    .filter(cell => cell.row > 0)
    .filter(cell => extractSourceWonAmounts(cell.text, {
      allowBareSaleShorthand: true,
      minAmount: 100_000,
      maxAmount: 50_000_000,
    }).length === 0)
    .map(cell => {
      const explicitDuration = explicitPriceRowTravelDurationDays(cell.text);
      // Some supplier matrices use a full-width banner such as
      // "9/29~10/21 매일 출발 3박4일". It overlaps every visual price
      // column but is still a duration scope marker, not a price axis.
      const bannerDuration = /\d{1,2}\s*박\s*\d{1,2}\s*일/u.test(cell.text)
        ? travelDurationDays(cell.text)
        : null;
      return { row: cell.row, durationDays: explicitDuration ?? bannerDuration };
    })
    .filter((value): value is { row: number; durationDays: number } => value.durationDays != null)
    .sort((left, right) => left.row - right.row);
  const durationByRow = new Map<number, number>();
  let currentDuration: number | null = null;
  let markerIndex = 0;
  for (let row = 1; row < table.rows; row += 1) {
    while (durationStarts[markerIndex]?.row === row) {
      currentDuration = durationStarts[markerIndex]!.durationDays;
      markerIndex += 1;
    }
    if (currentDuration != null) durationByRow.set(row, currentDuration);
  }
  return durationByRow;
}

function resolveSharedPriceColumnAssignments(
  table: DocumentIrTable,
  candidateTexts: string[],
  candidateDurations: Array<number | null>,
): Array<number | null> | null {
  const columns = priceColumns(table);
  if (columns.length === 0) return null;
  const durationByRow = sharedPriceTableDurationByRow(table);
  const tableDurations = new Set(durationByRow.values());
  // A shared visual table may have one amount column but independent row
  // blocks such as `3N5D` and `4N6D`. The duration-scoped rows are already a
  // complete product axis, so requiring two amount columns incorrectly keeps
  // the itineraries merged. Every candidate must prove a distinct duration
  // present in the shared table before the single column can be reused.
  if (columns.length === 1) {
    if (tableDurations.size < 2) return null;
    const header = priceColumnHeader(table, columns[0]!);
    const assignments = candidateTexts.map(() => null as number | null);
    for (const duration of tableDurations) {
      const members = candidateTexts.flatMap((candidate, index) => (
        candidateDurations[index] === duration
          ? [{ index, score: priceAxisMatchScore(candidate, header) }]
          : []
      ));
      if (members.length === 1) {
        assignments[members[0]!.index] = columns[0]!;
        continue;
      }
      const ranked = members.sort((left, right) => right.score - left.score || left.index - right.index);
      if (!ranked[0] || ranked[0].score <= 0 || ranked[0].score === ranked[1]?.score) continue;
      assignments[ranked[0].index] = columns[0]!;
    }
    return assignments.some(assignment => assignment != null) ? assignments : null;
  }
  const headers = columns.map(column => priceColumnHeader(table, column));
  const assignments = candidateTexts.map((candidate, candidateIndex) => {
    const duration = candidateDurations[candidateIndex] ?? null;
    if (tableDurations.size > 0) {
      if (duration == null) return undefined;
      if (!tableDurations.has(duration)) return null;
    }
    const scored = columns.map((column, index) => ({
      column,
      score: priceAxisMatchScore(candidate, headers[index] ?? ''),
    })).sort((left, right) => right.score - left.score || left.column - right.column);
    if (!scored[0] || scored[0].score <= 0 || scored[0].score === scored[1]?.score) return undefined;
    return scored[0].column;
  });
  if (assignments.some(assignment => assignment === undefined)) return null;

  const candidateGroups = new Map<string, number[]>();
  assignments.forEach((assignment, candidateIndex) => {
    if (assignment == null) return;
    const duration = candidateDurations[candidateIndex];
    const groupKey = tableDurations.size > 0 && duration != null ? `duration:${duration}` : 'all';
    candidateGroups.set(groupKey, [...(candidateGroups.get(groupKey) ?? []), assignment]);
  });
  if (candidateGroups.size === 0) return null;
  if ([...candidateGroups.values()].some(group => new Set(group).size !== group.length)) return null;
  return assignments as Array<number | null>;
}

function flattenSharedPriceTableColumn(
  table: DocumentIrTable,
  targetColumn: number,
  targetDuration: number | null,
): string {
  const allPriceColumns = priceColumns(table);
  const durationByRow = sharedPriceTableDurationByRow(table);
  const scopedRows = targetDuration == null || durationByRow.size === 0
    ? null
    : new Set([...durationByRow.entries()]
      .filter(([, duration]) => duration === targetDuration)
      .map(([row]) => row));
  const firstAmountRow = Math.min(...table.cells
    .filter(cell => extractSourceWonAmounts(cell.text, {
      allowBareSaleShorthand: true,
      minAmount: 100_000,
      maxAmount: 50_000_000,
    }).length > 0)
    .map(cell => cell.row));
  const gradeAxisPattern = /(?:실속|품격|고품격|프리미엄|럭셔리|노팁|노옵션|노쇼핑|호텔|리조트|게르)/u;
  const targetAxisHeader = table.cells
    .filter(cell => cell.row < firstAmountRow)
    .filter(cell => cell.column <= targetColumn && targetColumn < cell.column + Math.max(1, cell.colSpan))
    .filter(cell => gradeAxisPattern.test(cell.text))
    .sort((left, right) => right.row - left.row || left.colSpan - right.colSpan)[0] ?? null;
  const siblingAxisHeaders = targetAxisHeader == null ? [] : table.cells
    .filter(cell => cell.row === targetAxisHeader.row)
    .filter(cell => gradeAxisPattern.test(cell.text));
  const axisBand = siblingAxisHeaders.length < 2 ? null : {
    start: Math.min(...siblingAxisHeaders.map(cell => cell.column)),
    end: Math.max(...siblingAxisHeaders.map(cell => cell.column + Math.max(1, cell.colSpan) - 1)),
    targetStart: targetAxisHeader!.column,
    targetEnd: targetAxisHeader!.column + Math.max(1, targetAxisHeader!.colSpan) - 1,
    headerRow: targetAxisHeader!.row,
  };
  const selectedCells = table.cells
    .filter(cell => {
      if (scopedRows != null && cell.row > 0) {
        const cellRows = Array.from({ length: Math.max(1, cell.rowSpan) }, (_, index) => cell.row + index);
        if (!cellRows.some(row => scopedRows.has(row))) return false;
      }
      const start = cell.column;
      const end = cell.column + Math.max(1, cell.colSpan) - 1;
      if (axisBand && cell.row >= axisBand.headerRow && start <= axisBand.end && axisBand.start <= end) {
        if (start <= axisBand.start && end >= axisBand.end) return true;
        return start <= axisBand.targetEnd && axisBand.targetStart <= end;
      }
      const overlapsPrice = allPriceColumns.some(column => start <= column && column <= end);
      if (!overlapsPrice) return true;
      if (start <= Math.min(...allPriceColumns) && end >= Math.max(...allPriceColumns)) return true;
      return start <= targetColumn && targetColumn <= end;
    });
  const flattened: string[] = [];
  for (let row = 0; row < table.rows; row += 1) {
    const rowCells = selectedCells
      .filter(cell => cell.row === row || (
        cell.row < row
        && row < cell.row + Math.max(1, cell.rowSpan)
        && /(?:마감|대기|문의|판매\s*종료)/u.test(cell.text)
      ))
      .sort((left, right) => left.column - right.column);
    flattened.push(...rowCells.map(cell => cell.text.trim()).filter(Boolean));
  }
  return flattened
    .filter(Boolean)
    .join('\n');
}

export function diagnoseDocumentIrTableProductSplit(documentIr: DocumentIR): {
  completeCandidateCount: number;
  adjacentCandidateCount: number;
  selectedCandidateCount: number;
  identitiesUnique: boolean;
  sharedTables: Array<{
    id: string;
    priceColumns: number[];
    priceHeaders: string[];
    candidateScores: number[][];
    candidateDurations: Array<number | null>;
    assignments: Array<number | null> | null;
  }>;
} {
  const complete = documentIrProductTables(documentIr).map(candidate => ({
    tables: [candidate.table],
    identity: candidate.identity,
  }));
  const adjacent = adjacentDocumentIrProductTableGroups(documentIr);
  const candidates = adjacent.length > complete.length ? adjacent : complete;
  const candidateTexts = candidates.map(candidate => candidate.tables.map(flattenTableText).join('\n'));
  const candidateDurations = candidates.map(candidate => candidateTravelDurationDays(candidate.tables));
  const productTableIds = new Set(candidates.flatMap(candidate => candidate.tables.map(table => table.id)));
  return {
    completeCandidateCount: complete.length,
    adjacentCandidateCount: adjacent.length,
    selectedCandidateCount: candidates.length,
    identitiesUnique: new Set(candidates.map(candidate => candidate.identity)).size === candidates.length,
    sharedTables: sharedPriceTables(documentIr, productTableIds).map(table => {
      const columns = priceColumns(table);
      const headers = columns.map(column => priceColumnHeader(table, column));
      return {
        id: table.id,
        priceColumns: columns,
        priceHeaders: headers,
        candidateScores: candidateTexts.map(candidate => headers.map(header => priceAxisMatchScore(candidate, header))),
        candidateDurations,
        assignments: resolveSharedPriceColumnAssignments(table, candidateTexts, candidateDurations),
      };
    }),
  };
}

function splitDocumentIrTableProducts(documentIr: DocumentIR): string[] {
  const completeTableCandidates = documentIrProductTables(documentIr).map(candidate => ({
    tables: [candidate.table],
    identity: candidate.identity,
  }));
  const adjacentTableCandidates = adjacentDocumentIrProductTableGroups(documentIr);
  const candidates = adjacentTableCandidates.length > completeTableCandidates.length
    ? adjacentTableCandidates
    : completeTableCandidates;
  if (candidates.length < 2) return [];
  const identities = new Set(candidates.map(candidate => candidate.identity));
  if (identities.size !== candidates.length) return [];

  const productTableIds = new Set(candidates.flatMap(candidate => candidate.tables.map(table => table.id)));
  const sharedTables = sharedPriceTables(documentIr, productTableIds);
  const candidateTexts = candidates.map(candidate => candidate.tables.map(flattenTableText).join('\n'));
  const candidateDurations = candidates.map(candidate => candidateTravelDurationDays(candidate.tables));
  const sharedAssignments = sharedTables.map(table => resolveSharedPriceColumnAssignments(
    table,
    candidateTexts,
    candidateDurations,
  ));
  if (sharedAssignments.some(assignment => assignment == null)) return [];
  return candidates.map((candidate, candidateIndex) => {
    const local = candidate.tables.map(flattenTableText).join('\n\n');
    const sharedPrices = sharedTables.flatMap((table, tableIndex) => {
      const assignedColumn = sharedAssignments[tableIndex]?.[candidateIndex];
      if (assignedColumn == null) return [];
      return [flattenSharedPriceTableColumn(table, assignedColumn, candidateDurations[candidateIndex] ?? null)];
    }).join('\n\n');
    return sharedPrices ? `${sharedPrices}\n\n---\n\n${local}` : local;
  });
}

function hasLocalProductScope(source: CanonicalSegmentationSource): boolean {
  return source !== 'single-document';
}

export function reconcileTableCommercialGuideTip(
  variant: V3Variant,
  terms: DocumentIrTableCommercialTerms,
): boolean {
  const guideTipPattern = /(?:기사\s*(?:\/|&)?\s*가이드|가이드\s*(?:\/|&)?\s*기사|기사\s*가이드|가이드\s*기사)\s*(?:팁|경비)/u;
  const included = terms.inclusions.filter(item => guideTipPattern.test(item.value));
  const excluded = terms.exclusions.filter(item => guideTipPattern.test(item.value));
  if (included.length === 0 || excluded.length > 0) return false;

  const normalizeSource = (value: string): string => value.normalize('NFKC').replace(/\s+/gu, '');
  const inclusionSources = included.flatMap(item => [item.value, item.evidence.quote])
    .map(normalizeSource)
    .filter(value => value.length >= 4);
  const sourceIsIncluded = (value: string): boolean => {
    const normalized = normalizeSource(value);
    return normalized.length >= 4 && inclusionSources.some(source => (
      source.includes(normalized) || normalized.includes(source)
    ));
  };
  const wronglyLocalFacts = variant.structured_facts.filter(fact => (
    fact.category === 'guide_tip'
    && fact.values.included === false
    && fact.evidence.some(anchor => sourceIsIncluded(anchor.quote))
  ));
  const wronglyLocalNotices = variant.standard_notices.filter(notice => (
    notice.template_key === 'guide.tip_amount_local_payment'
    && sourceIsIncluded(notice.source_text)
  ));
  if (wronglyLocalFacts.length === 0 && wronglyLocalNotices.length === 0) return false;

  for (const fact of wronglyLocalFacts) {
    fact.values = { included: true, amount: null, currency: null, payment: null };
    fact.review_status = 'auto_clean';
    fact.standard_text = '가이드/기사 팁은 포함되어 있습니다.';
  }
  for (const notice of wronglyLocalNotices) {
    notice.category = 'tip_guideline';
    notice.template_key = 'guide.tip_included';
    notice.values = { included: true };
    notice.review_status = 'auto_clean';
    notice.standard_text = '가이드/기사 팁은 포함되어 있습니다.';
  }
  const includedNotices = variant.standard_notices.filter(notice => notice.template_key === 'guide.tip_included');
  if (includedNotices.length > 1) {
    const primary = includedNotices[0]!;
    const evidenceByQuote = new Map(primary.evidence.map(anchor => [anchor.quote, anchor]));
    for (const duplicate of includedNotices.slice(1)) {
      for (const anchor of duplicate.evidence) evidenceByQuote.set(anchor.quote, anchor);
    }
    primary.evidence = [...evidenceByQuote.values()];
    const duplicates = new Set(includedNotices.slice(1));
    variant.standard_notices = variant.standard_notices.filter(notice => !duplicates.has(notice));
  }
  return true;
}

export function reconcileTableCommercialIncludedBenefits(
  variant: V3Variant,
  terms: DocumentIrTableCommercialTerms,
): boolean {
  const normalizedInclusions = terms.inclusions.map(item => ({
    value: item.value.normalize('NFKC').replace(/\s+/gu, ''),
    quote: item.evidence.quote.normalize('NFKC').replace(/\s+/gu, ''),
  }));
  const isSourceIncludedBenefit = (option: V3Variant['options'][number]): boolean => {
    const raw = `${option.raw_name ?? ''} ${option.evidence?.quote ?? ''}`
      .normalize('NFKC')
      .replace(/\s+/gu, '');
    if (!/(?:포함|상당)/u.test(raw)) return false;
    return normalizedInclusions.some(inclusion => (
      (inclusion.value.length >= 4 && raw.includes(inclusion.value))
      || (inclusion.quote.length >= 4 && raw.includes(inclusion.quote))
      || (raw.length >= 4 && inclusion.quote.includes(raw))
    ));
  };
  const before = variant.options.length;
  // A priced benefit can still be included ("판랑 투어 포함, $30 상당").
  // Only discard it from optional items when the typed inclusion cell carries
  // the same source evidence; never infer this from the amount alone.
  variant.options = variant.options.filter(option => !isSourceIncludedBenefit(option));
  return variant.options.length !== before;
}

export function segmentDocumentIR(
  documentIr: DocumentIR,
  sourceDocumentId: string,
  supplierProfileHints?: CatalogSegmentationProfileHints,
  segmentationOverride?: { split: CatalogSplitResult; source: 'evidence-ai-pre-split' },
): {
  sections: CanonicalSection[];
  segmentationSource: CanonicalSegmentationSource;
} {
  const validationErrors = getDocumentIRValidationErrors(documentIr);
  if (validationErrors.length > 0) throw new Error(`DOCUMENT_IR_INVALID:${validationErrors.join(',')}`);
  const fullText = normalizeRawText(documentIr.text);
  if (fullText.length < 10) throw new Error('CANONICAL_SOURCE_TEXT_TOO_SHORT');

  const split = segmentationOverride?.split
    ?? splitCatalogByItineraryHeaders(fullText, { profileHints: supplierProfileHints });
  const sharedContext = split.sections.length >= 2 ? inferSharedDocumentContext(fullText) : [];
  const tableProductSections = splitDocumentIrTableProducts(documentIr);
  const tableSplitDiagnosis = tableProductSections.length >= 2
    ? diagnoseDocumentIrTableProductSplit(documentIr)
    : null;
  const hasResolvedSharedTableAssignments = Boolean(
    tableSplitDiagnosis
    && tableSplitDiagnosis.sharedTables.length > 0
    && tableSplitDiagnosis.sharedTables.every(table => table.assignments != null)
    && tableSplitDiagnosis.sharedTables.some(table => table.assignments?.some(assignment => assignment != null)),
  );
  const hasPartialSharedTableAssignments = Boolean(
    hasResolvedSharedTableAssignments
    && tableSplitDiagnosis?.sharedTables.some(table => {
      const assignments = table.assignments ?? [];
      return assignments.some(assignment => assignment != null)
        && assignments.some(assignment => assignment == null);
    }),
  );
  // A complete product table owns its own commercial terms and itinerary.
  // A complete table boundary only replaces the flattened splitter when it
  // proves strictly more independent products. With an equal count, shared
  // price tables can be replayed into every local table and mix hotel/grade
  // prices; keep the already-proven flat boundary in that case. The sole
  // equal-count exception is a partially assigned shared price table: it
  // proves that some sibling products intentionally have no sale price, so
  // preserving the local table products is required to keep those products
  // independently blocked instead of borrowing a neighbour's amount.
  const useTableProductSections = tableProductSections.length >= 2
    && (
      split.sections.length < 2
      || tableProductSections.length > split.sections.length
      || (tableProductSections.length === split.sections.length && hasPartialSharedTableAssignments)
    );
  const rawSections = useTableProductSections
    ? tableProductSections
    : split.sections.length >= 2
    ? split.sections.map(section => attachSharedDocumentContext(
      `${split.sharedPrefix ? `${split.sharedPrefix}\n\n---\n\n` : ''}${section}`.trim(),
      sharedContext,
    ))
    : [fullText];
  const segmentationSource: CanonicalSegmentationSource = useTableProductSections
    ? 'document-ir-table-products'
    : split.sections.length >= 2
      ? segmentationOverride?.source ?? 'catalog-pre-split'
      : 'single-document';

  return {
    segmentationSource,
    sections: rawSections.map((rawText, index) => {
      const normalized = normalizeRawText(rawText);
      const rawTextHash = sha256Hex(normalized);
      const sectionKey = `${sourceDocumentId}:${index}:${rawTextHash.slice(0, 16)}`;
      const evidence = sourceEvidenceForSection(documentIr, normalized);
      return {
        index,
        sectionKey,
        titleHint: explicitLocalProductTitle(localSectionText(normalized))
          ?? firstTitleHintV2(localSectionText(normalized))
          ?? firstTitleHintV2(normalized),
        rawText: normalized,
        rawTextHash,
        sourceNodeIds: evidence.sourceNodeIds,
        evidence: evidence.evidence,
      };
    }),
  };
}

export async function buildCanonicalNormalization(input: {
  documentIr: DocumentIR;
  sourceDocumentId: string;
  extractionId: string;
  attractions?: AttractionData[];
  criticalPriceOverrides?: CriticalPriceFactOverride[];
  sourceDepartureYearContext?: ProductSourceDepartureYearContext | null;
  departureDateReference?: {
    referenceDate: string;
    rollingInferenceEligible: boolean;
  } | null;
  supplierProfileHints?: CatalogSegmentationProfileHints;
  allowEvidenceAiSegmentation?: boolean;
}): Promise<CanonicalNormalization> {
  let segmented = segmentDocumentIR(input.documentIr, input.sourceDocumentId, input.supplierProfileHints);
  if (input.allowEvidenceAiSegmentation
    && segmented.sections.length === 1
    && shouldTryEvidenceAiCatalogSplit(input.documentIr.text)) {
    const aiBoundaries = await detectEvidenceBoundCatalogBoundariesWithLLM(input.documentIr.text);
    if (!aiBoundaries.skipped && aiBoundaries.products.length >= 2) {
      segmented = segmentDocumentIR(
        input.documentIr,
        input.sourceDocumentId,
        input.supplierProfileHints,
        { split: applyLLMSplit(input.documentIr.text, aiBoundaries), source: 'evidence-ai-pre-split' },
      );
    }
  }
  const attractionMasterHash = attractionMasterSnapshotHash(input.attractions);
  const payloadSections: Array<Record<string, unknown>> = [];
  const gateStatuses: string[] = [];
  const v6GateAccepted: boolean[] = [];
  const completenessResults: CanonicalCompleteness[] = [];
  const datePolicyResults: Array<ProductDepartureCalendarPolicyResult & { sectionIndex: number }> = [];
  let blockedSectionCount = 0;

  for (const section of segmented.sections) {
    try {
      const priceYearEvidence = sourceYearEvidence({
        // A single-product supplier document can keep its authoritative sale
        // period in a cover/header node that the segmenter intentionally
        // excludes from the product body. In that case the whole document is
        // still the same product's evidence. Multi-product catalogs continue
        // to resolve per section so one product's year cannot leak into
        // another product.
        text: segmented.sections.length === 1 ? input.documentIr.text : section.rawText,
        filename: sourceFilenameEvidence(input.documentIr),
        uploadEnvelope: input.sourceDepartureYearContext,
        referenceDate: input.departureDateReference?.referenceDate,
        rollingInferenceEligible: input.departureDateReference?.rollingInferenceEligible,
      });
      const v3Options = {
        sourceType: input.documentIr.sourceType,
        destination: section.titleHint ?? undefined,
        attractions: input.attractions ?? [],
        year: priceYearEvidence.validated ? priceYearEvidence.year ?? undefined : undefined,
        referenceDate: input.departureDateReference?.referenceDate,
      };
      const v3 = await runProductRegistrationV3(section.rawText, v3Options);
      // Keep the legacy parser's shared-prefix price extraction until every
      // supplier matrix has a typed reader, but compute customer-visible
      // notices/entities independently from the local product body. This is a
      // scoped compatibility projection, not a second publication authority.
      const localCustomerV3 = hasLocalProductScope(segmented.segmentationSource)
        ? await runProductRegistrationV3(localSectionText(section.rawText), v3Options)
        : null;
      const detectedTableItineraries = buildDocumentIrTableItineraries({
        documentIr: input.documentIr,
        sectionRawText: section.rawText,
      });
      const localSegmentDuration = hasLocalProductScope(segmented.segmentationSource)
        ? localDurationDays(section.rawText)
        : null;
      const locallyMatchingTableItineraries = localSegmentDuration == null
        ? []
        : detectedTableItineraries.filter(candidate => candidate.days.length === localSegmentDuration);
      const tableItineraries = locallyMatchingTableItineraries.length > 0
        ? locallyMatchingTableItineraries
        : detectedTableItineraries;
      const tableItinerary = tableItineraries.length === 1 ? tableItineraries[0]! : null;
      const v3DurationCandidates = [...new Set(v3.ledger.variants
        .map(variant => variant.duration_days)
        .filter((value): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 2 && value <= 31))];
      const sourceDurationFallback = localSegmentDuration
        ?? tableItinerary?.days.length
        ?? (v3DurationCandidates.length === 1 ? v3DurationCandidates[0]! : null);
      const tableCommercialTermCandidates = buildDocumentIrTableCommercialTermCandidates({
        documentIr: input.documentIr,
        sectionRawText: section.rawText,
      });
      const tableCommercialTerms = buildDocumentIrTableCommercialTerms({
        documentIr: input.documentIr,
        sectionRawText: section.rawText,
      });
      const scopedCommercialCandidates: ScopedCommercialCandidate[] = tableCommercialTermCandidates.length > 1
        ? tableCommercialTermCandidates.map(terms => {
            const table = input.documentIr.tables.find(candidate => candidate.id === terms.tableId)!;
            const scopedSourceIndex = createSourceLineIndex(flattenTableText(table));
            const scopedPlan = planProductRegistrationV3(scopedSourceIndex);
            const scopedLedger = buildProductRegistrationV3Ledger(scopedSourceIndex, scopedPlan, {
              year: v3Options.year,
              referenceDate: v3Options.referenceDate,
            });
            return {
              terms,
              table,
              durationDays: documentIrTableDurationDays(table)
                ?? detectedTableItineraries.find(candidate => candidate.tableId === terms.tableId)?.days.length
                ?? null,
              customerVariant: scopedLedger.variants.length === 1 ? scopedLedger.variants[0]! : null,
            };
          })
        : [];
      const tableCommercialTermsByDuration = tableItineraries.length <= 1 && tableCommercialTerms
        ? []
        : buildDocumentIrTableCommercialTermsByDuration({
            documentIr: input.documentIr,
            sectionRawText: section.rawText,
          });
      const detectedTablePriceCalendars = buildDocumentIrTablePriceCalendars({
        documentIr: input.documentIr,
        sectionRawText: section.rawText,
        fallbackYear: priceYearEvidence.validated ? priceYearEvidence.year : null,
        // A price-only monthly grid may omit the duration next to every price.
        // Reuse it only when the local product section or exactly one parsed
        // itinerary proves a single duration; never guess across variants.
        fallbackDurationDays: sourceDurationFallback,
      });
      const localDurationCalendars = localSegmentDuration == null
        ? []
        : detectedTablePriceCalendars.filter(calendar => calendar.durationDays === localSegmentDuration);
      // A catalog pre-split section already represents one explicit product.
      // If a shared price table contains several duration products, keep only
      // the duration named by this local section. A genuinely unsplit document
      // still receives every axis and expands into independent products below.
      const localCalendar = localSegmentDuration == null
        ? null
        : selectTablePriceCalendar({
            calendars: localDurationCalendars,
            durationDays: localSegmentDuration,
            sectionRawText: section.rawText,
          });
      const tablePriceCalendars = segmented.sections.length > 1
        ? localDurationCalendars.length === 1
          ? localDurationCalendars
          : localCalendar
            ? [localCalendar]
            : []
        : detectedTablePriceCalendars;
      const tableProductAxes = expandExplicitTableProductAxes({
        variants: v3.ledger.variants,
        calendars: tablePriceCalendars,
        itineraries: tableItineraries,
      });
      if (tableProductAxes.applied) {
        v3.ledger.variants = tableProductAxes.variants;
        // The typed table axis is a stronger product-count signal than the
        // initial flattened-text plan. Keep the final gate aligned with the
        // canonical products it actually validates.
        v3.structure_plan.expected_products = tableProductAxes.variants.length;
      }
      const itineraryChoices = !tableProductAxes.applied
        ? applySameOfferItineraryChoices({
            variants: v3.ledger.variants,
            itineraries: tableItineraries,
            sectionRawText: section.rawText,
          })
        : { applied: false, variants: v3.ledger.variants };
      if (itineraryChoices.applied) v3.ledger.variants = itineraryChoices.variants;
      let multiItineraryResolution: Record<string, unknown> = {
        state: itineraryChoices.applied
          ? 'resolved_choice_set'
          : tableItineraries.length > 1 ? 'ambiguous' : 'not_applicable',
        durations: tableItineraries.map(candidate => candidate.days.length),
        ...(itineraryChoices.applied ? { choiceCount: tableItineraries.length } : {}),
      };
      if (tableProductAxes.applied && tableItineraries.length > 1) {
        multiItineraryResolution = {
          state: 'resolved',
          durations: [...new Set(v3.ledger.variants.map(variant => variant.duration_days).filter(Boolean))],
          tableIds: tableItineraries.map(candidate => candidate.tableId),
          productAxes: tablePriceCalendars.map(calendar => ({
            durationDays: calendar.durationDays,
            label: calendar.gradeLabel,
            transportCode: calendar.transportCode ?? null,
            kind: calendar.productLabelKind ?? null,
          })),
        };
      } else if (tableItineraries.length > 1 && !itineraryChoices.applied) {
        const existingByDuration = new Map(v3.ledger.variants
          .filter(variant => typeof variant.duration_days === 'number')
          .map(variant => [variant.duration_days!, variant] as const));
        const baseVariant = v3.ledger.variants.length === 1 ? v3.ledger.variants[0]! : null;
        const resolvedVariants = tableItineraries.flatMap(itinerary => {
          const durationDays = itinerary.days.length;
          const terms = tableCommercialTermsByDuration.find(candidate => candidate.durationDays === durationDays);
          const existing = existingByDuration.get(durationDays) ?? baseVariant;
          if (!existing || !terms || terms.departureWeekdays.length === 0) return [];
          const tablePrices = selectTablePriceCalendar({
            calendars: tablePriceCalendars,
            durationDays,
            sectionRawText: section.rawText,
          })?.prices;
          const prices = tablePrices ?? existing.price_calendar.filter(price => {
            if (price.weekday != null) return terms.departureWeekdays.includes(price.weekday);
            const weekday = isoDateWeekday(price.date);
            return weekday != null && terms.departureWeekdays.includes(weekday);
          });
          if (prices.length === 0) return [];
          return [{
            ...existing,
            variant_key: `${existing.variant_key}-d${durationDays}`,
            course: existing.course ? `${existing.course} ${durationDays}\uC77C` : `${durationDays}\uC77C`,
            duration_days: durationDays,
            nights: itinerary.days.filter(day => (
              typeof day.hotel.raw_text === 'string' && day.hotel.raw_text.trim().length > 0
            )).length,
            title_parts: [...existing.title_parts, `${durationDays}\uC77C`],
            price_calendar: prices,
            days: itinerary.days,
            flight_segments: itinerary.flightSegments,
            inclusions: terms.inclusions,
            exclusions: terms.exclusions,
            evidence_coverage: {
              ...existing.evidence_coverage,
              price: true,
              itinerary: true,
              flight: itinerary.flightSegments.length > 0,
              hotel: itinerary.days.some(day => Boolean(day.hotel.raw_text)),
              meals: itinerary.days.some(day => (
                Boolean(day.meals.breakfast.raw_text || day.meals.lunch.raw_text || day.meals.dinner.raw_text)
              )),
              inclusions: true,
              exclusions: true,
            },
          }];
        });
        if (resolvedVariants.length === tableItineraries.length) {
          v3.ledger.variants = resolvedVariants;
          multiItineraryResolution = {
            state: 'resolved',
            durations: resolvedVariants.map(variant => variant.duration_days),
            tableIds: tableItineraries.map(candidate => candidate.tableId),
          };
        }
      }
      if (tableItinerary && !tableProductAxes.applied && !itineraryChoices.applied) {
        const tablePrices = selectTablePriceCalendar({
          calendars: tablePriceCalendars,
          durationDays: tableItinerary.days.length,
          sectionRawText: section.rawText,
        });
        if (tablePrices) {
          const selected = selectLocalVariantForTableFacts({
            variants: v3.ledger.variants,
            sectionRawText: section.rawText,
            durationDays: tableItinerary.days.length,
          });
          if (selected) {
            selected.price_calendar = tablePrices.prices;
            if (tablePrices.gradeLabel) selected.grade = tablePrices.gradeLabel;
            selected.evidence_coverage.price = true;
            v3.ledger.variants = [selected];
          }
        }
        for (const variant of v3.ledger.variants) {
          variant.days = tableItinerary.days;
          variant.flight_segments = tableItinerary.flightSegments;
          variant.duration_days = tableItinerary.days.length;
          variant.nights = tableItinerary.days.filter(day => (
            typeof day.hotel.raw_text === 'string' && day.hotel.raw_text.trim().length > 0
          )).length;
          variant.evidence_coverage.itinerary = true;
          variant.evidence_coverage.flight = tableItinerary.flightSegments.length > 0;
          variant.evidence_coverage.hotel = tableItinerary.days.some(day => Boolean(day.hotel.raw_text));
          variant.evidence_coverage.meals = tableItinerary.days.some(day => (
            Boolean(day.meals.breakfast.raw_text || day.meals.lunch.raw_text || day.meals.dinner.raw_text)
          ));
        }
      } else if (!tableProductAxes.applied && tablePriceCalendars.length > 0) {
        const durationDays = localDurationDays(section.rawText);
        const calendar = durationDays == null ? null : selectTablePriceCalendar({
          calendars: tablePriceCalendars,
          durationDays,
          sectionRawText: section.rawText,
        });
        const selected = durationDays == null ? null : selectLocalVariantForTableFacts({
          variants: v3.ledger.variants,
          sectionRawText: section.rawText,
          durationDays,
        });
        if (calendar && selected) {
          selected.price_calendar = calendar.prices;
          if (calendar.gradeLabel) selected.grade = calendar.gradeLabel;
          selected.evidence_coverage.price = true;
          v3.ledger.variants = [selected];
        } else {
          for (const variant of v3.ledger.variants) {
            const fallback = typeof variant.duration_days === 'number'
              ? selectTablePriceCalendar({
                  calendars: tablePriceCalendars,
                  durationDays: variant.duration_days,
                  sectionRawText: section.rawText,
                })
              : null;
            if (!fallback) continue;
            variant.price_calendar = fallback.prices;
            if (fallback.gradeLabel) variant.grade = fallback.gradeLabel;
            variant.evidence_coverage.price = true;
          }
        }
      }
      if (hasLocalProductScope(segmented.segmentationSource)) {
        v3.ledger.variants = reconcileCatalogPreSplitLocalVariant({
          variants: v3.ledger.variants,
          sectionRawText: section.rawText,
          durationDays: localSegmentDuration,
        });
      }
      const scopedCommercialByVariant = new Map<V3Variant, ScopedCommercialCandidate>();
      if (tableProductAxes.applied && scopedCommercialCandidates.length > 1) {
        for (const variant of v3.ledger.variants) {
          const scoped = selectScopedCommercialCandidate(variant, scopedCommercialCandidates);
          if (scoped) scopedCommercialByVariant.set(variant, scoped);
        }
      }
      if (scopedCommercialByVariant.size > 0) {
        for (const [variant, scoped] of scopedCommercialByVariant) {
          variant.inclusions = scoped.terms.inclusions;
          variant.exclusions = scoped.terms.exclusions;
          variant.evidence_coverage.inclusions = true;
          variant.evidence_coverage.exclusions = true;
        }
      } else if (tableCommercialTerms && (!tableProductAxes.applied || scopedCommercialCandidates.length <= 1)) {
        for (const variant of v3.ledger.variants) {
          variant.inclusions = tableCommercialTerms.inclusions;
          variant.exclusions = tableCommercialTerms.exclusions;
          variant.evidence_coverage.inclusions = true;
          variant.evidence_coverage.exclusions = true;
        }
      } else if (tableCommercialTermsByDuration.length > 0) {
        for (const variant of v3.ledger.variants) {
          const terms = tableCommercialTermsByDuration.find(candidate => candidate.durationDays === variant.duration_days);
          if (!terms) continue;
          variant.inclusions = terms.inclusions;
          variant.exclusions = terms.exclusions;
          variant.evidence_coverage.inclusions = true;
          variant.evidence_coverage.exclusions = true;
        }
      }
      if (hasLocalProductScope(segmented.segmentationSource)) {
        const localVariant = localCustomerV3?.ledger.variants.length === 1
          ? localCustomerV3.ledger.variants[0]!
          : null;
        if (localVariant) {
          for (const variant of v3.ledger.variants) {
            if (section.titleHint) {
              variant.course = section.titleHint;
              variant.title_parts = [section.titleHint, ...variant.title_parts]
                .filter((value, index, all) => all.indexOf(value) === index);
              const localGrade = section.titleHint.match(/(?:^|\s)(고품격|품격|실속|프리미엄|럭셔리)(?:\s|$)/u)?.[1] ?? null;
              if (localGrade) variant.grade = localGrade;
            }
            variant.standard_notices = localVariant.standard_notices;
            variant.structured_facts = localVariant.structured_facts;
            variant.options = localVariant.options;
            variant.shopping = localVariant.shopping;
          }
          v3.match_summary = localCustomerV3!.match_summary;
        } else {
          isolateCatalogCustomerFactsToLocalSection(v3.ledger.variants, section.rawText);
        }
      } else if (scopedCommercialByVariant.size > 0) {
        for (const [variant, scoped] of scopedCommercialByVariant) {
          if (!scoped.customerVariant) continue;
          variant.standard_notices = scoped.customerVariant.standard_notices;
          variant.structured_facts = scoped.customerVariant.structured_facts;
          variant.options = scoped.customerVariant.options;
          variant.shopping = scoped.customerVariant.shopping;
        }
      }
      for (const variant of v3.ledger.variants) {
        const terms = scopedCommercialByVariant.get(variant)?.terms
          ?? (!tableProductAxes.applied || scopedCommercialCandidates.length <= 1 ? tableCommercialTerms : null)
          ?? tableCommercialTermsByDuration.find(candidate => candidate.durationDays === variant.duration_days)
          ?? null;
        if (terms) {
          reconcileTableCommercialGuideTip(variant, terms);
          reconcileTableCommercialIncludedBenefits(variant, terms);
        }
      }
      if (
        hasLocalProductScope(segmented.segmentationSource)
        && v3.ledger.variants.length === 1
      ) {
        // Segmentation already proved that this section is one local product.
        // Shared matrices may mention several durations/grades, but they are
        // evidence inputs rather than another product boundary inside this
        // canonical section.
        v3.structure_plan.expected_products = 1;
        v3.structure_plan.document_type = 'single_package';
        v3.ledger.document.expected_products = 1;
        v3.ledger.document.type = 'single_package';
      }
      const filenameDepartureDates = priceYearEvidence.validated
        ? parseTrustedDepartureDatesFromFilename({
            filename: sourceFilenameEvidence(input.documentIr),
            validatedYear: priceYearEvidence.year!,
          })
        : null;
      const titleSalePriceSeed = seedSingleProductTitleSalePrice({
        variants: v3.ledger.variants,
        titleHint: section.titleHint,
        hasTrustedFilenameDates: Boolean(segmented.sections.length === 1 && filenameDepartureDates?.dates.length),
      });
      const filenamePriceBinding = segmented.sections.length === 1 && filenameDepartureDates
        ? bindSingleProductPricesToTrustedFilenameDates({
            variants: v3.ledger.variants,
            dates: filenameDepartureDates.dates,
          })
        : { applied: false, dates: [], amount: null, amounts: [] };
      const localTravelPeriod = priceYearEvidence.validated && v3.ledger.variants.length === 1
        ? parseTrustedSingleProductTravelPeriodStart({
            text: section.rawText,
            validatedYear: priceYearEvidence.year!,
            durationDays: v3.ledger.variants[0]!.duration_days ?? localDurationDays(section.rawText) ?? 0,
          })
        : null;
      const sourceTravelPeriodPriceBinding = !filenamePriceBinding.applied && localTravelPeriod
        ? bindSingleProductPricesToTrustedFilenameDates({
            variants: v3.ledger.variants,
            dates: [localTravelPeriod.date],
            sourceLabel: '원문 여행기간 출발일',
          })
        : { applied: false, dates: [], amount: null, amounts: [] };
      const criticalPriceOverride = applyVerifiedCriticalPriceOverride({
        section,
        variants: v3.ledger.variants,
        override: input.criticalPriceOverrides?.find(item => item.sectionIndex === section.index) ?? null,
      });
      consolidatePassengerPriceRows(v3.ledger.variants);
      applyPassengerPriceDefaults(v3.ledger.variants);
      applySourceLodgingAlternative(section.rawText, v3.ledger.variants);
      for (const variant of v3.ledger.variants) {
        if (variant.ticketing_condition) continue;
        variant.ticketing_condition = extractSourceTicketingCondition(section.rawText, {
          priceDates: variant.price_calendar,
          yearHint: priceYearEvidence.validated ? priceYearEvidence.year : null,
          today: input.departureDateReference?.referenceDate,
        });
        variant.evidence_coverage.ticketing_condition = Boolean(variant.ticketing_condition);
      }
      const explicitSectionWindow = input.departureDateReference
        ? resolveExplicitSourceDepartureWindow(section.rawText)
        : null;
      const explicitFilenameWindow = input.departureDateReference
        ? resolveExplicitSourceDepartureWindow(`\uCD9C\uBC1C\uC77C\n${sourceFilenameEvidence(input.documentIr)}`)
        : null;
      const trustedFilenameMonthWindow = parseTrustedDepartureMonthWindowFromFilename(
        sourceFilenameEvidence(input.documentIr),
      );
      const trustedFilenameDatesAreExpired = Boolean(
        input.departureDateReference
        && filenameDepartureDates?.dates.length
        && filenameDepartureDates.dates.every(date => date < input.departureDateReference!.referenceDate),
      );
      const sourceProvesSectionExpired = Boolean(
        trustedFilenameDatesAreExpired
        || Boolean(
          input.departureDateReference
          && trustedFilenameMonthWindow
          && trustedFilenameMonthWindow.end < input.departureDateReference.referenceDate,
        )
        || (
          input.departureDateReference
          && explicitSectionWindow
          && explicitSectionWindow.end < input.departureDateReference.referenceDate
        ),
      );
      const variantDatePolicyResults = v3.ledger.variants.map(variant => {
        if (sourceProvesSectionExpired) {
          const originalDatedEntryCount = variant.price_calendar.filter(entry => (
            Boolean(entry.date) || Boolean(entry.date_range)
          )).length;
          const undatedEntryCount = variant.price_calendar.length - originalDatedEntryCount;
          variant.price_calendar = [];
          return {
            entries: [],
            originalDatedEntryCount,
            futureDatedEntryCount: 0,
            inferredDateCount: 0,
            explicitDateCount: originalDatedEntryCount,
            excludedPastDateCount: originalDatedEntryCount,
            clippedRangeCount: 0,
            invalidDateCount: 0,
            undatedEntryCount,
            blockers: [],
            disposition: 'past_only_excluded' as const,
          };
        }
        const result = applyFutureDeparturePolicyToPriceCalendar({
          entries: variant.price_calendar,
          authority: priceYearEvidence.source,
          referenceDate: input.departureDateReference?.referenceDate
            ?? `${priceYearEvidence.year ?? 1970}-01-01`,
        });
        variant.price_calendar = result.entries;
        for (const entry of variant.price_calendar) {
          entry.departure_confirmed = isSourceDepartureDateConfirmed(section.rawText, entry.date);
        }
        return result;
      });
      const sectionDatePolicy: ProductDepartureCalendarPolicyResult & { sectionIndex: number } = {
        sectionIndex: section.index,
        entries: variantDatePolicyResults.flatMap(result => result.entries),
        originalDatedEntryCount: variantDatePolicyResults.reduce((sum, result) => sum + result.originalDatedEntryCount, 0),
        futureDatedEntryCount: variantDatePolicyResults.reduce((sum, result) => sum + result.futureDatedEntryCount, 0),
        inferredDateCount: variantDatePolicyResults.reduce((sum, result) => sum + result.inferredDateCount, 0),
        explicitDateCount: variantDatePolicyResults.reduce((sum, result) => sum + result.explicitDateCount, 0),
        excludedPastDateCount: variantDatePolicyResults.reduce((sum, result) => sum + result.excludedPastDateCount, 0),
        clippedRangeCount: variantDatePolicyResults.reduce((sum, result) => sum + result.clippedRangeCount, 0),
        invalidDateCount: variantDatePolicyResults.reduce((sum, result) => sum + result.invalidDateCount, 0),
        undatedEntryCount: variantDatePolicyResults.reduce((sum, result) => sum + result.undatedEntryCount, 0),
        blockers: variantDatePolicyResults.flatMap(result => result.blockers),
        disposition: 'undated_or_invalid',
      };
      sectionDatePolicy.disposition = sectionDatePolicy.originalDatedEntryCount > 0
        && sectionDatePolicy.futureDatedEntryCount === 0
        && sectionDatePolicy.excludedPastDateCount === sectionDatePolicy.originalDatedEntryCount
        && sectionDatePolicy.undatedEntryCount === 0
        && sectionDatePolicy.blockers.length === 0
        ? 'past_only_excluded'
        : sectionDatePolicy.futureDatedEntryCount > 0 && sectionDatePolicy.excludedPastDateCount > 0
          ? 'past_entries_removed'
          : sectionDatePolicy.futureDatedEntryCount > 0 && sectionDatePolicy.blockers.length === 0
          ? 'eligible_future'
          : 'undated_or_invalid';
      if (sourceProvesSectionExpired) sectionDatePolicy.disposition = 'past_only_excluded';
      datePolicyResults.push(sectionDatePolicy);
      v3.gate_result = evaluateProductRegistrationV3Gate(v3.structure_plan, v3.ledger, v3.match_summary);
      v3.render_contract_preview = ledgerToRenderPackageInputs(v3.ledger);
      const gateStatus = String(v3.gate_result.status ?? 'unknown');
      gateStatuses.push(gateStatus);
      if (gateStatus === 'blocked') blockedSectionCount += 1;
      const payloadSection: Record<string, unknown> = {
        index: section.index,
        sectionKey: section.sectionKey,
        titleHint: section.titleHint,
        destinationHint: extractHeroContextL1(section.rawText).destination ?? null,
        rawTextHash: section.rawTextHash,
        sourceNodeIds: section.sourceNodeIds,
        evidence: section.evidence,
        priceYearEvidence,
        filenamePriceBinding: {
          ...filenamePriceBinding,
          contextVersion: filenameDepartureDates?.version ?? null,
          sourceTokens: filenamePriceBinding.applied ? filenameDepartureDates?.sourceTokens ?? [] : [],
        },
        sourceTravelPeriodPriceBinding: {
          ...sourceTravelPeriodPriceBinding,
          sourceQuote: sourceTravelPeriodPriceBinding.applied ? localTravelPeriod?.quote ?? null : null,
          travelEnd: sourceTravelPeriodPriceBinding.applied ? localTravelPeriod?.end ?? null : null,
        },
        titleSalePriceSeed,
        criticalPriceOverride,
        departureDatePolicy: {
          ...sectionDatePolicy,
          explicitSourceWindow: explicitSectionWindow,
          trustedFilenameMonthWindow,
          trustedFilenameDatesAreExpired,
          sourceProvesSectionExpired,
          entries: undefined,
          referenceDate: input.departureDateReference?.referenceDate ?? null,
          timezone: PRODUCT_SOURCE_DEPARTURE_TIMEZONE,
          policyVersion: input.departureDateReference
            ? PRODUCT_SOURCE_DEPARTURE_DATE_POLICY_VERSION
            : null,
        },
        v3: {
          raw_text_hash: v3.raw_text_hash,
          structure_plan: v3.structure_plan,
          ledger: v3.ledger,
          match_summary: v3.match_summary,
          gate_result: v3.gate_result,
          // The deterministic ledger may choose a short filter header (for example
          // "#방콕") as its first title part. The canonical section title is selected
          // from the complete source section and is therefore the safer customer label.
          render_contract_preview: v3.render_contract_preview.map(preview => ({
            ...preview,
            title: section.titleHint ?? preview.title,
          })),
        },
        deterministicItinerary: tableItinerary
          ? {
              meta: {
                source: 'document_ir_table',
                table_id: tableItinerary.tableId,
                days: tableItinerary.days.length,
              },
              days: tableItinerary.days,
              flight_segments: tableItinerary.flightSegments,
            }
          : buildSupplierRawDeterministicItinerary(section.rawText),
        tableGridItinerary: tableItinerary
          ? { tableId: tableItinerary.tableId, sourceNodeIds: tableItinerary.sourceNodeIds }
          : tableItineraries.length > 1
            ? {
                byDuration: tableItineraries.map(candidate => ({
                  durationDays: candidate.days.length,
                  tableId: candidate.tableId,
                  sourceNodeIds: candidate.sourceNodeIds,
                })),
              }
            : null,
        multiItineraryResolution,
        tableGridCommercialTerms: tableCommercialTerms
          ? { tableId: tableCommercialTerms.tableId, sourceNodeIds: tableCommercialTerms.sourceNodeIds }
          : tableCommercialTermsByDuration.length > 0
            ? {
                byDuration: tableCommercialTermsByDuration.map(terms => ({
                  durationDays: terms.durationDays,
                  tableId: terms.tableId,
                  sourceNodeIds: terms.sourceNodeIds,
                })),
              }
            : null,
      };
      const completeness = evaluateCanonicalCompleteness({
        rawText: section.rawText,
        canonicalSection: payloadSection,
        sectionIndex: section.index,
      });
      const failedV3Checks = v3.gate_result.checks.filter(check => check.status === 'fail');
      const onlySafeDegradedV3Failures = failedV3Checks.length > 0 && failedV3Checks.every(check =>
        check.id.endsWith('.flight')
        || check.id.endsWith('.flight_times_complete')
        || check.id.endsWith('.hotel_or_notice')
      );
      v6GateAccepted.push(
        sectionDatePolicy.disposition === 'past_only_excluded'
        || gateStatus === 'ready_to_publish'
        || (completeness.publicationOutcome === 'degraded' && onlySafeDegradedV3Failures),
      );
      completenessResults.push(completeness);
      payloadSections.push({ ...payloadSection, completeness });
    } catch (error) {
      blockedSectionCount += 1;
      gateStatuses.push('error');
      v6GateAccepted.push(false);
      payloadSections.push({
        index: section.index,
        sectionKey: section.sectionKey,
        titleHint: section.titleHint,
        rawTextHash: section.rawTextHash,
        sourceNodeIds: section.sourceNodeIds,
        evidence: section.evidence,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const allSectionsReady = gateStatuses.length === segmented.sections.length
    && v6GateAccepted.length === segmented.sections.length
    && v6GateAccepted.every(Boolean);

  return {
    version: PRODUCT_REGISTRATION_V4_NORMALIZATION_VERSION,
    sourceDocumentId: input.sourceDocumentId,
    extractionId: input.extractionId,
    rawTextHash: sha256Hex(normalizeRawText(input.documentIr.text)),
    sections: segmented.sections,
    canonicalPayload: {
      sections: payloadSections,
      lineage: { attractionMasterHash },
    },
    lineage: { attractionMasterHash },
    qualityDiagnostics: {
      sectionCount: segmented.sections.length,
      normalizedSectionCount: payloadSections.filter(section => !section.error).length,
      blockedSectionCount,
      segmentationSource: segmented.segmentationSource,
      gateStatuses,
      completeness: {
        confirmedCount: completenessResults.reduce((sum, item) => sum + item.confirmedCount, 0),
        pendingSupplierCount: completenessResults.reduce((sum, item) => sum + item.pendingSupplierCount, 0),
        conflictingCount: completenessResults.reduce((sum, item) => sum + item.conflictingCount, 0),
        unavailableCount: completenessResults.reduce((sum, item) => sum + item.unavailableCount, 0),
        publicReadySectionCount: completenessResults.filter(item => item.publicReady).length,
        verifiedSectionCount: completenessResults.filter(item => item.publicationOutcome === 'verified').length,
        degradedSectionCount: completenessResults.filter(item => item.publicationOutcome === 'degraded').length,
        blockedSectionCount: completenessResults.filter(item => item.publicationOutcome === 'blocked').length,
        degradedReasons: completenessResults.flatMap(item => item.degradedReasons),
        blockers: completenessResults.flatMap(item => item.blockers),
        fields: completenessResults.flatMap(item => item.fields),
      },
      departureDatePolicy: {
        referenceDate: input.departureDateReference?.referenceDate ?? null,
        policyVersion: input.departureDateReference
          ? PRODUCT_SOURCE_DEPARTURE_DATE_POLICY_VERSION
          : null,
        inferredDateCount: datePolicyResults.reduce((sum, item) => sum + item.inferredDateCount, 0),
        explicitDateCount: datePolicyResults.reduce((sum, item) => sum + item.explicitDateCount, 0),
        excludedPastDateCount: datePolicyResults.reduce((sum, item) => sum + item.excludedPastDateCount, 0),
        futureDepartureCount: datePolicyResults.reduce((sum, item) => sum + item.futureDatedEntryCount, 0),
        pastOnlySectionIndexes: datePolicyResults
          .filter(item => item.disposition === 'past_only_excluded')
          .map(item => item.sectionIndex),
        blockers: datePolicyResults.flatMap(item => item.blockers),
      },
    },
    // V6 may accept only a narrow, explicit degraded subset (flight time and
    // source-marked equivalent/unconfirmed lodging). Every purchase-critical
    // gap remains fail-closed even if the legacy V3 gate only emitted a warn.
    status: allSectionsReady ? 'complete' : 'needs_review',
  };
}

export async function processProductRegistrationV4CanonicalNormalizationJob(input: {
  supabase: SupabaseClient;
  job: ProductRegistrationV4JobRecord;
  supplierProfileHints?: CatalogSegmentationProfileHints;
  allowEvidenceAiSegmentation?: boolean;
  executionMode?: CanonicalNormalizationExecutionMode;
}): Promise<{
  job: ProductRegistrationV4JobRecord;
  normalizationId: string;
  normalization: CanonicalNormalization;
  candidateSectionIndexes: number[];
  executionPolicy: CanonicalNormalizationExecutionPolicy;
}> {
  const job = input.job;
  if (!job.source_document_id || !job.extraction_id) throw new Error('CANONICAL_LINEAGE_REQUIRED');
  const executionPolicy = canonicalNormalizationExecutionPolicy(input.executionMode);

  try {
    if (!executionPolicy.commitRevisions && (
      (Array.isArray(job.v4_stage_state.v5RevisionIds) && job.v4_stage_state.v5RevisionIds.length > 0)
      || typeof job.v4_stage_state.v5RevisionId === 'string'
    )) {
      throw new Error('ANALYSIS_ONLY_JOB_ALREADY_HAS_REVISION');
    }
    const { data: extraction, error: extractionError } = await input.supabase
      .from('product_document_extractions')
      .select('id, source_document_id, document_ir')
      .eq('id', job.extraction_id)
      .eq('source_document_id', job.source_document_id)
      .eq('tenant_id', job.tenant_id)
      .single();
    if (extractionError) throw extractionError;
    const documentIr = extraction?.document_ir as DocumentIR;
    const attractions = await loadActiveAttractions(input.supabase);
    const sourceDepartureYearContext = parseProductSourceDepartureYearContext(
      job.v4_stage_state.sourceDepartureYearContext,
    );
    if (!sourceDepartureYearContext.ok) throw new Error(sourceDepartureYearContext.code);
    const departureDateReference = job.v6_date_policy_version === PRODUCT_SOURCE_DEPARTURE_DATE_POLICY_VERSION
      ? {
          referenceDate: assertProductDepartureReferenceDate(job.v6_reference_date ?? ''),
          rollingInferenceEligible:
            job.v4_stage_state.rollingDepartureDateInferenceEligible === true,
        }
      : null;
    const normalization = await buildCanonicalNormalization({
      documentIr,
      sourceDocumentId: job.source_document_id,
      extractionId: job.extraction_id,
      attractions,
      criticalPriceOverrides: parseCriticalPriceFactOverrides(job.v4_stage_state.criticalPriceOverrides),
      sourceDepartureYearContext: sourceDepartureYearContext.value,
      departureDateReference,
      supplierProfileHints: input.supplierProfileHints,
      allowEvidenceAiSegmentation: input.allowEvidenceAiSegmentation,
    });
    const persistedNormalizationVersion = executionPolicy.mode === 'analysis_only'
      ? `${normalization.version}:analysis-only-1`
      : normalization.version;
    const { data, error } = await input.supabase
      .from('product_registration_v4_normalizations')
      .upsert({
        tenant_id: job.tenant_id,
        job_id: job.id,
        source_document_id: job.source_document_id,
        extraction_id: job.extraction_id,
        normalization_version: persistedNormalizationVersion,
        raw_text_hash: normalization.rawTextHash,
        sections: normalization.sections,
        canonical_payload: normalization.canonicalPayload,
        quality_diagnostics: normalization.qualityDiagnostics,
        status: normalization.status,
      }, { onConflict: 'job_id,normalization_version,raw_text_hash' })
      .select('id')
      .single();
    if (error) throw error;
    const normalizationId = String((data as { id?: unknown }).id);
    const v5RevisionIds: string[] = [];
    const catalogProductIds: string[] = [];
    const correctionCatalogProductId = typeof job.v4_stage_state.correctionCatalogProductId === 'string'
      ? job.v4_stage_state.correctionCatalogProductId
      : null;
    const correctionBaseRevisionId = typeof job.v4_stage_state.correctionBaseRevisionId === 'string'
      ? job.v4_stage_state.correctionBaseRevisionId
      : null;
    const correctionProductKey = typeof job.v4_stage_state.correctionProductKey === 'string'
      ? job.v4_stage_state.correctionProductKey
      : null;
    const authorityBindingTargetTitle = typeof job.v4_stage_state.authorityBindingTargetTitle === 'string'
      ? job.v4_stage_state.authorityBindingTargetTitle
      : null;
    const authorityBindingTargetInternalCode = typeof job.v4_stage_state.authorityBindingTargetInternalCode === 'string'
      ? job.v4_stage_state.authorityBindingTargetInternalCode
      : null;
    const authorityBindingKind = job.v4_stage_state.authorityBindingKind === 'legacy_backfill'
      ? 'legacy_backfill'
      : 'correction';
    if (correctionCatalogProductId && (
      !correctionProductKey
      || (authorityBindingKind === 'correction' && !correctionBaseRevisionId)
    )) {
      throw new Error('REGISTRATION_CORRECTION_IDENTITY_AMBIGUOUS');
    }
    const boundSection = correctionCatalogProductId
      ? selectCanonicalSectionForIdentity(normalization.sections, {
          title: authorityBindingTargetTitle,
          internalCode: authorityBindingTargetInternalCode,
        })
      : null;
    if (correctionCatalogProductId && !boundSection) {
      throw new Error('REGISTRATION_CORRECTION_IDENTITY_AMBIGUOUS');
    }
    const pastOnlySectionIndexSet = new Set(
      normalization.qualityDiagnostics.departureDatePolicy.pastOnlySectionIndexes,
    );
    const candidateRevisionSourceSections = boundSection ? [boundSection] : normalization.sections;
    const nonPastRevisionSourceSections = candidateRevisionSourceSections.filter(
      section => !pastOnlySectionIndexSet.has(section.index),
    );
    const canonicalPayloadSections = Array.isArray(normalization.canonicalPayload.sections)
      ? normalization.canonicalPayload.sections
      : [];
    const salePricePartition = partitionProductSectionsBySalePrice({
      sections: nonPastRevisionSourceSections,
      canonicalSections: canonicalPayloadSections,
      documentText: documentIr.text,
      sourceSectionCount: normalization.sections.length,
    });
    const revisionSourceSections = salePricePartition.eligibleSections;
    const discardedMissingSalePriceSectionIndexes = salePricePartition.discardedSectionIndexes;
    const revisionSlices = buildCanonicalRevisionSlices(normalization, revisionSourceSections);
    if (correctionCatalogProductId && revisionSlices.length > 1) {
      // A correction is bound to one stable catalog product. Never guess which
      // variant of a newly re-extracted multi-product source should replace it.
      throw new Error('REGISTRATION_CORRECTION_VARIANT_IDENTITY_AMBIGUOUS');
    }
    const revisionSectionIndexes = revisionSlices.map(slice => slice.sectionIndex);
    let v5ShadowDiffSummary: Record<string, unknown> | null = null;
    if (executionPolicy.commitRevisions && (
      process.env.PRODUCT_REGISTRATION_V5_SHADOW === '1'
      || getProductRegistrationV6RuntimeConfig().workflowEnabled
    )) {
      const { data: legacyDraft, error: legacyDraftError } = await input.supabase
        .from('product_registration_drafts')
        .select('ledger')
        .eq('upload_job_id', job.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (legacyDraftError) {
        console.warn('[Product Registration V5] V3 shadow diff unavailable:', legacyDraftError.message);
        v5ShadowDiffSummary = { status: 'unavailable', reason: legacyDraftError.message };
      } else if (legacyDraft?.ledger) {
        const diff = buildV3V5CriticalDiff({
          legacyPayload: { sections: [{ v3: { ledger: legacyDraft.ledger } }] },
          canonicalPayload: normalization.canonicalPayload,
        });
        v5ShadowDiffSummary = {
          status: 'complete',
          criticalMismatch: diff.criticalMismatch,
          highMismatch: diff.highMismatch,
          matchedCriticalFieldCount: diff.matchedCriticalFieldCount,
          mismatchedCriticalFieldCount: diff.mismatchedCriticalFieldCount,
          mismatches: diff.diffs.filter(item => item.kind !== 'match').slice(0, 100),
        };
      } else {
        v5ShadowDiffSummary = { status: 'unavailable', reason: 'V3_DRAFT_NOT_FOUND' };
      }
      const shadowDiffBlocked = v5ShadowDiffSummary?.status === 'complete'
        && (v5ShadowDiffSummary.criticalMismatch === true || v5ShadowDiffSummary.highMismatch === true);
      for (const slice of revisionSlices) {
        const section = slice.section;
        const v5Build = buildProductRegistrationV5Revision({
          tenantId: job.tenant_id,
          packageId: null,
          jobId: job.id,
          normalizationId,
          sourceDocumentId: job.source_document_id,
          extractionId: job.extraction_id,
          normalization: {
            ...normalization,
            lineage: normalization.lineage,
            status: shadowDiffBlocked ? 'needs_review' : normalization.status,
            rawTextHash: section.rawTextHash,
            sections: [section],
            canonicalPayload: slice.canonicalPayload,
          },
        });
        const domainProjection = buildProductRegistrationV6DomainProjection({
          canonicalPayload: slice.canonicalPayload,
          packageId: null,
        });
        if (correctionBaseRevisionId) v5Build.supersedesRevisionId = correctionBaseRevisionId;
        const persisted = await commitCanonicalRevisionAtomic({
          supabase: input.supabase,
          commit: {
            tenantId: job.tenant_id,
            productKey: correctionProductKey
              ?? `source:${job.source_document_id}:section:${section.sectionKey}${slice.productKeySuffix}`,
            sourceChannel: correctionCatalogProductId
              ? authorityBindingKind
              : job.v6_source_channel ?? 'upload',
            operationKey: `kernel:${job.id}:${normalizationId}:${section.sectionKey}:${v5Build.payloadHash}`,
            catalogProductId: correctionCatalogProductId,
            build: v5Build,
            sections: [slice.section],
            domainProjection,
          },
        });
        v5RevisionIds.push(persisted.revisionId);
        catalogProductIds.push(persisted.catalogProductId);
      }
    }
    const updatedJob = await transitionProductRegistrationV4Job({
      supabase: input.supabase,
      jobId: job.id,
      stage: normalization.status === 'complete' ? 'normalized' : 'needs_review',
      status: canonicalNormalizationJobStatus({
        normalizationStatus: normalization.status,
        workflowEnabled: getProductRegistrationV6RuntimeConfig().workflowEnabled,
      }),
      state: {
        normalizationId,
        normalizationVersion: persistedNormalizationVersion,
        v5RevisionIds,
        v5RevisionId: v5RevisionIds[0] ?? null,
        catalogProductIds,
        catalogProductId: catalogProductIds[0] ?? null,
        revisionSectionIndexes: executionPolicy.commitRevisions ? revisionSectionIndexes : [],
        analysisCandidateSectionIndexes: revisionSectionIndexes,
        canonicalNormalizationMode: executionPolicy.mode,
        pastOnlySectionIndexes: normalization.qualityDiagnostics.departureDatePolicy.pastOnlySectionIndexes,
        discardedMissingSalePriceSectionIndexes,
        sourceSalePriceDispositions: salePricePartition.dispositions,
        departureDateReference: normalization.qualityDiagnostics.departureDatePolicy.referenceDate,
        departureDatePolicyVersion: normalization.qualityDiagnostics.departureDatePolicy.policyVersion,
        inferredDepartureDateCount: normalization.qualityDiagnostics.departureDatePolicy.inferredDateCount,
        excludedPastDateCount: normalization.qualityDiagnostics.departureDatePolicy.excludedPastDateCount,
        futureDepartureCount: normalization.qualityDiagnostics.departureDatePolicy.futureDepartureCount,
        ...(v5ShadowDiffSummary ? { v5ShadowDiff: v5ShadowDiffSummary } : {}),
        rawTextHash: normalization.rawTextHash,
        sectionCount: normalization.qualityDiagnostics.sectionCount,
        normalizedSectionCount: normalization.qualityDiagnostics.normalizedSectionCount,
        blockedSectionCount: normalization.qualityDiagnostics.blockedSectionCount,
        segmentationSource: normalization.qualityDiagnostics.segmentationSource,
      },
      canonicalNormalizationId: normalization.status === 'complete' ? normalizationId : null,
      clearLease: true,
      reviewReasons: normalization.status === 'complete' ? [] : ['CANONICAL_NORMALIZATION_REVIEW_REQUIRED'],
      errorCode: normalization.status === 'complete' ? null : 'CANONICAL_NORMALIZATION_REVIEW_REQUIRED',
      errorDetail: normalization.status === 'complete' ? null : 'One or more canonical sections failed the V3 gate.',
    });
    return {
      job: updatedJob,
      normalizationId,
      normalization,
      candidateSectionIndexes: revisionSectionIndexes,
      executionPolicy,
    };
  } catch (error) {
    const message = describeRegistrationError(error);
    await transitionProductRegistrationV4Job({
      supabase: input.supabase,
      jobId: job.id,
      stage: 'failed',
      status: 'failed',
      errorCode: registrationErrorCode(error, 'CANONICAL_NORMALIZATION_FAILED'),
      errorDetail: message,
      reviewReasons: ['CANONICAL_NORMALIZATION_FAILED'],
    }).catch(() => undefined);
    throw error instanceof Error ? error : new Error(message, { cause: error });
  }
}

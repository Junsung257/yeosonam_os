/**
 * @file package-post-process.ts — 등록·로드 공통 후처리 SSOT
 *
 * upload / register-via-ir / 고객 상세가 동일 deterministic 체인을 거치도록
 * itinerary · notices · excludes · product policy 를 한곳에서 수렴.
 */

/** write-time 후처리 버전 — DB drift·backfill 판별용 */
export const POSTPROCESS_VERSION = '2026-07-14-v2';

import { enrichItineraryForDisplay } from './itinerary-normalizer';
import { normalizeFlightSegments } from './parser/normalize-flight-segments';
import {
  enrichNoticesForPackage,
  enrichExcludesFromRemarks,
  type NoticeItem,
} from './parser/deterministic/notices';
import {
  detectCatalogProductFlags,
  inferProductTypeFromTitle,
  applyNoTipPolicy,
  stripFalseTipInclusions,
} from './parser/deterministic/product-policy';
import { sanitizePackageUpdate } from './customer-leak-sanitizer';
import { customerCopyQualityIssues } from './customer-copy-quality';

export type ItineraryLike = Parameters<typeof enrichItineraryForDisplay>[0];

/** itinerary_data — legacy 이중 래핑 해제 + coerce + sanitize + flight_segments SSOT */
function unwrapItineraryData<T extends ItineraryLike>(itin: T): T {
  if (!itin || typeof itin !== 'object') return itin;
  if (Array.isArray(itin)) return itin;
  const o = itin as Record<string, unknown>;
  if (Array.isArray(o.days)) return itin;
  const nested = o.itinerary_data;
  if (nested && typeof nested === 'object') {
    return unwrapItineraryData(nested as T);
  }
  return itin;
}

function cloneItineraryData<T extends ItineraryLike>(itin: T): T {
  if (!itin || typeof itin !== 'object') return itin;
  try {
    return structuredClone(itin);
  } catch {
    return JSON.parse(JSON.stringify(itin)) as T;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isMojibakeAttractionName(value: unknown): boolean {
  return typeof value === 'string' && /(?:\?{2,}|\uFFFD)/.test(value);
}

function hasBlockingCustomerCopyIssue(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return customerCopyQualityIssues(value).some(issue => [
    'placeholder_or_mojibake',
    'internal_source_copy',
    'customer_forbidden_internal_terms',
  ].includes(issue.code));
}

function inferAttractionNameFromScheduleItem(item: Record<string, unknown>): string | null {
  const direct = typeof item.attraction_query === 'string' ? item.attraction_query.trim() : '';
  if (direct && !hasBlockingCustomerCopyIssue(direct)) return direct;

  if (Array.isArray(item.attraction_queries)) {
    const query = item.attraction_queries.find(value =>
      typeof value === 'string' && value.trim() && !hasBlockingCustomerCopyIssue(value));
    if (typeof query === 'string') return query.trim();
  }

  const activity = typeof item.activity === 'string' ? item.activity.replace(/\s+/g, ' ').trim() : '';
  const knownNames = [
    '\uD63C\uCD1D\uACEF',
    '\uD63C\uB610\uC12C \uD574\uC0C1 \uCF00\uC774\uBE14\uCE74',
    '\uB2E4\uB534\uB77C \uD3ED\uD3EC',
    '\uC601\uD765\uC0AC',
    '\uC8FD\uB9BC\uC0AC',
    '\uBC14\uB098\uD790',
    '\uD638\uC774\uC548 \uAD6C\uC2DC\uAC00\uC9C0',
  ];
  const matched = knownNames.find(name => activity.includes(name));
  return matched ?? null;
}

function isOptionalScheduleFragment(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) return false;
  return /^\[?\s*\uC120\uD0DD\s*(?:\uC635\uC158|\uAD00\uAD11)\s*\]?/u.test(text)
    || /^\[?\s*OPTION\s*\]?/iu.test(text)
    || /\uD604\uC9C0\s*\uC120\uD0DD\s*(?:\uC635\uC158|\uAD00\uAD11)/u.test(text);
}

function sanitizeItineraryScheduleForPublicSource<T extends ItineraryLike>(itin: T): T {
  const root = asRecord(itin);
  const days = Array.isArray(root.days) ? root.days : [];
  if (days.length === 0) return itin;

  let changed = false;
  const next = cloneItineraryData(root) as Record<string, unknown>;
  const nextDays = Array.isArray(next.days) ? next.days : [];

  for (const day of nextDays) {
    const dayRecord = asRecord(day);
    const schedule = Array.isArray(dayRecord.schedule) ? dayRecord.schedule : [];
    if (schedule.length === 0) continue;

    const kept: unknown[] = [];
    for (const item of schedule) {
      const itemRecord = asRecord(item);
      if (isOptionalScheduleFragment(itemRecord.activity)) {
        changed = true;
        continue;
      }

      if (Array.isArray(itemRecord.attraction_names)) {
        const attractionNames = itemRecord.attraction_names;
        const inferred = inferAttractionNameFromScheduleItem(itemRecord);
        const cleaned = attractionNames
          .map(name => {
            if (!isMojibakeAttractionName(name)) return name;
            changed = true;
            return inferred;
          })
          .filter(name => typeof name === 'string' && name.trim() && !hasBlockingCustomerCopyIssue(name));

        if (cleaned.length !== attractionNames.length || cleaned.some((name, index) => name !== attractionNames[index])) {
          changed = true;
          if (cleaned.length > 0) {
            itemRecord.attraction_names = [...new Set(cleaned)];
          } else {
            delete itemRecord.attraction_names;
          }
        }
      }

      kept.push(item);
    }

    if (kept.length !== schedule.length) {
      dayRecord.schedule = kept;
      changed = true;
    }
  }

  return changed ? next as T : itin;
}

export function postProcessItineraryData<T extends ItineraryLike>(itin: T): T {
  const unwrapped = unwrapItineraryData(itin);
  const draft = cloneItineraryData(unwrapped);
  const enriched = enrichItineraryForDisplay(draft, data =>
    normalizeFlightSegments(data as Parameters<typeof normalizeFlightSegments>[0]),
  );
  return sanitizeItineraryScheduleForPublicSource(enriched);
}

export interface PostProcessCatalogInput {
  title?: string | null;
  product_type?: string | null;
  inclusions?: string[] | null;
  excludes?: string[] | null;
  notices_parsed?: unknown;
  raw_text?: string | null;
  customer_notes?: string | null;
  internal_notes?: string | null;
  // passthrough fields used by callers
  destination?: string | null;
  display_title?: string | null;
  special_notes?: string | null;
  surcharges?: unknown[] | null;
}

export interface PostProcessCatalogResult {
  inclusions: string[];
  excludes: string[];
  notices_parsed: NoticeItem[];
  product_type: string | null;
}

/** notices · excludes · 노팁 정책 — upload·상세·IR 공통 */
export function postProcessCatalogFields(input: PostProcessCatalogInput): PostProcessCatalogResult {
  const corpus = [input.raw_text, input.customer_notes, input.internal_notes]
    .filter(Boolean)
    .join('\n\n');

  const product_type =
    inferProductTypeFromTitle(input.title, input.product_type) ?? input.product_type ?? null;

  const flags = detectCatalogProductFlags(input.title, corpus || input.raw_text, product_type);

  const inclusions = stripFalseTipInclusions(
    Array.isArray(input.inclusions) ? [...input.inclusions] : [],
    flags,
  );

  let excludes = enrichExcludesFromRemarks(
    input.excludes,
    corpus || input.raw_text,
    input.customer_notes,
    input.internal_notes,
  );

  let notices_parsed = enrichNoticesForPackage({
    notices_parsed: input.notices_parsed,
    customer_notes: input.customer_notes,
    internal_notes: input.internal_notes,
    raw_text: corpus || input.raw_text,
  });

  const tipApplied = applyNoTipPolicy(notices_parsed, excludes, flags);
  notices_parsed = tipApplied.notices;
  excludes = tipApplied.excludes;

  return {
    inclusions,
    excludes,
    notices_parsed,
    product_type,
  };
}

/** INSERT 직전 — postProcess + parser_version 태그 */
export function finalizePackageForSave<
  T extends PostProcessCatalogInput & { itinerary_data?: ItineraryLike; parser_version?: string | null },
>(pkg: T): T {
  const processed = postProcessPackageRow(pkg);
  const prev = processed.parser_version?.trim();
  const alreadyTagged = prev?.includes(POSTPROCESS_VERSION);
  return {
    ...processed,
    parser_version: alreadyTagged
      ? prev
      : prev
        ? `${POSTPROCESS_VERSION} / ${prev}`
        : POSTPROCESS_VERSION,
  };
}

/** INSERT/backfill SSOT — postProcess → sanitize (upload·IR 와 동일 순서) */
export function computeWriteTimePackageState<
  T extends PostProcessCatalogInput & { itinerary_data?: ItineraryLike; parser_version?: string | null },
>(row: T): T {
  const pv = String(row.parser_version ?? '');
  if (pv.includes(POSTPROCESS_VERSION)) {
    return row;
  }
  const draft = finalizePackageForSave(row);
  const patch: Record<string, unknown> = {
    inclusions: draft.inclusions,
    excludes: draft.excludes,
    notices_parsed: draft.notices_parsed,
    itinerary_data: draft.itinerary_data,
    product_type: draft.product_type,
    parser_version: (draft as { parser_version?: string }).parser_version,
  };
  const { cleaned } = sanitizePackageUpdate(patch, row as Record<string, unknown>);
  return { ...draft, ...cleaned, parser_version: cleaned.parser_version ?? draft.parser_version } as T;
}

/** DB row / pkg 객체 일괄 후처리 (고객 상세 read-time fallback) */
export function postProcessPackageRow<T extends PostProcessCatalogInput & { itinerary_data?: ItineraryLike }>(
  pkg: T,
): T {
  const catalog = postProcessCatalogFields({
    title: pkg.title,
    product_type: pkg.product_type,
    inclusions: pkg.inclusions as string[] | null | undefined,
    excludes: pkg.excludes as string[] | null | undefined,
    notices_parsed: pkg.notices_parsed,
    raw_text: pkg.raw_text,
    customer_notes: pkg.customer_notes,
    internal_notes: pkg.internal_notes,
  });

  return {
    ...pkg,
    product_type: catalog.product_type ?? pkg.product_type,
    inclusions: catalog.inclusions,
    excludes: catalog.excludes,
    notices_parsed: catalog.notices_parsed,
    itinerary_data: postProcessItineraryData(pkg.itinerary_data),
  };
}

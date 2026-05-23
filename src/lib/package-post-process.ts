/**
 * @file package-post-process.ts — 등록·로드 공통 후처리 SSOT
 *
 * upload / register-via-ir / 고객 상세가 동일 deterministic 체인을 거치도록
 * itinerary · notices · excludes · product policy 를 한곳에서 수렴.
 */

/** write-time 후처리 버전 — DB drift·backfill 판별용 */
export const POSTPROCESS_VERSION = '2026-05-22-v1';

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

export function postProcessItineraryData<T extends ItineraryLike>(itin: T): T {
  const unwrapped = unwrapItineraryData(itin);
  return enrichItineraryForDisplay(unwrapped, data =>
    normalizeFlightSegments(data as Parameters<typeof normalizeFlightSegments>[0]),
  );
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

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

/** Add only course names and round length explicitly present in the source. */
export function attachSourceBackedGolfRemarks<T extends ItineraryLike>(
  itin: T,
  rawText: string | null | undefined,
): T {
  if (!itin || !rawText || !/(?:골프|18\s*H|18홀)/iu.test(rawText)) return itin;
  const root = asRecord(itin);
  const highlights = asRecord(root.highlights);
  const existing = Array.isArray(highlights.remarks)
    ? highlights.remarks.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];
  const courseNames: string[] = [];
  for (const rawLine of rawText.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    if (!/18\s*H|18홀/iu.test(line)) continue;
    const name = line
      .replace(/\s*(?:18\s*H|18홀).*$/iu, '')
      .replace(/[|:·,]+$/g, '')
      .trim();
    if (!name || name.length > 40 || /^(?:예정 골프장|골프장|일정|일자)$/iu.test(name)) continue;
    if (!courseNames.includes(name)) courseNames.push(name);
  }
  const cleanedCourseNames = courseNames
    .map(name => name.replace(/(?:예정\s*골프장|골프장)\s*$/u, '').replace(/[|:쨌,]+$/g, '').trim())
    .filter(name => name.length > 0);
  courseNames.splice(0, courseNames.length, ...Array.from(new Set(cleanedCourseNames)));
  const remarks = [...existing];
  if (courseNames.length > 0 && !remarks.some(value => /예정 골프장/iu.test(value))) {
    remarks.push(`일정표 기준 예정 골프장: ${courseNames.slice(0, 8).join(', ')}${courseNames.length > 8 ? ' 외' : ''}`);
  }
  if (!remarks.some(value => /18\s*H|18홀/iu.test(value))) {
    remarks.push('일정표 기준 골프 라운딩은 18홀입니다.');
  }
  if (remarks.length === existing.length) return itin;
  return { ...root, highlights: { ...highlights, remarks } } as unknown as T;
}

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

/**
 * Legacy day rows can carry an older transport code even when the same
 * itinerary has source-backed `flight_segments`. Align the persisted
 * customer snapshot as well as the renderer so every surface shows the same
 * flight number.
 */
function alignItineraryFlightCodes<T extends ItineraryLike>(itin: T): T {
  const root = asRecord(itin);
  const segments = Array.isArray(root.flight_segments)
    ? root.flight_segments.map(asRecord).filter(segment => typeof segment.flight_no === 'string' && segment.flight_no.trim())
    : [];
  const days = Array.isArray(root.days) ? root.days : [];
  if (segments.length === 0 || days.length === 0) return itin;

  const next = cloneItineraryData(root) as Record<string, unknown>;
  const nextDays = Array.isArray(next.days) ? next.days : [];
  let changed = false;

  // Keep legacy itinerary summary metadata aligned with source-backed flight segments.
  const nextMeta = asRecord(next.meta);
  const outbound = segments.find(segment => segment.leg === 'outbound');
  const inbound = segments.find(segment => segment.leg === 'inbound');
  if (outbound && nextMeta.flight_out !== outbound.flight_no) {
    nextMeta.flight_out = outbound.flight_no;
    changed = true;
  }
  if (inbound && nextMeta.flight_in !== inbound.flight_no) {
    nextMeta.flight_in = inbound.flight_no;
    changed = true;
  }
  if (Object.keys(nextMeta).length > 0) next.meta = nextMeta;

  nextDays.forEach((day, dayIndex) => {
    const dayRecord = asRecord(day);
    const schedule = Array.isArray(dayRecord.schedule) ? dayRecord.schedule : [];
    const daySegments = segments.filter(segment => {
      const pair = segment.day_pair;
      if (Array.isArray(pair) && typeof pair[0] === 'number') return pair[0] === dayIndex;
      return (segment.leg === 'outbound' && dayIndex === 0)
        || (segment.leg === 'inbound' && dayIndex === nextDays.length - 1);
    });
    if (daySegments.length === 0) return;

    const code = String(daySegments[0].flight_no).trim();
    let dayChanged = false;
    const aligned = schedule.map(item => {
      const record = asRecord(item);
      const activity = typeof record.activity === 'string' ? record.activity : '';
      const isFlightLike = record.type === 'flight'
        || record.entity_kind === 'flight'
        || /(?:국제선\s*(?:출발|도착)|\b(?:PUS|FUK)\s*→)/i.test(activity);
      if (!isFlightLike || record.transport === code) return item;
      changed = true;
      dayChanged = true;
      return { ...record, transport: code };
    });
    if (dayChanged) dayRecord.schedule = aligned;
  });

  return changed ? next as T : itin;
}

function enforcePublicationTransportSafety<T extends ItineraryLike>(itin: T): T {
  const root = asRecord(itin);
  const segments = Array.isArray(root.flight_segments)
    ? root.flight_segments.map(asRecord)
    : [];
  const unsafeServiceNumbers = new Set(segments
    .filter(segment => ['degraded', 'conflicting'].includes(String(segment.v6_fact_state ?? '')))
    .map(segment => String(segment.flight_no ?? segment.code ?? '').replace(/\s+/g, '').toUpperCase())
    .filter(Boolean));
  if (unsafeServiceNumbers.size === 0 || !Array.isArray(root.days)) return itin;
  const next = cloneItineraryData(root) as Record<string, unknown>;
  next.days = (next.days as unknown[]).map(rawDay => {
    const day = asRecord(rawDay);
    if (!Array.isArray(day.schedule)) return day;
    return {
      ...day,
      schedule: day.schedule.map(rawItem => {
        const item = asRecord(rawItem);
        const serviceNumber = String(item.transport ?? item.flight_no ?? item.code ?? '')
          .replace(/\s+/g, '').toUpperCase();
        if (!unsafeServiceNumbers.has(serviceNumber)) return item;
        const scrubText = (value: unknown): unknown => {
          if (typeof value !== 'string') return value;
          return value
            .replace(/\([^)]*\b\d{1,2}:\d{2}\b[^)]*\)/g, '(운항일 기준 상담 시 최종 확인)')
            .replace(/\b\d{1,2}:\d{2}\b/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        };
        const {
          time: _time,
          dep_time: _departureTime,
          arr_time: _arrivalTime,
          departure_local_time: _departureLocalTime,
          arrival_local_time: _arrivalLocalTime,
          ...safeItem
        } = item;
        return {
          ...safeItem,
          activity: scrubText(item.activity),
          note: scrubText(item.note),
          a4_sentence: scrubText(item.a4_sentence),
          landing_sentence: scrubText(item.landing_sentence),
          v6_schedule_notice: '운항일 기준 상담 시 최종 확인',
        };
      }),
    };
  });
  return next as T;
}

export function postProcessItineraryData<T extends ItineraryLike>(itin: T): T {
  const unwrapped = unwrapItineraryData(itin);
  const draft = alignItineraryFlightCodes(cloneItineraryData(unwrapped));
  const enriched = enrichItineraryForDisplay(draft, data =>
    normalizeFlightSegments(data as Parameters<typeof normalizeFlightSegments>[0]),
  );
  return enforcePublicationTransportSafety(
    alignItineraryFlightCodes(sanitizeItineraryScheduleForPublicSource(enriched)),
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
